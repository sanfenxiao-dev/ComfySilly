import React, { useEffect } from 'react';
import {
  Sparkles,
  MessageSquare,
  BookOpen,
  Terminal,
  Sliders,
  Regex,
  Plus,
  Trash2,
} from 'lucide-react';

interface ContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  onAddNode: (type: string, pos: { x: number; y: number }) => void;
  onDelete?: () => void;
  deleteLabel?: string;
}

export const CanvasContextMenu: React.FC<ContextMenuProps> = ({
  x,
  y,
  onClose,
  onAddNode,
  onDelete,
  deleteLabel,
}) => {
  useEffect(() => {
    const close = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [onClose]);
  const nodeOptions = [
    {
      type: 'promptBlock',
      label: '提示词块 (Prompt Block)',
      desc: '系统提示词、角色越狱词、规则块',
      icon: Sparkles,
      color: 'text-violet-400 bg-violet-500/10 border-violet-500/20',
    },
    {
      type: 'historySampler',
      label: '历史采样器 (History Sampler)',
      desc: '聊天记录滑动窗口与轮数截断',
      icon: MessageSquare,
      color: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20',
    },
    {
      type: 'lorebook',
      label: '世界书触发器 (WorldBook)',
      desc: '关键词递归扫描与世界设定注入',
      icon: BookOpen,
      color: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
    },
    {
      type: 'assembler',
      label: '预设总装配器 (Pipeline Assembler)',
      desc: 'Depth/Order 拓扑排序与上下文拼接',
      icon: Terminal,
      color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    },
    {
      type: 'llmInference',
      label: 'LLM 生成引擎 (LLM Engine)',
      desc: '大模型推理端点与采样超参数',
      icon: Sliders,
      color: 'text-rose-400 bg-rose-500/10 border-rose-500/20',
    },
    {
      type: 'regexFilter',
      label: '预设绑定正则 (Regex Binder)',
      desc: '流式输出文本正则过滤清洗流水线',
      icon: Regex,
      color: 'text-teal-400 bg-teal-500/10 border-teal-500/20',
    },
  ];

  return (
    <div
      role="menu"
      aria-label="画布操作"
      style={{
        left: `${Math.max(8, Math.min(x, window.innerWidth - 296))}px`,
        top: `${Math.max(8, Math.min(y, window.innerHeight - (onDelete ? 100 : 470)))}px`,
      }}
      onClick={(e) => e.stopPropagation()}
      className="fixed z-50 w-72 rounded-2xl bg-slate-900/98 border border-slate-700/80 shadow-2xl backdrop-blur-2xl p-2 space-y-1 animate-in fade-in zoom-in-95 duration-100 select-none"
    >
      {onDelete ? (
        <button
          role="menuitem"
          className="button button-danger w-full"
          onClick={() => {
            onDelete();
            onClose();
          }}
        >
          <Trash2 size={15} />
          {deleteLabel ?? '删除节点'}
        </button>
      ) : (
        <>
          <div className="px-2.5 py-1 text-[10px] font-mono font-bold text-slate-400 border-b border-slate-800/80 flex items-center justify-between">
            <span>新建节点 (ADD NODE)</span>
            <span className="text-[9px] text-slate-500">ESC 关闭</span>
          </div>

          <div className="space-y-1 pt-1">
            {nodeOptions.map((opt) => {
              const Icon = opt.icon;
              return (
                <button
                  key={opt.type}
                  onClick={() => {
                    onAddNode(opt.type, { x, y });
                    onClose();
                  }}
                  className="w-full flex items-center space-x-2.5 p-2 rounded-xl text-left hover:bg-slate-800/80 transition-all cursor-pointer group"
                >
                  <div
                    className={`p-1.5 rounded-lg border ${opt.color} group-hover:scale-110 transition-transform`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-slate-200 group-hover:text-violet-300 transition-colors">
                      {opt.label}
                    </div>
                    <div className="text-[10px] text-slate-500 truncate">{opt.desc}</div>
                  </div>
                  <Plus className="w-3.5 h-3.5 text-slate-600 group-hover:text-violet-400 opacity-0 group-hover:opacity-100 transition-all" />
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};
