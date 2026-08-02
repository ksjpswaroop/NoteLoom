use std::fs;
use tauri::{AppHandle, Manager};

const DATABASE_FILES: [&str; 3] = ["note.db", "note.db-wal", "note.db-shm"];

#[tauri::command]
pub fn delete_local_database(app: AppHandle) -> Result<(), String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("Unable to locate the database directory: {error}"))?;

    for file_name in DATABASE_FILES {
        let path = config_dir.join(file_name);
        if !path.exists() {
            continue;
        }
        fs::remove_file(&path)
            .map_err(|error| format!("Unable to delete {}: {error}", path.display()))?;
    }

    Ok(())
}
