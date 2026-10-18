//! Real provider requests. Credentials remain in the trusted host, never the card frames.
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    sync::{Arc, OnceLock},
    time::Duration,
};
use tokio::sync::{Mutex, Notify};

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Provider {
    pub id: String,
    pub base_url: String,
    #[serde(default)]
    pub api_key: String,
    pub model: String,
    pub response_format: String,
    #[serde(default)]
    pub thinking_level: String,
    #[serde(default = "temperature")]
    pub temperature: f64,
}
fn temperature() -> f64 {
    1.0
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Message {
    pub role: String,
    pub content: String,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatRequest {
    pub provider_id: String,
    pub request_id: String,
    pub messages: Vec<Message>,
    pub max_tokens: Option<u32>,
    pub temperature: Option<f64>,
    pub top_p: Option<f64>,
    #[serde(default)]
    pub purpose: Option<String>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationEvent {
    pub request_id: String,
    pub delta: String,
}
#[derive(Serialize)]
pub struct Completion {
    pub text: String,
    pub usage: Value,
}
static REQUESTS: OnceLock<Mutex<HashMap<String, Arc<Notify>>>> = OnceLock::new();
fn requests() -> &'static Mutex<HashMap<String, Arc<Notify>>> {
    REQUESTS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn endpoint(base: &str, path: &str) -> Result<String, String> {
    let base = base.trim().trim_end_matches('/');
    let url = reqwest::Url::parse(base).map_err(|_| "API URL 无效".to_string())?;
    if !["http", "https"].contains(&url.scheme())
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("API URL 必须为不含账号、查询参数或片段的 HTTP(S) 地址".into());
    }
    if base.ends_with(path) {
        Ok(base.to_owned())
    } else {
        Ok(format!("{base}/{path}"))
    }
}
fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(180))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())
}
fn protocol_request(p: &Provider, r: &ChatRequest) -> Result<(String, Value), String> {
    if p.model.trim().is_empty() {
        return Err("请选择或填写模型名称".into());
    }
    if r.messages.is_empty()
        || r.messages
            .iter()
            .any(|m| !["system", "user", "assistant"].contains(&m.role.as_str()))
    {
        return Err("消息列表为空或角色无效".into());
    }
    let max = r.max_tokens.unwrap_or(4096).clamp(1, 131072);
    let temp = r.temperature.unwrap_or(p.temperature);
    if !temp.is_finite() || !(0.0..=2.0).contains(&temp) {
        return Err("温度必须在 0–2 之间".into());
    }
    let thinking = match p.thinking_level.as_str() {
        "low" => 1024,
        "medium" => 4096,
        "high" => 8192,
        _ => 0,
    };
    match p.response_format.as_str() {
        "openai" => {
            let mut body =
                json!({"model":p.model,"messages":r.messages,"stream":true,"max_tokens":max});
            if thinking > 0 {
                body["reasoning_effort"] = json!(p.thinking_level);
            } else {
                body["temperature"] = json!(temp);
            }
            if let Some(v) = r.top_p {
                body["top_p"] = json!(v);
            }
            Ok((endpoint(&p.base_url, "chat/completions")?, body))
        }
        "claude" => {
            let system = r
                .messages
                .iter()
                .filter(|m| m.role == "system")
                .map(|m| m.content.clone())
                .collect::<Vec<_>>()
                .join("\n\n");
            let messages: Vec<_> = r.messages.iter().filter(|m| m.role != "system").collect();
            let mut body = json!({"model":p.model,"system":system,"messages":messages,"stream":true,"max_tokens":max.max(thinking+1024)});
            if thinking > 0 {
                body["thinking"] = json!({"type":"enabled","budget_tokens":thinking});
            } else {
                body["temperature"] = json!(temp.min(1.0));
            }
            Ok((endpoint(&p.base_url, "messages")?, body))
        }
        "gemini" => {
            let system = r
                .messages
                .iter()
                .filter(|m| m.role == "system")
                .map(|m| json!({"text":m.content}))
                .collect::<Vec<_>>();
            let contents=r.messages.iter().filter(|m|m.role!="system").map(|m|json!({"role":if m.role=="assistant" {"model"} else {"user"},"parts":[{"text":m.content}]})).collect::<Vec<_>>();
            let mut config = json!({"maxOutputTokens":max,"temperature":temp});
            if thinking > 0 {
                config["thinkingConfig"] = json!({"thinkingBudget":thinking});
            }
            let body = json!({"systemInstruction":{"parts":system},"contents":contents,"generationConfig":config});
            let model = p.model.strip_prefix("models/").unwrap_or(&p.model);
            if model
                .chars()
                .any(|c| !c.is_alphanumeric() && !"-_.".contains(c))
            {
                return Err("Gemini 模型标识无效".into());
            }
            Ok((
                format!(
                    "{}?alt=sse",
                    endpoint(
                        &p.base_url,
                        &format!("models/{model}:streamGenerateContent")
                    )?
                ),
                body,
            ))
        }
        _ => Err("不支持的 API 协议".into()),
    }
}
fn authorized(p: &Provider, b: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
    match p.response_format.as_str() {
        "claude" => b
            .header("x-api-key", &p.api_key)
            .header("anthropic-version", "2023-06-01"),
        "gemini" => b.header("x-goog-api-key", &p.api_key),
        _ => {
            if p.api_key.is_empty() {
                b
            } else {
                b.bearer_auth(&p.api_key)
            }
        }
    }
}
fn safe_error(message: String, key: &str) -> String {
    let text = if key.is_empty() {
        message
    } else {
        message.replace(key, "[REDACTED]")
    };
    text.chars().take(2000).collect()
}
fn extract_delta(value: &Value) -> String {
    if let Some(s) = value
        .pointer("/choices/0/delta/content")
        .and_then(Value::as_str)
    {
        return s.into();
    }
    if value["type"] == "content_block_delta" {
        return value
            .pointer("/delta/text")
            .and_then(Value::as_str)
            .unwrap_or("")
            .into();
    }
    value
        .pointer("/candidates/0/content/parts")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter(|v| v["thought"] != true)
                .filter_map(|v| v["text"].as_str())
                .collect()
        })
        .unwrap_or_default()
}
fn consume_data(
    data: &str,
    text: &mut String,
    usage: &mut Value,
    emit: &mut impl FnMut(String),
) -> Result<(), String> {
    if data.trim().is_empty() || data.trim() == "[DONE]" {
        return Ok(());
    }
    let value: Value =
        serde_json::from_str(data).map_err(|e| format!("服务返回了无效的 SSE JSON：{e}"))?;
    if value.get("error").is_some() {
        return Err(format!("提供商错误：{}", value["error"]));
    }
    let delta = extract_delta(&value);
    if !delta.is_empty() {
        text.push_str(&delta);
        emit(delta);
    }
    for candidate in [
        value.get("usage"),
        value.get("usageMetadata"),
        value.pointer("/message/usage"),
    ] {
        if let Some(v) = candidate {
            *usage = v.clone();
        }
    }
    Ok(())
}
async fn stream(
    p: &Provider,
    r: &ChatRequest,
    mut emit: impl FnMut(String),
) -> Result<Completion, String> {
    let (url, body) = protocol_request(p, r)?;
    let mut response = authorized(p, client()?.post(url))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("连接模型失败：{e}"))?;
    let status = response.status();
    if !status.is_success() {
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
            bytes.extend_from_slice(&chunk[..chunk.len().min(8192 - bytes.len())]);
            if bytes.len() >= 8192 {
                break;
            }
        }
        return Err(safe_error(
            format!("HTTP {status}：{}", String::from_utf8_lossy(&bytes)),
            &p.api_key,
        ));
    }
    if !response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .contains("text/event-stream")
    {
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
            if bytes.len() + chunk.len() > 16 * 1024 * 1024 {
                return Err("模型响应过大".into());
            }
            bytes.extend_from_slice(&chunk);
        }
        let value: Value = serde_json::from_slice(&bytes)
            .map_err(|_| "响应既不是 SSE，也不是有效 JSON".to_string())?;
        if let Some(error) = value.get("error") {
            return Err(safe_error(format!("提供商错误：{error}"), &p.api_key));
        }
        let text = value
            .pointer("/choices/0/message/content")
            .and_then(Value::as_str)
            .map(String::from)
            .or_else(|| {
                value["content"]
                    .as_array()
                    .map(|a| a.iter().filter_map(|v| v["text"].as_str()).collect())
            })
            .unwrap_or_else(|| extract_delta(&value));
        if text.is_empty() {
            return Err("模型返回了空内容，请检查协议、模型和输出长度设置".into());
        }
        emit(text.clone());
        return Ok(Completion {
            text,
            usage: value
                .get("usage")
                .or(value.get("usageMetadata"))
                .cloned()
                .unwrap_or(Value::Null),
        });
    }
    let mut buffer = Vec::new();
    let mut data_lines = Vec::new();
    let mut text = String::new();
    let mut usage = Value::Null;
    let mut received = 0usize;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("读取模型流失败：{e}"))?
    {
        received += chunk.len();
        if received > 16 * 1024 * 1024 {
            return Err("模型响应超过 16 MiB 限制".into());
        }
        buffer.extend_from_slice(&chunk);
        while let Some(end) = buffer.iter().position(|b| *b == b'\n') {
            let line: Vec<_> = buffer.drain(..=end).collect();
            let line = std::str::from_utf8(&line)
                .map_err(|_| "模型流不是 UTF-8".to_string())?
                .trim_end_matches(['\r', '\n']);
            if line.is_empty() {
                consume_data(&data_lines.join("\n"), &mut text, &mut usage, &mut emit)
                    .map_err(|e| safe_error(e, &p.api_key))?;
                data_lines.clear();
            } else if let Some(data) = line.strip_prefix("data:") {
                data_lines.push(data.trim_start().to_owned());
            }
        }
    }
    if !buffer.is_empty() {
        let tail = String::from_utf8(buffer).map_err(|_| "模型流尾部不是 UTF-8".to_string())?;
        if let Some(data) = tail.strip_prefix("data:") {
            data_lines.push(data.trim().to_owned());
        }
    }
    consume_data(&data_lines.join("\n"), &mut text, &mut usage, &mut emit)
        .map_err(|e| safe_error(e, &p.api_key))?;
    if text.is_empty() {
        return Err("模型未返回正文（可能只有思考内容或被安全过滤），请检查模型和输出长度".into());
    }
    Ok(Completion { text, usage })
}
#[tauri::command]
pub async fn generate_chat(
    request: ChatRequest,
    on_event: tauri::ipc::Channel<GenerationEvent>,
) -> Result<Completion, String> {
    let raw = crate::load_app_settings().await?;
    let settings: Value = serde_json::from_str(&raw).map_err(|_| "AI 配置损坏".to_string())?;
    let provider = provider_for_request(&settings, &request)?;
    let notify = Arc::new(Notify::new());
    {
        let mut map = requests().lock().await;
        if map.contains_key(&request.request_id) {
            return Err("请求 ID 重复".into());
        }
        map.insert(request.request_id.clone(), notify.clone());
    }
    let result = tokio::select! {result=stream(&provider,&request,|delta|{let _=on_event.send(GenerationEvent{request_id:request.request_id.clone(),delta});})=>result,_=notify.notified()=>Err("生成已取消".into())};
    requests().lock().await.remove(&request.request_id);
    result
}
fn provider_for_request(settings: &Value, request: &ChatRequest) -> Result<Provider, String> {
    let providers: Vec<Provider> = serde_json::from_value(settings["providers"].clone())
        .map_err(|_| "请先在设置中保存 AI 提供商".to_string())?;
    let mut provider = providers
        .into_iter()
        .find(|p| p.id == request.provider_id)
        .ok_or("所选提供商不存在，请重新保存设置")?;
    if let Some(purpose) = &request.purpose {
        if purpose != "memory" {
            return Err("未知模型请求用途".into());
        }
        if settings["memory"]["enabled"].as_bool() != Some(true) {
            return Err("请先在设置中启用自动记忆并保存".into());
        }
        let selected = settings["memory"]["providerId"].as_str()
            .filter(|s| !s.is_empty())
            .or_else(|| settings["activeProviderId"].as_str());
        if selected != Some(provider.id.as_str()) {
            return Err("记忆连接已变更，请重新整理".into());
        }
        // Summaries need bounded JSON, not thousands of reasoning tokens from
        // the foreground roleplay model's settings.
        provider.thinking_level = "off".into();
    }
    Ok(provider)
}
#[tauri::command]
pub async fn cancel_generation(request_id: String) -> Result<bool, String> {
    if let Some(n) = requests().lock().await.get(&request_id) {
        n.notify_one();
        Ok(true)
    } else {
        Ok(false)
    }
}
#[tauri::command]
pub async fn list_provider_models(provider: Provider) -> Result<Vec<String>, String> {
    let response = authorized(
        &provider,
        client()?.get(endpoint(&provider.base_url, "models")?),
    )
    .send()
    .await
    .map_err(|e| format!("拉取模型失败：{e}"))?;
    let status = response.status();
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    if bytes.len() > 4 * 1024 * 1024 {
        return Err("模型列表响应过大".into());
    }
    if !status.is_success() {
        return Err(safe_error(
            format!("HTTP {status}：{}", String::from_utf8_lossy(&bytes)),
            &provider.api_key,
        ));
    }
    let value: Value =
        serde_json::from_slice(&bytes).map_err(|_| "模型列表不是有效 JSON".to_string())?;
    let items = value
        .get("data")
        .or(value.get("models"))
        .and_then(Value::as_array)
        .ok_or("未找到 data/models 模型列表")?;
    let mut models: Vec<_> = items
        .iter()
        .filter_map(|v| {
            v.get("id")
                .or(v.get("name"))
                .and_then(Value::as_str)
                .map(|s| s.trim_start_matches("models/").to_owned())
        })
        .collect();
    models.sort();
    models.dedup();
    Ok(models)
}
#[cfg(test)]
mod tests {
    use super::*;
    fn provider(protocol: &str) -> Provider {
        Provider {
            id: "test".into(),
            base_url: "http://127.0.0.1:1/v1".into(),
            api_key: "secret".into(),
            model: "model".into(),
            response_format: protocol.into(),
            thinking_level: "off".into(),
            temperature: 0.0,
        }
    }
    fn request() -> ChatRequest {
        ChatRequest {
            provider_id: "test".into(),
            request_id: "r".into(),
            messages: vec![
                Message {
                    role: "system".into(),
                    content: "world".into(),
                },
                Message {
                    role: "user".into(),
                    content: "hello".into(),
                },
            ],
            max_tokens: Some(128),
            temperature: None,
            top_p: None,
            purpose: None,
        }
    }
    #[tokio::test]
    async fn configured_provider_live_smoke() {
        if std::env::var("COMFYSILLY_LIVE_TEST").ok().as_deref() != Some("1") {
            return;
        }
        let settings: Value =
            serde_json::from_str(&crate::load_app_settings().await.unwrap()).unwrap();
        let p: Provider = serde_json::from_value(
            settings["providers"]
                .as_array()
                .unwrap()
                .iter()
                .find(|p| p["id"] == settings["activeProviderId"])
                .unwrap()
                .clone(),
        )
        .unwrap();
        let mut r = request();
        r.messages = vec![Message {
            role: "user".into(),
            content: "Reply with OK only.".into(),
        }];
        r.max_tokens = Some(128);
        r.provider_id = p.id.clone();
        r.request_id = format!("live-smoke-{}", std::process::id());
        let count = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let received = count.clone();
        let channel = tauri::ipc::Channel::new(move |_| {
            received.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            Ok(())
        });
        let result = generate_chat(r, channel).await.expect(
            "Configured provider must return a real reply through the actual Tauri command",
        );
        assert!(!result.text.trim().is_empty());
        assert!(count.load(std::sync::atomic::Ordering::Relaxed) > 0);
        match list_provider_models(p.clone()).await {
            Ok(models) => println!("LIVE model-list verified: {} models", models.len()),
            Err(_) => println!(
                "LIVE provider does not expose a usable model list; manual model ID remains supported"
            ),
        };
        println!(
            "LIVE provider verified: protocol={}, model={}, response_chars={}",
            p.response_format,
            p.model,
            result.text.chars().count()
        );
    }
    #[test]
    fn protocol_bodies_and_urls() {
        for protocol in ["openai", "claude", "gemini"] {
            let (url, body) = protocol_request(&provider(protocol), &request()).unwrap();
            assert!(url.starts_with("http://127.0.0.1:1/v1/"));
            assert!(body.is_object());
        }
        assert!(endpoint("file:///tmp", "models").is_err());
        assert!(endpoint("https://key:secret@host", "models").is_err());
        assert_eq!(
            protocol_request(&provider("openai"), &request()).unwrap().1["temperature"],
            0.0
        );
    }
    #[test]
    fn delta_parsing() {
        let mut text = String::new();
        let mut usage = Value::Null;
        let mut deltas = Vec::new();
        for data in [
            r#"{"choices":[{"delta":{"content":"你"}}]}"#,
            r#"{"type":"content_block_delta","delta":{"text":"好"}}"#,
            r#"{"candidates":[{"content":{"parts":[{"text":"!"}]}}]}"#,
            "[DONE]",
        ] {
            consume_data(data, &mut text, &mut usage, &mut |s| deltas.push(s)).unwrap();
        }
        assert_eq!(text, "你好!");
        assert_eq!(deltas.len(), 3);
        assert_eq!(
            safe_error("secret failed".into(), "secret"),
            "[REDACTED] failed"
        );
    }
    #[test]
    fn memory_purpose_is_opt_in_and_does_not_change_foreground_settings() {
        let settings = json!({
            "activeProviderId":"test", "providers":[{
                "id":"test","baseUrl":"http://127.0.0.1:1/v1","model":"model",
                "responseFormat":"openai","thinkingLevel":"high","apiKey":"secret"
            }],
            "memory":{"enabled":true,"providerId":"test"}
        });
        let mut r = request();
        assert_eq!(provider_for_request(&settings, &r).unwrap().thinking_level, "high");
        r.purpose = Some("memory".into());
        assert_eq!(provider_for_request(&settings, &r).unwrap().thinking_level, "off");
        assert_eq!(settings["providers"][0]["thinkingLevel"], "high");
        let mut disabled = settings.clone();
        disabled["memory"]["enabled"] = json!(false);
        assert!(provider_for_request(&disabled, &r).is_err());
        disabled["memory"] = Value::Null;
        assert!(provider_for_request(&disabled, &r).is_err());
        let mut wrong = settings.clone();
        wrong["memory"]["providerId"] = json!("different");
        assert!(provider_for_request(&wrong, &r).is_err());
        wrong["memory"]["providerId"] = json!("");
        assert!(provider_for_request(&wrong, &r).is_ok());
        r.purpose = Some("arbitrary".into());
        assert!(provider_for_request(&settings, &r).is_err());
    }
    #[test]
    fn memory_request_uses_existing_three_protocols_without_changing_messages() {
        let summary = r#"{"summary":"用户与角色的故事","facts":[],"events":[],"openThreads":[]}"#;
        for protocol in ["openai", "claude", "gemini"] {
            let mut r = request();
            r.purpose = Some("memory".into());
            r.max_tokens = Some(4096);
            r.messages[1].content = summary.into();
            let (_, body) = protocol_request(&provider(protocol), &r).unwrap();
            assert!(body.to_string().contains("用户与角色的故事"));
            assert_eq!(r.messages[1].content, summary);
        }
    }
    #[tokio::test]
    async fn real_http_stream_fragmentation_and_auth() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = vec![0u8; 8192];
            let n = socket.read(&mut request).await.unwrap();
            let incoming = String::from_utf8_lossy(&request[..n]);
            assert!(
                incoming
                    .to_lowercase()
                    .contains("authorization: bearer secret")
            );
            let body = "data: {\"choices\":[{\"delta\":{\"content\":\"你好\"}}]}\r\n\r\ndata: [DONE]\r\n\r\n";
            let header = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            socket.write_all(header.as_bytes()).await.unwrap();
            for part in body.as_bytes().chunks(3) {
                socket.write_all(part).await.unwrap();
                tokio::task::yield_now().await;
            }
        });
        let mut p = provider("openai");
        p.base_url = format!("http://{addr}/v1");
        let mut deltas = Vec::new();
        let result = stream(&p, &request(), |d| deltas.push(d)).await.unwrap();
        assert_eq!(result.text, "你好");
        assert_eq!(deltas.concat(), "你好");
        server.await.unwrap();
    }
}
