import { useEffect, useState } from 'react';
import { Search, BookOpen, Save, Plus, Trash2, Undo2, ArrowUp, ArrowDown } from 'lucide-react';
import { Dialog, ConfirmDialog } from './Dialog';
export interface LoreEntry {
  uid?: number | string;
  comment?: string;
  key?: string[] | string;
  keysecondary?: string[] | string;
  content: string;
  disable?: boolean;
  constant?: boolean;
  selective?: boolean;
  order?: number;
  depth?: number;
  [key: string]: any;
}

export interface LorebookData {
  [key: string]: unknown;
  name: string;
  entries: LoreEntry[] | Record<string, LoreEntry>;
}

interface LorebookModalProps {
  isOpen: boolean;
  title: string;
  lorebook: LorebookData;
  onClose: () => void;
  onSave: (updated: { name: string; entries: LoreEntry[] }) => void | Promise<void>;
}

const normalize = (raw: unknown): LoreEntry[] =>
  Array.isArray(raw)
    ? structuredClone(raw)
    : raw && typeof raw === 'object'
      ? Object.entries(raw).map(([key, value]) => ({
          ...structuredClone(value as LoreEntry),
          uid: (value as LoreEntry).uid ?? key,
        }))
      : [];
export function LorebookModal({ isOpen, title, lorebook, onClose, onSave }: LorebookModalProps) {
  const [entries, setEntries] = useState<LoreEntry[]>([]),
    [selected, setSelected] = useState(0),
    [filter, setFilter] = useState(''),
    [name, setName] = useState('');
  const [saving, setSaving] = useState(false),
    [error, setError] = useState(''),
    [dirty, setDirty] = useState(false),
    [discard, setDiscard] = useState(false);
  const [removed, setRemoved] = useState<{ entry: LoreEntry; index: number } | null>(null);
  const [raw, setRaw] = useState('');
  useEffect(() => {
    if (isOpen) {
      setEntries(normalize(lorebook.entries));
      setName(lorebook.name || '世界书');
      setSelected(0);
      setFilter('');
      setError('');
      setDirty(false);
      setRemoved(null);
      setRaw('');
    }
  }, [isOpen, lorebook]);
  const current = entries[selected];
  const update = (patch: Partial<LoreEntry>) => {
    setEntries((es) => es.map((e, i) => (i === selected ? { ...e, ...patch } : e)));
    setDirty(true);
    setRaw('');
  };
  const close = () => (dirty ? setDiscard(true) : onClose());
  const add = () => {
    setEntries((es) => [
      {
        uid: Date.now(),
        comment: '新条目',
        key: [],
        keysecondary: [],
        content: '',
        disable: false,
        constant: false,
        order: 100,
      },
      ...es,
    ]);
    setSelected(0);
    setFilter('');
    setDirty(true);
    setRaw('');
  };
  const move = (delta: number) => {
    const to = selected + delta;
    if (to < 0 || to >= entries.length) return;
    const next = [...entries];
    [next[selected], next[to]] = [next[to], next[selected]];
    setEntries(next);
    setSelected(to);
    setDirty(true);
  };
  const toggle = (key: 'disable' | 'constant' | 'selective', label: string) => (
    <div className="lore-option">
      <span>{label}</span>
      <button
        className="switch"
        role="switch"
        aria-label={label}
        aria-checked={
          key === 'disable' ? current.disable !== true && current.enabled !== false : !!current[key]
        }
        onClick={() => {
          if (key === 'disable') {
            const enabled = current.disable !== true && current.enabled !== false;
            update({ disable: enabled, enabled: !enabled });
          } else update({ [key]: !current[key] });
        }}
      />
    </div>
  );
  const fields = (key: 'key' | 'keysecondary', label: string) => {
    const alias = key === 'key' ? 'keys' : 'secondary_keys';
    const keys = current[key] ?? current[alias];
    return (
      <label className="field">
        <span>{label}</span>
        <input
          className="text-input"
          value={Array.isArray(keys) ? keys.join(', ') : keys || ''}
          onChange={(e) =>
            (() => {
              const values = e.target.value
                .split(/[,，]/)
                .map((k) => k.trim())
                .filter(Boolean);
              update({ [key]: values, ...(alias in current ? { [alias]: values } : {}) });
            })()
          }
          placeholder="多个关键词用逗号分隔"
        />
      </label>
    );
  };
  const visible = entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) =>
      `${entry.comment || entry.name || ''} ${entry.content} ${entry.key || entry.keys || ''}`
        .toLocaleLowerCase()
        .includes(filter.toLocaleLowerCase()),
    );
  return (
    <>
      <Dialog
        open={isOpen}
        onClose={close}
        title={title}
        description="按关键词触发，或作为常驻设定注入。修改后保存到本机。"
        className="lore-editor-dialog"
        busy={saving}
      >
        <div className="lore-editor-layout">
          <aside className="lore-editor-sidebar">
            <label className="search-field">
              <Search size={14} />
              <input
                aria-label="搜索设定条目"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="搜索条目 / 关键词…"
              />
            </label>
            <button className="button" onClick={add}>
              <Plus size={14} />
              添加条目<span>{entries.length}</span>
            </button>
            <div className="lore-entry-list">
              {visible.map(({ entry, index }) => (
                <button
                  key={`${entry.uid ?? index}-${index}`}
                  className={selected === index ? 'is-active' : ''}
                  onClick={() => {
                    setSelected(index);
                    setRaw('');
                    setError('');
                  }}
                >
                  <span
                    className={`status-dot ${entry.disable === true || entry.enabled === false ? 'is-off' : ''}`}
                  />
                  <span>
                    <strong>{entry.comment || entry.name || '未命名条目'}</strong>
                    <small>
                      {entry.constant
                        ? '常驻'
                        : (Array.isArray(entry.key ?? entry.keys)
                            ? (entry.key ?? entry.keys).join(' · ')
                            : (entry.key ?? entry.keys)) || '未设置关键词'}
                    </small>
                  </span>
                </button>
              ))}
            </div>
            {removed && (
              <button
                className="button button-quiet"
                onClick={() => {
                  const next = [...entries];
                  next.splice(Math.min(removed.index, next.length), 0, removed.entry);
                  setEntries(next);
                  setSelected(Math.min(removed.index, next.length - 1));
                  setRemoved(null);
                  setDirty(true);
                }}
              >
                <Undo2 size={13} />
                撤销上次删除
              </button>
            )}
          </aside>
          <div className="lore-editor-main">
            <label className="field">
              <span>世界书名称</span>
              <input
                className="text-input"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setDirty(true);
                }}
              />
            </label>
            {current ? (
              <div className="lore-entry-editor" key={current.uid ?? selected}>
                <div className="lore-entry-heading">
                  <span className="eyebrow">ENTRY {String(selected + 1).padStart(2, '0')}</span>
                  <div>
                    <button
                      className="icon-button"
                      aria-label="上移条目"
                      disabled={selected === 0}
                      onClick={() => move(-1)}
                    >
                      <ArrowUp size={15} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label="下移条目"
                      disabled={selected === entries.length - 1}
                      onClick={() => move(1)}
                    >
                      <ArrowDown size={15} />
                    </button>
                    <button
                      className="button button-danger"
                      onClick={() => {
                        setRemoved({ entry: current, index: selected });
                        setEntries((es) => es.filter((_, i) => i !== selected));
                        setSelected(Math.max(0, selected - 1));
                        setDirty(true);
                        setRaw('');
                      }}
                    >
                      <Trash2 size={14} />
                      删除条目
                    </button>
                  </div>
                </div>
                <label className="field">
                  <span>条目名称 / 注释</span>
                  <input
                    className="text-input"
                    value={current.comment ?? current.name ?? ''}
                    onChange={(e) => update({ comment: e.target.value })}
                  />
                </label>
                <div className="lore-options">
                  {toggle('disable', '启用条目')}
                  {toggle('constant', '常驻注入')}
                  {toggle('selective', '启用辅助关键词')}
                </div>
                {fields('key', '主要关键词')}
                {current.selective && fields('keysecondary', '辅助关键词')}
                <label className="field">
                  <span>
                    设定内容<small>{current.content?.length ?? 0} 字符</small>
                  </span>
                  <textarea
                    className="text-input lore-content"
                    value={current.content || ''}
                    onChange={(e) => update({ content: e.target.value })}
                    rows={10}
                    placeholder="写下世界、人物、地点或规则…"
                  />
                </label>
                <details className="lore-advanced">
                  <summary>高级注入参数</summary>
                  <div className="field-grid">
                    <label className="field">
                      <span>注入顺序</span>
                      <input
                        className="text-input"
                        type="number"
                        value={current.order ?? current.insertion_order ?? 100}
                        onChange={(e) =>
                          update({
                            order: Number(e.target.value),
                            ...('insertion_order' in current
                              ? { insertion_order: Number(e.target.value) }
                              : {}),
                          })
                        }
                      />
                    </label>
                    <label className="field">
                      <span>注入深度</span>
                      <input
                        className="text-input"
                        min="0"
                        type="number"
                        value={current.depth ?? current.extensions?.depth ?? 4}
                        onChange={(e) => update({ depth: Number(e.target.value) })}
                      />
                    </label>
                    <label className="field">
                      <span>注入位置</span>
                      <select
                        className="text-input"
                        value={
                          (
                            { before_char: 0, after_char: 1, at_depth: 4 } as Record<string, number>
                          )[String(current.position ?? current.extensions?.position)] ??
                          current.position ??
                          current.extensions?.position ??
                          0
                        }
                        onChange={(e) => update({ position: Number(e.target.value) })}
                      >
                        <option value="0">角色描述之前</option>
                        <option value="1">角色描述之后</option>
                        <option value="4">按深度插入历史</option>
                      </select>
                    </label>
                    <label className="field">
                      <span>辅助关键词逻辑</span>
                      <select
                        className="text-input"
                        value={current.selectiveLogic ?? current.extensions?.selectiveLogic ?? 0}
                        onChange={(e) => update({ selectiveLogic: Number(e.target.value) })}
                      >
                        <option value="0">任意命中</option>
                        <option value="1">不全命中</option>
                        <option value="2">全部不命中</option>
                        <option value="3">全部命中</option>
                      </select>
                    </label>
                  </div>
                  <p className="field-hint">
                    列表移动用于整理条目；实际注入优先级由“注入顺序”和深度决定。
                  </p>
                </details>
                <details
                  className="lore-advanced"
                  onToggle={(e) => {
                    if (e.currentTarget.open) setRaw(JSON.stringify(current, null, 2));
                  }}
                >
                  <summary>原始条目 JSON · 保留全部扩展参数</summary>
                  <textarea
                    aria-label="原始条目 JSON"
                    className="text-input"
                    rows={10}
                    value={raw}
                    onChange={(e) => setRaw(e.target.value)}
                  />
                  <button
                    className="button"
                    onClick={() => {
                      try {
                        const data = JSON.parse(raw);
                        if (
                          !data ||
                          typeof data !== 'object' ||
                          Array.isArray(data) ||
                          typeof data.content !== 'string'
                        )
                          throw new Error('条目须为对象，且 content 为字符串');
                        setEntries((es) => es.map((e, i) => (i === selected ? data : e)));
                        setDirty(true);
                        setError('');
                      } catch (e) {
                        setError(`JSON 无效：${String(e)}`);
                      }
                    }}
                  >
                    应用 JSON 修改
                  </button>
                  <p className="field-hint">
                    未知字段会原样保存；保存字段不表示运行时已支持全部酒馆插件行为。
                  </p>
                </details>
              </div>
            ) : (
              <div className="empty-state">
                <BookOpen size={28} />
                <h2>还没有条目</h2>
                <p>可以新建条目，也可以撤销上次删除。</p>
                <button className="button" onClick={add}>
                  <Plus size={15} />
                  添加第一条设定
                </button>
              </div>
            )}
          </div>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <footer className="dialog-footer">
          <span className="field-hint">
            {dirty ? '有未保存的修改' : '已保存'} · {entries.length} 个条目
          </span>
          <button className="button" disabled={saving} onClick={close}>
            关闭
          </button>
          <button
            className="button button-primary"
            disabled={saving || !name.trim()}
            onClick={async () => {
              setSaving(true);
              setError('');
              try {
                await onSave({ ...lorebook, name, entries });
                setDirty(false);
                onClose();
              } catch (e) {
                setError(`保存失败：${String(e)}`);
              } finally {
                setSaving(false);
              }
            }}
          >
            <Save size={15} />
            {saving ? '保存中…' : '保存世界书'}
          </button>
        </footer>
      </Dialog>
      <ConfirmDialog
        open={discard}
        title="放弃尚未保存的修改？"
        description="本次世界书修改尚未保存，关闭将还原为上次保存的内容。"
        onClose={() => setDiscard(false)}
        onConfirm={() => {
          setDiscard(false);
          setDirty(false);
          onClose();
        }}
        confirmText="放弃修改并关闭"
      />
    </>
  );
}
