//
//  CaptureSession.swift
//  Helpers for the voix keyboard ↔ host bounce protocol.
//
//  Decision 3 URL contract:
//
//    Keyboard → Host:
//      voix://capture?session_id=<uuid>&return=<encoded url>
//
//    Host → Keyboard:
//      voix-keyboard://done?session_id=<uuid>
//      voix-keyboard://cancelled?session_id=<uuid>
//      voix-keyboard://failed?session_id=<uuid>&error=<encoded>
//
//  The keyboard never actually consumes voix-keyboard:// URLs (a
//  keyboard extension can't receive openURL callbacks). The host
//  opens it so iOS bounces back to the previous app — the keyboard's
//  viewDidAppear then fires, and the shared container is the actual
//  data source.
//
import Foundation

enum CaptureSession {

    static let hostScheme = "voix"
    static let keyboardScheme = "voix-keyboard"

    static func newSessionId() -> String {
        UUID().uuidString
    }

    /// Build the `voix://capture?…` URL the keyboard hands to
    /// `extensionContext?.open(_:)`.
    static func captureURL(sessionId: String) -> URL? {
        let returnUrl = "\(keyboardScheme)://done?session_id=\(sessionId)"
        // Manual percent-encoding avoids URLComponents picking the
        // wrong query-allowed set across iOS versions.
        let encodedReturn = returnUrl.addingPercentEncoding(
            withAllowedCharacters: .urlQueryValueAllowed
        ) ?? returnUrl
        let raw = "\(hostScheme)://capture?session_id=\(sessionId)&return=\(encodedReturn)"
        return URL(string: raw)
    }
}

extension CharacterSet {
    /// Standard query-value allowed set (alphanumerics + a few safe
    /// punctuation marks), matches what `URLComponents.queryItems`
    /// produces.
    static let urlQueryValueAllowed: CharacterSet = {
        var allowed = CharacterSet.urlQueryAllowed
        // The default set treats `=`, `&`, `+`, `?`, `#`, `/` as
        // allowed in queries, which breaks nested URLs in return=…
        allowed.remove(charactersIn: "=&+?#/")
        return allowed
    }()
}
