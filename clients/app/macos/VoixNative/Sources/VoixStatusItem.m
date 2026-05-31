// VoixStatusItem.m — bridge declarations for Swift VoixStatusItem.
// Pattern mirrors VoixOverlay/VoixPaste/etc. Required because the
// Swift class subclasses RCTEventEmitter and the bridge needs the
// Obj-C surface to discover the JS-side module name.

#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_REMAP_MODULE(VoixStatusItem, VoixStatusItem, RCTEventEmitter)

RCT_EXTERN_METHOD(install:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(setOverlayVisible:(BOOL)visible
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(setHotkeyLabel:(NSString *)label
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(setHotkeyConflict:(BOOL)hasConflict
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
