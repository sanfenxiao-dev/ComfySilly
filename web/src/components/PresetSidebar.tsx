import React, { useState } from 'react';
import type { Node } from '@xyflow/react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  DragOverlay,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ChevronLeft,
  ChevronRight,
  Search,
  Hash,
  SlidersHorizontal,
  Eye,
  GripVertical,
  Edit3,
} from 'lucide-react';

interface PresetSidebarProps {
  nodes: Node[];
  onToggleNode: (id: string, enabled: boolean) => void;
  onFocusNode: (id: string) => void;
  onOpenEditor: (id: string) => void;
  onReorderList: (draggedId: string, targetId: string) => void;
}

interface SortableItemProps {
  id: string;
  node: Node;
  index: number;
  onToggle: (id: string, enabled: boolean) => void;
  onFocus: (id: string) => void;
  onOpen: (id: string) => void;
}

function SortableItem({ id, node, index, onToggle, onFocus, onOpen }: SortableItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });

  const d = node.data as any;

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
    zIndex: isDragging ? 999 : 'auto',
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={() => onOpen(node.id)}
      className={`group relative flex items-center justify-between p-2 rounded-xl border transition-colors cursor-pointer select-none ${
        d.enabled
          ? 'bg-slate-900/90 border-slate-800 hover:border-violet-500/70 hover:bg-slate-850 shadow-sm'
          : 'bg-slate-950/40 border-slate-850/60 opacity-60 hover:opacity-90'
      }`}
    >
      <div className="flex items-center space-x-2 min-w-0 flex-1 pr-2">
        <button
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
          className="cursor-grab active:cursor-grabbing text-slate-500 hover:text-violet-400 p-1 -ml-1 rounded hover:bg-slate-800 transition"
          title="按住拖拽排序 (支持边缘自动上下滚动)"
        >
          <GripVertical className="w-4 h-4" />
        </button>

        <span className="flex-shrink-0 flex items-center gap-0.5 text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-300 border border-violet-500/20">
          <Hash className="w-2.5 h-2.5" />
          {d.calcIndex ?? index + 1}
        </span>

        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold text-slate-200 truncate group-hover:text-violet-300 transition-colors">
            {d.name || 'Prompt Block'}
          </div>
          <div className="text-[10px] font-mono text-slate-500 flex items-center space-x-1.5">
            <span>{d.role}</span>
            <span>•</span>
            <span>D:{d.depth}</span>
            <span>•</span>
            <span>O:{d.order}</span>
          </div>
        </div>
      </div>

      <div className="flex items-center space-x-1.5 flex-shrink-0">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onOpen(node.id);
          }}
          className="p-1 rounded text-slate-500 hover:text-violet-400 hover:bg-slate-800 transition"
          title="打开独立浮动窗口编辑"
        >
          <Edit3 className="w-3.5 h-3.5" />
        </button>

        <button
          onClick={(e) => {
            e.stopPropagation();
            onFocus(node.id);
          }}
          className="p-1 rounded text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition"
          title="在画布中定位此节点"
        >
          <Eye className="w-3.5 h-3.5" />
        </button>

        {/* 真正的 Switch 开关按钮 */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggle(node.id, !d.enabled);
          }}
          className={`relative inline-flex h-4 w-7 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
            d.enabled ? 'bg-violet-600' : 'bg-slate-700'
          }`}
          title={d.enabled ? '点击禁用该条目' : '点击启用该条目'}
        >
          <span
            className={`pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
              d.enabled ? 'translate-x-3' : 'translate-x-0'
            }`}
          />
        </button>
      </div>
    </div>
  );
}

