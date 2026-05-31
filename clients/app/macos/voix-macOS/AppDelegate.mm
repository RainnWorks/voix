#import "AppDelegate.h"

#import <AVFoundation/AVFoundation.h>
#import <React/RCTBundleURLProvider.h>
#import <ReactAppDependencyProvider/RCTAppDependencyProvider.h>

@implementation AppDelegate

- (void)applicationDidFinishLaunching:(NSNotification *)notification
{
  self.moduleName = @"voix";
  // You can add your custom initial props in the dictionary below.
  // They will be passed down to the ViewController used by React Native.
  self.initialProps = @{};
  self.dependencyProvider = [RCTAppDependencyProvider new];

  // M22 Fix (Yuki B2 partial): NewArch diagnostic boot log. The
  // Info.plist declares RCTNewArchEnabled=true, but every voix native
  // module ships as legacy RCT_EXTERN_MODULE. Today this works via
  // RN-macOS 0.81's bridge-compat shim; on 0.82+ that shim is removed
  // and the legacy modules would be invisible to JS — symptom:
  // NativeModules.VoixHotkey === undefined, hotkey never registers,
  // hold-to-talk silently dead. The real fix is migrating bridges to
  // proper TurboModules (M23 surgery). For now this log gives future
  // debugging a clear signal.
  //
  // Pair this with the JS-side diagnostic in MacOverlay.native.tsx
  // which logs NativeModules.VoixHotkey availability at boot.
  NSNumber *newArch = [[NSBundle mainBundle].infoDictionary
                       objectForKey:@"RCTNewArchEnabled"];
  NSLog(@"[voix] NewArch=%@ bridges=legacy "
        @"(M22 known: bridge-compat works on RN 0.81; M23+ TurboModule)",
        [newArch boolValue] ? @"true" : @"false");

  // M22 Fix (Yuki H5): request microphone permission at app boot, not on
  // the first ⌃⌥Space press. The dialog activates voix, stealing focus
  // from the user's editor (TextEdit, Notes, etc). When requested at
  // boot the focus race doesn't compete with hotkey-driven dictation;
  // by the time Tom presses the hotkey, AV cache is warm and the user's
  // editor stays focused. AVCaptureDevice.requestAccess is a no-op if
  // status is anything other than .notDetermined, so safe to call every
  // launch.
  if ([AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeAudio]
      == AVAuthorizationStatusNotDetermined) {
    [AVCaptureDevice requestAccessForMediaType:AVMediaTypeAudio
                             completionHandler:^(BOOL granted) {
      // Logged for boot diagnostic — Tom will see this in console.
      NSLog(@"[voix] mic permission %@",
            granted ? @"granted" : @"denied");
    }];
  }

  // -applicationDidFinishLaunching: is a void method on RN-macOS's
  // RCTAppDelegate; call super (it creates the window + RN host) then
  // install our backdrop. No return value — see below.
  [super applicationDidFinishLaunching:notification];

  // A2 (macOS M-MobileFit parity, point 4): AppKit-vibrancy on the
  // sidebar. The desktop shell keeps the shared RN nav (web nav stays —
  // we do NOT swap in an NSToolbar), but a flat translucent fill is the
  // "web-app-in-a-window" tell. The native idiom is a vibrant sidebar
  // backed by NSVisualEffectView so the desktop wallpaper/material
  // shows through with the system's blur.
  //
  // Mechanics: drop a behind-window .sidebar-material NSVisualEffectView
  // beneath the RN host view and make that host view's layer clear. The
  // shared AppShell turns ONLY the sidebar column transparent on macOS
  // (titlebar + content pane stay opaque), so the vibrancy is revealed
  // exactly under the 220pt sidebar and nowhere else. Additive + fully
  // reversible; the paste-focus NSPanel flow (VoixOverlay) is untouched.
  [self installSidebarVibrancy];
}

/// Install a behind-window vibrant backdrop so the RN sidebar column
/// reads as a native macOS sidebar (A2 point 4). Idempotent: guards on
/// an identifier'd subview so a re-entrant launch can't stack backdrops.
- (void)installSidebarVibrancy
{
  NSWindow *window = self.window;
  NSView *content = window.contentView;
  if (window == nil || content == nil) {
    return;
  }

  static NSUserInterfaceItemIdentifier const kBackdropID = @"voixVibrancyBackdrop";
  for (NSView *existing in content.subviews) {
    if ([existing.identifier isEqualToString:kBackdropID]) {
      return; // already installed
    }
  }

  // The window must be non-opaque with a clear background for the
  // behind-window blend to sample the desktop instead of a black fill.
  window.opaque = NO;
  window.backgroundColor = [NSColor clearColor];

  NSVisualEffectView *backdrop =
      [[NSVisualEffectView alloc] initWithFrame:content.bounds];
  backdrop.identifier = kBackdropID;
  backdrop.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  backdrop.material = NSVisualEffectMaterialSidebar;
  backdrop.blendingMode = NSVisualEffectBlendingModeBehindWindow;
  backdrop.state = NSVisualEffectStateActive;
  [content addSubview:backdrop positioned:NSWindowBelow relativeTo:nil];

  // Clear the RN host view's own layer fill so the transparent sidebar
  // column (set in AppShell on macOS) reveals the backdrop. The shell's
  // titlebar + content pane keep opaque fills, so vibrancy stays scoped
  // to the sidebar.
  NSView *hostView = window.contentViewController.view ?: content;
  hostView.wantsLayer = YES;
  hostView.layer.backgroundColor = [NSColor clearColor].CGColor;
}

- (NSURL *)sourceURLForBridge:(RCTBridge *)bridge
{
  return [self bundleURL];
}

- (NSURL *)bundleURL
{
#if DEBUG
  return [[RCTBundleURLProvider sharedSettings] jsBundleURLForBundleRoot:@"index"];
#else
  return [[NSBundle mainBundle] URLForResource:@"main" withExtension:@"jsbundle"];
#endif
}

/// This method controls whether the `concurrentRoot`feature of React18 is turned on or off.
///
/// @see: https://reactjs.org/blog/2022/03/29/react-v18.html
/// @note: This requires to be rendering on Fabric (i.e. on the New Architecture).
/// @return: `true` if the `concurrentRoot` feature is enabled. Otherwise, it returns `false`.
- (BOOL)concurrentRootEnabled
{
#ifdef RN_FABRIC_ENABLED
  return true;
#else
  return false;
#endif
}

@end
