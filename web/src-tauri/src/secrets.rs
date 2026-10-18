//! Windows user-bound protection for provider keys. Card data is never encrypted here.
use base64::Engine;
use serde_json::Value;
const PREFIX: &str = "dpapi-v1:";
#[cfg(windows)]
fn crypt(bytes: &[u8], decrypt: bool) -> Result<Vec<u8>, String> {
    use windows_sys::Win32::{
        Foundation::LocalFree,
        Security::Cryptography::{
            CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN, CryptProtectData, CryptUnprotectData,
        },
    };
    let input = CRYPT_INTEGER_BLOB {
        cbData: bytes.len().try_into().map_err(|_| "密钥数据过大")?,
        pbData: bytes.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };
    // DPAPI allocates the output with LocalAlloc; this function always releases it.
    let ok = unsafe {
        if decrypt {
            CryptUnprotectData(
                &input,
                std::ptr::null_mut(),
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        } else {
            CryptProtectData(
                &input,
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        }
    };
    if ok == 0 {
        return Err(format!(
            "Windows 密钥保护失败：{}",
            std::io::Error::last_os_error()
        ));
    }
    let result = if output.cbData == 0 {
        Vec::new()
    } else {
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() }
    };
    unsafe {
        LocalFree(output.pbData as _);
    }
    Ok(result)
}
#[cfg(not(windows))]
fn crypt(_: &[u8], _: bool) -> Result<Vec<u8>, String> {
    Err("当前构建未提供系统密钥存储".into())
}
pub fn protect_config(raw: &str) -> Result<(String, bool), String> {
    let mut value: Value = serde_json::from_str(raw).map_err(|_| "AI 设置 JSON 无效")?;
    let mut changed = false;
    if let Some(providers) = value["providers"].as_array_mut() {
        for provider in providers {
            if let Some(key) = provider["apiKey"].as_str() {
                if !key.is_empty() && !key.starts_with(PREFIX) {
                    let bytes = crypt(key.as_bytes(), false)?;
                    provider["apiKey"] = Value::String(format!(
                        "{PREFIX}{}",
                        base64::prelude::BASE64_STANDARD.encode(bytes)
                    ));
                    changed = true;
                }
            }
        }
    }
    Ok((value.to_string(), changed))
}
pub fn unprotect_config(raw: &str) -> Result<String, String> {
    let mut value: Value = serde_json::from_str(raw).map_err(|_| "AI 设置 JSON 无效")?;
    if let Some(providers) = value["providers"].as_array_mut() {
        for provider in providers {
            if let Some(key) = provider["apiKey"].as_str() {
                if let Some(encoded) = key.strip_prefix(PREFIX) {
                    let bytes = base64::prelude::BASE64_STANDARD
                        .decode(encoded)
                        .map_err(|_| "保存的密钥数据损坏")?;
                    let decoded = crypt(&bytes, true)?;
                    provider["apiKey"] = Value::String(
                        String::from_utf8(decoded).map_err(|_| "解密后的密钥编码无效")?,
                    );
                }
            }
        }
    }
    Ok(value.to_string())
}
#[cfg(all(test, windows))]
mod tests {
    use super::*;
    #[test]
    fn keys_round_trip_without_plaintext_on_disk() {
        let raw = r#"{"activeProviderId":"test","providers":[{"id":"test","apiKey":"test-secret-key","model":"model"}]}"#;
        let (protected, changed) = protect_config(raw).unwrap();
        assert!(changed);
        assert!(!protected.contains("test-secret-key"));
        assert_eq!(
            serde_json::from_str::<Value>(&unprotect_config(&protected).unwrap()).unwrap(),
            serde_json::from_str::<Value>(raw).unwrap()
        );
        assert!(!protect_config(&protected).unwrap().1);
        assert!(unprotect_config(r#"{"providers":[{"apiKey":"dpapi-v1:broken"}]}"#).is_err());
    }
}
