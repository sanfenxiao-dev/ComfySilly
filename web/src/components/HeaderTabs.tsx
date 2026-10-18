import { useState, useRef, useEffect } from 'react';
import {
  SlidersHorizontal,
  MessageSquare,
  BookOpen,
  Puzzle,
  Upload,
  Save,
  ChevronDown,
  Trash2,
  Plus,
  Settings,
  Orbit,
  ScanLine,
} from 'lucide-react';
import type { TabType } from '../types/flow';
import type { Persona } from '../types/settings';
import { Avatar } from './Avatar';
import { ConfirmDialog } from './Dialog';
interface Props {
  currentTab: TabType;
  onTabChange: (tab: TabType) => void;
  onImportPreset: () => void;
  onSaveCurrentPreset: () => void;
  onNewPreset: () => void;
  onDeletePreset: (name: string, path: string) => void;
  onRunWorkflow: () => void;
  onOpenSettings: () => void;
  onOpenPersona?: () => void;
  persona?: Persona;
  presetList: { name: string; path: string; modified_time: number }[];
  currentPresetName: string;
  onSelectPresetFromLibrary: (name: string, path: string) => void;
}
export function HeaderTabs(p: Props) {
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState<{ name: string; path: string } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const click = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', click);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', click);
      document.removeEventListener('keydown', key);
    };
  }, []);
  const tabs = [
    ['preset', '预设', SlidersHorizontal],
    ['chat', '角色与对话', MessageSquare],
    ['worldbook', '世界书', BookOpen],
    ['plugins', '扩展', Puzzle],
  ] as const;
  return (
    <>
      <header className="app-topbar">
        <div className="topbar-row">
          <div className="brand">
            <span className="brand-mark">
              <Orbit size={19} />
            </span>
            ComfySilly<small>STUDIO</small>
          </div>
          <nav className="top-navigation" aria-label="主导航">
            {tabs.map(([id, label, Icon]) => (
              <button
                key={id}
                className={`top-tab ${p.currentTab === id ? 'is-active' : ''}`}
                aria-current={p.currentTab === id ? 'page' : undefined}
                onClick={() => {
                  setOpen(false);
                  p.onTabChange(id);
                }}
              >
                <Icon size={16} />
                <span>{label}</span>
              </button>
            ))}
          </nav>
          <div className="top-actions">
            <button
              className="persona-chip"
              onClick={p.onOpenPersona ?? p.onOpenSettings}
              title="用户身份设置"
            >
              <Avatar src={p.persona?.avatar} name={p.persona?.name || '用户'} size="small" />
              <span>{p.persona?.name || '用户'}</span>
            </button>
            <button
              className="icon-button"
              title="设置"
              aria-label="设置"
              onClick={p.onOpenSettings}
            >
              <Settings size={19} />
            </button>
          </div>
        </div>
        {p.currentTab === 'preset' && (
          <div className="workspace-toolbar">
            <span className="workspace-label">PRESET STUDIO</span>
            <div ref={ref} className="preset-picker">
              <button className="button" aria-expanded={open} onClick={() => setOpen(!open)}>
                {p.currentPresetName || '未命名预设'}
                <ChevronDown size={14} />
              </button>
              {open && (
                <div className="popover">
                  <div className="popover-title">已保存预设 · {p.presetList.length}</div>
                  <div className="popover-list">
                    {p.presetList.length === 0 && (
                      <p className="settings-empty">保存或导入一个预设，便可在这里切换。</p>
                    )}
                    {p.presetList.map((item) => (
                      <div
                        key={item.path}
                        className={`popover-row ${p.currentPresetName === item.name ? 'is-active' : ''}`}
                      >
                        <button
                          className="popover-select"
                          onClick={() => {
                            p.onSelectPresetFromLibrary(item.name, item.path);
                            setOpen(false);
                          }}
                        >
                          {item.name}
                        </button>
                        <button
                          className="icon-button danger"
                          aria-label={`删除预设 ${item.name}`}
                          onClick={() => {
                            setDeleting(item);
                            setOpen(false);
                          }}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <span className="toolbar-divider" />
            <button className="button button-quiet" onClick={p.onNewPreset}>
              <Plus size={14} />
              新建
            </button>
            <button className="button button-quiet" onClick={p.onImportPreset}>
              <Upload size={14} />
              导入
            </button>
            <button className="button button-quiet" onClick={p.onSaveCurrentPreset}>
              <Save size={14} />
              保存
            </button>
            <div className="toolbar-spacer" />
            <button className="button" onClick={p.onRunWorkflow}>
              <ScanLine size={14} />
              检查与预览
            </button>
          </div>
        )}
      </header>
      <ConfirmDialog
        open={!!deleting}
        title="删除预设？"
        description={`「${deleting?.name ?? ''}」将从本机预设库删除，不能撤销。`}
        onClose={() => setDeleting(null)}
        danger
        confirmText="删除预设"
        onConfirm={() => {
          if (deleting) return p.onDeletePreset(deleting.name, deleting.path);
        }}
      />
    </>
  );
}