export const PresetSidebar: React.FC<PresetSidebarProps> = ({
  nodes,
  onToggleNode,
  onFocusNode,
  onOpenEditor,
  onReorderList,
}) => {
  const [isOpen, setIsOpen] = useState<boolean>(true);
  const [filterText, setFilterText] = useState<string>('');
  const [onlyEnabled, setOnlyEnabled] = useState<boolean>(false);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  const promptNodes = nodes.filter((n) => n.type === 'promptBlock');

  const filteredPrompts = promptNodes.filter((n) => {
    const d = n.data as any;
    const matchesText =
      (d.name || '').toLowerCase().includes(filterText.toLowerCase()) ||
      (d.content || '').toLowerCase().includes(filterText.toLowerCase());
    if (onlyEnabled) {
      return matchesText && d.enabled;
    }
    return matchesText;
  });

  const enabledCount = promptNodes.filter((n) => (n.data as any).enabled).length;

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 4,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      onReorderList(active.id as string, over.id as string);
    }
    setActiveDragId(null);
  };

  const activeNode = promptNodes.find((n) => n.id === activeDragId);
  const activeData = activeNode?.data as any;

  return (
    <aside
      className={`relative h-full bg-slate-950/95 border-r border-slate-800 transition-all duration-300 z-20 flex flex-col select-none ${
        isOpen ? 'w-88' : 'w-10'
      }`}
    >
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-800 bg-slate-900/60">
        {isOpen && (
          <div className="flex items-center space-x-2">
            <SlidersHorizontal className="w-4 h-4 text-violet-400" />
            <span className="text-xs font-bold text-slate-200">预设条目编排</span>
            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-violet-500/20 text-violet-300">
              {enabledCount}/{promptNodes.length}
            </span>
          </div>
        )}
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition cursor-pointer mx-auto"
          title={isOpen ? '收起左侧面板' : '展开酒馆条目面板'}
        >
          {isOpen ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
      </div>

      {isOpen && (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="p-2.5 border-b border-slate-800 space-y-2 bg-slate-900/30">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-500" />
              <input
                type="text"
                placeholder="搜索条目名称..."
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700/80 rounded-lg pl-8 pr-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-violet-500 placeholder:text-slate-600"
              />
            </div>

            <div className="flex items-center justify-between text-[11px] text-slate-400 px-0.5">
              <label className="flex items-center space-x-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={onlyEnabled}
                  onChange={(e) => setOnlyEnabled(e.target.checked)}
                  className="rounded border-slate-700 bg-slate-900 text-violet-600 focus:ring-0 cursor-pointer"
                />
                <span>已激活 ({enabledCount})</span>
              </label>
              <span className="text-violet-400/80 text-[10px]">按住手柄支持边缘自动下翻</span>
            </div>
          </div>

          {/* dnd-kit 弹性动画拖拽列表 */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
            {filteredPrompts.length === 0 ? (
              <div className="text-center py-8 text-xs text-slate-500">暂无匹配的预设条目</div>
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={filteredPrompts.map((n) => n.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {filteredPrompts.map((node, index) => (
                    <SortableItem
                      key={node.id}
                      id={node.id}
                      node={node}
                      index={index}
                      onToggle={onToggleNode}
                      onFocus={onFocusNode}
                      onOpen={onOpenEditor}
                    />
                  ))}
                </SortableContext>

                {/* 拖拽时的实体悬浮镜像 */}
                <DragOverlay
                  dropAnimation={{ duration: 200, easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)' }}
                >
                  {activeDragId && activeData ? (
                    <div className="flex items-center justify-between p-2.5 rounded-xl border border-violet-500 bg-slate-900 text-white shadow-2xl scale-105 opacity-95">
                      <div className="flex items-center space-x-2">
                        <GripVertical className="w-4 h-4 text-violet-400" />
                        <span className="text-xs font-bold text-violet-200">
                          #{activeData.calcIndex} {activeData.name}
                        </span>
                      </div>
                      <span className="text-[10px] font-mono text-violet-300 bg-violet-500/20 px-2 py-0.5 rounded">
                        正在调序中...
                      </span>
                    </div>
                  ) : null}
                </DragOverlay>
              </DndContext>
            )}
          </div>
        </div>
      )}
    </aside>
  );
};
