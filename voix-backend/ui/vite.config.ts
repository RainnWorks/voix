import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

// Vite config for the voix UI.
//
// Key choice: alias `react-native` → `react-native-web` at the bundler
// level. Components in src/ + packages/ui/ import from `react-native`
// directly. In the browser this resolves to the web shims (View, Text,
// Pressable, TextInput render to DOM elements). When we later ship a
// real React Native shell — iOS / macOS via the M20 RN-CLI app —
// `react-native` resolves to the actual native bindings via Metro.
// Same component source, native widgets on native. Web feel where we
// ship the daemon's HTML, native feel where we ship a platform shell.

/**
 * Resolver plugin: skip `.native.ts(x)` files. Metro picks these up
 * automatically on RN ≥ 0.79, so the package's platform-specific
 * branches use the `<file>.native.ts` convention. Vite's bundler
 * doesn't have that built-in — without this plugin, a bare
 * `import "./Foo"` would resolve to `Foo.native.ts` when only the web
 * variant should ship to the browser. The plugin scopes the skip to
 * file imports so an explicit `import "./Foo.native"` (if anyone
 * writes it) still resolves.
 */
function ignoreNativeSuffixes(): Plugin {
  return {
    name: "voix:ignore-native-suffixes",
    enforce: "pre",
    resolveId(source, importer, options) {
      // If the consumer explicitly types ".native" in the import, let
      // it through — they meant it.
      if (source.endsWith(".native") || source.endsWith(".native.ts") || source.endsWith(".native.tsx")) {
        return null;
      }
      // Only act on relative / absolute paths — package-name resolves
      // (react, react-native, @voix/ui) keep their normal behaviour.
      if (!source.startsWith(".") && !source.startsWith("/")) {
        return null;
      }
      // Delegate to the default resolver, then post-process: if it
      // landed on a `.native.ts(x)` file, fall back to the equivalent
      // non-suffixed file.
      return this.resolve(source, importer, { ...options, skipSelf: true }).then((resolved) => {
        if (!resolved) return null;
        const id = resolved.id;
        if (id.endsWith(".native.ts") || id.endsWith(".native.tsx")) {
          // strip .native and try again
          const stripped = id.replace(/\.native(\.tsx?)$/, "$1");
          return this.resolve(stripped, importer, { ...options, skipSelf: true });
        }
        return resolved;
      });
    },
  };
}

export default defineConfig({
  // HA Add-on ingress mounts us at a long token-based path
  // (`/api/hassio_ingress/<token>/`), not the site root. Vite's default
  // `base: "/"` makes the built index.html reference `/assets/…`
  // (absolute), which the browser resolves against the domain root and
  // bypasses the ingress prefix → 404 on every asset. `./` makes the
  // references relative to the index.html's loaded path, so they
  // resolve under the ingress prefix correctly. Same trick works for
  // local `bun start` (served at /) and a Tauri webview (served at
  // tauri://).
  base: "./",
  plugins: [tsconfigPaths(), ignoreNativeSuffixes(), react()],
  resolve: {
    alias: {
      "react-native": "react-native-web",
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
    target: "es2022",
  },
  server: {
    port: 5173,
    // During `bun run dev`, proxy API calls to the daemon (assumed on
    // :8765). Lets us iterate on UI with hot reload while pointing at
    // real daemon state.
    proxy: {
      "/api": "http://localhost:8765",
      "/recordings": "http://localhost:8765",
    },
  },
});
