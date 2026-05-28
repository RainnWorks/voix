import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Vite config for the voix UI.
//
// Key choice: alias `react-native` → `react-native-web` at the bundler
// level. Components in src/ import from `react-native` directly. In the
// browser this resolves to the web shims (View, Text, Pressable,
// TextInput render to DOM elements). When we later wrap this app in a
// real React Native shell — Mac app via Tauri / iOS keyboard extension —
// `react-native` resolves to the actual native bindings. Same component
// source, native widgets on native. Web feel where we ship the daemon's
// HTML, native feel where we ship a platform shell.
export default defineConfig({
  plugins: [react()],
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
