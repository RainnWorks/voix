Pod::Spec.new do |s|
  s.name         = "VoixNative"
  s.version      = "0.1.0"
  s.summary      = "voix-macOS native modules: AVAudioEngine capture + playback, global hotkey, paste."
  s.homepage     = "https://github.com/voix"
  s.license      = "MIT"
  s.author       = "voix"
  s.source       = { :path => "." }

  s.platform     = :osx, "14.0"
  s.requires_arc = true

  s.source_files = "Sources/**/*.{swift,m,mm,h}"

  # Frameworks consumed by the Swift sources:
  # - AVFAudio: AVAudioEngine + AVAudioPlayerNode (capture + playback).
  # - AVFoundation: AVCaptureDevice for mic permission gates.
  # - AppKit: NSPasteboard, NSPanel for overlay; NSWorkspace for opening
  #   System Settings.
  # - Carbon: RegisterEventHotKey via KeyboardShortcuts SPM (added in
  #   step 6) — wrapped framework, but the link needs Carbon present.
  # - CoreGraphics + ApplicationServices: CGEventPost + AXIsProcessTrusted.
  s.frameworks   = "AVFAudio", "AVFoundation", "AppKit", "CoreGraphics",
                   "ApplicationServices", "Carbon"

  s.dependency "React-Core"
end
