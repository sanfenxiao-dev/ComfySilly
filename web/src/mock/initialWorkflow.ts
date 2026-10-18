import type { Node, Edge } from '@xyflow/react';

export const initialNodes: Node[] = [
  {
    id: 'node-main-prompt',
    type: 'promptBlock',
    position: { x: 50, y: 60 },
    data: {
      name: 'Main System Prompt',
      role: 'system',
      depth: 0,
      order: 0,
      content:
        'Write {{char}}\x27s next response in a fictional roleplay between {{char}} and {{user}}. Stay deeply in character, vivid, engaging and authentic.',
      enabled: true,
    },
  },
  {
    id: 'node-jailbreak',
    type: 'promptBlock',
    position: { x: 50, y: 280 },
    data: {
      name: 'Jailbreak / Style Modifier',
      role: 'system',
      depth: 1,
      order: 100,
      content:
        '[Style: immersive, sensory-rich, psychological depth, nuanced pacing. Do not speak or act on behalf of {{user}}.]',
      enabled: true,
    },
  },
  {
    id: 'node-lorebook',
    type: 'lorebook',
    position: { x: 440, y: 60 },
    data: {
      scanDepth: 5,
      recursive: true,
      entriesCount: 24,
      strategy: 'selective',
    },
  },
  {
    id: 'node-history',
    type: 'historySampler',
    position: { x: 440, y: 280 },
    data: {
      maxMessages: 30,
      maxTokens: 4096,
      reverseOrder: false,
    },
  },
  {
    id: 'node-assembler',
    type: 'assembler',
    position: { x: 840, y: 150 },
    data: {
      mode: 'chatml',
    },
  },
  {
    id: 'node-llm',
    type: 'llmInference',
    position: { x: 1240, y: 150 },
    data: {
      model: 'claude-3-5-sonnet',
      temperature: 0.95,
      topP: 0.9,
    },
  },
];

export const initialEdges: Edge[] = [
  {
    id: 'e-prompt-assembler',
    source: 'node-main-prompt',
    sourceHandle: 'prompt_out',
    target: 'node-assembler',
    targetHandle: 'prompt_in',
    animated: true,
  },
  {
    id: 'e-jailbreak-assembler',
    source: 'node-jailbreak',
    sourceHandle: 'prompt_out',
    target: 'node-assembler',
    targetHandle: 'prompt_in',
    animated: true,
  },
  {
    id: 'e-lore-assembler',
    source: 'node-lorebook',
    sourceHandle: 'lore_out',
    target: 'node-assembler',
    targetHandle: 'lore_in',
    animated: true,
  },
  {
    id: 'e-history-assembler',
    source: 'node-history',
    sourceHandle: 'history_out',
    target: 'node-assembler',
    targetHandle: 'history_in',
    animated: true,
  },
  {
    id: 'e-assembler-llm',
    source: 'node-assembler',
    sourceHandle: 'final_out',
    target: 'node-llm',
    targetHandle: 'prompt_in',
    animated: true,
  },
];
