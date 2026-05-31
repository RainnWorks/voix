//
//  SharedContainer.swift
//  Shared between host (voix) and extension (VoixKeyboard) targets.
//
//  Thin wrapper around FileManager.containerURL for the
//  `group.co.rowm.voix` App Group. Sessions live in the
//  `keyboard-sessions/` subdirectory with a `.json` state file and
//  optional `.txt` transcript file per session.
//
//  Files default to NSFileProtectionCompleteUntilFirstUserAuthentication,
//  which is what we want — readable post-unlock-since-boot, blocked
//  while the device has never been unlocked. Do NOT escalate to
//  .complete; the keyboard would lose read access mid-bounce if the
//  device locks. Architect Decision 2.
//
import Foundation
import os

enum SharedContainer {

    static let groupId = "group.co.rowm.voix"
    static let sessionsSubdir = "keyboard-sessions"

    private static let log = OSLog(
        subsystem: "co.rowm.voix.keyboard",
        category: "shared-container"
    )

    /// Root container for the App Group, or nil if the entitlement is
    /// missing on this target (most common cause: provisioning
    /// profile doesn't include the group, or the entitlements file
    /// drifted between targets).
    static func containerURL() -> URL? {
        FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: groupId
        )
    }

    /// Directory for keyboard sessions. Returns nil if the App Group
    /// isn't available. Creates the directory if missing.
    static func sessionsDirectoryURL() -> URL? {
        guard let root = containerURL() else { return nil }
        let dir = root.appendingPathComponent(sessionsSubdir, isDirectory: true)
        if !FileManager.default.fileExists(atPath: dir.path) {
            do {
                try FileManager.default.createDirectory(
                    at: dir,
                    withIntermediateDirectories: true
                )
            } catch {
                os_log(
                    "createDirectory failed: %{public}@",
                    log: log,
                    type: .error,
                    String(describing: error)
                )
                return nil
            }
        }
        return dir
    }

    static func sessionURL(_ id: String) -> URL? {
        sessionsDirectoryURL()?.appendingPathComponent("\(id).json")
    }

    static func transcriptURL(_ id: String) -> URL? {
        sessionsDirectoryURL()?.appendingPathComponent("\(id).txt")
    }

    // MARK: - Read / write state

    static func writeState(_ state: KeyboardSessionState) throws {
        guard let url = sessionURL(state.sessionId) else {
            throw SharedContainerError.containerUnavailable
        }
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let data = try encoder.encode(state)
        try data.write(to: url, options: .atomic)
    }

    static func readState(_ id: String) throws -> KeyboardSessionState? {
        guard let url = sessionURL(id) else {
            throw SharedContainerError.containerUnavailable
        }
        guard FileManager.default.fileExists(atPath: url.path) else {
            return nil
        }
        let data = try Data(contentsOf: url)
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try decoder.decode(KeyboardSessionState.self, from: data)
    }

    static func writeTranscript(_ id: String, _ text: String) throws {
        guard let url = transcriptURL(id) else {
            throw SharedContainerError.containerUnavailable
        }
        try text.write(to: url, atomically: true, encoding: .utf8)
    }

    static func readTranscript(_ id: String) throws -> String? {
        guard let url = transcriptURL(id) else {
            throw SharedContainerError.containerUnavailable
        }
        guard FileManager.default.fileExists(atPath: url.path) else {
            return nil
        }
        return try String(contentsOf: url, encoding: .utf8)
    }

    static func deleteSession(_ id: String) {
        if let url = sessionURL(id) {
            try? FileManager.default.removeItem(at: url)
        }
        if let url = transcriptURL(id) {
            try? FileManager.default.removeItem(at: url)
        }
    }

    // MARK: - Durable active-bounce pointer (Adversary H-1)
    //
    // The bounce lifecycle (`KeyboardState.phase == .bounced`) lives
    // only in RAM on the KeyboardViewController instance. When the
    // keyboard bounces to the host, iOS foregrounds a heavy RN app and
    // routinely jettisons the backgrounded keyboard extension. On
    // return iOS spins up a FRESH controller whose phase is `.idle`, so
    // `viewDidAppear`'s `if case .bounced` consume-trigger never fires
    // and the dictated transcript sits in the container until the
    // 5-minute orphan sweep silently deletes it.
    //
    // Fix: persist the active bounce (sessionId + startedAt) to the App
    // Group's UserDefaults the moment we bounce, and reload it in
    // `viewDidLoad` so a recycled extension reconstructs `.bounced` and
    // consumes the `done` session. The `.json`/`.txt` channel was
    // always sound; this restores the *trigger* to read it.

    private static let activeBounceKey = "voix.kbd.activeBounce"

    private static func defaults() -> UserDefaults? {
        UserDefaults(suiteName: groupId)
    }

    static func persistActiveBounce(sessionId: String, startedAt: Date) {
        guard let defaults = defaults() else {
            os_log(
                "persistActiveBounce: App Group UserDefaults unavailable",
                log: log, type: .error
            )
            return
        }
        defaults.set(
            [
                "sessionId": sessionId,
                "startedAt": startedAt.timeIntervalSince1970,
            ] as [String: Any],
            forKey: activeBounceKey
        )
    }

    /// Reload a persisted active bounce, if any. Returns nil when there
    /// is none. The caller is responsible for timeout math — startedAt
    /// is the original bounce instant so the 60s window survives a
    /// process restart.
    static func loadActiveBounce() -> (sessionId: String, startedAt: Date)? {
        guard
            let defaults = defaults(),
            let dict = defaults.dictionary(forKey: activeBounceKey),
            let sessionId = dict["sessionId"] as? String,
            let startedAt = dict["startedAt"] as? TimeInterval
        else {
            return nil
        }
        return (sessionId, Date(timeIntervalSince1970: startedAt))
    }

    static func clearActiveBounce() {
        defaults()?.removeObject(forKey: activeBounceKey)
    }

    /// Sweep sessions older than `maxAge` seconds. Orphans from host
    /// crashes get cleaned up on next keyboard launch.
    static func sweepOrphans(olderThan maxAge: TimeInterval = 300) {
        guard let dir = sessionsDirectoryURL() else { return }
        let now = Date()
        let contents = (try? FileManager.default.contentsOfDirectory(
            at: dir,
            includingPropertiesForKeys: [.contentModificationDateKey]
        )) ?? []
        for url in contents {
            let values = try? url.resourceValues(
                forKeys: [.contentModificationDateKey]
            )
            guard let modified = values?.contentModificationDate else {
                continue
            }
            if now.timeIntervalSince(modified) > maxAge {
                try? FileManager.default.removeItem(at: url)
            }
        }
    }
}

enum SharedContainerError: Error {
    case containerUnavailable
}
