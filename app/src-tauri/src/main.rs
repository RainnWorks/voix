// Standard binary shim — production logic lives in lib.rs so it can be
// tested without the tauri::Builder runtime.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    voix_app_lib::run();
}
