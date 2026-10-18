import { orderPrompts, withPromptOrder } from './promptCompiler.ts';
import type { Node, Edge } from '@xyflow/react';

export interface SillyPromptItem {
  identifier?: string;
  name?: string;
  role?: string;
  content?: string;
  enabled?: boolean;
  injection_depth?: number;
  injection_order?: number;
  injection_position?: number;
  system_prompt?: boolean;
  marker?: boolean;
  [key: string]: any;
}

export interface SillyPresetJson {
  prompts?: SillyPromptItem[];
  prompt_order?: any[];
  temperature?: number;
  top_p?: number;
  top_k?: number;
  top_a?: number;
  min_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  repetition_penalty?: number;
  openai_max_tokens?: number;
  openai_max_context?: number;
  stream_openai?: boolean;
  impersonation_prompt?: string;
  wi_format?: string;
  scenario_format?: string;
  personality_format?: string;
  extensions?: Record<string, any>;
  [key: string]: any;
}

/**
 * 🌟 360° 全覆盖正则规则提取器：
 * 兼容流派 1: extensions.regex_scripts (图灵/官方酒馆拓展脚本)
 * 兼容流派 2: extensions.regex (标准内置正则)
 * 兼容流派 3: SPreset / 类脑内置 RegexBinding.regexes
 * 兼容流派 4: prompts 里的 regexes-bindings
 */
export function extractRegexRulesFromPreset(preset: SillyPresetJson): any[] {
  let rules: any[] = [];

  // 1. 扫描 extensions.regex_scripts (图灵预设等使用此标准)
  if (preset.extensions && Array.isArray((preset.extensions as any).regex_scripts)) {
    rules.push(...(preset.extensions as any).regex_scripts);
  }

  // 2. 扫描 extensions.regex
  if (preset.extensions && Array.isArray((preset.extensions as any).regex)) {
    rules.push(...(preset.extensions as any).regex);
  }

  // 3. 扫描 extensions 内部任意含有 regex 字眼的数组
  if (preset.extensions && typeof preset.extensions === 'object') {
    Object.keys(preset.extensions).forEach((k) => {
      if (k !== 'regex' && k !== 'regex_scripts' && k.toLowerCase().includes('regex')) {
        const val = (preset.extensions as any)[k];
        if (Array.isArray(val)) {
          rules.push(...val);
        }
      }
    });
  }

  // 4. 扫描 prompts 中的 SPresetSettings / regexes-bindings
  (preset.prompts || []).forEach((p) => {
    if (
      p.content &&
      (p.content.startsWith('{') || p.content.includes('Regex') || p.content.includes('regex'))
    ) {
      try {
        const inner = JSON.parse(p.content);
        if (inner.RegexBinding && Array.isArray(inner.RegexBinding.regexes)) {
          rules.push(...inner.RegexBinding.regexes);
        }
        if (Array.isArray(inner.regexes)) {
          rules.push(...inner.regexes);
        }
        if (Array.isArray(inner.regex_scripts)) {
          rules.push(...inner.regex_scripts);
        }
        if (Array.isArray(inner)) {
          rules.push(...inner);
        }
      } catch {
        // ignore
      }
    }
  });

  return rules;
}

