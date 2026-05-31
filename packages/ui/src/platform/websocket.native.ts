/**
 * WebSocket — RN impl.
 *
 * Three-line re-export of RN's built-in WebSocket polyfill. Per
 * Decision 6 we don't pull a third-party WS library: RN's built-in
 * handles binary frames (`ws.binaryType = "arraybuffer"`) on RN 0.81
 * and sub-protocols via the constructor's second arg.
 *
 * The native sibling exists so TypeScript resolves a WebSocket type
 * that matches the actual runtime per target (RN's WebSocket is a
 * strict subset of DOM's — declaring uses against the wider DOM lib
 * leaks subtly to RN's typecheck).
 */

export const PlatformWebSocket: typeof WebSocket = WebSocket;
export type PlatformWebSocketInstance = WebSocket;
