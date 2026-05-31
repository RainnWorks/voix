//! Cmd+V paste simulation.
//!
//! Uses AppleScript via `osascript` rather than enigo. enigo's macOS
//! backend calls `TSMGetInputSourceProperty`, which on macOS 14+/26 is
//! main-thread-only — calling it from a tokio blocking worker triggers
//! `_dispatch_assert_queue_fail` and SIGTRAPs the process. AppleScript
//! has none of these constraints: `osascript` is a child process that
//! handles the keystroke through the Accessibility API.
//!
//! First call still prompts for Accessibility permission ("System Events
//! wants to use System Events"). Granting permission once persists for
//! the app's bundle identifier.

use std::process::Command;

/// Synthesize a Cmd+V keystroke into the frontmost app.
pub fn paste_now() -> Result<(), String> {
    let script = r#"tell application "System Events" to keystroke "v" using command down"#;
    let output = Command::new("/usr/bin/osascript")
        .arg("-e")
        .arg(script)
        .output()
        .map_err(|e| format!("osascript spawn: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // The most common failure is missing Accessibility permission —
        // surface that hint so callers can show a useful error.
        return Err(format!(
            "osascript failed ({}): {}. Grant Voix Accessibility permission in System Settings.",
            output.status, stderr.trim()
        ));
    }
    Ok(())
}
