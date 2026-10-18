import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  BookOpen,
  Save,
  ArrowUpRight,
  Plus,
  History,
  Upload,
  GitBranch,
} from 'lucide-react';
import type { CharacterCardData } from './CharacterShelf';
import { ConfirmDialog } from './Dialog';
import { readAvatar } from '../types/settings';
interface Props {
  character: CharacterCardData;
  onBack: () => void;
  onStartChat: (sessionId?: string, updated?: CharacterCardData) => void;
  onNewChat?: (updated?: CharacterCardData) => void;
  onUpdateCharacter: (updated: CharacterCardData) => void | Promise<void>;
  onOpenLorebookModal: () => void;
}
export function CharacterDetail({
  character,
  onBack,
  onStartChat,
  onNewChat,
  onUpdateCharacter,
  onOpenLorebookModal,
}: Props) {
  const initial = useMemo(
    () => ({
      name: character.name,
      creator: character.creator || '',
      character_version: character.character_version || '',
      description: character.description || '',
      personality: character.personality || '',
      scenario: character.scenario || '',
      first_mes: character.first_mes || '',
      mes_example: character.mes_example || '',
      avatar_b64: character.avatar_b64,
    }),
    [character.id],
  );
  const [draft, setDraft] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [leave, setLeave] = useState(false);
  const [tab, setTab] = useState<'setting' | 'history'>('setting');
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const sessions = character.sessions || [];
  const last = sessions.find((s) => s.id === character.activeSessionId) ?? sessions[0];
  const save = async () => {
    if (!draft.name.trim()) {
      setStatus('角色名字不能为空');
      return false;
    }
    setBusy(true);
    try {
      await onUpdateCharacter({ ...character, ...draft });
      setSaved(draft);
      setStatus('角色设定已保存');
      return true;
    } catch (e) {
      setStatus(`保存失败：${String(e)}`);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const field = (
    key: 'description' | 'personality' | 'scenario' | 'first_mes' | 'mes_example',
    label: string,
    placeholder: string,
    rows = 4,
  ) => (
    <label className="field" key={key}>
      <span>
        {label}
        <small>{draft[key].length} 字符</small>
      </span>
      <textarea
        className="text-input"
        rows={rows}
        value={draft[key]}
        placeholder={placeholder}
        onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
      />
    </label>
  );
  return (
    <section className="page character-detail route-enter">
      <div className="page-inner">
        <header className="detail-toolbar">
          <button
            className="button button-quiet"
            disabled={busy}
            onClick={() => (dirty ? setLeave(true) : onBack())}
          >
            <ArrowLeft size={16} />
            返回角色书架
          </button>
          <span className="detail-save-status" role="status">
            {status || (dirty ? '有未保存的修改' : '所有修改已保存')}
          </span>
          <button className="button" disabled={busy || !dirty} onClick={() => void save()}>
            <Save size={15} />
            {busy ? '保存中…' : '保存角色设定'}
          </button>
        </header>
        <div className="detail-grid">
          <aside className="detail-aside">
            <div className="detail-poster">
              {draft.avatar_b64 ? (
                <img src={draft.avatar_b64} alt={draft.name} />
              ) : (
                <BookOpen size={60} />
              )}
              <label className="button">
                <Upload size={14} />
                更换头像
                <input
                  hidden
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (f)
                      try {
                        const avatar = await readAvatar(f);
                        setDraft((s) => ({ ...s, avatar_b64: avatar }));
                      } catch (err) {
                        setStatus(String(err));
                      }
                  }}
                />
              </label>
            </div>
            <div className="detail-aside-title">
              <span className="eyebrow">CHARACTER PORTRAIT</span>
              <h1>{draft.name}</h1>
              <p>
                {draft.creator ? `by ${draft.creator}` : '一位等待故事开始的角色'}
                {draft.character_version ? ` · ${draft.character_version}` : ''}
              </p>
            </div>
            <button
              className="button button-primary detail-start"
              disabled={busy}
              onClick={async () => {
                if (dirty && !(await save())) return;
                onStartChat(last?.id, { ...character, ...draft });
              }}
            >
              {last ? '继续上次对话' : '开始对话'}
              <ArrowUpRight size={16} />
            </button>
            <button
              className="button detail-start"
              disabled={busy}
              onClick={async () => {
                if (dirty && !(await save())) return;
                onNewChat?.({ ...character, ...draft });
              }}
            >
              <Plus size={15} />
              新建对话
            </button>
            <button className="detail-lore" onClick={onOpenLorebookModal}>
              <BookOpen size={20} />
              <span>
                <strong>角色世界书</strong>
                <small>
                  {Object.keys(character.lorebook?.entries ?? {}).length} 条专属设定 · 点击编辑
                </small>
              </span>
              <ArrowUpRight size={15} />
            </button>
            <p className="detail-footnote">
              角色内的 HTML 与脚本会在聊天内显示。交互脚本需在对话中主动信任后才能运行。
            </p>
          </aside>
          <div className="detail-body">
            <div className="detail-tabs">
              <button
                className={tab === 'setting' ? 'is-active' : ''}
                onClick={() => setTab('setting')}
              >
                角色设定
              </button>
              <button
                className={tab === 'history' ? 'is-active' : ''}
                onClick={() => setTab('history')}
              >
                <History size={14} />
                历史与分支 <span>{sessions.length}</span>
              </button>
            </div>
            {tab === 'setting' ? (
              <div className="detail-fields route-enter">
                <div className="field-grid">
                  <label className="field">
                    <span>角色名字</span>
                    <input
                      className="text-input"
                      value={draft.name}
                      onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    />
                  </label>
                  <label className="field">
                    <span>创作者</span>
                    <input
                      className="text-input"
                      value={draft.creator}
                      onChange={(e) => setDraft({ ...draft, creator: e.target.value })}
                    />
                  </label>
                </div>
                <label className="field">
                  <span>版本</span>
                  <input
                    className="text-input"
                    value={draft.character_version}
                    onChange={(e) => setDraft({ ...draft, character_version: e.target.value })}
                  />
                </label>
                {field('description', '角色描述', '外貌、背景、核心设定…', 6)}
                {field('personality', '性格与表达', '性格、口吻、习惯…', 3)}
                {field('scenario', '场景', '故事开始的地方…', 3)}
                {field(
                  'first_mes',
                  '第一句开场白',
                  '新对话的第一条消息；支持 Markdown、HTML 与卡片交互内容。',
                  6,
                )}
                {field('mes_example', '对话示例', '以角色的对话示例帮助模型把握表达方式。', 4)}
              </div>
            ) : (
              <div className="detail-histories route-enter">
                {sessions.length === 0 ? (
                  <div className="empty-state">
                    <History size={28} />
                    <h2>还没有历史对话</h2>
                    <p>开始第一段故事，之后可以从这里继续。</p>
                  </div>
                ) : (
                  sessions.map((s) => (
                    <button key={s.id} onClick={() => onStartChat(s.id)}>
                      <span className="detail-history-symbol">
                        {s.parentSessionId ? <GitBranch size={18} /> : <History size={18} />}
                      </span>
                      <span>
                        <strong>{s.title}</strong>
                        <small>
                          {s.messages.length} 条消息 · {s.parentSessionId ? '独立分支' : '主线'}
                          {s.id === last?.id ? ' · 上次阅读' : ''}
                        </small>
                      </span>
                      <ArrowUpRight size={16} />
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      <ConfirmDialog
        open={leave}
        title="离开角色编辑？"
        description="当前修改尚未保存。离开将放弃这些修改，已保存的角色与对话不会改变。"
        onClose={() => setLeave(false)}
        onConfirm={onBack}
        confirmText="放弃修改并离开"
      />
    </section>
  );
}
