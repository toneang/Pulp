use std::str::FromStr;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State, WindowEvent};
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
async fn export_markdown(content: String) -> Result<bool, String> {
    let destination = rfd::AsyncFileDialog::new()
        .set_title("导出 Markdown")
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
fn new_note(app: AppHandle, note: Note, next_format: String) -> Result<(), String> {
    if !note.content.trim().is_empty() {
        let directory = note_path(&app)?.parent().ok_or("无法定位归档目录")?.join("archive");
        std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|error| error.to_string())?.as_nanos();
        let json = serde_json::to_string(&note).map_err(|error| error.to_string())?;
        std::fs::write(directory.join(format!("{timestamp}.json")), json)
            .map_err(|error| format!("归档失败：{error}"))?;
    }
    save_note(app, Note { content: String::new(), format: next_format })
}

/// 笔记内容与编辑模式，持久化到应用数据目录
#[derive(Serialize, Deserialize, Clone, Default)]
struct Note {
    #[serde(default)]
    content: String,
    /// "markdown" 或 "plain"
    #[serde(default = "default_format")]
    format: String,
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
        })
}

#[tauri::command]
fn save_note(app: AppHandle, note: Note) -> Result<(), String> {
    let path = note_path(&app)?;
    let json = serde_json::to_string(&note).map_err(|e| format!("序列化失败：{e}"))?;

    // 先写临时文件再原子替换，避免写一半断电导致笔记损坏
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json).map_err(|e| format!("写入失败：{e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("保存失败：{e}"))?;
    Ok(())
}

/// 用户设置，与笔记分开存放
#[derive(Serialize, Deserialize, Clone)]
struct Settings {
    /// 全局唤出快捷键，Tauri 加速键写法
    #[serde(default = "default_shortcut")]
    shortcut: String,
    /// 新笔记的默认格式："markdown" 或 "plain"
    #[serde(default = "default_format")]
    default_format: String,
    /// 开机自启
    #[serde(default)]
    autostart: bool,
}

fn default_shortcut() -> String {
    DEFAULT_SHORTCUT.to_string()
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            shortcut: default_shortcut(),
            default_format: default_format(),
            autostart: false,
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
    let current = read_settings(&app);

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
            load_note,
            save_note,
            load_settings,
            save_settings
        ])
        .setup(|app| {
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
