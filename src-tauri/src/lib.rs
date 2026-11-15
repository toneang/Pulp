use std::str::FromStr;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

/// 默认唤出快捷键：macOS 为 Cmd+Shift+P，Windows/Linux 为 Ctrl+Shift+P
const DEFAULT_SHORTCUT: &str = "CmdOrCtrl+Shift+P";

/// 当前已注册的快捷键，换绑时需要先注销旧的
#[derive(Default)]
struct ShortcutStatus {
    registered: bool,
    accelerator: String,
}

#[derive(Serialize)]
struct ShortcutInfo {
    registered: bool,
    accelerator: String,
}

/// 前端读取快捷键注册结果，注册失败时提示用户更换组合
#[tauri::command]
fn shortcut_state(status: State<'_, Mutex<ShortcutStatus>>) -> ShortcutInfo {
    match status.lock() {
        Ok(s) => ShortcutInfo {
            registered: s.registered,
            accelerator: s.accelerator.clone(),
        },
        Err(_) => ShortcutInfo {
            registered: false,
            accelerator: DEFAULT_SHORTCUT.to_string(),
        },
    }
}

/// 真正退出进程；与「隐藏」区分开
#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
async fn export_markdown(app: AppHandle, content: String) -> Result<bool, String> {
    let destination = rfd::AsyncFileDialog::new()
        .set_title(language_text(&app, "导出 Markdown", "Export Markdown"))
        .set_file_name("Pulp.md")
        .add_filter("Markdown", &["md"])
        .save_file()
        .await;
    let Some(destination) = destination else {
        return Ok(false);
    };
    std::fs::write(destination.path(), content)
        .map_err(|error| format!("导出失败：{error}"))?;
    Ok(true)
}

#[tauri::command]
fn print_note(window: tauri::WebviewWindow) -> Result<(), String> {
    window.print().map_err(|error| format!("打开打印面板失败：{error}"))
}

#[tauri::command]
fn new_note(app: AppHandle, note: Note, next_format: String) -> Result<Note, String> {
    archive_note(&app, &note)?;
    let settings = read_settings(&app);
    let directory = if settings.notes_directory.is_empty() {
        note_path(&app)?.parent().ok_or("无法定位笔记目录")?.join("notes")
    } else {
        std::path::PathBuf::from(&settings.notes_directory)
    };
    std::fs::create_dir_all(&directory).map_err(|error| format!("无法创建笔记目录：{error}"))?;
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| error.to_string())?.as_nanos();
    let extension = if next_format == "plain" { "txt" } else { "md" };
    let file_path = directory.join(format!("Pulp-{timestamp}.{extension}"));
    std::fs::OpenOptions::new().write(true).create_new(true).open(&file_path)
        .map_err(|error| format!("创建笔记失败：{error}"))?;
    let next = Note { content: String::new(), format: next_format, file_path: Some(file_path) };
    save_note(app, next.clone())?;
    Ok(next)
}

fn archive_note(app: &AppHandle, note: &Note) -> Result<(), String> {
    if !note.content.trim().is_empty() {
        let directory = note_path(app)?.parent().ok_or("无法定位归档目录")?.join("archive");
        std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|error| error.to_string())?.as_nanos();
        let json = serde_json::to_string(&note).map_err(|error| error.to_string())?;
        std::fs::write(directory.join(format!("{timestamp}.json")), json)
            .map_err(|error| format!("归档失败：{error}"))?;
    }
    Ok(())
}

#[tauri::command]
fn open_archive(app: AppHandle, id: String, current: Note) -> Result<Note, String> {
    if id.is_empty() || !id.bytes().all(|character| character.is_ascii_digit()) {
        return Err("无效的历史笔记编号".to_string());
    }
    let path = note_path(&app)?.parent().ok_or("无法定位归档目录")?
        .join("archive").join(format!("{id}.json"));
    let raw = std::fs::read_to_string(path).map_err(|error| format!("读取历史失败：{error}"))?;
    let note: Note = serde_json::from_str(&raw).map_err(|error| error.to_string())?;
    archive_note(&app, &current)?;
    save_note(app, note.clone())?;
    Ok(note)
}

