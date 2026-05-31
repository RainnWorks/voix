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
//  Step 2 (this commit): stub controller, empty pill placeholder. The
//  real UI, App Group reads, and URL-scheme bounce land in steps 3-7.
//
import UIKit
import os

final class KeyboardViewController: UIInputViewController {

    private static let log = OSLog(
        subsystem: "co.rowm.voix.keyboard",
        category: "lifecycle"
    )

    private var pillButton: UIButton?

    override func viewDidLoad() {
        super.viewDidLoad()
        os_log("voix kbd: viewDidLoad", log: Self.log, type: .info)
        probeSharedContainer()
        installStubPill()
    }

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

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        os_log("voix kbd: viewWillAppear hasFullAccess=%{public}@",
               log: Self.log, type: .info,
               String(describing: hasFullAccess))
    }

    private func installStubPill() {
        let button = UIButton(type: .system)
        button.translatesAutoresizingMaskIntoConstraints = false
        button.setTitle("Talk to voix", for: .normal)
        button.titleLabel?.font = .systemFont(ofSize: 18, weight: .semibold)
        button.backgroundColor = UIColor(
            red: 0x18 / 255.0,
            green: 0xBC / 255.0,
            blue: 0xF2 / 255.0,
            alpha: 1.0
        ) // HA blue
        button.setTitleColor(.white, for: .normal)
        button.layer.cornerRadius = 28
        button.isEnabled = false // step 2: stub only
        view.addSubview(button)

        NSLayoutConstraint.activate([
            button.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            button.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            button.heightAnchor.constraint(equalToConstant: 56),
            button.leadingAnchor.constraint(
                equalTo: view.leadingAnchor, constant: 16),
            button.trailingAnchor.constraint(
                equalTo: view.trailingAnchor, constant: -16),
        ])
        pillButton = button
    }
}
