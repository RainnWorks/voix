// VoixAudioPermissions.m — bridge declarations for Swift VoixAudioPermissions.

#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(VoixAudioPermissions, NSObject)

RCT_EXTERN_METHOD(getMicrophoneStatus:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(requestMicrophone:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(isAccessibilityTrusted:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(openAccessibilitySettings:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
