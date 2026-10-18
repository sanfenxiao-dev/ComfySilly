mod card_png;
mod providers;
mod secrets;
mod storage;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize)]
pub struct PipelineExecutionResult {
    pub success: bool,
    pub message: String,
    pub estimated_tokens: usize,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FileMeta {
    pub name: String,
    pub path: String,
    pub modified_time: u64,
}

fn get_app_dir(sub: &str) -> PathBuf {
    let mut dir = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
    dir.push("ComfySilly");
    dir.push(sub);
    if !dir.exists() {
        let _ = std::fs::create_dir_all(&dir);
    }
    dir
}

#[tauri::command]
async fn execute_pipeline_flow(flow_json: String) -> Result<PipelineExecutionResult, String> {
    log::info!(
        "Received workflow graph for execution: {} bytes",
        flow_json.len()
    );
    let graph: serde_json::Value =
        serde_json::from_str(&flow_json).map_err(|error| format!("工作流 JSON 无效：{}", error))?;
    if !graph.get("nodes").map_or(false, |v| v.is_array())
        || !graph.get("edges").map_or(false, |v| v.is_array())
    {
        return Err("工作流必须包含 nodes 和 edges 数组".to_string());
    }
    Ok(PipelineExecutionResult {
        success: false,
        message: "工作流 JSON 结构有效；执行引擎与模型调用尚未接入，未执行推理。".to_string(),
        estimated_tokens: 0,
    })
}

#[tauri::command]
async fn load_preset_file(file_path: String) -> Result<String, String> {
    tokio::fs::read_to_string(&file_path)
        .await
        .map_err(|e| format!("Failed to read file '{}': {}", file_path, e))
}

#[tauri::command]
async fn save_preset_to_library(name: String, content: String) -> Result<String, String> {
    let dir = get_app_dir("presets");
    let safe_name = name.replace(
        |c: char| !c.is_alphanumeric() && c != '_' && c != '-' && c != '.',
        "_",
    );
    let file_path = dir.join(format!("{}.json", safe_name));

    storage::save_json(&file_path, &content).await?;

    Ok(file_path.to_string_lossy().to_string())
}

#[tauri::command]
async fn delete_preset_from_library(path: String) -> Result<bool, String> {
    let p = storage::library_deletion_path(&get_app_dir("presets"), &PathBuf::from(&path))?;
    if p.exists() {
        tokio::fs::remove_file(&p)
            .await
            .map_err(|e| format!("Failed to delete preset file: {}", e))?;
        Ok(true)
    } else {
        Err("File not found".to_string())
    }
}

#[tauri::command]
async fn list_preset_library() -> Result<Vec<FileMeta>, String> {
    let dir = get_app_dir("presets");
    let mut list = Vec::new();

    if let Ok(mut entries) = tokio::fs::read_dir(&dir).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) == Some("json") {
                let name = path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("unknown")
                    .to_string();
                let modified = entry
                    .metadata()
                    .await
                    .ok()
                    .and_then(|m| m.modified().ok())
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs())
                    .unwrap_or(0);

                list.push(FileMeta {
                    name,
                    path: path.to_string_lossy().to_string(),
                    modified_time: modified,
                });
            }
        }
    }

    list.sort_by(|a, b| b.modified_time.cmp(&a.modified_time));
    Ok(list)
}

/// 🌟 全局世界书保存与列表管理
#[tauri::command]
async fn save_worldbook_to_library(name: String, content: String) -> Result<String, String> {
    let dir = get_app_dir("worldbooks");
    let safe_name = name.replace(
        |c: char| !c.is_alphanumeric() && c != '_' && c != '-' && c != '.',
        "_",
    );
    let file_path = dir.join(format!("{}.json", safe_name));

    storage::save_json(&file_path, &content).await?;

    Ok(file_path.to_string_lossy().to_string())
}

#[tauri::command]
async fn list_worldbook_library() -> Result<Vec<FileMeta>, String> {
    let dir = get_app_dir("worldbooks");
    let mut list = Vec::new();

    if let Ok(mut entries) = tokio::fs::read_dir(&dir).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) == Some("json") {
                let name = path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("unknown")
                    .to_string();
                let modified = entry
                    .metadata()
                    .await
                    .ok()
                    .and_then(|m| m.modified().ok())
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs())
                    .unwrap_or(0);

                list.push(FileMeta {
                    name,
                    path: path.to_string_lossy().to_string(),
                    modified_time: modified,
                });
            }
        }
    }

    list.sort_by(|a, b| b.modified_time.cmp(&a.modified_time));
    Ok(list)
}

#[tauri::command]
async fn delete_worldbook_from_library(path: String) -> Result<bool, String> {
    let p = storage::library_deletion_path(&get_app_dir("worldbooks"), &PathBuf::from(&path))?;
    if p.exists() {
        tokio::fs::remove_file(&p)
            .await
            .map_err(|e| format!("Failed to delete worldbook file: {}", e))?;
        Ok(true)
    } else {
        Err("File not found".to_string())
    }
}

