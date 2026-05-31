/**
 * Native entry — register the shared @voix/ui App so iOS + macOS
 * render the same surface the web target renders via Vite.
 *
 * M21 lifts platform shims (audio I/O, settings, hotkey, clipboard);
 * for M20 hello-world this single import path is the acceptance test.
 */
import { AppRegistry, LogBox } from "react-native";
import { App } from "@voix/ui";
import { name as appName } from "./app.json";

// LogBox's "Open debugger to view warnings" toast is a dev-only RN
// overlay that floats over the bottom tab bar (Marina v4 LOW / carried
// since M19). It is inert in a true production bundle, but belt-and-
// suspenders: if a release-configured build still ships with __DEV__
// somehow live, silence the overlay so it can never read as product
// chrome. Dev builds keep their warnings.
if (process.env.NODE_ENV === "production") {
  LogBox.ignoreAllLogs(true);
}

AppRegistry.registerComponent(appName, () => App);