export function convertSillyPresetToGraph(
  preset: SillyPresetJson,
  callbacks?: {
    onToggle?: (id: string, enabled: boolean) => void;
    onUpdate?: (id: string, patch: any) => void;
  },
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // Canvas, sidebar, saved preset and compiled requests use the same canonical order.
  const rawPrompts = orderPrompts(preset);

  // 画布上仅渲染启用的条目
  const enabledPrompts = rawPrompts.filter((p) => p.enabled !== false);

  const nodeWidth = 360;
  const colGap = 80;
  const rowHeight = 160;
  const itemsPerCol = 5;
  const totalCols = Math.max(1, Math.ceil(enabledPrompts.length / itemsPerCol));

  enabledPrompts.forEach((prompt, idx) => {
    const col = Math.floor(idx / itemsPerCol);
    const row = idx % itemsPerCol;

    const nodeId = `prompt-${prompt.identifier || idx}`;
    const x = 60 + col * (nodeWidth + colGap);
    const y = 60 + row * rowHeight;

    nodes.push({
      id: nodeId,
      type: 'promptBlock',
      position: { x, y },
      data: {
        identifier: prompt.identifier,
        calcIndex: idx + 1,
        name: prompt.name || `Prompt #${idx + 1}`,
        role: prompt.role || 'system',
        depth: prompt.injection_depth ?? 0,
        order: prompt.injection_order ?? (idx + 1) * 10,
        position: prompt.injection_position ?? 0,
        content: prompt.content || '',
        enabled: true,
        collapsed: true,
        onToggle: callbacks?.onToggle,
        onUpdate: callbacks?.onUpdate,
      },
    });

    if (idx > 0 && idx % itemsPerCol !== 0) {
      const prevId = `prompt-${enabledPrompts[idx - 1].identifier || idx - 1}`;
      edges.push({
        id: `flow-step-${idx}`,
        source: prevId,
        sourceHandle: 'prompt_out',
        target: nodeId,
        targetHandle: 'prompt_in',
        style: { stroke: '#475569', strokeWidth: 1.5, strokeDasharray: '4 4' },
      });
    }
  });

  const rightX = 80 + totalCols * (nodeWidth + colGap);

  // 1. 上下文历史采样节点
  const historyNodeId = 'node-chat-history';
  nodes.push({
    id: historyNodeId,
    type: 'historySampler',
    position: { x: rightX, y: 60 },
    data: {
      maxMessages: 30,
      maxTokens: preset.openai_max_tokens ?? 4096,
    },
  });

  // 2. 世界书节点
  const lorebookNodeId = 'node-lorebook-scanner';
  nodes.push({
    id: lorebookNodeId,
    type: 'lorebook',
    position: { x: rightX, y: 240 },
    data: {
      scanDepth: 5,
      entriesCount: 0,
    },
  });

  // 3. 预设总装配 Assembler 节点
  const assemblerNodeId = 'node-pipeline-assembler';
  nodes.push({
    id: assemblerNodeId,
    type: 'assembler',
    position: { x: rightX + 400, y: 150 },
    data: {
      totalPrompts: rawPrompts.length,
      enabledCount: enabledPrompts.length,
    },
  });

  // 4. LLM 推理生成引擎节点
  const llmNodeId = 'node-llm-engine';
  nodes.push({
    id: llmNodeId,
    type: 'llmInference',
    position: { x: rightX + 820, y: 150 },
    data: {
      temperature: preset.temperature ?? 1.08,
      topP: preset.top_p ?? 0.98,
      maxTokens: preset.openai_max_tokens ?? 4096,
      repPenalty: preset.repetition_penalty ?? 1.0,
      onUpdate: callbacks?.onUpdate,
    },
  });

  edges.push({
    id: 'e-assembler-llm',
    source: assemblerNodeId,
    sourceHandle: 'final_out',
    target: llmNodeId,
    targetHandle: 'prompt_in',
    animated: true,
    style: { stroke: '#10b981', strokeWidth: 2.5 },
  });

  // 5. 🌟 预设绑定正则（Regex Filter）节点接入
  const regexRules = extractRegexRulesFromPreset(preset);
  const regexNodeId = 'node-regex-filter';
  nodes.push({
    id: regexNodeId,
    type: 'regexFilter',
    position: { x: rightX + 1240, y: 150 },
    data: {
      regexList: regexRules,
      onUpdate: callbacks?.onUpdate,
    },
  });

  edges.push({
    id: 'e-llm-to-regex',
    source: llmNodeId,
    sourceHandle: 'stream_out',
    target: regexNodeId,
    targetHandle: 'llm_in',
    animated: true,
    style: { stroke: '#14b8a6', strokeWidth: 2.5 },
  });

  return { nodes, edges };
}

export function exportGraphToSillyPreset(
  allSourcePrompts: SillyPromptItem[],
  canvasNodes: Node[],
  basePreset?: SillyPresetJson,
): SillyPresetJson {
  const llmNode = canvasNodes.find((n) => n.type === 'llmInference');
  const llmData = (llmNode?.data || {}) as any;

  const regexNode = canvasNodes.find((n) => n.type === 'regexFilter');
  const regexList = (regexNode?.data as any)?.regexList || [];

  const nodeMap = new Map<string, any>();
  canvasNodes.forEach((n) => {
    if (n.type === 'promptBlock') {
      nodeMap.set(n.id, n.data);
    }
  });

  const prompts: SillyPromptItem[] = allSourcePrompts.map((p, idx) => {
    const nodeId = `prompt-${p.identifier || idx}`;
    const updated = nodeMap.get(nodeId);
    if (updated) {
      return {
        ...p,
        name: updated.name,
        role: updated.role,
        content: updated.content,
        injection_depth: updated.depth,
        injection_order: updated.order,
        enabled: updated.enabled,
      };
    }
    return p;
  });

  // 如果原本是 extensions.regex_scripts 则存回 regex_scripts
  const extensions = { ...(basePreset?.extensions || {}) };
  if (extensions.regex_scripts) {
    extensions.regex_scripts = regexList;
  } else {
    extensions.regex = regexList;
  }

  return withPromptOrder(
    {
      ...(basePreset || {}),
      prompts,
      extensions,
      temperature: llmData.temperature ?? basePreset?.temperature ?? 1.0,
      top_p: llmData.topP ?? basePreset?.top_p ?? 0.95,
      repetition_penalty: llmData.repPenalty ?? basePreset?.repetition_penalty ?? 1.0,
      openai_max_tokens: llmData.maxTokens ?? basePreset?.openai_max_tokens ?? 4096,
    },
    prompts,
  );
}