/// 🌟 从 PNG 文件中解析提取酒馆角色卡 V2 / V3
#[tauri::command]
async fn parse_character_card(file_path: String) -> Result<String, String> {
    let metadata = tokio::fs::metadata(&file_path)
        .await
        .map_err(|e| format!("无法访问角色卡：{e}"))?;
    if metadata.len() > 128 * 1024 * 1024 {
        return Err("角色卡文件过大，当前上限为 128 MiB".into());
    }
    let bytes = tokio::fs::read(&file_path)
        .await
        .map_err(|e| format!("读取角色卡失败：{e}"))?;
    let json_str = card_png::extract_card_json(&bytes)?;
    use base64::Engine;
    let img_b64 = base64::prelude::BASE64_STANDARD.encode(&bytes);
    Ok(serde_json::json!({
        "cardJson": json_str,
        "imageB64": format!("data:image/png;base64,{}", img_b64),
        "fileName": PathBuf::from(&file_path).file_name().and_then(|s| s.to_str()).unwrap_or("card")
    })
    .to_string())
}

#[tauri::command]
async fn save_character_to_library(id: String, payload_json: String) -> Result<bool, String> {
    let dir = get_app_dir("characters");
    let file_path = storage::character_path(&dir, &id)?;
    storage::save_json(&file_path, &payload_json).await?;
    Ok(true)
}

#[tauri::command]
async fn list_character_library() -> Result<Vec<String>, String> {
    let dir = get_app_dir("characters");
    let mut list = Vec::new();

    if let Ok(mut entries) = tokio::fs::read_dir(&dir).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) == Some("json") {
                if let Ok(content) = tokio::fs::read_to_string(&path).await {
                    list.push(content);
                }
            }
        }
    }

    Ok(list)
}

#[tauri::command]
async fn delete_character_from_library(id: String) -> Result<bool, String> {
    let dir = get_app_dir("characters");
    let file_path = storage::character_path(&dir, &id)?;
    if file_path.exists() {
        tokio::fs::remove_file(&file_path)
            .await
            .map_err(|e| format!("Failed to delete character: {}", e))?;
        Ok(true)
    } else {
        Err("Character not found".to_string())
    }
}

#[tauri::command]
async fn save_app_settings(settings_json: String) -> Result<bool, String> {
    let dir = get_app_dir("config");
    let file_path = dir.join("settings.json");
    let (protected, _) = secrets::protect_config(&settings_json)?;
    storage::save_json(&file_path, &protected).await?;
    Ok(true)
}

#[tauri::command]
async fn load_app_settings() -> Result<String, String> {
    let dir = get_app_dir("config");
    let file_path = dir.join("settings.json");
    if file_path.exists() {
        let raw = tokio::fs::read_to_string(&file_path)
            .await
            .map_err(|e| format!("读取设置失败：{e}"))?;
        let (protected, changed) = secrets::protect_config(&raw)?;
        if changed {
            storage::save_json(&file_path, &protected).await?;
        }
        secrets::unprotect_config(&protected)
    } else {
        Ok("{}".to_string())
    }
}

/// Only a native save dialog can select the destination. Frames never receive this IPC.
#[tauri::command]
async fn export_chat_file(
    app: tauri::AppHandle,
    file_name: String,
    content: String,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    if content.len() > 64 * 1024 * 1024 {
        return Err("导出内容超过 64 MiB".into());
    }
    let extension = if file_name.ends_with(".md") {
        "md"
    } else if file_name.ends_with(".json") {
        "json"
    } else {
        return Err("只支持 Markdown 或 JSON 导出".into());
    };
    let safe_name: String = file_name
        .chars()
        .map(|c| {
            if "<>:\"/\\|?*".contains(c) || c.is_control() {
                '_'
            } else {
                c
            }
        })
        .collect();
    let destination = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .add_filter("对话文件", &[extension])
            .set_file_name(safe_name)
            .blocking_save_file()
    })
    .await
    .map_err(|e| e.to_string())?;
    let Some(destination) = destination else {
        return Ok(None);
    };
    let path = destination.into_path().map_err(|e| e.to_string())?;
    storage::save_text(&path, &content).await?;
    Ok(Some(path.to_string_lossy().to_string()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            providers::generate_chat,
            providers::cancel_generation,
            providers::list_provider_models,
            execute_pipeline_flow,
            load_preset_file,
            save_preset_to_library,
            delete_preset_from_library,
            list_preset_library,
            save_worldbook_to_library,
            list_worldbook_library,
            delete_worldbook_from_library,
            parse_character_card,
            save_character_to_library,
            list_character_library,
            delete_character_from_library,
            save_app_settings,
            load_app_settings,
            export_chat_file
        ])
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}
