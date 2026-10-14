// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use settimeout::set_timeout;
use std::time::Duration;

use tauri::{Manager, State, WindowEvent};

mod line_endings;
mod text_processor;
mod memory_usage;
use line_endings::{LineEnding, LineFormat};
use text_processor::{CombineColumn, ProcessedText, TextError, TextProcessor};

mod diff;
mod job_slot;
use job_slot::JobSlot;

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

// CPU-heavy text commands (Split, Filter, Remove, Diff) run on Tokio's blocking pool, not on the async executor threads
// that also serve the other IPC commands. Per operation at most one job runs and at most one waits (`JobSlot`):
// a newer request replaces the waiting one, which then never runs (`TextError::Superseded`). A running regex cannot
// be stopped. Different operations do not block each other.
static SPLIT_JOBS: JobSlot<ProcessedText<Vec<String>>> = JobSlot::new();
static FILTER_JOBS: JobSlot<ProcessedText<String>> = JobSlot::new();
static REMOVE_JOBS: JobSlot<ProcessedText<String>> = JobSlot::new();
static DIFF_JOBS: JobSlot<diff::DiffResponse> = JobSlot::new();

#[tauri::command]
async fn process_text_block(
    text: String,
    delimiter: String,
    trimparts: bool,
    useregex: bool,
    keepemptylines: bool,
) -> Result<ProcessedText<Vec<String>>, TextError> {
    SPLIT_JOBS.run(move || {
        TextProcessor::process_text_block_to_column_strings(&text, &delimiter, trimparts, useregex, keepemptylines)
    })
    .await
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

/// Combine of the split columns. `lineending` (`"\n"`, `"\r\n"` or `"\r"`) and `trailingnewline` are the line format of
/// the text that was split, detected by the frontend with the shared rules (`src/utils/lines.ts`).
#[tauri::command]
async fn combine_columns(
    columns: Vec<Vec<String>>,
    used: Vec<CombineColumn>,
    lineending: String,
    trailingnewline: bool,
) -> Result<String, String> {
    let line_ending = LineEnding::parse(&lineending).ok_or_else(|| format!("unsupported line ending {lineending:?}"))?;
    let format = LineFormat { line_ending, trailing_newline: trailingnewline };
    Ok(TextProcessor::combine_columns(&columns, &used, format))
}

/// Line diff (Paket 7): returns the `DiffDocumentV2` and, only when `worddiff` is true, its word diff as structured IPC
/// data (no JSON string inside the JSON). Runs on the blocking pool through its own job slot like Split/Filter/Remove;
/// a too complex line diff is `TextError::DiffTooComplex`.
#[tauri::command]
async fn get_text_diff(
    oldtext: String,
    newtext: String,
    ignorewhitespace: bool,
    worddiff: bool,
) -> Result<diff::DiffResponse, TextError> {
    DIFF_JOBS.run(move || diff::get_diff(&oldtext, &newtext, ignorewhitespace, worddiff)).await
}

/// Filter Text Method
// async + blocking pool: sync commands run on the main thread, a long regex would freeze the window
#[tauri::command]
async fn filter_text(
    text: String,
    pattern: String,
    filtermode: String,
    casesensitive: bool,
    splitmatches: bool,
) -> Result<ProcessedText<String>, TextError> {
    FILTER_JOBS.run(move || {
        TextProcessor::filter_text_internal(
            &text,
            &pattern,
            &filtermode,
            casesensitive,
            splitmatches,
        )
    })
    .await
}

/// Remove Lines Method
// async + blocking pool: sync commands run on the main thread, a long regex would freeze the window
#[tauri::command]
async fn remove_lines(
    text: String,
    pattern: String,
    removemode: String,
    casesensitive: bool,
    useregex: bool,
    trimparts: bool,
) -> Result<ProcessedText<String>, TextError> {
    REMOVE_JOBS.run(move || {
        TextProcessor::remove_lines_internal(
            &text,
            &pattern,
            &removemode,
            casesensitive,
            useregex,
            trimparts,
        )
    })
    .await
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
            combine_columns,
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
            // Position = äußere Position (passend zu outer_position), Größe = innere Größe (passend zu inner_size).
            // Beide unabhängig, da z. B. Wayland keine Fensterposition liefert/setzt.
            {
                let settings = settings_state.lock().unwrap();
                if let Some((x, y)) = settings.window_position {
                    let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }));
                }
                if let Some((w, h)) = settings.window_size {
                    let _ = window.set_size(tauri::Size::Physical(tauri::PhysicalSize { width: w, height: h }));
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
                        // Maximiert/minimiert nicht speichern, damit die zuletzt gespeicherte Normalgröße erhalten bleibt
                        let is_maximized = window_clone.is_maximized().unwrap_or(false);
                        let is_minimized = window_clone.is_minimized().unwrap_or(false);
                        if !is_maximized && !is_minimized {
                            let mut settings = state_clone.lock().unwrap();
                            if let Ok(position) = window_clone.outer_position() {
                                settings.window_position = Some((position.x, position.y));
                            }
                            // inner_size, da set_size beim Start die innere Größe setzt
                            if let Ok(size) = window_clone.inner_size() {
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

#[cfg(test)]
mod tests {
    use super::*;

    /// The command tests share the real job slots: run in parallel, one test's request would correctly supersede
    /// another test's waiting request. Each command test holds this lock.
    static COMMAND_TESTS: Mutex<()> = Mutex::new(());
    fn serial() -> std::sync::MutexGuard<'static, ()> {
        COMMAND_TESTS.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Error result of a text command as the frontend receives it through Tauri IPC (`fromBackendError`).
    fn ipc_error<T: std::fmt::Debug>(result: Result<T, TextError>) -> serde_json::Value {
        serde_json::to_value(result.expect_err("expected an error result")).unwrap()
    }

    #[test]
    fn text_commands_report_invalid_regex_as_kind_and_message() {
        let _serial = serial();
        use tauri::async_runtime::block_on;
        for error in [
            ipc_error(block_on(process_text_block("a".into(), "([a-".into(), false, true, true))),
            ipc_error(block_on(filter_text("a".into(), "([a-".into(), "keep".into(), false, false))),
            ipc_error(block_on(remove_lines("a".into(), "([a-".into(), "containing".into(), true, true, false))),
        ] {
            assert_eq!(error["kind"], "invalidRegex", "{error}");
            assert!(error["message"].as_str().is_some_and(|m| m.contains("position 4")), "{error}"); // not shifted by the (?i) prefix
        }
    }

    #[test]
    fn text_commands_report_backtrack_limit_as_regex_runtime_error() {
        let _serial = serial();
        let text = "ab".repeat(40);
        let error = ipc_error(tauri::async_runtime::block_on(filter_text(text, "(a|b|ab)*(?=c)".into(), "keep".into(), true, false)));
        assert_eq!(error["kind"], "regexRuntime", "{error}");
    }

    #[test]
    fn text_commands_process_ordinary_input() {
        let _serial = serial();
        let filtered = tauri::async_runtime::block_on(filter_text("cost $42".into(), r"(?<=\$)\d+".into(), "keep".into(), true, false)).unwrap();
        assert_eq!(filtered.result_text, "42");
        let removed = tauri::async_runtime::block_on(remove_lines("aa\nab".into(), r"(\w)\1".into(), "containing".into(), true, true, false)).unwrap();
        assert_eq!((removed.result_text.as_str(), removed.removed_lines), ("ab", 1));
        let split = tauri::async_runtime::block_on(process_text_block("a,b".into(), ",".into(), false, false, true)).unwrap();
        assert_eq!(split.result_text, vec!["a", "b"]);
        // The metrics of the processing are kept (measured inside the job, without the queue time)
        assert!(serde_json::to_value(&split.metrics).unwrap()["execution_time_ms"].as_f64().is_some_and(|ms| ms >= 0.0));
    }

    #[test]
    fn combine_columns_command_uses_the_given_line_format() {
        use tauri::async_runtime::block_on;
        // Same argument shape as LeftMenuBar.appendColumnTauri (`used` deserialized from `{ index, separator }`)
        let used: Vec<CombineColumn> = serde_json::from_value(serde_json::json!([{ "index": 1, "separator": "" }, { "index": 0, "separator": ":" }])).unwrap();
        let columns = vec![vec!["A".to_string(), "C".into(), "".into()], vec!["B".to_string(), "D".into(), "".into()]];
        let combined = block_on(combine_columns(columns.clone(), used.clone(), "\r\n".into(), true)).unwrap();
        assert_eq!(combined, "B:A\r\nD:C\r\n:\r\n");
        let error = block_on(combine_columns(columns, used, "\\n".into(), false)).unwrap_err();
        assert!(error.contains("unsupported line ending"), "{error}");
        // A single empty value is a valid (empty) result, not an error
        let first: Vec<CombineColumn> = serde_json::from_value(serde_json::json!([{ "index": 0, "separator": "" }])).unwrap();
        assert_eq!(block_on(combine_columns(vec![vec![String::new()]], first, "\n".into(), false)), Ok(String::new()));
    }

    #[test]
    fn superseded_and_internal_errors_reach_the_frontend_as_kind() {
        let superseded = ipc_error::<()>(Err(TextError::Superseded));
        assert_eq!(superseded["kind"], "superseded", "{superseded}");
        let internal = ipc_error::<()>(Err(TextError::Internal("text processing job panicked".into())));
        assert_eq!((internal["kind"].as_str(), internal["message"].as_str()), (Some("internal"), Some("text processing job panicked")));
    }
}
