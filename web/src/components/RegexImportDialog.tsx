import { createContext, useRef, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { ArrowUp, ArrowDown, X, Upload } from 'lucide-react';
import { Dialog } from './Dialog';
import { parseRegexImport } from '../utils/canvasState';

export const RegexNodeActions = createContext<{ onImport: (id: string) => void; order: string[] }>({
  onImport: () => {},
  order: [],
});
type Source = { id: string; name: string; rules: Record<string, any>[] };
export function RegexImportDialog({
  targetId,
  targets,
  onClose,
  onApply,
}: {
  targetId: string;
  targets: { id: string; name: string }[];
  onClose: () => void;
  onApply: (targetId: string, rules: Record<string, any>[], skipDuplicates: boolean) => void;
}) {
  const [target, setTarget] = useState(targetId);
  const [sources, setSources] = useState<Source[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [skip, setSkip] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const stage = async (files: { name: string; read: () => Promise<string> }[]) => {
    if (!files.length) return;
    setBusy(true);
    setError('');
    try {
      if (files.length + sources.length > 100) throw Error('一次最多选择 100 个文件');
      const batch = await Promise.all(
        files.map(async (file) => {
          const text = await file.read();
          if (new Blob([text]).size > 10 * 1024 * 1024) throw Error(`${file.name} 超过 10 MB`);
          try {
            return {
              id: crypto.randomUUID(),
              name: file.name,
              rules: parseRegexImport(JSON.parse(text.replace(/^\uFEFF/, ''))).map((r) => ({
                ...r,
                _comfysilly_sourceFile: file.name,
              })),
            };
          } catch (e) {
            throw Error(`${file.name}：${String(e)}`);
          }
        }),
      );
      setSources((old) => [...old, ...batch]);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const choose = async () => {
    if (!isTauri()) {
      input.current?.click();
      return;
    }
    try {
      const selected = await open({
        multiple: true,
        filters: [{ name: '酒馆正则 JSON', extensions: ['json'] }],
        title: '选择正则文件；导入前可调整文件顺序',
      });
      if (selected)
        await stage(
          (Array.isArray(selected) ? selected : [selected]).map((path) => ({
            name: path.split(/[\\/]/).pop()!,
            read: () => invoke<string>('load_preset_file', { filePath: path }),
          })),
        );
    } catch (e) {
      setError(`选择文件失败：${String(e)}`);
    }
  };
  const move = (index: number, delta: number) =>
    setSources((old) => {
      const next = [...old],
        to = index + delta;
      if (to < 0 || to >= next.length) return old;
      [next[index], next[to]] = [next[to], next[index]];
      return next;
    });
  return (
    <Dialog
      open
      onClose={onClose}
      title="导入正则到节点"
      description="按文件队列从上到下追加；每个文件内部保留原始规则顺序。可反复选择文件，再统一导入。"
      className="regex-import-dialog"
      busy={busy}
    >
      <div className="regex-import-body">
        <label>
          目标正则节点
          <select
            aria-label="目标正则节点"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            disabled={busy}
          >
            <option value="__new__">新建一个正则节点</option>
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <button className="button" disabled={busy} onClick={() => void choose()}>
          <Upload size={15} />
          选择 JSON 文件（可多选）
        </button>
        <input
          ref={input}
          hidden
          multiple
          type="file"
          accept=".json,application/json"
          aria-label="选择正则 JSON 文件"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = '';
            void stage(files.map((file) => ({ name: file.name, read: () => file.text() })));
          }}
        />
        <ol className="regex-import-queue" aria-label="正则文件导入顺序">
          {sources.map((source, i) => (
            <li key={source.id}>
              <span className="regex-file-index">{i + 1}</span>
              <div>
                <strong>{source.name}</strong>
                <small>{source.rules.length} 条规则</small>
              </div>
              <button
                className="icon-button"
                aria-label={`上移文件 ${source.name}`}
                disabled={busy || i === 0}
                onClick={() => move(i, -1)}
              >
                <ArrowUp size={15} />
              </button>
              <button
                className="icon-button"
                aria-label={`下移文件 ${source.name}`}
                disabled={busy || i === sources.length - 1}
                onClick={() => move(i, 1)}
              >
                <ArrowDown size={15} />
              </button>
              <button
                className="icon-button danger"
                aria-label={`移除文件 ${source.name}`}
                disabled={busy}
                onClick={() => setSources((old) => old.filter((s) => s.id !== source.id))}
              >
                <X size={15} />
              </button>
            </li>
          ))}
        </ol>
        {!sources.length && (
          <p className="regex-import-help">
            尚未选择文件。批量选择后的顺序以此处队列为准，可用上下按钮调整。
          </p>
        )}
        <label className="regex-import-dedupe">
          <input type="checkbox" checked={skip} onChange={(e) => setSkip(e.target.checked)} />
          跳过目标节点中完全相同的规则（不会跨节点去重）
        </label>
        <p className="regex-import-help">
          空表达式的标题/分隔条目会原样保留且不执行。导入只追加，不覆盖已有规则；完成后请保存预设。
        </p>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
      </div>
      <footer className="dialog-footer">
        <button className="button" disabled={busy} onClick={onClose}>
          取消
        </button>
        <button
          className="button button-primary"
          disabled={busy || !sources.length}
          onClick={() => {
            try {
              onApply(
                target,
                sources.flatMap((s) => s.rules),
                skip,
              );
              onClose();
            } catch (e) {
              setError(String(e));
            }
          }}
        >
          {busy
            ? '读取中…'
            : `按顺序导入 ${sources.reduce((n, s) => n + s.rules.length, 0)} 条规则`}
        </button>
      </footer>
    </Dialog>
  );
}
