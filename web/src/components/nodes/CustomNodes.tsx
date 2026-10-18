import { memo, useCallback, useContext } from 'react';
import { RegexNodeActions } from '../RegexImportDialog';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { PromptBlockData } from '../../types/flow';
import {
  BookOpen,
  Layers,
  Terminal,
  Sparkles,
  Sliders,
  ChevronDown,
  ChevronRight,
  Hash,
  Regex,
  Plus,
  Trash2,
  Edit2,
  ArrowUp,
  ArrowDown,
  Upload,
} from 'lucide-react';

export const PromptBlockNode = memo(({ id, data, selected }: NodeProps) => {
  const d = data as PromptBlockData;

  const handleToggle = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (typeof d.onToggle === 'function') {
        d.onToggle(id, !d.enabled);
      }
    },
    [id, d],
  );

  const handleContentChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      if (typeof d.onUpdate === 'function') {
        d.onUpdate(id, { content: e.target.value });
      }
    },
    [id, d],
  );

  const handleDepthChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = parseInt(e.target.value, 10);
      if (!isNaN(val) && typeof d.onUpdate === 'function') {
        d.onUpdate(id, { depth: val });
      }
    },
    [id, d],
  );

  const handleOrderChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = parseInt(e.target.value, 10);
      if (!isNaN(val) && typeof d.onUpdate === 'function') {
        d.onUpdate(id, { order: val });
      }
    },
    [id, d],
  );

  const handleRoleChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      if (typeof d.onUpdate === 'function') {
        d.onUpdate(id, { role: e.target.value as any });
      }
    },
    [id, d],
  );

  const handleToggleExpand = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (typeof d.onUpdate === 'function') {
        d.onUpdate(id, { collapsed: !d.collapsed });
      }
    },
    [id, d],
  );

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.stopPropagation();
  }, []);

  return (
    <div
      className={`relative w-88 rounded-xl bg-slate-900/95 border transition-all duration-200 shadow-xl overflow-visible nowheel nopan ${
        selected
          ? 'border-violet-500 shadow-violet-500/20 ring-2 ring-violet-500/30'
          : 'border-slate-800 hover:border-slate-700'
      }`}
    >
      <div className="flex items-center justify-between px-3 py-2 bg-slate-950/90 border-b border-slate-800/80">
        <div className="flex items-center space-x-2 flex-1 min-w-0 pr-2">
          <button
            onClick={handleToggleExpand}
            className="text-slate-400 hover:text-slate-200 cursor-pointer p-0.5"
            title={d.collapsed ? '展开内容' : '收起内容'}
          >
            {d.collapsed ? (
              <ChevronRight className="w-3.5 h-3.5" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" />
            )}
          </button>

          <span className="flex items-center gap-0.5 text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-300 border border-violet-500/30">
            <Hash className="w-2.5 h-2.5" />
            {d.calcIndex ?? d.order}
          </span>

          <span className="text-xs font-semibold text-slate-200 truncate" title={d.name}>
            {d.name || 'Prompt Block'}
          </span>
        </div>

        <button
          onClick={handleToggle}
          className="relative inline-flex h-4 w-7 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out bg-violet-600"
          title="点击在画布中隐藏此条目"
        >
          <span className="pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out translate-x-3" />
        </button>
      </div>

      <div className="px-3 py-2 bg-slate-950/50 border-b border-slate-800/60 grid grid-cols-3 gap-2 text-[11px]">
        <div className="flex flex-col space-y-0.5">
          <span className="text-slate-500 text-[10px]">角色 (Role)</span>
          <select
            value={d.role || 'system'}
            onChange={handleRoleChange}
            className="bg-slate-900 border border-slate-700/80 rounded px-1.5 py-0.5 text-violet-300 font-mono text-[11px] focus:outline-none focus:border-violet-500 cursor-pointer"
          >
            <option value="system">system</option>
            <option value="user">user</option>
            <option value="assistant">assistant</option>
          </select>
        </div>

        <div className="flex flex-col space-y-0.5" title="深度: 0=历史最后, 4=倒数第4条">
          <span className="text-slate-500 text-[10px]">插入深度 (D)</span>
          <input
            type="number"
            defaultValue={d.depth ?? 0}
            onBlur={handleDepthChange}
            className="bg-slate-900 border border-slate-700/80 rounded px-1.5 py-0.5 text-slate-200 font-mono text-[11px] focus:outline-none focus:border-violet-500 w-full"
          />
        </div>

        <div className="flex flex-col space-y-0.5" title="同一深度下的执行权重先后">
          <span className="text-slate-500 text-[10px]">先后顺序 (O)</span>
          <input
            type="number"
            defaultValue={d.order ?? 100}
            onBlur={handleOrderChange}
            className="bg-slate-900 border border-slate-700/80 rounded px-1.5 py-0.5 text-slate-200 font-mono text-[11px] focus:outline-none focus:border-violet-500 w-full"
          />
        </div>
      </div>

      {!d.collapsed && (
        <div className="p-3" onWheel={handleWheel}>
          <div className="flex items-center justify-between text-[10px] text-slate-500 mb-1 font-mono">
            <span>滚轮上下滑动翻阅</span>
            <span>{(d.content || '').length} 字符</span>
          </div>
          <textarea
            defaultValue={d.content}
            onBlur={handleContentChange}
            rows={7}
            className="w-full text-xs font-mono bg-slate-950/90 border border-slate-800 rounded-lg p-2.5 text-slate-200 focus:outline-none focus:border-violet-500 resize-y leading-relaxed transition-all nodrag nowheel overflow-y-auto"
            placeholder="提示词内容模板..."
          />
        </div>
      )}

      <Handle
        type="target"
        position={Position.Left}
        id="prompt_in"
        className="!bg-violet-400 !w-3 !h-3 -ml-1.5"
      />
      <Handle
        type="source"
        position={Position.Right}
        id="prompt_out"
        className="!bg-violet-400 !border-slate-900 !w-3 !h-3 -mr-1.5 shadow-sm shadow-violet-500"
      />
    </div>
  );
});

