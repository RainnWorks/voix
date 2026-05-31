//
//  KeyboardSessionState.swift
//  Shared between host (voix) and extension (VoixKeyboard) targets.
//
//  Single source of truth for a keyboard-initiated capture session.
//  Lives in the App Group container `group.co.rowm.voix` as
//  `keyboard-sessions/<sessionId>.json` plus a sibling `.txt`
//  containing the final transcript.
//
//  Lifecycle (Decision 6):
//    pending    — keyboard wrote state, opened host
//    capturing  — host picked up the URL and started recording
//    done       — host wrote transcript; keyboard polls + inserts
//    failed     — host couldn't capture (mic denied, daemon down)
//    cancelled  — user dismissed or 60s timeout fired
//
import Foundation

struct KeyboardSessionState: Codable, Equatable {
    enum Status: String, Codable {
        case pending
        case capturing
        case done
        case failed
        case cancelled
    }

    let sessionId: String
    let createdAt: Date
    var status: Status
    var transcript: String?
    var error: String?

    init(
        sessionId: String,
        createdAt: Date = Date(),
        status: Status = .pending,
        transcript: String? = nil,
        error: String? = nil
    ) {
        self.sessionId = sessionId
        self.createdAt = createdAt
        self.status = status
        self.transcript = transcript
        self.error = error
    }
}
