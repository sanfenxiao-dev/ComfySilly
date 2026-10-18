export type TabType = 'preset' | 'chat' | 'worldbook' | 'plugins';

export interface BaseNodeData {
  label: string;
  [key: string]: any;
}

export interface PromptBlockData extends BaseNodeData {
  role: 'system' | 'user' | 'assistant';
  name: string;
  depth: number;
  order: number;
  content: string;
  enabled: boolean;
}

export interface LorebookData extends BaseNodeData {
  scanDepth: number;
  recursive: boolean;
  entriesCount: number;
  strategy: 'constant' | 'selective' | 'vector';
}

export interface HistorySamplerData extends BaseNodeData {
  maxContextTokens: number;
  maxMessages: number;
  reverseOrder: boolean;
}

export interface LlmConfigData extends BaseNodeData {
  model: string;
  temperature: number;
  maxTokens: number;
  topP: number;
  repPenalty: number;
  stream: boolean;
}

export interface AssemblerData extends BaseNodeData {
  mode: 'instruct' | 'chatml' | 'raw';
  totalTokensEstimate?: number;
}
