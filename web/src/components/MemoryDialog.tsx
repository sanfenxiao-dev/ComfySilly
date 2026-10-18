import { useEffect, useMemo, useState } from 'react';
import { Dialog, ConfirmDialog } from './Dialog';
import type { ChatSession } from './CharacterShelf';
import type { MemoryStatus } from '../runtime/useAutomaticMemory';
import { usableMemory } from '../utils/memory';
import type { ConversationMemory, MemoryContent } from '../utils/memory';

interface Props {
  open: boolean;
  onClose: () => void;
  session: ChatSession;
  characterId: string;
  enabled: boolean;
  status: MemoryStatus;
  onRetry: () => void;
  onSave: (memory: ConversationMemory | undefined, expectedRevision?: string) => Promise<void>;
  onPause: () => Promise<void>;
}
export function MemoryDialog({
  open,
  onClose,
  session,
  characterId,
  enabled,
  status,
  onRetry,
  onSave,
  onPause,
}: Props) {
  const checkpoint = useMemo(
    () =>
      open ? usableMemory(session.memory, characterId, session.id, session.messages) : undefined,
    [open, session.memory, session.messages, characterId, session.id],
  );
  const [editing, setEditing] = useState<{
    revision?: string;
    content: MemoryContent;
  } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reset, setReset] = useState(false);
  const [sourceId, setSourceId] = useState<string | null>(null);
  useEffect(() => {
    setEditing(null);
    setError('');
    setReset(false);
    setSourceId(null);
  }, [open, session.id]);
  const action = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const source = session.messages.find((m) => m.id === sourceId);
  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        title="对话记忆"
        description={`仅属于「${session.title}」。不共享给其他角色卡或其他对话。`}
        className="memory-dialog"
        busy={busy}
      >
        <div className="memory-content">
          <div className="memory-overview" role="status">
            <strong>
              {!enabled
                ? '请在设置 → 自动记忆中启用并保存'
                : session.memoryPaused
                  ? '本对话已暂停自动记忆'
                  : status.detail || '等待整理'}
            </strong>
            <span>
              已整理 {checkpoint?.cursor.completed ?? 0} / {session.messages.length} 条原始消息
              {checkpoint?.cursor.offset ? ' · 正在续读超长消息' : ''}
            </span>
            {checkpoint && (
              <small>上次更新：{new Date(checkpoint.updatedAt).toLocaleString()}</small>
            )}
          </div>
          <p className="inline-note">
            整理在后台进行，会额外调用设置中选择的语言模型。失败不会清空旧记忆；尚未覆盖的原始消息仍保留在请求中。修改历史后，只使用与当前剧情一致的快照，必要时从原文重新整理。
          </p>
          <div className="memory-actions">
            <button
              className="button"
              disabled={!enabled || busy}
              onClick={() => {
                onRetry();
                setError('');
              }}
            >
              重试整理
            </button>
            <button className="button" disabled={busy} onClick={() => void action(onPause)}>
              {session.memoryPaused ? '恢复本对话记忆' : '暂停本对话记忆'}
            </button>
            <button className="button button-danger" disabled={busy} onClick={() => setReset(true)}>
              清空并重新整理
            </button>
            {checkpoint && !editing && (
              <button
                className="button"
                onClick={() => {
                  setEditing({
                    revision: session.memory?.revision,
                    content: structuredClone(checkpoint),
                  });
                }}
              >
                修正记忆
              </button>
            )}
          </div>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {editing ? (
            <>
              <label className="field">
                剧情摘要
                <textarea
                  className="text-input"
                  rows={6}
                  maxLength={8000}
                  value={editing.content.summary}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      content: { ...editing.content, summary: e.target.value },
                    })
                  }
                />
              </label>
              {(['facts', 'events', 'openThreads'] as const).map((key, group) => (
                <section key={key}>
                  <h3>{['已确认事实', '重要事件', '未完成事项'][group]}</h3>
                  {editing.content[key].map((item, i) => (
                    <div className="memory-item-editor" key={i}>
                      <textarea
                        className="text-input"
                        rows={2}
                        maxLength={600}
                        aria-label={`修改${['事实', '事件', '待办'][group]} ${i + 1}`}
                        value={item.content}
                        onChange={(e) =>
                          setEditing({
                            ...editing,
                            content: {
                              ...editing.content,
                              [key]: editing.content[key].map((v, n) =>
                                n === i ? { ...v, content: e.target.value } : v,
                              ),
                            },
                          })
                        }
                      />
                      <button
                        className="button button-quiet"
                        onClick={() =>
                          setEditing({
                            ...editing,
                            content: {
                              ...editing.content,
                              [key]: editing.content[key].filter((_, n) => n !== i),
                            },
                          })
                        }
                      >
                        删除
                      </button>
                    </div>
                  ))}
                </section>
              ))}
              <div className="memory-actions">
                <button className="button" onClick={() => setEditing(null)}>
                  取消修正
                </button>
                <button
                  className="button button-primary"
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      if (
                        !checkpoint ||
                        !session.memory ||
                        session.memory.revision !== editing.revision
                      )
                        throw new Error(
                          '后台已更新记忆，请取消修正后重新打开编辑，避免覆盖新结果。',
                        );
                      const memory = {
                        ...session.memory,
                        revision: crypto.randomUUID(),
                        checkpoints: [
                          ...session.memory.checkpoints.filter((c) => c !== checkpoint),
                          {
                            ...checkpoint,
                            ...editing.content,
                            updatedAt: new Date().toISOString(),
                          },
                        ],
                      };
                      await onSave(memory, editing.revision);
                      setEditing(null);
                    })
                  }
                >
                  保存修正
                </button>
              </div>
            </>
          ) : checkpoint ? (
            <>
              <section>
                <h3>剧情摘要</h3>
                <p className="memory-summary">{checkpoint.summary || '暂无摘要'}</p>
              </section>
              {(['facts', 'events', 'openThreads'] as const).map((key, group) => (
                <section key={key}>
                  <h3>
                    {['已确认事实', '重要事件', '未完成事项'][group]}{' '}
                    <small>{checkpoint[key].length}</small>
                  </h3>
                  {checkpoint[key].length ? (
                    <ul className="memory-items">
                      {checkpoint[key].map((item, i) => (
                        <li key={i}>
                          <p>{item.content}</p>
                          <div>
                            {item.sourceMessageIds.map((id) => (
                              <button
                                key={id}
                                className="memory-source"
                                onClick={() => setSourceId(id)}
                              >
                                来源 #{session.messages.findIndex((m) => m.id === id) + 1}
                              </button>
                            ))}
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="field-hint">暂无</p>
                  )}
                </section>
              ))}
            </>
          ) : (
            <div className="memory-empty">
              尚无有效的记忆快照。启用后，完成的对话会按顺序在后台整理；已有长历史也会逐批补齐。
            </div>
          )}
        </div>
      </Dialog>
      <ConfirmDialog
        open={reset}
        onClose={() => setReset(false)}
        title="清空这段对话的记忆？"
        description="只清除此对话的自动摘要，不删除聊天、世界书或脚本变量。启用自动记忆时会从原文重新整理，产生额外模型费用。"
        confirmText="清空记忆"
        danger
        onConfirm={async () => {
          await onSave(undefined);
          setEditing(null);
          setReset(false);
        }}
      />
      <Dialog
        open={Boolean(source)}
        onClose={() => setSourceId(null)}
        title="记忆来源消息"
        className="memory-dialog"
      >
        <pre className="memory-source-message">{source?.content}</pre>
      </Dialog>
    </>
  );
}
