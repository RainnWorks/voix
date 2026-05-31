//
//  KeyboardState.swift
//  ObservableObject that drives KeyboardRootView's SwiftUI tree.
//
//  Tracks the bounce lifecycle and Full Access status. Owned by the
//  KeyboardViewController so the SwiftUI tree reactively rerenders
//  on viewWillAppear / viewDidAppear, and so the controller can mutate
//  the state from UIKit callbacks (insert text, restart polling).
//
//  Lifecycle states map 1:1 with Architect Decision 6's state
//  machine:
//
//    idle      — pill visible, ready to bounce
//    bounced   — keyboard called extensionContext.open(_:),
//                waiting for host to write status=done to the
//                shared container.
//    inserting — read transcript, calling insertText now.
//    needsFullAccess — onboarding screen shown.
//
//  Failure surfaces:
//    .toast(message) sets a brief banner under the pill; expires
//    after 2s. Used for failed / cancelled / timeout reads.
//
import Combine
import Foundation

final class KeyboardState: ObservableObject {

    enum Phase: Equatable {
        case idle
        case needsFullAccess
        case bounced(sessionId: String, startedAt: Date)
        case inserting
    }

    @Published var phase: Phase = .idle
    @Published var toastMessage: String?

    func showToast(_ text: String, duration: TimeInterval = 2.0) {
        toastMessage = text
        DispatchQueue.main.asyncAfter(deadline: .now() + duration) {
            [weak self] in
            // Only clear if it hasn't been overwritten by a newer
            // toast in the meantime.
            if self?.toastMessage == text {
                self?.toastMessage = nil
            }
        }
    }
}
