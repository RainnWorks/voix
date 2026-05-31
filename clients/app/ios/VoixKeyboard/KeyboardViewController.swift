//
//  KeyboardViewController.swift
//  VoixKeyboard
//
//  voix custom keyboard extension. Bounces to the host app for capture
//  (Apple blocks mic access in keyboard extensions) and inserts the
//  polished transcript on return via shared App Group container.
//
//  Memory budget: keep total RSS under 30 MB during idle. SwiftUI is
//  fine; no third-party libs; no heavy async chains. Apple's hard
//  limit for keyboard extensions is ~48 MB before iOS terminates.
//
//  Step 5 (this commit): SwiftUI root, pill bounces via
//  extensionContext.open, Full Access onboarding when off, Settings
//  deep-link, globe key switches input mode. The actual return flow
//  (read shared container + insertText) lands in step 7 alongside
//  the polling timer and timeout — for now, viewDidAppear logs the
//  bounce result so step 5's smoke can confirm the URL handler fires.
//
import SwiftUI
import UIKit
import os

final class KeyboardViewController: UIInputViewController {

    private static let log = OSLog(
        subsystem: "co.rowm.voix.keyboard",
        category: "lifecycle"
    )

    private let state = KeyboardState()
    private var hostingController: UIHostingController<KeyboardRootView>?

    override func viewDidLoad() {
        super.viewDidLoad()
        os_log("voix kbd: viewDidLoad", log: Self.log, type: .info)
        probeSharedContainer()
        SharedContainer.sweepOrphans()
        installSwiftUIRoot()
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        os_log(
            "voix kbd: viewWillAppear hasFullAccess=%{public}@ phase=%{public}@",
            log: Self.log,
            type: .info,
            String(describing: hasFullAccess),
            String(describing: state.phase)
        )
        // Re-render with latest Full Access status — user may have
        // just toggled it in Settings.
        refreshHostingController()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        // Step 5: if we're mid-bounce, log it; step 7 implements the
        // actual readState → insertText flow.
        if case let .bounced(sessionId, _) = state.phase {
            os_log(
                "voix kbd: viewDidAppear during bounce session=%{public}@ (read flow lands in step 7)",
                log: Self.log,
                type: .info,
                sessionId
            )
        }
    }

    // MARK: - SwiftUI host

    private func installSwiftUIRoot() {
        let root = makeRootView()
        let hosting = UIHostingController(rootView: root)
        hosting.view.translatesAutoresizingMaskIntoConstraints = false
        hosting.view.backgroundColor = .clear
        addChild(hosting)
        view.addSubview(hosting.view)
        NSLayoutConstraint.activate([
            hosting.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            hosting.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            hosting.view.topAnchor.constraint(equalTo: view.topAnchor),
            hosting.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
        hosting.didMove(toParent: self)
        hostingController = hosting
    }

    private func refreshHostingController() {
        hostingController?.rootView = makeRootView()
    }

    private func makeRootView() -> KeyboardRootView {
        KeyboardRootView(
            state: state,
            hasFullAccess: hasFullAccess,
            onTalkTap: { [weak self] in self?.handleTalkTap() },
            onOpenSettings: { [weak self] in self?.openSettings() },
            onGlobeTap: { [weak self] in self?.advanceToNextInputMode() },
            onGlobeLongPress: { [weak self] in self?.showInputSwitcher() }
        )
    }

    // MARK: - Diagnostics

    private func probeSharedContainer() {
        // Step 3 smoke: confirm App Group entitlement landed. If the
        // entitlements file drifted between host and extension, the
        // container URL is nil and the keyboard cannot read host
        // state. Architect Risk 4.
        if let dir = SharedContainer.sessionsDirectoryURL() {
            os_log(
                "voix kbd: shared container OK at %{public}@",
                log: Self.log,
                type: .info,
                dir.path
            )
        } else {
            os_log(
                "voix kbd: shared container UNAVAILABLE — check App Group entitlement",
                log: Self.log,
                type: .error
            )
        }
    }

    // MARK: - Actions

    private func handleTalkTap() {
        guard hasFullAccess else {
            // SwiftUI should already be showing the onboarding stack,
            // but in case the user re-tapped during a state-change
            // race we no-op rather than silently failing.
            os_log("voix kbd: tap with no Full Access — refusing bounce",
                   log: Self.log, type: .info)
            return
        }
        // Write the pending session record to the shared container
        // before opening the URL — the host needs to see status=pending
        // when its Linking handler fires.
        let sessionId = CaptureSession.newSessionId()
        let pending = KeyboardSessionState(sessionId: sessionId)
        do {
            try SharedContainer.writeState(pending)
        } catch {
            os_log(
                "voix kbd: writeState failed: %{public}@",
                log: Self.log,
                type: .error,
                String(describing: error)
            )
            state.showToast("voix couldn't start")
            return
        }
        guard let url = CaptureSession.captureURL(sessionId: sessionId) else {
            os_log("voix kbd: failed to build capture URL", log: Self.log, type: .error)
            state.showToast("voix couldn't start")
            return
        }
        os_log("voix kbd: bouncing to host session=%{public}@",
               log: Self.log, type: .info, sessionId)
        state.phase = .bounced(sessionId: sessionId, startedAt: Date())
        refreshHostingController()
        extensionContext?.open(url) { [weak self] success in
            guard let self else { return }
            if !success {
                os_log("voix kbd: extensionContext.open returned false",
                       log: Self.log, type: .error)
                DispatchQueue.main.async {
                    self.state.phase = .idle
                    self.state.showToast("voix host app not found")
                    self.refreshHostingController()
                }
            }
        }
    }

    private func openSettings() {
        // From an app extension, the only Settings deep-link Apple
        // exposes is `app-settings:` pointing at the HOST app's
        // settings pane. There's no public scheme that drops the user
        // directly on the Keyboard → voix → Allow Full Access row;
        // the host app's Settings screen owns guiding the user from
        // there (Decision 5).
        guard let url = URL(string: UIApplication.openSettingsURLString) else {
            return
        }
        extensionContext?.open(url) { success in
            os_log("voix kbd: openSettings success=%{public}@",
                   log: Self.log, type: .info, String(describing: success))
        }
    }

    private func showInputSwitcher() {
        // Long-press on the globe key shows the system input-mode
        // switcher; the framework needs a `from` view + event to
        // anchor the popover.
        if let target = hostingController?.view {
            handleInputModeList(from: target, with: UIEvent())
        }
    }
}
