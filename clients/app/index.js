/**
 * Native entry — register the shared @voix/ui App so iOS + macOS
 * render the same surface the web target renders via Vite.
 *
 * M21 lifts platform shims (audio I/O, settings, hotkey, clipboard);
 * for M20 hello-world this single import path is the acceptance test.
 */
import { AppRegistry } from "react-native";
import { App } from "@voix/ui";
import { name as appName } from "./app.json";

AppRegistry.registerComponent(appName, () => App);
