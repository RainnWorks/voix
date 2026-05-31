// VoixAudioPlayback.m — bridge declarations for Swift VoixAudioPlayback.

#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(VoixAudioPlayback, NSObject)

RCT_EXTERN_METHOD(start:(nonnull NSNumber *)sampleRateHz
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(pushFrame:(nonnull NSString *)base64
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(stop:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