export const LorebookNode = memo(({ selected }: NodeProps) => {
  return (
    <div
      className={`relative w-80 rounded-xl bg-slate-900/95 border transition-all duration-200 shadow-xl overflow-hidden ${
        selected
          ? 'border-amber-500 shadow-amber-500/25 ring-2 ring-amber-500/30'
          : 'border-slate-800 hover:border-slate-700'
      }`}
    >
      <div className="flex items-center justify-between px-3.5 py-2.5 bg-slate-950 border-b border-slate-800">
        <div className="flex items-center space-x-2">
          <div className="p-1 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <BookOpen className="w-3.5 h-3.5" />
          </div>
          <span className="text-xs font-semibold text-slate-200">WorldBook (世界书触发)</span>
        </div>
        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/20 text-amber-300">
          Auto
        </span>
      </div>

      <div className="p-3 space-y-2 text-xs text-slate-300">
        <div className="flex items-center justify-between text-[11px] text-slate-400">
          <span>触发方式:</span>
          <span className="font-mono text-amber-400">由对话编译器管理</span>
        </div>
        <div className="p-2 rounded bg-amber-950/20 border border-amber-500/20 flex items-center justify-between">
          <span className="text-[11px] text-amber-200/90 flex items-center gap-1.5">
            <Sparkles className="w-3 h-3 text-amber-400" /> 激活结果
          </span>
          <span className="font-mono text-amber-400 font-semibold">查看实际提示词</span>
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        id="lore_out"
        className="!bg-amber-400 !border-slate-900 !w-3 !h-3 -mr-1.5"
      />
    </div>
  );
});

