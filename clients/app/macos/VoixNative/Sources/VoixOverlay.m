// VoixOverlay.m — bridge declarations for Swift VoixOverlay.

#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(VoixOverlay, NSObject)

RCT_EXTERN_METHOD(showOverlay:(NSDictionary *)payload
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(hideOverlay:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(updateStatus:(nonnull NSString *)status
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
