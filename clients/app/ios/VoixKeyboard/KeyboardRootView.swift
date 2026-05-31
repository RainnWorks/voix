//
//  KeyboardRootView.swift
//  SwiftUI root for the voix keyboard. Decisions 4 + 5.
//
//  Layout (vertical, top to bottom):
//    voix wordmark (top-left, 16pt)
//    big rounded pill, "⬤ Talk to voix", HA-blue fill, white text
//    "or pick another keyboard ⌄" hint, italic 11pt, textQuiet
//    optional toast / state row
//
//  When `hasFullAccess` is false, the pill is replaced with the
//  onboarding screen — same wordmark, copy explaining why, and an
//  "Open Settings" pill that deep-links to the host app's Settings
//  page (best we can do; iOS doesn't expose a direct deep-link to
//  the keyboard's pane).
//
//  Memory: this view is pure SwiftUI + system fonts + system colors.
//  No third-party libs, no AsyncImage, no Combine chains. Architect
//  Risk 2 — pill state should stay under 8 MB RSS.
//
import SwiftUI

struct KeyboardRootView: View {

    @ObservedObject var state: KeyboardState
    let hasFullAccess: Bool
    let onTalkTap: () -> Void
    let onOpenSettings: () -> Void
    let onGlobeTap: () -> Void
    let onGlobeLongPress: () -> Void

    private let haBlue = Color(red: 0x18 / 255.0,
                               green: 0xBC / 255.0,
                               blue: 0xF2 / 255.0)

    var body: some View {
        ZStack(alignment: .topLeading) {
            VStack(alignment: .center, spacing: 12) {
                wordmark
                Spacer(minLength: 0)
                if hasFullAccess {
                    pillStack
                } else {
                    onboardingStack
                }
                Spacer(minLength: 0)
                bottomRow
            }
            .padding(16)
        }
    }

    // MARK: - Wordmark

    private var wordmark: some View {
        HStack {
            Text("voix")
                .font(.system(size: 16, weight: .semibold, design: .default))
                .foregroundColor(.primary)
            Spacer()
        }
    }

    // MARK: - Pill (Full Access ON)

    private var pillStack: some View {
        VStack(spacing: 8) {
            Button(action: onTalkTap) {
                HStack(spacing: 10) {
                    puckGlyph
                        .frame(width: 24, height: 24)
                    Text(pillLabel)
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundColor(.white)
                }
                .frame(maxWidth: .infinity)
                .frame(height: 56)
                .background(haBlue)
                .clipShape(RoundedRectangle(cornerRadius: 28))
            }
            .buttonStyle(.plain)
            .disabled(isBounceInFlight)

            Text("or pick another keyboard ⌄")
                .font(.system(size: 11, weight: .regular).italic())
                .foregroundColor(.secondary)
                .opacity(0.7)

            if let toast = state.toastMessage {
                Text(toast)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(.primary)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4)
                    .background(.thinMaterial)
                    .clipShape(Capsule())
            }
        }
    }

    private var puckGlyph: some View {
        Circle()
            .fill(Color.white.opacity(0.95))
            .overlay(
                Circle()
                    .fill(haBlue.opacity(0.9))
                    .padding(7)
            )
    }

    private var pillLabel: String {
        switch state.phase {
        case .inserting:
            return "Pasting…"
        case .bounced:
            return "voix is listening…"
        default:
            return "Talk to voix"
        }
    }

    private var isBounceInFlight: Bool {
        if case .bounced = state.phase { return true }
        if case .inserting = state.phase { return true }
        return false
    }

    // MARK: - Onboarding (Full Access OFF)

    private var onboardingStack: some View {
        VStack(spacing: 10) {
            Text("voix needs Full Access to record.")
                .font(.system(size: 14, weight: .medium))
                .foregroundColor(.primary)
                .multilineTextAlignment(.center)

            Text("Settings → General → Keyboard → Keyboards → voix → Allow Full Access")
                .font(.system(size: 11, weight: .regular, design: .monospaced))
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .lineLimit(3)

            Button(action: onOpenSettings) {
                Text("Open Settings")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(.white)
                    .frame(maxWidth: .infinity)
                    .frame(height: 44)
                    .background(haBlue)
                    .clipShape(RoundedRectangle(cornerRadius: 22))
            }
            .buttonStyle(.plain)

            Text("Your text stays on your devices.")
                .font(.system(size: 10).italic())
                .foregroundColor(.secondary)
                .opacity(0.7)
        }
    }

    // MARK: - Bottom row (globe key)

    private var bottomRow: some View {
        HStack {
            Spacer()
            Button(action: onGlobeTap) {
                Image(systemName: "globe")
                    .font(.system(size: 18, weight: .regular))
                    .foregroundColor(.primary)
                    .frame(width: 44, height: 44)
            }
            .buttonStyle(.plain)
            .simultaneousGesture(
                LongPressGesture(minimumDuration: 0.4).onEnded { _ in
                    onGlobeLongPress()
                }
            )
            .accessibilityLabel("Switch keyboard")
        }
    }
}
