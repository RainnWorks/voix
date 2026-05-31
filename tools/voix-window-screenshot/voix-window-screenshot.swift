/// voix-window-screenshot.swift
///
/// macOS verify tool — captures the voix-macOS window to a PNG file.
///
/// Why: M20's smoke ran `screencapture -x` and caught the login window
/// because the Mac was locked; we couldn't tell apart "voix didn't
/// render" from "screen is asleep." This tool:
///
///   1. Checks the loginwindow session via CGSessionCopyCurrentDictionary
///      — if not on console (locked / no GUI session), exits 2 with a
///      clear message instead of capturing nothing useful.
///   2. Iterates ScreenCaptureKit's SCShareableContent for the voix-owned
///      window (ownerName == "voix" by default; --owner to override).
///   3. Uses SCScreenshotManager to capture the window image, writes
///      PNG to the output path.
///
/// Build:
///     swiftc -O tools/voix-window-screenshot/voix-window-screenshot.swift \
///         -o /tmp/voix-window-screenshot
///
/// Or use the wrapper: scripts/macos-screenshot.sh
///
/// Usage:
///     voix-window-screenshot [--owner <name>] <output.png>
///
/// Exit codes:
///   0 — wrote PNG.
///   1 — bad arguments or write failure.
///   2 — screen is locked (no console session); no PNG produced.
///   3 — no voix window found (app not running or backgrounded too far).
///   4 — screen recording permission not granted.
///
/// Note: macOS 15+ obsoleted CGWindowListCreateImage; this tool uses
/// ScreenCaptureKit (SCK), which requires the parent process to have
/// "Screen Recording" permission in System Settings → Privacy & Security.
/// On first run, macOS will prompt; the user must grant + re-run.

import AppKit
import CoreGraphics
import Foundation
import ScreenCaptureKit

// Force-initialize the connection to WindowServer. Without this, the
// first CG/SC call from a plain CLI (no NSApplication bootstrap) hits
// `CGS_REQUIRE_INIT` assertion and aborts. NSApplication.shared touches
// the right global state to register the process as a GUI client.
_ = NSApplication.shared

func usage() -> Never {
    FileHandle.standardError.write(Data(
        "usage: voix-window-screenshot [--owner <name>] <output.png>\n".utf8
    ))
    exit(1)
}

func fail(_ code: Int32, _ message: String) -> Never {
    FileHandle.standardError.write(Data("voix-window-screenshot: \(message)\n".utf8))
    exit(code)
}

// ---- parse args --------------------------------------------------------

var owner = "voix"
var output: String?
var iter = 1
let args = CommandLine.arguments
while iter < args.count {
    let arg = args[iter]
    if arg == "--owner" {
        iter += 1
        if iter >= args.count { usage() }
        owner = args[iter]
    } else if arg == "-h" || arg == "--help" {
        usage()
    } else if output == nil {
        output = arg
    } else {
        usage()
    }
    iter += 1
}
guard let outputPath = output else { usage() }

// ---- lock-screen check -------------------------------------------------

// CGSessionCopyCurrentDictionary returns nil if there's no logged-in
// console user; if it returns a dict but kCGSSessionOnConsoleKey is
// false, the screen is locked / the user is at the login window.
//
// Without this guard, SCK would either fail or capture the loginwindow,
// neither of which is useful — exactly the M20 failure mode.

if let session = CGSessionCopyCurrentDictionary() as? [String: Any] {
    let onConsole = session["kCGSSessionOnConsoleKey"] as? Bool ?? false
    if !onConsole {
        fail(2, "screen is locked — cannot screenshot. Unlock the Mac and re-run.")
    }
} else {
    fail(2, "no GUI session detected — cannot screenshot. Log in and re-run.")
}

// ---- ScreenCaptureKit: find + capture ----------------------------------

// SCShareableContent.current is async, so wrap the whole flow in a Task
// and block until done via DispatchSemaphore (CLI doesn't have a run loop).

let semaphore = DispatchSemaphore(value: 0)
var exitCode: Int32 = 0
var failureMessage: String?
var pngData: Data?
var capturedSize: (Int, Int) = (0, 0)

Task {
    defer { semaphore.signal() }

    let content: SCShareableContent
    do {
        content = try await SCShareableContent.excludingDesktopWindows(
            true,
            onScreenWindowsOnly: true
        )
    } catch {
        exitCode = 4
        failureMessage = "SCShareableContent failed (Screen Recording permission?): \(error.localizedDescription)"
        return
    }

    // Largest area wins — RN sometimes spawns 1x1 floating shim windows
    // that share the owner name. The big content window is what we want.
    func area(_ w: SCWindow) -> CGFloat {
        return w.frame.width * w.frame.height
    }

    let candidates = content.windows.filter {
        $0.owningApplication?.applicationName == owner
    }
    guard let window = candidates.max(by: { area($0) < area($1) }), area(window) > 100 else {
        let names = Set(
            content.windows.compactMap { $0.owningApplication?.applicationName }
        ).sorted().joined(separator: ", ")
        exitCode = 3
        failureMessage = "no '\(owner)' window found. Visible apps: \(names)"
        return
    }

    let filter = SCContentFilter(desktopIndependentWindow: window)
    let config = SCStreamConfiguration()
    config.width = Int(window.frame.width)
    config.height = Int(window.frame.height)
    config.showsCursor = false
    // captureResolution = .nominal: 1:1 logical pixels, no @2x scale-up.
    // We want a reasonable PNG size, not a Retina monster.
    if #available(macOS 14.0, *) {
        config.captureResolution = .nominal
    }

    let cgImage: CGImage
    do {
        cgImage = try await SCScreenshotManager.captureImage(
            contentFilter: filter,
            configuration: config
        )
    } catch {
        exitCode = 1
        failureMessage = "SCScreenshotManager.captureImage failed: \(error.localizedDescription)"
        return
    }

    let bitmap = NSBitmapImageRep(cgImage: cgImage)
    guard let png = bitmap.representation(using: .png, properties: [:]) else {
        exitCode = 1
        failureMessage = "PNG encode failed"
        return
    }
    pngData = png
    capturedSize = (cgImage.width, cgImage.height)
}

semaphore.wait()

if exitCode != 0 {
    fail(exitCode, failureMessage ?? "unknown failure")
}

guard let data = pngData else {
    fail(1, "no PNG data produced")
}

let url = URL(fileURLWithPath: outputPath)
do {
    try data.write(to: url)
} catch {
    fail(1, "write \(outputPath) failed: \(error.localizedDescription)")
}

print("wrote \(outputPath) (\(data.count) bytes, \(capturedSize.0)x\(capturedSize.1))")
exit(0)
