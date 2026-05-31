Pod::Spec.new do |s|
  s.name         = "VoixIOSNative"
  s.version      = "0.1.0"
  s.summary      = "voix-iOS native modules: M24 keyboard bounce + App Group container IO."
  s.homepage     = "https://github.com/voix"
  s.license      = "MIT"
  s.author       = "voix"
  s.source       = { :path => "." }

  s.platform     = :ios, "15.1"
  s.requires_arc = true

  s.source_files = "Sources/**/*.{swift,m,mm,h}"

  s.frameworks   = "UIKit", "Foundation"

  s.dependency "React-Core"
end
