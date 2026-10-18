# ComfySilly 0.2.0 — 实现范围与验收

更新：2026-10-18。当前是 Rust / Tauri 2 桌面应用，不需要用户启动浏览器或开发服务器。界面由内嵌 WebView2 渲染。

## 本轮已实现

### 真实请求与提示词
- Rust 提供 OpenAI Chat Completions、Anthropic Messages、Gemini GenerateContent 协议适配，支持 SSE 流式响应、取消、连接/请求超时、错误提示、模型列表。不是固定假回复。
- 实际通过已保存的 OpenAI-compatible 提供商，对 `gemini-3.8-flash` 发送最小测试消息，真实 `generate_chat` 命令及 Tauri Channel 收到正文；模型列表返回 34 项。没有发送用户的真实会话。
- 编译预设 prompt_order、启用条目、角色设定、历史、全局/角色世界书、基础宏和深度注入；提示词预览显示实际顺序。关闭条目不注入。上下文超预算报错，不静默丢历史。
- 画布检查循环/悬空连线；聊天执行采用预设的确定性顺序。**任意 DAG 节点执行器尚未完成**，画布连接不是自动运行任意插件的承诺。

### 消息内交互运行环境
- 原文 → 显示正则 → Markdown/HTML 分段；正确识别无语言围栏、多 HTML 块及 CRLF。静态模式不请求外部资源。
- 用户每次进入会话明确点击“信任此卡并启用交互前端”，才执行卡片代码及联网资源。未知卡片代码可能读取当前角色/会话数据并联网，不应随意信任。
- 消息 iframe 与后台脚本 iframe 分离。独立实现的 postMessage RPC 验证源窗口与随机 token；没有 allow-same-origin，没有 API key，没有 Tauri IPC，没有父窗口 DOM 访问。
- 内置 jQuery / Lodash / Vue / Zod / YAML / Pinia，修复 Zod 命名空间、production 宏、CDN Vue/Pinia 多实例等实际兼容问题。外部资源失败、未支持接口会显式显示。
- 实现变量作用域、事件订阅/清理/异步确认、当前角色消息增删改、角色世界书读写、正则读写、脚本按钮、基础 Slash `/send /trigger /setinput /pass /echo` 和模型生成代理。
- 同名事件发射串行，消息修改先更新 frame 快照，再提交宿主；避免作者表单一次修改多个字段时前面的值被后续旧快照覆盖。
- iframe 高度改变和变量改变不重建 iframe。聊天与脚本共享真实会话存储，不是硬编码 ERA 网页或伪造 ERA 事件。

### 持久化与编辑
- 角色详情进入上次选择的会话；新增/切换/删除会话保存 activeSessionId；新角色可在书架创建并编辑。PNG 导入保留额外角色字段及世界书元数据。
- 按角色排队保存，并以部分更新合并消息/世界书/角色设定，避免跨功能互相覆盖；聊天保存不再重新加载整套书架 JSON。初始会话立即持久化。
- 保存失败保留编辑状态并显示错误；世界书保存失败不自动关闭弹窗。
- API key 使用 Windows DPAPI 加密落盘，旧明文配置读取时迁移；解密只发生于可信宿主。密文绑定当前 Windows 用户，不是可直接移植的凭证备份。
- JSON 原子替换、非法 ID/路径校验、PNG 签名与分块校验、错误边界及无控制台窗口入口均保留。
- 新建画布提示词进入预设真实条目集，编辑同步源数据，排序/开关后不丢已改提示词。

## 已验证与未验证必须区分

- `npm test`：21 项通过（含只读真实 ERA 卡解析、正则、预设顺序、世界书触发、写入队列、图结构验证）。
- `cargo test --lib --release`：12 项通过；真实外网测试需要显式设置 `COMFYSILLY_LIVE_TEST=1`，普通测试不主动消耗额度。
- `npm run test:ui`：headless Edge，测试会话持久化、静态与可点击 HTML、独立后台事件、变量保存、不重载、隔离边界、UI 流式生命周期。
- `tests/era-compat.smoke.mjs`：使用真实导入卡副本，清空历史后在内存 harness 中执行真实作者后台及远程前端。真实姓名表单写入会话变量并验证不会被随后保存覆盖；“开始故事”按钮通过真实作者事件与 Slash 到达生成接口、会话保存收到的测试回复。不改写用户角色文件。它与真实提供商网络测试是两条分别验收的链路，不应把测试 IPC 的流当作外网回复。
- `npm run build` / `npx tauri build`：TypeScript、生产资源、Windows exe、NSIS 和 MSI。
- 测试截图与报告在 `web/.test-results`，不会打包测试 harness。

## 尚未完整兼容 / 后续改造

- **不是完整酒馆助手替代品，也不是任意卡片 100% 兼容。** EJS 提示词模板、脚本依赖的任意 SillyTavern DOM、QuickReply、TTS、生图、复杂的生成配置/自定义宏、全部 worldbook 语义尚未齐全。
- 全局与预设变量使用宿主 localStorage；卡片的原生 WebStorage 因 opaque origin 不可用，只提供 frame 生命周期内的内存 facade。它不等价于持久化的卡片 localStorage。
- 远程作者资源需保持可访问。当前采用整体信任卡片而非逐域细分授权。后台脚本挂载到自身 body 的独立浮动面板，不一定等同于酒馆 DOM 插件显示效果。
- 正则仍在 UI 线程执行；极端病态正则可能阻塞。大库头像/历史分离、历史虚拟列表、可终止正则 Worker、完整备份与冲突版本化仍待继续。
- 世界书概率/扫描深度/优先级、宏和示例消息处理是部分实现，发送前可用“查看实际提示词”核对。
- 已实际启动打包的 Windows 0.2.0 程序，通过原生窗口验证画布、本地角色库、角色详情和聊天页面显示，成功读取已保存的模型配置。PE subsystem 为 2 (Windows GUI)，不会创建控制台。桌面交互脚本授权后完整流程仍以 headless Edge 的独立验收为依据，不冒充全量原生 WebView2 交互已验证。
- `npm run lint` 无 error，但仍有 React hooks/编译器建议及历史辅助脚本的 unused 警告，尚未全部清理。

## 本地验证命令

```powershell
npm --prefix web test
npm --prefix web run build
npm --prefix web run test:ui
cargo test --manifest-path web/src-tauri/Cargo.toml --lib --release
# 真实卡脚本验收需要设置 COMFYSILLY_TEST_CARD；Playwright 可用 PLAYWRIGHT_MODULE_DIR 指定。
node web/tests/era-compat.smoke.mjs
# web 目录：
npx tauri build
```

参考：N0VI028/JS-Slash-Runner 的公开类型与接口。运行桥独立实现，没有复制其整套运行时；引入第三方代码前仍需检查许可证。
