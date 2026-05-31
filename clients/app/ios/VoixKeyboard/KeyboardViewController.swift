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
//  Step 7 (this commit): closes the return loop.
//   - viewDidAppear reads <session_id>.json from the shared container;
//     on status=done, inserts the transcript via textDocumentProxy
//     and clears both files.
//   - 500ms poll timer covers the rare "user re-foregrounded the text
//     field while the host is still capturing" race.
//   - 60s hard timeout fires from bounce start — if the host crashed
//     mid-capture or never returned, the pill returns to idle with a
//     "voix couldn't record" toast.
//   - Orphan sweep on launch removes >5min-old session files.
//
import SwiftUI
import UIKit
import os

final class KeyboardViewController: UIInputViewController {

    private static let log = OSLog(
        subsystem: "co.rowm.voix.keyboard",
        category: "lifecycle"
    )

    /// 60 seconds from bounce-out (Architect Decision 6). Long enough
    /// to cover daemon spin-up + ~30s capture + return-trip latency;
    /// short enough that a crashed host doesn't strand the user.
    private static let bounceTimeout: TimeInterval = 60.0

    /// Re-poll cadence while bounced. Cheap — single file stat per
    /// tick — and only runs during an active bounce. viewDidAppear
    /// is the primary signal; the poll exists for the
    /// `status: capturing` race where the user re-foregrounded the
    /// host field before the host finished writing `done`.
    private static let pollInterval: TimeInterval = 0.5

    private let state = KeyboardState()
    private var hostingController: UIHostingController<KeyboardRootView>?
    private var pollTimer: Timer?
    private var timeoutTimer: Timer?

