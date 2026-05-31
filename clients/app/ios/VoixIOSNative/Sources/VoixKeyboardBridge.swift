//
//  VoixKeyboardBridge.swift
//  Host-side TurboModule that implements the keyboard bounce protocol
//  contract from RN. Lives in the host (voix) target only — the
//  keyboard extension uses SharedContainer.swift directly.
//
//  JS surface:
//    writeSession(sessionId: string, status: 'capturing'|'done'|'failed'|'cancelled',
//                 transcript?: string, error?: string): Promise<void>
//    readSession(sessionId: string): Promise<{
//      sessionId, status, transcript?, error?
//    } | null>
//    returnToKeyboard(returnUrl: string): Promise<{ opened: boolean }>
//
//  Architecture decisions:
//   - Write goes through the same App Group container that the
//     keyboard extension reads. The `KeyboardSessionState` schema
//     mirrors VoixKeyboard/Shared/KeyboardSessionState.swift; the
//     two files have to stay in sync, and check-app-group.sh + the
//     keyboard's probeSharedContainer log catch drift cheaply.
//   - returnToKeyboard simply opens the `voix-keyboard://done?…` URL
//     the keyboard handed us. iOS auto-bounces the user back to the
//     previous app (Notes, Mail…) where the keyboard's
//     viewDidAppear fires and reads the shared container.
//
import Foundation
import React
import UIKit

@objc(VoixKeyboardBridge)
final class VoixKeyboardBridge: NSObject {

    @objc static func requiresMainQueueSetup() -> Bool {
        return false
    }

    private static let appGroupId = "group.co.rowm.voix"
    private static let sessionsSubdir = "keyboard-sessions"

    // MARK: - File-system helpers (host mirror of SharedContainer)

    private func sessionsDirectoryURL() -> URL? {
        guard let root = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: Self.appGroupId
        ) else { return nil }
        let dir = root.appendingPathComponent(Self.sessionsSubdir, isDirectory: true)
        if !FileManager.default.fileExists(atPath: dir.path) {
            do {
                try FileManager.default.createDirectory(
                    at: dir, withIntermediateDirectories: true
                )
            } catch {
                return nil
            }
        }
        return dir
    }

    private func sessionURL(_ id: String) -> URL? {
        sessionsDirectoryURL()?.appendingPathComponent("\(id).json")
    }

    private func transcriptURL(_ id: String) -> URL? {
        sessionsDirectoryURL()?.appendingPathComponent("\(id).txt")
    }

    // MARK: - JS bridge

    @objc(writeSession:status:transcript:error:resolver:rejecter:)
    func writeSession(
        _ sessionId: NSString,
        status: NSString,
        transcript: NSString?,
        error: NSString?,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        guard let url = sessionURL(sessionId as String) else {
            reject("NO_CONTAINER", "App Group container unavailable", nil)
            return
        }

        // Load existing state if any so we preserve createdAt /
        // sessionId. If missing (e.g. host started fresh), seed a new
        // record stamped now.
        var state = readDecoded(url) ?? KeyboardSessionStatePayload(
            sessionId: sessionId as String,
            createdAt: ISO8601DateFormatter().string(from: Date()),
            status: status as String,
            transcript: nil,
            error: nil
        )
        state.status = status as String
        if let transcript = transcript as String? { state.transcript = transcript }
        if let error = error as String? { state.error = error }

        do {
            let encoder = JSONEncoder()
            encoder.dateEncodingStrategy = .iso8601
            encoder.outputFormatting = [.sortedKeys]
            let data = try encoder.encode(state)
            try data.write(to: url, options: .atomic)
        } catch {
            reject("WRITE_FAILED", error.localizedDescription, error)
            return
        }

        // Mirror final transcript to the convenience .txt file so the
        // keyboard's read path can skip JSON parsing.
        if let text = transcript as String? {
            if let txtUrl = transcriptURL(sessionId as String) {
                try? text.write(to: txtUrl, atomically: true, encoding: .utf8)
            }
        }

        resolve(nil)
    }

    @objc(readSession:resolver:rejecter:)
    func readSession(
        _ sessionId: NSString,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        guard let url = sessionURL(sessionId as String) else {
            reject("NO_CONTAINER", "App Group container unavailable", nil)
            return
        }
        guard FileManager.default.fileExists(atPath: url.path) else {
            resolve(nil)
            return
        }
        guard let state = readDecoded(url) else {
            reject("DECODE_FAILED", "Could not decode session state", nil)
            return
        }
        var dict: [String: Any] = [
            "sessionId": state.sessionId,
            "createdAt": state.createdAt,
            "status": state.status,
        ]
        if let t = state.transcript { dict["transcript"] = t }
        if let e = state.error { dict["error"] = e }
        resolve(dict)
    }

    @objc(returnToKeyboard:resolver:rejecter:)
    func returnToKeyboard(
        _ returnUrl: NSString,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        guard let url = URL(string: returnUrl as String) else {
            reject("BAD_URL", "Invalid returnUrl", nil)
            return
        }
        DispatchQueue.main.async {
            UIApplication.shared.open(url, options: [:]) { success in
                resolve(["opened": success])
            }
        }
    }

    // MARK: - Helpers

    private func readDecoded(_ url: URL) -> KeyboardSessionStatePayload? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try? decoder.decode(KeyboardSessionStatePayload.self, from: data)
    }
}

/// Loose mirror of VoixKeyboard/Shared/KeyboardSessionState.swift.
/// Kept duplicated rather than shared because importing the keyboard
/// extension's Swift module into the host pulls SwiftUI + keyboard-
/// only symbols. The schema is small enough that drift is detectable
/// at code-review time.
private struct KeyboardSessionStatePayload: Codable {
    let sessionId: String
    let createdAt: String
    var status: String
    var transcript: String?
    var error: String?
}
