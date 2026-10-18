//! Local persistence helpers. Original JSON survives failed or interrupted writes.
use std::path::{Path, PathBuf};
use tokio::io::AsyncWriteExt;
static SAVE_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
static NEXT_SAVE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

pub fn character_path(root: &Path, id: &str) -> Result<PathBuf, String> {
    if id.is_empty()
        || !id
            .chars()
            .all(|c| c.is_alphanumeric() || c == '-' || c == '_')
    {
        return Err("角色 ID 无效：只允许字母、数字、下划线和连字符".into());
    }
    Ok(root.join(format!("{id}.json")))
}

pub fn library_deletion_path(root: &Path, path: &Path) -> Result<PathBuf, String> {
    let root = root
        .canonicalize()
        .map_err(|e| format!("无法访问本地库：{e}"))?;
    let path = path
        .canonicalize()
        .map_err(|e| format!("无法访问待删除文件：{e}"))?;
    if path.parent() != Some(root.as_path())
        || path.extension().and_then(|s| s.to_str()) != Some("json")
    {
        return Err("只能删除对应本地库内的 JSON 文件".into());
    }
    Ok(path)
}

pub async fn save_json(path: &Path, payload: &str) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(payload)
        .map_err(|e| format!("JSON 无效，原文件未修改：{e}"))?;
    save_text(path, payload).await
}

pub async fn save_text(path: &Path, payload: &str) -> Result<(), String> {
    let _guard = SAVE_LOCK.lock().await;
    let nonce = NEXT_SAVE.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let tmp = path.with_extension(format!("json.{}.{nonce}.tmp", std::process::id()));
    // If create_new fails, do not delete an existing temporary file we did not create.
    let mut file = tokio::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&tmp)
        .await
        .map_err(|e| format!("无法创建临时文件：{e}"))?;
    let result: Result<(), String> = async {
        file.write_all(payload.as_bytes())
            .await
            .map_err(|e| format!("写入临时文件失败：{e}"))?;
        file.sync_all()
            .await
            .map_err(|e| format!("同步临时文件失败：{e}"))?;
        drop(file);
        tokio::fs::rename(&tmp, path)
            .await
            .map_err(|e| format!("替换保存文件失败，原文件仍保留：{e}"))?;
        Ok(())
    }
    .await;
    if result.is_err() {
        let _ = tokio::fs::remove_file(&tmp).await;
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_id_path_traversal() {
        for id in ["", "../outside", "..", "C:\\outside", "a/b", "a:b"] {
            assert!(character_path(Path::new("library"), id).is_err());
        }
        assert_eq!(
            character_path(Path::new("library"), "char-123").unwrap(),
            Path::new("library").join("char-123.json")
        );
    }
    #[tokio::test]
    async fn exports_utf8_markdown_and_replaces_atomically() {
        let dir = std::env::temp_dir().join(format!("comfysilly-text-test-{}", std::process::id()));
        tokio::fs::create_dir_all(&dir).await.unwrap();
        let file = dir.join("对话.md");
        save_text(&file, "# 故事\n\n第一版").await.unwrap();
        save_text(&file, "# 故事\n\n新版 · 中文 🌿").await.unwrap();
        assert_eq!(
            tokio::fs::read_to_string(&file).await.unwrap(),
            "# 故事\n\n新版 · 中文 🌿"
        );
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1);
        tokio::fs::remove_file(&file).await.unwrap();
        tokio::fs::remove_dir(&dir).await.unwrap();
    }
    #[tokio::test]
    async fn replaces_json_and_preserves_original_when_validation_fails() {
        let dir =
            std::env::temp_dir().join(format!("comfysilly-storage-test-{}", std::process::id()));
        tokio::fs::create_dir_all(&dir).await.unwrap();
        let file = dir.join("character.json");
        save_json(&file, r#"{"value":1}"#).await.unwrap();
        save_json(&file, r#"{"value":2}"#).await.unwrap();
        assert!(save_json(&file, "not json").await.is_err());
        assert_eq!(
            tokio::fs::read_to_string(&file).await.unwrap(),
            r#"{"value":2}"#
        );
        assert!(library_deletion_path(&dir, &file).is_ok());
        assert!(library_deletion_path(&dir, Path::new("Cargo.toml")).is_err());
        // Remove only the explicitly created fixture file, never a recursive directory.
        tokio::fs::remove_file(&file).await.unwrap();
        tokio::fs::remove_dir(&dir).await.unwrap();
    }
}