#[tauri::command]
async fn choose_notes_directory(app: AppHandle) -> Option<String> {
    rfd::AsyncFileDialog::new().set_title(language_text(&app, "选择新笔记保存文件夹", "Choose a folder for new notes")).pick_folder().await
        .map(|folder| folder.path().to_string_lossy().to_string())
}

#[derive(Serialize)]
struct ArchivedNote {
    id: String,
    content: String,
    format: String,
}

#[tauri::command]
fn list_archives(app: AppHandle) -> Result<Vec<ArchivedNote>, String> {
    let directory = note_path(&app)?.parent().ok_or("无法定位归档目录")?.join("archive");
    if !directory.exists() { return Ok(Vec::new()); }
    let mut notes = Vec::new();
    for entry in std::fs::read_dir(directory).map_err(|error| error.to_string())? {
        let path = entry.map_err(|error| error.to_string())?.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") { continue; }
        let raw = std::fs::read_to_string(&path).map_err(|error| error.to_string())?;
        let note: Note = serde_json::from_str(&raw).map_err(|error| error.to_string())?;
        notes.push(ArchivedNote {
            id: path.file_stem().ok_or("无效文件名")?.to_string_lossy().to_string(),
            content: note.content,
            format: note.format,
        });
    }
    notes.sort_by(|left, right| right.id.len().cmp(&left.id.len()).then_with(|| right.id.cmp(&left.id)));
    Ok(notes)
}

/// 笔记内容与编辑模式，持久化到应用数据目录
#[derive(Serialize, Deserialize, Clone, Default)]
struct Note {
    #[serde(default)]
    content: String,
    /// "markdown" 或 "plain"
    #[serde(default = "default_format")]
    format: String,
    #[serde(default)]
    file_path: Option<std::path::PathBuf>,
}

fn default_format() -> String {
    "markdown".to_string()
}

fn note_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法定位数据目录：{e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("无法创建数据目录：{e}"))?;
    Ok(dir.join("note.json"))
}

#[tauri::command]
fn load_note(app: AppHandle) -> Note {
    // 读不到或解析失败都退回空笔记，避免首次启动报错
    note_path(&app)
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|raw| serde_json::from_str::<Note>(&raw).ok())
        .unwrap_or_else(|| Note {
            content: String::new(),
            format: default_format(),
            file_path: None,
        })
}

#[tauri::command]
fn save_note(app: AppHandle, note: Note) -> Result<(), String> {
    let path = note_path(&app)?;
    let json = serde_json::to_string(&note).map_err(|e| format!("序列化失败：{e}"))?;
    if let Some(file_path) = &note.file_path {
        let temporary = file_path.with_extension("pulp-tmp");
        std::fs::write(&temporary, &note.content).map_err(|error| format!("笔记文件写入失败：{error}"))?;
        std::fs::rename(&temporary, file_path).map_err(|error| format!("笔记文件保存失败：{error}"))?;
    }

    // 先写临时文件再原子替换，避免写一半断电导致笔记损坏
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json).map_err(|e| format!("写入失败：{e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("保存失败：{e}"))?;
    Ok(())
}

/// 用户设置，与笔记分开存放
#[derive(Serialize, Deserialize, Clone)]
struct Settings {
    #[serde(default = "default_language")]
    language: String,
    /// 全局唤出快捷键，Tauri 加速键写法
    #[serde(default = "default_shortcut")]
    shortcut: String,
    /// 新笔记的默认格式："markdown" 或 "plain"
    #[serde(default = "default_format")]
    default_format: String,
    /// 开机自启
    #[serde(default)]
    autostart: bool,
    #[serde(default)]
    notes_directory: String,
}

fn default_shortcut() -> String {
    DEFAULT_SHORTCUT.to_string()
}

fn default_language() -> String { "zh".to_string() }

fn language_text(app: &AppHandle, chinese: &str, english: &str) -> String {
    if read_settings(app).language == "en" { english.to_string() } else { chinese.to_string() }
}

fn tray_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let show = MenuItem::with_id(app, "show", language_text(app, "打开 Pulp", "Open Pulp"), true, None::<&str>)?;
    let hide = MenuItem::with_id(app, "hide", language_text(app, "隐藏窗口", "Hide window"), true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", language_text(app, "退出 Pulp", "Quit Pulp"), true, None::<&str>)?;
    Menu::with_items(app, &[&show, &hide, &quit])
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            language: default_language(),
            shortcut: default_shortcut(),
            default_format: default_format(),
            autostart: false,
            notes_directory: String::new(),
        }
    }
}

