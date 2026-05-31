// VoixPaste.m — bridge declarations for Swift VoixPaste.

#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(VoixPaste, NSObject)

RCT_EXTERN_METHOD(copyToClipboard:(nonnull NSString *)text
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(paste:(nonnull NSString *)text
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(isAccessibilityTrusted:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
