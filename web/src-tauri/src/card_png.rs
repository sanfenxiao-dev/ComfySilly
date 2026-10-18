//! Card metadata parsing is independent of the UI and never executes card code.
use base64::Engine;

pub fn extract_card_json(bytes: &[u8]) -> Result<String, String> {
    if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err("文件不是有效的 PNG 图片".into());
    }
    let mut pos = 8usize;
    let mut candidate = None;
    let mut has_v3 = false;
    while pos < bytes.len() {
        let header_end = pos.checked_add(8).ok_or("PNG 长度溢出")?;
        if header_end > bytes.len() {
            return Err("PNG 分块头已截断".into());
        }
        let length = u32::from_be_bytes(bytes[pos..pos + 4].try_into().unwrap()) as usize;
        let end = header_end
            .checked_add(length)
            .and_then(|v| v.checked_add(4))
            .ok_or("PNG 分块长度溢出")?;
        if end > bytes.len() {
            return Err("PNG 分块数据已截断，无法导入".into());
        }
        let kind = &bytes[pos + 4..header_end];
        if kind == b"tEXt" || kind == b"iTXt" {
            let data = &bytes[header_end..end - 4];
            if let Some(nul) = data.iter().position(|b| *b == 0) {
                let keyword = &data[..nul];
                if keyword == b"chara" || keyword == b"ccv3" {
                    let mut text = &data[nul + 1..];
                    if kind == b"iTXt" {
                        if text.len() < 2 {
                            return Err("PNG iTXt 压缩字段缺失".into());
                        }
                        if text[0] != 0 || text[1] != 0 {
                            return Err("暂不支持压缩的角色卡 iTXt 元数据".into());
                        }
                        text = &text[2..];
                        // Language tag, then translated keyword, both NUL-terminated.
                        for _ in 0..2 {
                            let end = text
                                .iter()
                                .position(|b| *b == 0)
                                .ok_or("PNG iTXt 字段已截断")?;
                            text = &text[end + 1..];
                        }
                    }
                    let text = std::str::from_utf8(text)
                        .map_err(|e| format!("角色卡元数据不是 UTF-8：{e}"))?
                        .trim();
                    let json = if text.starts_with('{') {
                        text.to_owned()
                    } else {
                        let decoded = base64::prelude::BASE64_STANDARD
                            .decode(text)
                            .map_err(|e| format!("角色卡 Base64 无效：{e}"))?;
                        String::from_utf8(decoded)
                            .map_err(|e| format!("角色卡 JSON 不是 UTF-8：{e}"))?
                    };
                    let value: serde_json::Value = serde_json::from_str(&json)
                        .map_err(|e| format!("角色卡 JSON 无效：{e}"))?;
                    if !value.is_object() {
                        return Err("角色卡 JSON 必须是对象".into());
                    }
                    if keyword == b"ccv3" || !has_v3 {
                        candidate = Some(json);
                        has_v3 = keyword == b"ccv3";
                    }
                }
            }
        }
        pos = end;
        if kind == b"IEND" {
            break;
        }
    }
    candidate.ok_or_else(|| "PNG 中未找到 chara / ccv3 角色卡元数据".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn png(chunks: &[(&[u8], &[u8])]) -> Vec<u8> {
        let mut bytes = b"\x89PNG\r\n\x1a\n".to_vec();
        for (kind, data) in chunks {
            bytes.extend_from_slice(&(data.len() as u32).to_be_bytes());
            bytes.extend_from_slice(kind);
            bytes.extend_from_slice(data);
            bytes.extend_from_slice(&[0; 4]);
        }
        bytes
    }
    #[test]
    fn rejects_bad_signature_and_truncated_chunks_without_panicking() {
        assert!(extract_card_json(b"not png").is_err());
        let mut bytes = b"\x89PNG\r\n\x1a\n".to_vec();
        bytes.extend_from_slice(&u32::MAX.to_be_bytes());
        bytes.extend_from_slice(b"tEXt");
        assert!(extract_card_json(&bytes).is_err());
        assert!(extract_card_json(&b"\x89PNG\r\n\x1a\n\0\0"[..]).is_err());
    }
    #[test]
    fn reads_base64_text_and_prefers_v3() {
        let v2 = format!(
            "chara\0{}",
            base64::prelude::BASE64_STANDARD.encode(r#"{"name":"v2"}"#)
        );
        let v3 = "ccv3\0{\"name\":\"v3\"}";
        let data = png(&[
            (b"tEXt", v2.as_bytes()),
            (b"tEXt", v3.as_bytes()),
            (b"tEXt", v2.as_bytes()),
        ]);
        assert_eq!(extract_card_json(&data).unwrap(), r#"{"name":"v3"}"#);
    }
    #[test]
    fn reads_uncompressed_international_text() {
        let data = png(&[(b"iTXt", b"chara\0\0\0zh\0name\0{\"name\":\"ok\"}")]);
        assert_eq!(extract_card_json(&data).unwrap(), r#"{"name":"ok"}"#);
    }
    #[test]
    fn imported_avatar_metadata_regression() {
        let Ok(path) = std::env::var("COMFYSILLY_TEST_CARD") else {
            return;
        };
        let text = std::fs::read_to_string(path).unwrap();
        let card: serde_json::Value = serde_json::from_str(&text).unwrap();
        let avatar = card["avatar_b64"].as_str().unwrap();
        let encoded = avatar
            .strip_prefix("data:image/png;base64,")
            .expect("Regression fixture must have a PNG avatar");
        let bytes = base64::prelude::BASE64_STANDARD.decode(encoded).unwrap();
        let json = extract_card_json(&bytes).expect("Real imported PNG metadata must be readable");
        let metadata: serde_json::Value = serde_json::from_str(&json).unwrap();
        let data = metadata.get("data").unwrap_or(&metadata);
        assert!(data["first_mes"].is_string());
    }
    #[test]
    fn rejects_invalid_json_and_malformed_itxt() {
        assert!(extract_card_json(&png(&[(b"tEXt", b"chara\0{broken}")])).is_err());
        assert!(extract_card_json(&png(&[(b"iTXt", b"chara\0\0")])).is_err());
        assert!(extract_card_json(&png(&[(b"iTXt", b"chara\0\x01\0\0\0")])).is_err());
    }
}
