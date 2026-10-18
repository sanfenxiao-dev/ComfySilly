import { invoke } from '@tauri-apps/api/core';
import { useEffect, useRef, useState } from 'react';
import {
  Server,
  Palette,
  MessagesSquare,
  UserRound,
  Info,
  Plus,
  Trash2,
  Download,
  Upload,
  Check,
  Save,
} from 'lucide-react';
import { Dialog } from './Dialog';
import { Avatar } from './Avatar';
import {
  normalizeSettings,
  preferencesOf,
  personaOf,
  personasOf,
  providerTemplates,
  readAvatar,
} from '../types/settings';
import type { AppSettings, ProviderConfig, Preferences } from '../types/settings';
export type { AppSettings, ProviderConfig } from '../types/settings';
export type SettingsSection = 'models' | 'appearance' | 'conversation' | 'personas' | 'about';
interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSave: (settings: AppSettings) => void | Promise<void>;
  initialSettings?: AppSettings;
  initialSection?: SettingsSection;
  onPreviewPreferences?: (preferences: Preferences | null) => void;
}
const sections = [
  { id: 'models', label: '模型与连接', icon: Server },
  { id: 'appearance', label: '外观与动效', icon: Palette },
  { id: 'conversation', label: '对话偏好', icon: MessagesSquare },
  { id: 'personas', label: '用户身份', icon: UserRound },
  { id: 'about', label: '数据与关于', icon: Info },
] as const;
export function SettingsModal({
  isOpen,
  onClose,
  onSave,
  initialSettings,
  initialSection = 'models',
  onPreviewPreferences,
}: Props) {
  const [draft, setDraft] = useState(() => normalizeSettings(initialSettings));
  const [section, setSection] = useState<SettingsSection>(initialSection);
  const [selected, setSelected] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [fetching, setFetching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(0);
  useEffect(() => {
    if (isOpen) {
      const s = normalizeSettings(initialSettings);
      setDraft(structuredClone(s));
      setSelected(s.activeProviderId);
      setSection(initialSection);
      setError('');
      setModels([]);
      request.current++;
    } else {
      onPreviewPreferences?.(null);
      request.current++;
    }
  }, [isOpen, initialSettings, initialSection]);
  const prefs = preferencesOf(draft),
    persona = personaOf(draft),
    providers = draft.providers,
    provider = providers.find((p) => p.id === selected) ?? providers[0];
  const patchProvider = (patch: Partial<ProviderConfig>) =>
    setDraft((s) => ({
      ...s,
      providers: s.providers.map((p) => (p.id === provider.id ? { ...p, ...patch } : p)),
    }));
  const patchPrefs = (patch: Partial<Preferences>) => {
    const next = { ...prefs, ...patch };
    setDraft((s) => ({ ...s, preferences: next }));
    onPreviewPreferences?.(next);
  };
  const patchPersona = (patch: Partial<typeof persona>) =>
    setDraft((s) => ({
      ...s,
      personas: personasOf(s).map((p) => (p.id === persona.id ? { ...p, ...patch } : p)),
    }));
  const close = () => {
    onPreviewPreferences?.(null);
    onClose();
  };
  const fetchModels = async () => {
    const id = ++request.current;
    setFetching(true);
    setError('');
    try {
      const list = await invoke<string[]>('list_provider_models', { provider });
      if (request.current === id) {
        setModels(list);
        if (!list.length) setError('模型列表为空，也可以手动输入模型 ID。');
      }
    } catch (e) {
      if (request.current === id) setError(String(e));
    } finally {
      setFetching(false);
    }
  };
  return (
    <Dialog
      open={isOpen}
      onClose={close}
      title="设置"
      description="让工作室适合你的写作方式。修改后保存才会持久生效。"
      className="settings-dialog"
      busy={saving}
    >
      <div className="settings-layout">
        <nav className="settings-navigation" aria-label="设置分类">
          {sections.map((s) => (
            <button
              key={s.id}
              className={section === s.id ? 'is-active' : ''}
              aria-current={section === s.id ? 'page' : undefined}
              onClick={() => {
                setSection(s.id);
                setError('');
              }}
            >
              <s.icon size={17} />
              {s.label}
            </button>
          ))}
        </nav>
        <div className="settings-content" key={section}>
          {section === 'models' && (
            <>
              <div className="settings-section">
                <h3>AI 提供商</h3>
                <p>选择当前连接；密钥仅保存在本机，不会传给角色卡脚本。</p>
                <div className="provider-list">
                  {providers.map((p) => (
                    <button
                      key={p.id}
                      className={`provider-pill ${p.id === provider.id ? 'is-active' : ''}`}
                      onClick={() => {
                        setSelected(p.id);
                        setModels([]);
                        request.current++;
                      }}
                    >
                      {p.name}
                      {p.id === draft.activeProviderId && <Check size={13} />}
                    </button>
                  ))}
                </div>
                <div className="field">
                  <label htmlFor="provider-template">添加连接</label>
                  <select
                    id="provider-template"
                    className="text-input"
                    value=""
                    onChange={(e) => {
                      const template = providerTemplates.find((p) => p.id === e.target.value);
                      if (template) {
                        const p = { ...template, id: crypto.randomUUID() };
                        setDraft((s) => ({ ...s, providers: [...s.providers, p] }));
                        setSelected(p.id);
                        setModels([]);
                      }
                    }}
                  >
                    <option value="">选择提供商模板…</option>
                    {providerTemplates.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="settings-section">
                <div className="provider-head">
                  <h3>连接详情</h3>
                  <button
                    className="button button-quiet"
                    disabled={provider.id === draft.activeProviderId}
                    onClick={() => setDraft((s) => ({ ...s, activeProviderId: provider.id }))}
                  >
                    {provider.id === draft.activeProviderId ? '当前使用' : '设为当前连接'}
                  </button>
                </div>
                <div className="field-grid">
                  <label className="field">
                    名称
                    <input
                      className="text-input"
                      value={provider.name}
                      onChange={(e) => patchProvider({ name: e.target.value })}
                    />
                  </label>
                  <label className="field">
                    API 格式
                    <select
                      className="text-input"
                      value={provider.responseFormat}
                      onChange={(e) =>
                        patchProvider({
                          responseFormat: e.target.value as ProviderConfig['responseFormat'],
                        })
                      }
                    >
                      <option value="openai">OpenAI 兼容</option>
                      <option value="claude">Anthropic Messages</option>
                      <option value="gemini">Google Gemini</option>
                    </select>
                  </label>
                </div>
                <label className="field">
                  API 地址
                  <input
                    className="text-input"
                    placeholder="https://api.example.com/v1"
                    value={provider.baseUrl}
                    onChange={(e) => patchProvider({ baseUrl: e.target.value })}
                  />
                </label>
                <label className="field">
                  API Key
                  <input
                    className="text-input"
                    type="password"
                    autoComplete="off"
                    value={provider.apiKey}
                    onChange={(e) => patchProvider({ apiKey: e.target.value })}
                  />
                </label>
                <div className="model-fetch">
                  <label className="field">
                    模型 ID
                    <input
                      list="available-models"
                      className="text-input"
                      value={provider.model}
                      onChange={(e) => patchProvider({ model: e.target.value })}
                      placeholder="手动输入，或拉取模型列表"
                    />
                    <datalist id="available-models">
                      {models.map((m) => (
                        <option key={m} value={m} />
                      ))}
                    </datalist>
                  </label>
                  <button className="button" disabled={fetching} onClick={() => void fetchModels()}>
                    <Download size={14} />
                    {fetching ? '拉取中…' : '拉取模型'}
                  </button>
                </div>
                <div className="field-grid">
                  <label className="field">
                    思考等级
                    <select
                      className="text-input"
                      value={provider.thinkingLevel}
                      onChange={(e) =>
                        patchProvider({
                          thinkingLevel: e.target.value as ProviderConfig['thinkingLevel'],
                        })
                      }
                    >
                      <option value="off">默认 / 关闭</option>
                      <option value="low">低</option>
                      <option value="medium">中</option>
                      <option value="high">高</option>
                    </select>
                  </label>
                  <label className="field">
                    默认温度 · {provider.temperature}
                    <input
                      type="range"
                      min="0"
                      max="2"
                      step="0.05"
                      value={provider.temperature}
                      onChange={(e) => patchProvider({ temperature: Number(e.target.value) })}
                    />
                    <span className="field-hint">有预设温度时以预设为准。</span>
                  </label>
                </div>
                <button
                  className="button button-danger"
                  disabled={providers.length < 2}
                  onClick={() => {
                    const next = providers.filter((p) => p.id !== provider.id);
                    setDraft((s) => ({
                      ...s,
                      providers: next,
                      activeProviderId:
                        s.activeProviderId === provider.id ? next[0].id : s.activeProviderId,
                    }));
                    setSelected(next[0].id);
                  }}
                >
                  <Trash2 size={14} />
                  移除此连接
                </button>
              </div>
            </>
          )}
          {section === 'appearance' && (
            <>
              <div className="settings-section">
                <h3>安静一点，更专注一点</h3>
                <p>克制的色彩与柔和的动效。外观可实时预览，取消将还原。</p>
                <div className="settings-row">
                  <div>
                    <strong>主题</strong>
                    <p>石墨夜色，或浅色纸笺。</p>
                  </div>
                  <div className="segmented">
                    {(['dark', 'light'] as const).map((t) => (
                      <button
                        key={t}
                        aria-pressed={prefs.theme === t}
                        onClick={() => patchPrefs({ theme: t })}
                      >
                        {t === 'dark' ? '石墨' : '纸笺'}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="settings-row">
                  <div>
                    <strong>动画强度</strong>
                    <p>自动尊重系统的减少动态效果偏好。</p>
                  </div>
                  <select
                    className="text-input"
                    value={prefs.motion}
                    onChange={(e) =>
                      patchPrefs({ motion: e.target.value as Preferences['motion'] })
                    }
                  >
                    <option value="full">优雅过渡</option>
                    <option value="reduced">轻量过渡</option>
                    <option value="off">关闭动画</option>
                  </select>
                </div>
                <label className="field">
                  正文字号 · {prefs.fontSize}px
                  <input
                    type="range"
                    min="13"
                    max="22"
                    value={prefs.fontSize}
                    onChange={(e) => patchPrefs({ fontSize: Number(e.target.value) })}
                  />
                </label>
                <label className="field">
                  阅读宽度 · {prefs.messageWidth}px
                  <input
                    type="range"
                    min="620"
                    max="1200"
                    step="20"
                    value={prefs.messageWidth}
                    onChange={(e) => patchPrefs({ messageWidth: Number(e.target.value) })}
                  />
                </label>
              </div>
            </>
          )}
          {section === 'conversation' && (
            <>
              <div className="settings-section">
                <h3>对话排版</h3>
                <p>默认双方居中，像一起写下一本故事。</p>
                <div className="segmented">
                  {(['centered', 'bubbles', 'compact'] as const).map((t, i) => (
                    <button
                      key={t}
                      aria-pressed={prefs.chatLayout === t}
                      onClick={() => patchPrefs({ chatLayout: t })}
                    >
                      {['居中阅读', '左右气泡', '紧凑记录'][i]}
                    </button>
                  ))}
                </div>
                <div className={`settings-preview preview-${prefs.chatLayout}`}>
                  <div className="preview-message">
                    <small>{persona.name}</small>
                    <p>沿着小路，再走一会儿吧。</p>
                  </div>
                  <div className="preview-message preview-user">
                    <small>故事中的人</small>
                    <p>风穿过树梢。远处的灯火，像一个尚未说完的回答。</p>
                  </div>
                </div>
                <div className="settings-row">
                  <div>
                    <strong>显示消息时间</strong>
                  </div>
                  <button
                    className="switch"
                    role="switch"
                    aria-checked={prefs.showTimestamps}
                    aria-label="显示消息时间"
                    onClick={() => patchPrefs({ showTimestamps: !prefs.showTimestamps })}
                  />
                </div>
                <div className="settings-row">
                  <div>
                    <strong>跟随新消息</strong>
                    <p>手动向上阅读时不会强制拉回底部。</p>
                  </div>
                  <button
                    className="switch"
                    role="switch"
                    aria-checked={prefs.autoScroll}
                    aria-label="跟随新消息"
                    onClick={() => patchPrefs({ autoScroll: !prefs.autoScroll })}
                  />
                </div>
                <label className="field">
                  发送快捷键
                  <select
                    className="text-input"
                    value={prefs.sendKey}
                    onChange={(e) =>
                      patchPrefs({ sendKey: e.target.value as Preferences['sendKey'] })
                    }
                  >
                    <option value="enter">Enter 发送 · Shift + Enter 换行</option>
                    <option value="ctrl-enter">Ctrl / ⌘ + Enter 发送</option>
                  </select>
                </label>
              </div>
              <div className="inline-note">
                历史修改与历史重生成会创建独立分支，原对话保持不变。最后一条 AI
                回复可直接切换多个生成版本。
              </div>
            </>
          )}
          {section === 'personas' && (
            <>
              <div className="settings-section">
                <h3>用户身份</h3>
                <p>名字替换 {'{{user}}'}，设定会作为用户身份进入实际提示词。已有消息保留原署名。</p>
                <div className="provider-list">
                  {personasOf(draft).map((p) => (
                    <button
                      key={p.id}
                      className={`provider-pill ${p.id === persona.id ? 'is-active' : ''}`}
                      onClick={() => setDraft((s) => ({ ...s, activePersonaId: p.id }))}
                    >
                      {p.name}
                    </button>
                  ))}
                  <button
                    className="button button-quiet"
                    onClick={() => {
                      const p = { id: crypto.randomUUID(), name: '新身份', description: '' };
                      setDraft((s) => ({
                        ...s,
                        personas: [...personasOf(s), p],
                        activePersonaId: p.id,
                      }));
                    }}
                  >
                    <Plus size={14} />
                    新身份
                  </button>
                </div>
                <div className="persona-editor">
                  <Avatar src={persona.avatar} name={persona.name} size="large" />
                  <div className="persona-actions">
                    <label className="button">
                      <Upload size={14} />
                      上传头像
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif"
                        hidden
                        onChange={async (e) => {
                          const f = e.target.files?.[0];
                          if (f)
                            try {
                              patchPersona({ avatar: await readAvatar(f) });
                            } catch (err) {
                              setError(String(err));
                            }
                          e.target.value = '';
                        }}
                      />
                    </label>
                    <button
                      className="button button-quiet"
                      onClick={() => patchPersona({ avatar: undefined })}
                    >
                      重置头像
                    </button>
                  </div>
                </div>
                <label className="field">
                  名字
                  <input
                    className="text-input"
                    maxLength={100}
                    value={persona.name}
                    onChange={(e) => patchPersona({ name: e.target.value })}
                  />
                </label>
                <label className="field">
                  用户设定
                  <textarea
                    className="text-input"
                    rows={7}
                    value={persona.description}
                    onChange={(e) => patchPersona({ description: e.target.value })}
                    placeholder="你的外貌、性格、背景，以及与角色的关系…"
                  />
                </label>
                <button
                  className="button button-danger"
                  disabled={personasOf(draft).length < 2}
                  onClick={() => {
                    const ps = personasOf(draft).filter((p) => p.id !== persona.id);
                    setDraft((s) => ({ ...s, personas: ps, activePersonaId: ps[0].id }));
                  }}
                >
                  <Trash2 size={14} />
                  删除此身份
                </button>
              </div>
            </>
          )}
          {section === 'about' && (
            <>
              <div className="settings-section">
                <span className="eyebrow">COMFYSILLY / STUDIO</span>
                <h3>一个安静的故事工作室</h3>
                <p>0.3.3 · Windows 桌面版 · Rust / Tauri</p>
                <div className="settings-rule" />
                <h3>你的数据留在本机</h3>
                <p>
                  预设、角色、世界书、身份与历史记录保存在 Windows 应用数据目录的 ComfySilly
                  文件夹内。密钥使用 Windows DPAPI 加密；聊天会发送到你所选的 AI 提供商。
                </p>
                <h3>独立分支与导出</h3>
                <p>
                  对话工具栏可导出当前分支的 Markdown 或 JSON（不含 API
                  Key）。导出属于当前对话，不替代全库备份。
                </p>
                <h3>兼容性边界</h3>
                <p>
                  支持酒馆常用数据、显示正则与部分酒馆助手
                  API。第三方脚本仅在主动信任后执行；任意插件、EJS
                  模板与任意工作流图不承诺完整兼容。请仅信任可靠来源的角色卡。
                </p>
              </div>
            </>
          )}
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
        </div>
      </div>
      <footer className="dialog-footer">
        <span className="field-hint">{saving ? '正在保存到本机…' : '设置仅保存到本机'}</span>
        <button className="button" onClick={close} disabled={saving}>
          取消
        </button>
        <button
          className="button button-primary"
          disabled={saving}
          onClick={async () => {
            setError('');
            if (personasOf(draft).some((p) => !p.name.trim())) {
              setError('身份名字不能为空');
              return;
            }
            setSaving(true);
            try {
              await onSave(normalizeSettings(draft));
              close();
            } catch (e) {
              setError(`保存失败：${String(e)}`);
            } finally {
              setSaving(false);
            }
          }}
        >
          <Save size={15} />
          {saving ? '保存中…' : '保存设置'}
        </button>
      </footer>
    </Dialog>
  );
}
