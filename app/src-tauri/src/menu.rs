//! Native macOS menu bar. The app menu (with Quit, About, etc.) and a
//! Window menu with show/hide for the Live Transcript window.

#[cfg(target_os = "macos")]
use tauri::{
    menu::{Menu, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder},
    AppHandle, Emitter, Wry,
};

#[cfg(target_os = "macos")]
pub fn build(app: &AppHandle<Wry>) -> tauri::Result<Menu<Wry>> {
    // App menu (the "Voix" leftmost menu) — uses the standard predefined
    // items so Cmd+Q / About / Hide all work natively. The brand guide
    // forbids custom traffic lights and chrome; this is the bare minimum.
    let app_menu = SubmenuBuilder::new(app, "Voix")
        .item(&PredefinedMenuItem::about(app, None, None)?)
        .separator()
        .item(&PredefinedMenuItem::hide(app, None)?)
        .item(&PredefinedMenuItem::hide_others(app, None)?)
        .item(&PredefinedMenuItem::show_all(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::quit(app, None)?)
        .build()?;

    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .item(&PredefinedMenuItem::undo(app, None)?)
        .item(&PredefinedMenuItem::redo(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, None)?)
        .item(&PredefinedMenuItem::copy(app, None)?)
        .item(&PredefinedMenuItem::paste(app, None)?)
        .item(&PredefinedMenuItem::select_all(app, None)?)
        .build()?;

    // File menu — only "New conversation" matters for now. The keyboard
    // shortcut (⌘N) is wired so it works whether the menu is visible or
    // not. The JS handler listens for the emitted event.
    let new_conv = MenuItemBuilder::with_id("new-conversation", "New conversation")
        .accelerator("Cmd+N")
        .build(app)?;
    let file_menu = SubmenuBuilder::new(app, "File")
        .item(&new_conv)
        .build()?;

    let window_menu = SubmenuBuilder::new(app, "Window")
        .item(&PredefinedMenuItem::minimize(app, None)?)
        .item(&PredefinedMenuItem::close_window(app, None)?)
        .build()?;

    let menu = MenuBuilder::new(app)
        .items(&[&app_menu, &file_menu, &edit_menu, &window_menu])
        .build()?;

    let handle = app.clone();
    app.on_menu_event(move |_app, event| {
        if event.id().as_ref() == "new-conversation" {
            handle.emit("voix://menu/new-conversation", ()).ok();
        }
    });

    Ok(menu)
}

#[cfg(not(target_os = "macos"))]
pub fn build(_: &tauri::AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    unreachable!("menu::build is only called on macOS")
}
