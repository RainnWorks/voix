// VoixAudioCapture.m
//
// Objective-C bridge declarations for the Swift VoixAudioCapture class.
// React Native's legacy bridge module discovery scans `RCT_EXTERN_MODULE`
// declarations in ObjC sources; the Swift @objc methods are linked at
// runtime via their selectors.
//
// Why a separate .m file: Swift cannot host RCT_EXTERN_MODULE / RCT_EXTERN_METHOD
// macros (these expand to ObjC categories on a runtime-generated stub
// class).

#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE(VoixAudioCapture, RCTEventEmitter)

RCT_EXTERN_METHOD(start:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(stop:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(getSampleRate:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
