import { useMemo, useState } from 'react';
import type { CSSProperties, MouseEvent } from 'react';
import { BookOpen, Plus, Upload, Trash2, MessageSquare, Search, ArrowUpRight } from 'lucide-react';
import { ConfirmDialog } from './Dialog';
export interface MessageVariant {
  id: string;
  content: string;
  timestamp: string;
  source: 'generated' | 'edited' | 'original';
  runtimeVariables?: Record<string, Record<string, unknown>>;
}
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  name?: string;
  avatar?: string;
  personaId?: string;
  variants?: MessageVariant[];
  selectedVariant?: number;
}
export interface ChatSession {
  id: string;
  title: string;
  updatedAt: string;
  parentSessionId?: string;
  forkedFromMessageId?: string;
  runtimeVariables?: Record<string, Record<string, unknown>>;
  runtimeCheckpoints?: Record<string, Record<string, Record<string, unknown>>>;
  messages: ChatMessage[];
}

export interface CharacterCardData {
  id: string;
  name: string;
  creator: string;
  character_version: string;
  description: string;
  personality: string;
  scenario: string;
  first_mes: string;
  mes_example?: string;
  avatar_b64: string;
  lorebook?: {
    name: string;
    entries: any;
  };
  extensions?: Record<string, any>;
  sessions: ChatSession[];
  activeSessionId?: string;
}

interface CharacterShelfProps {
  characters: CharacterCardData[];
  onImportCard: () => void;
  onCreateCard?: () => void;
  onSelectCharacter: (card: CharacterCardData, sessionId?: string) => void;
  onDeleteCharacter: (id: string, e: MouseEvent) => void;
  onNewSessionForCard: (id: string, e: MouseEvent) => void;
}
export function CharacterShelf({
  characters,
  onImportCard,
  onCreateCard,
  onSelectCharacter,
  onDeleteCharacter,
  onNewSessionForCard,
}: CharacterShelfProps) {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('recent');
  const [deleting, setDeleting] = useState<{ card: CharacterCardData; event: MouseEvent } | null>(
    null,
  );
  const filtered = useMemo(
    () =>
      characters
        .filter((c) =>
          `${c.name} ${c.creator} ${c.description}`
            .toLocaleLowerCase()
            .includes(search.toLocaleLowerCase()),
        )
        .sort((a, b) =>
          sort === 'name'
            ? a.name.localeCompare(b.name, 'zh-CN')
            : Math.max(0, ...(b.sessions ?? []).map((s) => Date.parse(s.updatedAt) || 0)) -
              Math.max(0, ...(a.sessions ?? []).map((s) => Date.parse(s.updatedAt) || 0)),
        ),
    [characters, search, sort],
  );
  return (
    <section className="page route-enter">
      <div className="page-inner">
        <header className="page-heading">
          <div>
            <span className="eyebrow">YOUR STORIES, COLLECTED</span>
            <h1>角色书架</h1>
            <p>收藏一个角色，展开一个世界。每一次相遇，都可以有不同的续篇。</p>
          </div>
          <div className="page-heading-actions">
            <button className="button" onClick={onCreateCard}>
              <Plus size={16} />
              新建角色
            </button>
            <button className="button button-primary" onClick={onImportCard}>
              <Upload size={16} />
              导入角色卡
            </button>
          </div>
        </header>
        <div className="page-tools">
          <label className="search-field">
            <Search size={16} />
            <input
              aria-label="搜索角色"
              placeholder="搜索名字、作者或设定…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <span className="collection-info">
            {characters.length} 个角色 ·{' '}
            {characters.reduce((n, c) => n + (c.sessions?.length ?? 0), 0)} 段故事
          </span>
          <select
            className="text-input"
            aria-label="角色排序"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option value="recent">最近对话</option>
            <option value="name">名字顺序</option>
          </select>
        </div>
        {filtered.length === 0 ? (
          <div className="empty-state">
            <span className="empty-symbol">
              <BookOpen size={30} />
            </span>
            <h2>{search ? '没有找到这个角色' : '故事从这里开始'}</h2>
            <p>
              {search ? '试试另一个名字，或清空搜索。' : '导入 PNG 角色卡，或亲手写下一个新角色。'}
            </p>
            <button className="button" onClick={search ? () => setSearch('') : onImportCard}>
              {search ? '清空搜索' : '导入第一张角色卡'}
            </button>
          </div>
        ) : (
          <div className="shelf-grid">
            {filtered.map((card, i) => (
              <article
                key={card.id}
                className="book-card"
                style={{ '--stagger': `${Math.min(i, 12) * 35}ms` } as CSSProperties}
              >
                <div className="book-cover">
                  <button
                    className="cover-open"
                    onClick={() => onSelectCharacter(card)}
                    aria-label={`打开角色 ${card.name}`}
                  >
                    {card.avatar_b64 ? (
                      <img src={card.avatar_b64} alt="" loading="lazy" />
                    ) : (
                      <BookOpen size={46} />
                    )}
                    <span className="cover-caption">
                      展开故事 <ArrowUpRight size={14} />
                    </span>
                  </button>
                  <div className="cover-actions">
                    <button
                      className="icon-button"
                      title="新建对话"
                      aria-label={`与 ${card.name} 新建对话`}
                      onClick={(e) => onNewSessionForCard(card.id, e)}
                    >
                      <Plus size={16} />
                    </button>
                    <button
                      className="icon-button danger"
                      aria-label={`删除角色 ${card.name}`}
                      onClick={(e) => setDeleting({ card, event: e })}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
                <div className="book-meta">
                  <button className="book-title" onClick={() => onSelectCharacter(card)}>
                    {card.name}
                  </button>
                  <p className="book-description">
                    {card.creator ? `by ${card.creator}` : '等待相遇的故事'}
                    {card.character_version ? ` · ${card.character_version}` : ''}
                  </p>
                  <div className="book-stats">
                    <span>
                      <MessageSquare size={12} />
                      {card.sessions?.length ?? 0} 段对话
                    </span>
                    {card.lorebook?.entries && (
                      <span>
                        <BookOpen size={12} />
                        {Object.keys(card.lorebook.entries).length} 条世界书
                      </span>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
      <ConfirmDialog
        open={!!deleting}
        title="删除角色？"
        description={`将删除「${deleting?.card.name ?? ''}」及其全部对话，不能撤销。建议先导出重要对话。`}
        onClose={() => setDeleting(null)}
        danger
        confirmText="删除角色"
        onConfirm={() => {
          if (deleting) return onDeleteCharacter(deleting.card.id, deleting.event);
        }}
      />
    </section>
  );
}
