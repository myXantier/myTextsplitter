use std::path::PathBuf;
use serde::{Serialize, Deserialize};
use std::fs;


#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")] // Erzwingt camelCase für JSON-Keys
pub struct SaveAppSettings {
    pub is_dark_mode: Option<bool>,
    pub language: Option<String>,
    pub trim_line: Option<bool>,
    pub trim_parts: Option<bool>,
    pub font_size: Option<String>,
    pub show_line_numbers: Option<bool>,
    pub show_empty_lines: Option<bool>,
    pub saved_patterns: Option<Vec<String>>,
    pub window_position: Option<(i32, i32)>,
    pub window_size: Option<(u32, u32)>,
}

impl Default for SaveAppSettings {
    fn default() -> Self {
        Self {
            is_dark_mode: Some(true),
            language: Some("en".to_string()),
            trim_line: Some(false),
            trim_parts: Some(false),
            font_size: Some("text-sm".to_string()),
            show_line_numbers: Some(false),
            show_empty_lines: Some(false),
            saved_patterns: Some(vec![]),
            window_position: Some((100, 100)),
            window_size: Some((1200, 800)),
        }
    }
}

impl SaveAppSettings {
    fn get_path() -> PathBuf {
        dirs::config_dir().expect("Konnte App-Config-Verzeichnis nicht finden")
            .join("com.text-splitter.dev/settings.json")
    }

    
    // Funktion zum Speichern der Settings in einer Datei
    pub fn get_settings_path() -> PathBuf {
        dirs::config_dir().unwrap().join("com.text-splitter.dev/settings.json")
    }


    // Settings aus Datei laden
    pub fn load() -> Self {
        let path = Self::get_path();
        if let Ok(data) = fs::read_to_string(&path) {
            if let Ok(settings) = serde_json::from_str(&data) {
                return settings;
            }
        }
        Self::default()
    }

    // Settings speichern
    pub fn save(&self) -> Result<(), String> {
        let path = Self::get_path();
        println!("Speicherpath der Einstellungen: {:?}", path);
        std::fs::write(&path, serde_json::to_string_pretty(self).map_err(|e| e.to_string())?)
            .map_err(|e| format!("Fehler beim Speichern der Settings: {:?}", e))
    }
}
