/**
 * WebSocket — web impl.
 *
 * Three-line re-export: the DOM's `WebSocket` is exactly what the
 * audio-io client wants. The split exists so TypeScript resolves a
 * `WebSocket` type that matches the actual runtime per target — RN's
 * WebSocket is a strict subset of DOM's, and authoring TalkButton /
 * client.ts against the wider DOM type means RN target fails subtle
 * typecheck (e.g. `WebSocket.CONNECTING` numerics, `protocols` arg).
 *
 * Native sibling: `websocket.native.ts` re-exports React Native's
 * built-in WebSocket polyfill.
 */

export const PlatformWebSocket: typeof WebSocket = WebSocket;
export type PlatformWebSocketInstance = WebSocket;
