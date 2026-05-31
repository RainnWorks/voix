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

  return [super applicationDidFinishLaunching:notification];
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
