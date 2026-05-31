// VoixKeyboardBridge.m — bridge declarations for Swift VoixKeyboardBridge.

#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(VoixKeyboardBridge, NSObject)

RCT_EXTERN_METHOD(writeSession:(nonnull NSString *)sessionId
                  status:(nonnull NSString *)status
                  transcript:(NSString *)transcript
                  error:(NSString *)error
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(readSession:(nonnull NSString *)sessionId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(returnToKeyboard:(nonnull NSString *)returnUrl
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