export const HistorySamplerNode = memo(({ selected }: NodeProps) => {
  return (
    <div
      className={`relative w-80 rounded-xl bg-slate-900/95 border transition-all duration-200 shadow-xl overflow-hidden ${
        selected
          ? 'border-cyan-500 shadow-cyan-500/25 ring-2 ring-cyan-500/30'
          : 'border-slate-800 hover:border-slate-700'
      }`}
    >
      <div className="flex items-center justify-between px-3.5 py-2.5 bg-slate-950 border-b border-slate-800">
        <div className="flex items-center space-x-2">
          <div className="p-1 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
            <Layers className="w-3.5 h-3.5" />
          </div>
          <span className="text-xs font-semibold text-slate-200">Chat History (历史采样)</span>
        </div>
        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-400">
          结构示意
        </span>
      </div>

      <div className="p-3 text-xs text-slate-300">
        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <div className="bg-slate-950/60 p-2 rounded border border-slate-800">
            <div className="text-slate-500">上下文来源</div>
            <div className="font-mono text-cyan-400 font-semibold mt-0.5">当前会话</div>
          </div>
          <div className="bg-slate-950/60 p-2 rounded border border-slate-800">
            <div className="text-slate-500">预算校验</div>
            <div className="font-mono text-cyan-400 font-semibold mt-0.5">以预设为准</div>
          </div>
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        id="history_out"
        className="!bg-cyan-400 !border-slate-900 !w-3 !h-3 -mr-1.5"
      />
    </div>
  );
});

export const AssemblerNode = memo(({ data, selected }: NodeProps) => {
  const d = data as any;
  return (
    <div
      className={`relative w-84 rounded-xl bg-slate-900/95 border transition-all duration-200 shadow-xl overflow-hidden ${
        selected
          ? 'border-emerald-500 shadow-emerald-500/25 ring-2 ring-emerald-500/30'
          : 'border-slate-800 hover:border-slate-700'
      }`}
    >
      <div className="flex items-center justify-between px-3.5 py-2.5 bg-slate-950 border-b border-slate-800">
        <div className="flex items-center space-x-2">
          <div className="p-1 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <Terminal className="w-3.5 h-3.5" />
          </div>
          <span className="text-xs font-semibold text-slate-200">
            Pipeline Assembler (预设总装)
          </span>
        </div>
        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300">
          ChatML
        </span>
      </div>

      <div className="p-3 space-y-2 text-xs text-slate-300">
        <div className="text-[11px] text-slate-400 flex justify-between">
          <span>排序依据:</span>
          <span className="text-emerald-400 font-mono font-medium">左侧条目 / prompt_order</span>
        </div>
        <div className="p-2 rounded bg-emerald-950/20 border border-emerald-500/20 flex items-center justify-between">
          <span className="text-[11px] text-emerald-200/90">当前渲染激活提示词:</span>
          <span className="font-mono text-emerald-400 font-bold">{d.enabledCount ?? 0} 条</span>
        </div>
      </div>

      <Handle
        type="target"
        position={Position.Left}
        id="prompt_in"
        className="!bg-violet-400 !border-slate-900 !w-3 !h-3 -ml-1.5"
      />
      <Handle
        type="source"
        position={Position.Right}
        id="final_out"
        className="!bg-emerald-400 !border-slate-900 !w-3 !h-3 -mr-1.5"
      />
    </div>
  );
});