    override func viewDidLoad() {
        super.viewDidLoad()
        os_log("voix kbd: viewDidLoad", log: Self.log, type: .info)
        probeSharedContainer()
        SharedContainer.sweepOrphans()
        // Adversary H-1: a recycled extension comes back with a fresh
        // .idle phase. Reconstruct .bounced from the durable pointer so
        // viewDidAppear consumes the host's `done` session instead of
        // letting the transcript get swept silently. Must run AFTER the
        // orphan sweep so a long-dead pointer (whose files the sweep
        // just cleared) is treated as stale rather than restored.
        restorePersistedBounceIfFresh()
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
        // Decision 6 primary signal: iOS just brought the keyboard
        // back to a text field. If we were mid-bounce, the host
        // either finished and wrote `done`, or it's still working —
        // we look at the file to decide which.
        if case .bounced = state.phase {
            consumeBouncedSession()
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
        let startedAt = Date()
        state.phase = .bounced(sessionId: sessionId, startedAt: startedAt)
        // Durable copy of the bounce so a recycled extension can resume
        // it on next viewDidLoad (Adversary H-1). Cleared on every
        // terminal transition below.
        SharedContainer.persistActiveBounce(sessionId: sessionId, startedAt: startedAt)
        refreshHostingController()
        startTimers()
        extensionContext?.open(url) { [weak self] success in
            guard let self else { return }
            if !success {
                os_log("voix kbd: extensionContext.open returned false",
                       log: Self.log, type: .error)
                DispatchQueue.main.async {
                    self.cancelTimers()
                    SharedContainer.clearActiveBounce()
                    self.state.phase = .idle
                    self.state.showToast("voix host app not found")
                    self.refreshHostingController()
                }
            }
        }
    }

    /// Adversary H-1: on a cold/recycled launch, reconstruct an
    /// in-flight bounce from the durable App Group pointer so the
    /// return leg still fires. Only restores a pointer still inside the
    /// timeout window — a long-dead one is cleared silently rather than
    /// flashing a "couldn't record" toast on a launch the user didn't
    /// initiate.
    private func restorePersistedBounceIfFresh() {
        guard case .idle = state.phase,
              let bounce = SharedContainer.loadActiveBounce() else {
            return
        }
        let elapsed = Date().timeIntervalSince(bounce.startedAt)
        if elapsed > Self.bounceTimeout {
            SharedContainer.clearActiveBounce()
            return
        }
        os_log(
            "voix kbd: restoring persisted bounce session=%{public}@ elapsed=%.1fs",
            log: Self.log, type: .info, bounce.sessionId, elapsed
        )
        state.phase = .bounced(sessionId: bounce.sessionId, startedAt: bounce.startedAt)
        startTimers()
    }

    // MARK: - Return-flow consumer

    private func consumeBouncedSession() {
        guard case let .bounced(sessionId, startedAt) = state.phase else {
            return
        }
        // If we've blown past the timeout the timer will pick it up
        // shortly; check synchronously here too in case the timer
        // fired and the view came back before the run-loop tick.
        if Date().timeIntervalSince(startedAt) > Self.bounceTimeout {
            handleTimeout(sessionId: sessionId)
            return
        }
        do {
            guard let session = try SharedContainer.readState(sessionId) else {
                // Host hasn't written anything yet — start polling.
                startPollIfNeeded()
                return
            }
            switch session.status {
            case .pending, .capturing:
                startPollIfNeeded()
            case .done:
                applyDone(sessionId: sessionId)
            case .failed:
                applyFailed(sessionId: sessionId, error: session.error)
            case .cancelled:
                applyCancelled(sessionId: sessionId)
            }
        } catch {
            os_log(
                "voix kbd: readState failed: %{public}@",
                log: Self.log,
                type: .error,
                String(describing: error)
            )
            applyFailed(sessionId: sessionId, error: "read_error")
        }
    }

    private func applyDone(sessionId: String) {
        let transcript = (try? SharedContainer.readTranscript(sessionId)) ?? ""
        SharedContainer.deleteSession(sessionId)
        cancelTimers()
        SharedContainer.clearActiveBounce()
        state.phase = .inserting
        refreshHostingController()
        let proxy = textDocumentProxy
        DispatchQueue.main.async { [weak self] in
            if !transcript.isEmpty {
                proxy.insertText(transcript)
            }
            self?.state.phase = .idle
            self?.refreshHostingController()
        }
    }

    private func applyFailed(sessionId: String, error: String?) {
        SharedContainer.deleteSession(sessionId)
        cancelTimers()
        SharedContainer.clearActiveBounce()
        state.phase = .idle
        let message: String
        switch error {
        case "mic_denied":
            message = "Mic permission denied"
        case "daemon_unreachable":
            message = "voix daemon offline"
        case "timeout":
            message = "voix couldn't record"
        case "no_speech":
            message = "Didn't catch anything"
        default:
            message = "voix couldn't record"
        }
        state.showToast(message)
        refreshHostingController()
    }

    private func applyCancelled(sessionId: String) {
        SharedContainer.deleteSession(sessionId)
        cancelTimers()
        SharedContainer.clearActiveBounce()
        state.phase = .idle
        state.showToast("Cancelled")
        refreshHostingController()
    }

    private func handleTimeout(sessionId: String) {
        // Mark session cancelled so a slow host that wakes up later
        // doesn't write `done` onto a screen we already moved past.
        var cancelled = (try? SharedContainer.readState(sessionId))
            ?? KeyboardSessionState(sessionId: sessionId)
        cancelled.status = .cancelled
        try? SharedContainer.writeState(cancelled)
        SharedContainer.deleteSession(sessionId)
        cancelTimers()
        SharedContainer.clearActiveBounce()
        state.phase = .idle
        state.showToast("voix couldn't record")
        refreshHostingController()
    }

    // MARK: - Timers

    private func startTimers() {
        cancelTimers()
        timeoutTimer = Timer.scheduledTimer(
            withTimeInterval: Self.bounceTimeout, repeats: false
        ) { [weak self] _ in
            guard let self else { return }
            if case let .bounced(sessionId, _) = self.state.phase {
                self.handleTimeout(sessionId: sessionId)
            }
        }
    }

    private func startPollIfNeeded() {
        if pollTimer != nil { return }
        pollTimer = Timer.scheduledTimer(
            withTimeInterval: Self.pollInterval, repeats: true
        ) { [weak self] _ in
            guard let self else { return }
            if case .bounced = self.state.phase {
                self.consumeBouncedSession()
            } else {
                self.pollTimer?.invalidate()
                self.pollTimer = nil
            }
        }
    }

    private func cancelTimers() {
        pollTimer?.invalidate()
        pollTimer = nil
        timeoutTimer?.invalidate()
        timeoutTimer = nil
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
