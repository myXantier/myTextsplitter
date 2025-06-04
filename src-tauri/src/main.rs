// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use settimeout::set_timeout;
use std::time::Duration;

use tauri::{Manager, State, WindowEvent};

mod text_processor;
mod memory_usage;
use text_processor::{ProcessedText, TextProcessor};

mod text_diff;

// Settings
mod settings;
use settings::SaveAppSettings;
use std::sync::{Arc, Mutex};

use lazy_static::lazy_static;
use memory_stats::{memory_stats, MemoryStats};


// Wrap `SaveAppSettings` in `Arc<Mutex<T>>` für sichere Thread-Nutzung
pub struct SettingsState(pub Arc<Mutex<SaveAppSettings>>);

lazy_static! {
    static ref MEMORY_START: Mutex<Option<MemoryStats>> = Mutex::new(None);
}

#[tauri::command]
fn start_memory_measurement() {
    let mut mem_start = MEMORY_START.lock().unwrap();
    *mem_start = memory_stats(); // Ersten Messwert speichern
}

#[tauri::command]
fn get_memory_diff() -> Option<(i64, i64)> {
    let mut mem_start = MEMORY_START.lock().unwrap();
    if let Some(start_mem) = *mem_start {
        if let Some(current_mem) = memory_stats() {
            let phys_diff = (current_mem.physical_mem as i64) - (start_mem.physical_mem as i64);
            let virt_diff = (current_mem.virtual_mem as i64) - (start_mem.virtual_mem as i64);
            *mem_start = None; // Nach der Messung zurücksetzen
            return Some((phys_diff, virt_diff));
        }
    }
    None
}

#[tauri::command]
fn is_backend_available() -> bool {
    true // Immer verfügbar, solange Tauri läuft
}

#[tauri::command]
async fn process_text_block(
    text: String,
    delimiter: String,
    trimparts: bool,
    useregex: bool,
) -> Result<ProcessedText<Vec<String>>, String> {
    TextProcessor::process_text_block_to_column_strings(&text, &delimiter, trimparts, useregex)
        .map_err(|e| e.to_string())
}

// #[tauri::command]
// async fn process_file(file_path: String, delimiter: String) -> Result<Vec<String>, String> {
//     TextProcessor::process_file_to_column_strings(file_path, &delimiter)
//         .map_err(|err| format!("Error processing file: {}", err))
// }

#[tauri::command]
async fn connect_texts(text1: String, text2: String, separator: String) -> Result<String, String> {
    TextProcessor::connect_texts(&text1, &text2, &separator).map_err(|e| e.to_string())
}

/// Text Diff Method
#[tauri::command]
async fn get_text_diff(
    oldtext: String,
    newtext: String,
    ignorewhitespace: bool,
) -> Result<ProcessedText<String>, String> {
    text_diff::get_diff_json(&oldtext, &newtext, ignorewhitespace).map_err(|e| e.to_string())
}

/// Filter Text Method
#[tauri::command]
fn filter_text(
    text: String,
    pattern: String,
    filtermode: String,
    casesensitive: bool,
    splitmatches: bool,
) -> Result<ProcessedText<String>, String> {
    TextProcessor::filter_text_internal(
        &text,
        &pattern,
        &filtermode,
        casesensitive,
        splitmatches,
    )
}

/// Remove Lines Method
#[tauri::command]
fn remove_lines(
    text: String,
    pattern: String,
    removemode: String,
    casesensitive: bool,
    useregex: bool,
    trimparts: bool,
) -> Result<ProcessedText<String>, String> {
    TextProcessor::remove_lines_internal(
        &text,
        &pattern,
        &removemode,
        casesensitive,
        useregex,
        trimparts,
    )
}

#[tauri::command]
fn get_settings(state: State<SettingsState>) -> SaveAppSettings {
    state.0.lock().unwrap().clone()
}


#[tauri::command]
fn set_settings(state: State<SettingsState>, newsettings: SaveAppSettings) -> Result<(), String> {
    *state.0.lock().unwrap() = newsettings;
    Ok(())
}


fn save_settings_to_file(state: Arc<Mutex<SaveAppSettings>>) -> Result<(), String> {
    state.lock().unwrap().save()
}

#[tauri::command]
fn save_and_close(state: State<SettingsState>, app: tauri::AppHandle) {
    if let Err(e) = save_settings_to_file(state.0.clone()) {
        eprintln!("❌ Fehler beim Speichern der Settings: {:?}", e);
    }
    app.exit(0); // Sicherstellen, dass die App danach auch wirklich beendet wird
}


#[tauri::command]
async fn close_splashscreen(window: tauri::Window) {
    // Close splashscreen
    if let Some(splashscreen) = window.get_webview_window("splashscreen") {
        set_timeout(Duration::from_millis(100)).await;
        splashscreen.close().unwrap();
    }

    // Show main window
    set_timeout(Duration::from_millis(500)).await;
    window.get_webview_window("main").unwrap().show().unwrap();
}

#[allow(unused_variables)]
#[tauri::command]
async fn set_window_shadow(window: tauri::Window) {
    //#[cfg(any(windows, target_os = "windows"))]
    //set_shadow(&window, true).unwrap();
}


fn main() {
    #[cfg(target_os = "linux")]
    std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");

    tauri::Builder::default()
        .manage(SettingsState(Arc::new(Mutex::new(SaveAppSettings::load()))))
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            get_settings,
            set_settings,
            save_and_close,
            process_text_block,
            // process_file,
            connect_texts,
            get_text_diff,
            filter_text,
            remove_lines,
            is_backend_available,
            start_memory_measurement,
            get_memory_diff,
            close_splashscreen,
            set_window_shadow,
        ])
        .setup(|app| {
            let settings_state = app.state::<SettingsState>().0.clone();
            let window = app.get_webview_window("main").expect("Fenster nicht gefunden"); 

            // Fenstergröße & Position beim Start wiederherstellen
            {
                let settings = settings_state.lock().unwrap();
                if let Some((x, y)) = settings.window_position {
                    if let Some((w, h)) = settings.window_size {
                        let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }));
                        let _ = window.set_size(tauri::Size::Physical(tauri::PhysicalSize { width: w, height: h }));
                    }
                }
            }

            // Vor dem Schließen Position & Größe speichern
            let settings_clone = settings_state.clone();
            window.clone().on_window_event(move |event| {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    println!("🔴 App wird geschlossen: Speichere Fensterposition...");

                    let state_clone = settings_clone.clone();
                    let window_clone = window.clone();

                    std::thread::spawn(move || {
                        if let Ok(position) = window_clone.outer_position() {
                            if let Ok(size) = window_clone.outer_size() {
                                let mut settings = state_clone.lock().unwrap();
                                settings.window_position = Some((position.x, position.y));
                                settings.window_size = Some((size.width, size.height));
                            }
                        }

                        if let Err(e) = save_settings_to_file(state_clone) {
                            eprintln!("❌ Fehler beim Speichern: {:?}", e);
                        }
                        std::process::exit(0);
                    });
                }
                });

                // #[cfg(debug_assertions)]
                // app.get_webview_window("main").expect("Fenster nicht gefunden").open_devtools();
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