export const LlmInferenceNode = memo(({ data, selected }: NodeProps) => {
  const d = data as any;

  const handleChange = (key: string, val: any) => {
    if (typeof d.onUpdate === 'function') {
      d.onUpdate('node-llm-engine', { [key]: val });
    }
  };

  return (
    <div
      className={`relative w-84 rounded-xl bg-slate-900/95 border transition-all duration-200 shadow-xl overflow-hidden ${
        selected
          ? 'border-rose-500 shadow-rose-500/25 ring-2 ring-rose-500/30'
          : 'border-slate-800 hover:border-slate-700'
      }`}
    >
      <div className="flex items-center justify-between px-3.5 py-2.5 bg-slate-950 border-b border-slate-800">
        <div className="flex items-center space-x-2">
          <div className="p-1 rounded bg-rose-500/10 text-rose-400 border border-rose-500/20">
            <Sliders className="w-3.5 h-3.5" />
          </div>
          <span className="text-xs font-semibold text-slate-200">LLM Engine (推理生成)</span>
        </div>
        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300">
          设置中的连接
        </span>
      </div>

      <div className="p-3 space-y-2.5 text-xs text-slate-300">
        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <div className="bg-slate-950/60 p-2 rounded border border-slate-800 flex flex-col space-y-1">
            <span className="text-slate-400">Temperature</span>
            <input
              type="number"
              step="0.01"
              defaultValue={d.temperature ?? 1.0}
              onChange={(e) => handleChange('temperature', parseFloat(e.target.value))}
              className="bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-rose-400 font-mono text-xs"
            />
          </div>
          <div className="bg-slate-950/60 p-2 rounded border border-slate-800 flex flex-col space-y-1">
            <span className="text-slate-400">Top P</span>
            <input
              type="number"
              step="0.01"
              defaultValue={d.topP ?? 0.95}
              onChange={(e) => handleChange('topP', parseFloat(e.target.value))}
              className="bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-rose-400 font-mono text-xs"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <div className="bg-slate-950/60 p-2 rounded border border-slate-800 flex flex-col space-y-1">
            <span className="text-slate-400">Max Tokens</span>
            <input
              type="number"
              defaultValue={d.maxTokens ?? 4096}
              onChange={(e) => handleChange('maxTokens', parseInt(e.target.value, 10))}
              className="bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-rose-400 font-mono text-xs"
            />
          </div>
          <div className="bg-slate-950/60 p-2 rounded border border-slate-800 flex flex-col space-y-1">
            <span className="text-slate-400">Rep Penalty</span>
            <input
              type="number"
              step="0.05"
              defaultValue={d.repPenalty ?? 1.0}
              onChange={(e) => handleChange('repPenalty', parseFloat(e.target.value))}
              className="bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-rose-400 font-mono text-xs"
            />
          </div>
        </div>
      </div>

      <Handle
        type="target"
        position={Position.Left}
        id="prompt_in"
        className="!bg-emerald-400 !border-slate-900 !w-3 !h-3 -ml-1.5"
      />
      <Handle
        type="source"
        position={Position.Right}
        id="stream_out"
        className="!bg-rose-400 !border-slate-900 !w-3 !h-3 -mr-1.5"
      />
    </div>
  );
});

