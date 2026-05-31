// Resolves the tauri JS API regardless of whether the page was loaded
// with the global injection (withGlobalTauri:true in tauri.conf.json) or
// is being run inside a plain browser for static debugging. In a plain
// browser, the shim no-ops so the UI at least renders.
//
// All other JS modules call into `tauri.invoke(...)` / `tauri.listen(...)`
// so swapping the API source is a one-file change.

const g = (typeof window !== "undefined" ? window.__TAURI__ : undefined) || null;

export const tauri = {
  invoke: g?.core?.invoke
    ?? ((cmd, args) => {
      console.warn(`[tauri-shim] invoke('${cmd}') called outside Tauri — ignoring`, args);
      return Promise.resolve();
    }),
  listen: g?.event?.listen
    ?? ((evt, _cb) => {
      console.warn(`[tauri-shim] listen('${evt}') called outside Tauri — ignoring`);
      return Promise.resolve(() => {});
    }),
  available: g !== null,
};
