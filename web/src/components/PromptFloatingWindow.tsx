import React, { useState, useRef, useEffect } from 'react';
import type { Node } from '@xyflow/react';
import { X, Save, Edit3, Maximize2, Minimize2 } from 'lucide-react';

interface PromptFloatingWindowProps {
  nodeId: string | null;
  nodes: Node[];
  onClose: () => void;
  onUpdateNode: (id: string, patch: any) => void;
}

export const PromptFloatingWindow: React.FC<PromptFloatingWindowProps> = ({
  nodeId,
  nodes,
  onClose,
  onUpdateNode,
}) => {
  const node = nodes.find((n) => n.id === nodeId);
  const data = node?.data as any;

  // 窗口坐标与尺寸 (类似 Windows 独立浮动窗口)
  const [position, setPosition] = useState<{ x: number; y: number }>({ x: 380, y: 80 });
  const [size] = useState<{ width: number; height: number }>({ width: 560, height: 480 });
  const [isMaximized, setIsMaximized] = useState<boolean>(false);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const dragRef = useRef<{ startX: number; startY: number; initX: number; initY: number }>({
    startX: 0,
    startY: 0,
    initX: 0,
    initY: 0,
  });

  // 编辑字段状态
  const [name, setName] = useState<string>('');
  const [content, setContent] = useState<string>('');
  const [role, setRole] = useState<string>('system');
  const [depth, setDepth] = useState<number>(0);
  const [order, setOrder] = useState<number>(100);

  useEffect(() => {
    if (data) {
      setName(data.name || '');
      setContent(data.content || '');
      setRole(data.role || 'system');
      setDepth(data.depth ?? 0);
      setOrder(data.order ?? 100);
    }
  }, [nodeId, data]);

  // 窗口拖动逻辑 (原生无边框窗口手感)
  const handleMouseDown = (e: React.MouseEvent) => {
    if (isMaximized) return;
    setIsDragging(true);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initX: position.x,
      initY: position.y,
    };
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      setPosition({
        x: Math.max(10, dragRef.current.initX + dx),
        y: Math.max(10, dragRef.current.initY + dy),
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  if (!nodeId || !data) return null;

  const handleSave = () => {
    onUpdateNode(nodeId, {
      name,
      content,
      role,
      depth,
      order,
    });
  };

  return (
    <div
      style={
        isMaximized
          ? { left: 340, top: 60, width: 'calc(100vw - 360px)', height: 'calc(100vh - 80px)' }
          : {
              left: `${position.x}px`,
              top: `${position.y}px`,
              width: `${size.width}px`,
              height: `${size.height}px`,
            }
      }
      className="absolute z-50 rounded-xl bg-slate-900/98 border border-slate-700/80 shadow-2xl flex flex-col backdrop-blur-xl overflow-hidden transition-all duration-75 select-none"
    >
      {/* 类似 Windows 窗口标题栏（按住可自由拖拽） */}
      <div
        onMouseDown={handleMouseDown}
        className="h-10 bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 border-b border-slate-800 flex items-center justify-between px-3 cursor-move"
      >
        <div className="flex items-center space-x-2 min-w-0 pr-2">
          <Edit3 className="w-4 h-4 text-violet-400 flex-shrink-0" />
          <span className="text-xs font-bold text-slate-100 truncate">
            提示词条目编辑器 - #{data.calcIndex ?? data.order} ({name})
          </span>
        </div>

        <div className="flex items-center space-x-1 flex-shrink-0">
          <button
            onClick={() => setIsMaximized(!isMaximized)}
            className="p-1 rounded text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition cursor-pointer"
            title={isMaximized ? '还原窗口' : '最大化窗口'}
          >
            {isMaximized ? (
              <Minimize2 className="w-3.5 h-3.5" />
            ) : (
              <Maximize2 className="w-3.5 h-3.5" />
            )}
          </button>
          <button
            onClick={onClose}
            className="p-1 rounded text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition cursor-pointer"
            title="关闭窗口"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 窗口主体内容 */}
      <div className="flex-1 flex flex-col p-4 space-y-3 overflow-hidden select-text">
        {/* 条目名称输入与即时保存按钮 */}
        <div className="flex items-center space-x-3">
          <div className="flex-1">
            <span className="text-[10px] text-slate-400 block mb-1">条目名称 (Label)</span>
            <input
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                onUpdateNode(nodeId, { name: e.target.value });
              }}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-100 font-medium focus:outline-none focus:border-violet-500"
              placeholder="请输入条目名称..."
            />
          </div>

          <button
            onClick={handleSave}
            className="flex items-center space-x-1.5 px-4 py-2 mt-4 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold shadow-md shadow-violet-600/30 transition cursor-pointer active:scale-95"
          >
            <Save className="w-3.5 h-3.5" />
            <span>立即同步</span>
          </button>
        </div>

        {/* 角色与顺序调控参数 */}
        <div className="grid grid-cols-3 gap-3">
          <div>
            <span className="text-[10px] text-slate-400 block mb-1">注入角色 (Role)</span>
            <select
              value={role}
              onChange={(e) => {
                setRole(e.target.value);
                onUpdateNode(nodeId, { role: e.target.value });
              }}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-violet-300 font-mono text-xs focus:outline-none cursor-pointer"
            >
              <option value="system">system</option>
              <option value="user">user</option>
              <option value="assistant">assistant</option>
            </select>
          </div>

          <div>
            <span
              className="text-[10px] text-slate-400 block mb-1"
              title="深度越大越靠前被模型读取"
            >
              插入深度 (Depth)
            </span>
            <input
              type="number"
              value={depth}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10) || 0;
                setDepth(v);
                onUpdateNode(nodeId, { depth: v });
              }}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100 font-mono text-xs focus:outline-none"
            />
          </div>

          <div>
            <span
              className="text-[10px] text-slate-400 block mb-1"
              title="同一深度下数字越小越先执行"
            >
              执行排序 (Order)
            </span>
            <input
              type="number"
              value={order}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10) || 0;
                setOrder(v);
                onUpdateNode(nodeId, { order: v });
              }}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100 font-mono text-xs focus:outline-none"
            />
          </div>
        </div>

        {/* 宽广的大屏幕正文编辑区 */}
        <div className="flex-1 flex flex-col min-h-0 pt-1">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5">
            <span className="font-medium text-slate-300">
              提示词正文模板 (支持 &#123;&#123;char&#125;&#125;, &#123;&#123;user&#125;&#125;
              等宏替换):
            </span>
            <span className="font-mono text-[11px] text-slate-500">{content.length} 字符</span>
          </div>
          <textarea
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
              onUpdateNode(nodeId, { content: e.target.value });
            }}
            className="flex-1 w-full bg-slate-950/90 border border-slate-700/80 rounded-xl p-3 text-xs font-mono text-slate-200 focus:outline-none focus:border-violet-500 resize-none leading-relaxed transition-all placeholder:text-slate-600 shadow-inner"
            placeholder="在此编辑长篇提示词..."
          />
        </div>
      </div>
    </div>
  );
};