/// 🌟 专门处理“预设绑定正则（Regex Filter）”的管线节点 (支持自由上移/下移调序、自由编辑、增删规则、开关规则！)
export const RegexFilterNode = memo(({ id, data, selected }: NodeProps) => {
  const d = data as any;
  const regexList: any[] = d.regexList || [];
  const actions = useContext(RegexNodeActions);
  const pipelineIndex = actions.order.indexOf(id) + 1;

  const handleToggleRule = useCallback(
    (idx: number) => {
      const updated = [...regexList];
      updated[idx] = { ...updated[idx], disabled: !updated[idx].disabled };
      if (typeof d.onUpdate === 'function') {
        d.onUpdate(id, { regexList: updated });
      }
    },
    [regexList, d],
  );

  const handleDeleteRule = useCallback(
    (idx: number) => {
      const updated = regexList.filter((_, i) => i !== idx);
      if (typeof d.onUpdate === 'function') {
        d.onUpdate(id, { regexList: updated });
      }
    },
    [regexList, d],
  );

  // 🌟 正则规则顺序上移/下移调序
  const handleMoveRule = useCallback(
    (idx: number, direction: 'up' | 'down') => {
      const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (targetIdx < 0 || targetIdx >= regexList.length) return;
      const updated = [...regexList];
      const [moved] = updated.splice(idx, 1);
      updated.splice(targetIdx, 0, moved);
      if (typeof d.onUpdate === 'function') {
        d.onUpdate(id, { regexList: updated });
      }
    },
    [regexList, d],
  );

  const handleAddRule = useCallback(() => {
    const newRule = {
      id: crypto.randomUUID(),
      scriptName: '新正则规则',
      findRegex: '/(待匹配文本)/g',
      replaceString: '$1',
      disabled: false,
    };
    if (typeof d.onUpdate === 'function') {
      d.onUpdate(id, { regexList: [...regexList, newRule] });
    }
  }, [regexList, d]);

  const handleUpdateRuleText = useCallback(
    (idx: number, field: string, value: string) => {
      const updated = [...regexList];
      updated[idx] = { ...updated[idx], [field]: value };
      if (typeof d.onUpdate === 'function') {
        d.onUpdate(id, { regexList: updated });
      }
    },
    [regexList, d],
  );

  return (
    <div
      className={`relative w-96 rounded-xl bg-slate-900/95 border transition-all duration-200 shadow-xl overflow-visible nowheel ${
        selected
          ? 'border-teal-500 shadow-teal-500/25 ring-2 ring-teal-500/30'
          : 'border-slate-800 hover:border-slate-700'
      }`}
    >
      <div className="flex items-center justify-between px-3.5 py-2.5 bg-slate-950 border-b border-slate-800">
        <div className="flex items-center space-x-2">
          <div className="p-1 rounded bg-teal-500/10 text-teal-400 border border-teal-500/20">
            <Regex className="w-3.5 h-3.5" />
          </div>
          <span className="text-xs font-semibold text-slate-200">
            正则节点 #{pipelineIndex || '—'}
          </span>
        </div>
        <div className="flex items-center space-x-1.5">
          <button
            className="p-1 rounded text-teal-400 hover:bg-teal-500/20 nodrag"
            title="导入 JSON 到此节点"
            aria-label="导入 JSON 到此节点"
            onClick={(e) => {
              e.stopPropagation();
              actions.onImport(id);
            }}
          >
            <Upload className="w-3.5 h-3.5" />
          </button>
          <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-teal-500/20 text-teal-300">
            {regexList.length} 条
          </span>
          <button
            onClick={handleAddRule}
            className="p-1 rounded text-teal-400 hover:bg-teal-500/20 transition cursor-pointer"
            title="添加新正则规则"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="p-3 space-y-2 text-xs text-slate-300">
        <div className="text-[11px] text-slate-400 flex justify-between">
          <span>执行顺序 #{pipelineIndex || '—'} · 节点内从上到下</span>
          <button className="text-teal-300 nodrag" onClick={() => actions.onImport(id)}>
            导入文件
          </button>
        </div>

        {/* 规则可编辑列表 */}
        <div
          className="max-h-60 overflow-y-auto space-y-2 pr-1"
          onWheel={(e) => e.stopPropagation()}
        >
          {regexList.length === 0 ? (
            <div className="p-4 text-center text-slate-500 text-xs bg-slate-950/40 rounded-lg border border-slate-800">
              此节点暂无规则，点击「导入文件」追加 JSON
            </div>
          ) : (
            regexList.map((r, i) => (
              <div
                key={r._comfysilly_instanceId ?? r.id ?? `${i}:${r.scriptName}`}
                className={`p-2 rounded-lg border transition-all ${
                  r.disabled
                    ? 'bg-slate-950/40 border-slate-850 opacity-60'
                    : 'bg-slate-950/90 border-slate-800 hover:border-teal-500/50'
                }`}
              >
                {/* 规则头：序号、名称、调序、开关、删除 */}
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center space-x-1.5 flex-1 min-w-0 pr-2">
                    <span className="text-[10px] font-mono font-bold px-1 py-0.2 rounded bg-teal-500/20 text-teal-300">
                      #{i + 1}
                    </span>
                    <Edit2 className="w-3 h-3 text-teal-400 flex-shrink-0" />
                    <input
                      type="text"
                      aria-label={`规则 ${i + 1} 名称`}
                      defaultValue={r.scriptName || r.name || `规则 #${i + 1}`}
                      onBlur={(e) => handleUpdateRuleText(i, 'scriptName', e.target.value)}
                      className="bg-transparent text-slate-200 text-xs font-semibold focus:outline-none focus:text-teal-300 truncate w-full"
                    />
                  </div>

                  <div className="flex items-center space-x-1 flex-shrink-0">
                    {/* 🌟 顺序上移 / 下移 */}
                    <button
                      onClick={() => handleMoveRule(i, 'up')}
                      disabled={i === 0}
                      className="p-0.5 rounded text-slate-500 hover:text-teal-300 disabled:opacity-30 cursor-pointer"
                      title="上移此规则"
                    >
                      <ArrowUp className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => handleMoveRule(i, 'down')}
                      disabled={i === regexList.length - 1}
                      className="p-0.5 rounded text-slate-500 hover:text-teal-300 disabled:opacity-30 cursor-pointer"
                      title="下移此规则"
                    >
                      <ArrowDown className="w-3 h-3" />
                    </button>

                    <button
                      onClick={() => handleToggleRule(i)}
                      className={`relative inline-flex h-3.5 w-6 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                        !r.disabled ? 'bg-teal-600' : 'bg-slate-700'
                      }`}
                      title={!r.disabled ? '禁用此规则' : '启用此规则'}
                    >
                      <span
                        className={`pointer-events-none inline-block h-2.5 w-2.5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                          !r.disabled ? 'translate-x-2.5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                    <button
                      onClick={() => handleDeleteRule(i)}
                      className="text-slate-500 hover:text-rose-400 p-0.5 rounded cursor-pointer"
                      title="删除此规则"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
                {r._comfysilly_sourceFile && (
                  <div
                    className="text-[10px] text-slate-500 truncate mb-1"
                    title={r._comfysilly_sourceFile}
                  >
                    来源：{r._comfysilly_sourceFile}
                  </div>
                )}

                {/* 正则表达式 (Find Regex) */}
                <div className="space-y-1 font-mono text-[11px]">
                  <div className="flex items-center space-x-1 bg-slate-900 px-2 py-1 rounded border border-slate-800">
                    <span className="text-teal-400 select-none">Find:</span>
                    <input
                      type="text"
                      aria-label={`规则 ${i + 1} 匹配表达式`}
                      defaultValue={r.findRegex || ''}
                      onBlur={(e) => handleUpdateRuleText(i, 'findRegex', e.target.value)}
                      className="w-full bg-transparent text-slate-300 focus:outline-none"
                      placeholder="/pattern/g"
                    />
                  </div>

                  {/* 替换为 (Replace String) */}
                  <div className="flex items-center space-x-1 bg-slate-900 px-2 py-1 rounded border border-slate-800">
                    <span className="text-indigo-400 select-none">Replace:</span>
                    <input
                      type="text"
                      aria-label={`规则 ${i + 1} 替换内容`}
                      defaultValue={r.replaceString ?? ''}
                      onBlur={(e) => handleUpdateRuleText(i, 'replaceString', e.target.value)}
                      className="w-full bg-transparent text-slate-300 focus:outline-none"
                      placeholder="$1"
                    />
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <Handle
        type="target"
        position={Position.Left}
        id="llm_in"
        className="!bg-rose-400 !border-slate-900 !w-3 !h-3 -ml-1.5"
      />
      <Handle
        type="source"
        position={Position.Right}
        id="filtered_out"
        className="!bg-teal-400 !border-slate-900 !w-3 !h-3 -mr-1.5"
      />
    </div>
  );
});
