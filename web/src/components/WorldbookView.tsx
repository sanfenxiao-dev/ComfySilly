import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { BookOpen, Upload, Plus, Trash2, Search, ArrowUpRight } from 'lucide-react';
import type { LorebookData } from './LorebookModal';
import { ConfirmDialog } from './Dialog';
export interface GlobalWorldbookMeta {
  storageName?: string;
  name: string;
  path: string;
  entriesCount: number;
  enabled: boolean;
  data: LorebookData;
}
interface Props {
  worldbooks: GlobalWorldbookMeta[];
  onImportWorldbook: () => void;
  onNewWorldbook: () => void;
  onDeleteWorldbook: (name: string, path: string) => void;
  onToggleWorldbook: (name: string, enabled: boolean) => void;
  onOpenEditor: (wb: GlobalWorldbookMeta) => void;
}
export function WorldbookView({
  worldbooks,
  onImportWorldbook,
  onNewWorldbook,
  onDeleteWorldbook,
  onToggleWorldbook,
  onOpenEditor,
}: Props) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [deleting, setDeleting] = useState<GlobalWorldbookMeta | null>(null);
  const filtered = useMemo(
    () =>
      worldbooks.filter(
        (b) =>
          b.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()) &&
          (filter === 'all' || b.enabled),
      ),
    [worldbooks, search, filter],
  );
  return (
    <section className="page route-enter">
      <div className="page-inner">
        <header className="page-heading">
          <div>
            <span className="eyebrow">A WORLD BEYOND THE PAGE</span>
            <h1>世界书</h1>
            <p>
              让设定在合适的时刻浮现。全局世界书可用于所有角色，角色专属世界书在角色详情内编辑。
            </p>
          </div>
          <div className="page-heading-actions">
            <button className="button" onClick={onNewWorldbook}>
              <Plus size={16} />
              新建世界书
            </button>
            <button className="button button-primary" onClick={onImportWorldbook}>
              <Upload size={16} />
              导入世界书
            </button>
          </div>
        </header>
        <div className="page-tools">
          <label className="search-field">
            <Search size={16} />
            <input
              aria-label="搜索世界书"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索世界书…"
            />
          </label>
          <span className="collection-info">
            {worldbooks.filter((b) => b.enabled).length} 本已启用 ·{' '}
            {worldbooks.reduce((n, b) => n + b.entriesCount, 0)} 条设定
          </span>
          <div className="segmented">
            <button aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
              全部
            </button>
            <button aria-pressed={filter === 'active'} onClick={() => setFilter('active')}>
              已启用
            </button>
          </div>
        </div>
        {filtered.length === 0 ? (
          <div className="empty-state">
            <span className="empty-symbol">
              <BookOpen size={30} />
            </span>
            <h2>{worldbooks.length ? '没有匹配的世界书' : '让世界更完整'}</h2>
            <p>导入酒馆 JSON 世界书，或写下自己的第一条设定。</p>
            <button className="button" onClick={onNewWorldbook}>
              <Plus size={15} />
              新建世界书
            </button>
          </div>
        ) : (
          <div className="lore-grid">
            {filtered.map((book, i) => {
              const raw = book.data.entries;
              const entries = Array.isArray(raw)
                ? raw
                : raw && typeof raw === 'object'
                  ? Object.values(raw)
                  : [];
              const preview = entries
                .slice(0, 3)
                .map(
                  (e: any) =>
                    e.comment ||
                    e.name ||
                    (Array.isArray(e.key) ? e.key.join('、') : '') ||
                    '未命名条目',
                )
                .join(' · ');
              return (
                <article
                  key={book.path || book.name}
                  className={`lore-card ${book.enabled ? '' : 'is-off'}`}
                  style={{ '--stagger': `${Math.min(i, 12) * 35}ms` } as CSSProperties}
                >
                  <div className="lore-card-top">
                    <span className="lore-symbol">
                      <BookOpen size={23} />
                    </span>
                    <button
                      className="switch"
                      role="switch"
                      aria-label={`启用 ${book.name}`}
                      aria-checked={book.enabled}
                      onClick={() => onToggleWorldbook(book.path, !book.enabled)}
                    />
                  </div>
                  <h2>
                    <button onClick={() => onOpenEditor(book)}>{book.name}</button>
                  </h2>
                  <p className="lore-summary">{preview || '还没有内容，开始构建你的世界。'}</p>
                  <div className="lore-card-footer">
                    <span className="badge">
                      <span className={`status-dot ${book.enabled ? '' : 'is-off'}`} />
                      {book.entriesCount} 条 · {book.enabled ? '已启用' : '未启用'}
                    </span>
                    <div>
                      <button
                        className="icon-button danger"
                        aria-label={`删除世界书 ${book.name}`}
                        onClick={() => setDeleting(book)}
                      >
                        <Trash2 size={15} />
                      </button>
                      <button className="button button-quiet" onClick={() => onOpenEditor(book)}>
                        编辑
                        <ArrowUpRight size={14} />
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
      <ConfirmDialog
        open={!!deleting}
        title="删除世界书？"
        description={`「${deleting?.name ?? ''}」及其中的全部条目将从本机删除，不能撤销。`}
        onClose={() => setDeleting(null)}
        danger
        confirmText="删除世界书"
        onConfirm={() => {
          if (deleting) return onDeleteWorldbook(deleting.name, deleting.path);
        }}
      />
    </section>
  );
}