fn settings_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法定位数据目录：{e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("无法创建数据目录：{e}"))?;
    Ok(dir.join("settings.json"))
}

fn read_settings(app: &AppHandle) -> Settings {
    settings_path(app)
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|raw| serde_json::from_str::<Settings>(&raw).ok())
        .unwrap_or_default()
}

fn write_settings(app: &AppHandle, settings: &Settings) -> Result<(), String> {
    let path = settings_path(app)?;
    let json = serde_json::to_string(settings).map_err(|e| format!("序列化失败：{e}"))?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json).map_err(|e| format!("写入失败：{e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("保存失败：{e}"))?;
    Ok(())
}

#[tauri::command]
fn load_settings(app: AppHandle) -> Settings {
    read_settings(&app)
}

/// 换绑全局快捷键：先注销旧的，新的注册失败则回滚，避免用户失去唤出能力
fn rebind_shortcut(app: &AppHandle, accelerator: &str) -> Result<(), String> {
    let next =
        Shortcut::from_str(accelerator).map_err(|_| format!("无法识别的组合键：{accelerator}"))?;

    let previous = app
        .try_state::<Mutex<ShortcutStatus>>()
        .and_then(|s| s.lock().ok().map(|v| v.accelerator.clone()));

    // 先注销旧快捷键，否则旧组合会继续生效
    if let Some(old) = previous.as_deref() {
        if !old.is_empty() && old != accelerator {
            if let Ok(old_shortcut) = Shortcut::from_str(old) {
                let _ = app.global_shortcut().unregister(old_shortcut);
            }
        }
    }

    match app.global_shortcut().register(next) {
        Ok(()) => {
            if let Some(state) = app.try_state::<Mutex<ShortcutStatus>>() {
                if let Ok(mut status) = state.lock() {
                    status.registered = true;
                    status.accelerator = accelerator.to_string();
                }
            }
            Ok(())
        }
        Err(error) => {
            // 新组合注册失败（多半被别的程序占用），把旧的重新装回去
            if let Some(old) = previous.as_deref() {
                if !old.is_empty() && old != accelerator {
                    if let Ok(old_shortcut) = Shortcut::from_str(old) {
                        let _ = app.global_shortcut().register(old_shortcut);
                    }
                }
            }
            Err(format!("注册失败，可能已被其它程序占用：{error}"))
        }
    }
}

#[tauri::command]
fn save_settings(app: AppHandle, settings: Settings) -> Result<Settings, String> {
    if settings.language != "zh" && settings.language != "en" {
        return Err("Unsupported language".to_string());
    }
    let current = read_settings(&app);
    if settings.notes_directory != current.notes_directory && !settings.notes_directory.is_empty() {
        let directory = std::path::Path::new(&settings.notes_directory);
        if !directory.is_absolute() || !directory.is_dir() {
            return Err("请选择有效的保存文件夹".to_string());
        }
        let timestamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
            .map_err(|error| error.to_string())?.as_nanos();
        let probe = directory.join(format!(".pulp-write-check-{timestamp}"));
        let file = std::fs::OpenOptions::new().write(true).create_new(true).open(&probe)
            .map_err(|error| format!("此文件夹不可写：{error}"))?;
        drop(file);
        std::fs::remove_file(probe).map_err(|error| format!("文件夹权限检查失败：{error}"))?;
    }

    // 快捷键变了才重新注册，省去无谓的注销/注册抖动
    if settings.shortcut != current.shortcut {
        rebind_shortcut(&app, &settings.shortcut)?;
    }

    if settings.autostart != current.autostart {
        let manager = app.autolaunch();
        let result = if settings.autostart {
            manager.enable()
        } else {
            manager.disable()
        };
        result.map_err(|e| format!("开机自启设置失败：{e}"))?;
    }

    write_settings(&app, &settings)?;
    if current.language != settings.language {
        if let Some(tray) = app.tray_by_id("pulp") {
            let update = tray_menu(&app).and_then(|menu| tray.set_menu(Some(menu)))
                .and_then(|_| tray.set_tooltip(Some(language_text(&app, "Pulp · 悬浮记事本", "Pulp · A floating space for your thoughts"))));
            if let Err(error) = update {
                let _ = write_settings(&app, &current);
                if let Ok(menu) = tray_menu(&app) { let _ = tray.set_menu(Some(menu)); }
                return Err(error.to_string());
            }
        }
    }
    Ok(settings)
}

/// 可见则隐藏，隐藏则显示并聚焦
fn toggle_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    let visible = window.is_visible().unwrap_or(false);
    let minimized = window.is_minimized().unwrap_or(false);

    if visible && !minimized {
        let _ = window.hide();
    } else {
        if minimized {
            let _ = window.unminimize();
        }
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    // 只响应按下，避免一次按键触发两次切换
                    if event.state() == ShortcutState::Pressed {
                        toggle_window(app);
                    }
                })
                .build(),
        )
        .manage(Mutex::new(ShortcutStatus::default()))
        .invoke_handler(tauri::generate_handler![
            shortcut_state,
            quit_app,
            export_markdown,
            print_note,
            new_note,
            open_archive,
            choose_notes_directory,
            list_archives,
            load_note,
            save_note,
            load_settings,
            save_settings
        ])
        .setup(|app| {
            let menu = tray_menu(app.handle())?;
            let mut tray = TrayIconBuilder::with_id("pulp")
                .tooltip(language_text(app.handle(), "Pulp · 悬浮记事本", "Pulp · A floating space for your thoughts"))
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| {
                    if let Some(window) = app.get_webview_window("main") {
                        match event.id.as_ref() {
                            "show" => {
                                let _ = window.unminimize();
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                            "hide" => { let _ = window.hide(); }
                            "quit" => { let _ = window.emit("tray-quit", ()); }
                            _ => {}
                        }
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        if let Some(window) = tray.app_handle().get_webview_window("main") {
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                });
            if let Some(icon) = app.default_window_icon() { tray = tray.icon(icon.clone()); }
            tray.build(app)?;
            // macOS：不占用 Dock 图标，像配件一样常驻后台
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            // 按用户保存的设置注册快捷键；失败则退回默认组合再试一次
            let handle = app.handle().clone();
            let settings = read_settings(&handle);

            if rebind_shortcut(&handle, &settings.shortcut).is_err() {
                eprintln!(
                    "注册快捷键 {} 失败，尝试退回默认组合",
                    settings.shortcut
                );
                if rebind_shortcut(&handle, DEFAULT_SHORTCUT).is_err() {
                    eprintln!("默认快捷键同样注册失败，请在设置里改用其它组合");
                    if let Some(state) = handle.try_state::<Mutex<ShortcutStatus>>() {
                        if let Ok(mut status) = state.lock() {
                            status.registered = false;
                            status.accelerator = settings.shortcut.clone();
                        }
                    }
                }
            }

            // 首次启动直接展示一次，方便确认进程已就绪
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            // 关闭请求 = 隐藏窗口，进程常驻，快捷键始终有效
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Pulp");
}
