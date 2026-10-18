export interface ProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  responseFormat: 'openai' | 'claude' | 'gemini';
  thinkingLevel: 'off' | 'low' | 'medium' | 'high';
  temperature: number;
}
export interface Persona {
  id: string;
  name: string;
  description: string;
  avatar?: string;
}
export interface Preferences {
  theme: 'dark' | 'light';
  chatLayout: 'centered' | 'bubbles' | 'compact';
  motion: 'full' | 'reduced' | 'off';
  messageWidth: number;
  fontSize: number;
  showTimestamps: boolean;
  autoScroll: boolean;
  visibleMessageCount: number;
  sendKey: 'enter' | 'ctrl-enter';
}
export interface MemorySettings {
  enabled: boolean;
  providerId: string;
  triggerEveryTurns: number;
  recentMessages: number;
  maxMemoryChars: number;
  batchChars: number;
  maxOutputTokens: number;
}
export interface AppSettings {
  activeProviderId: string;
  providers: ProviderConfig[];
  personas?: Persona[];
  activePersonaId?: string;
  preferences?: Partial<Preferences>;
  memory?: Partial<MemorySettings>;
  [key: string]: unknown;
}
export const defaultPreferences: Preferences = {
  theme: 'dark',
  chatLayout: 'centered',
  motion: 'full',
  messageWidth: 880,
  fontSize: 16,
  showTimestamps: false,
  autoScroll: true,
  visibleMessageCount: 80,
  sendKey: 'enter',
};
export const defaultPersona: Persona = { id: 'user-default', name: '用户', description: '' };
export const defaultMemorySettings: MemorySettings = {
  enabled: false,
  providerId: '',
  triggerEveryTurns: 1,
  recentMessages: 12,
  maxMemoryChars: 12000,
  batchChars: 16000,
  maxOutputTokens: 4096,
};
export const providerTemplates: ProviderConfig[] = [
  {
    id: 'openai-default',
    name: 'OpenAI 兼容',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: '',
    responseFormat: 'openai',
    thinkingLevel: 'off',
    temperature: 1,
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    apiKey: '',
    model: '',
    responseFormat: 'claude',
    thinkingLevel: 'off',
    temperature: 1,
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    apiKey: '',
    model: '',
    responseFormat: 'gemini',
    thinkingLevel: 'off',
    temperature: 1,
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKey: '',
    model: '',
    responseFormat: 'openai',
    thinkingLevel: 'off',
    temperature: 1,
  },
];
export function preferencesOf(settings?: AppSettings): Preferences {
  const p = { ...defaultPreferences, ...settings?.preferences };
  return {
    ...p,
    theme: p.theme === 'light' ? 'light' : 'dark',
    sendKey: p.sendKey === 'ctrl-enter' ? 'ctrl-enter' : 'enter',
    autoScroll: p.autoScroll !== false,
    showTimestamps: p.showTimestamps === true,
    visibleMessageCount: bounded(p.visibleMessageCount, 10, 500, 80),
    chatLayout: ['centered', 'bubbles', 'compact'].includes(p.chatLayout)
      ? p.chatLayout
      : 'centered',
    motion: ['full', 'reduced', 'off'].includes(p.motion) ? p.motion : 'full',
    messageWidth: Math.max(620, Math.min(1200, Number(p.messageWidth) || 880)),
    fontSize: Math.max(13, Math.min(22, Number(p.fontSize) || 16)),
  };
}
export function personasOf(settings?: AppSettings): Persona[] {
  const personas = Array.isArray(settings?.personas)
    ? settings.personas
        .filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string')
        .map((p) => ({
          ...p,
          description: typeof p.description === 'string' ? p.description : '',
          avatar: typeof p.avatar === 'string' ? p.avatar : undefined,
        }))
    : [];
  return personas.length ? personas : [defaultPersona];
}
export function personaOf(settings?: AppSettings): Persona {
  const list = personasOf(settings);
  return list.find((p) => p.id === settings?.activePersonaId) ?? list[0];
}
export function memoryOf(settings?: AppSettings): MemorySettings {
  const raw = { ...defaultMemorySettings, ...settings?.memory };
  return {
    enabled: raw.enabled === true,
    providerId: typeof raw.providerId === 'string' ? raw.providerId : '',
    triggerEveryTurns: bounded(raw.triggerEveryTurns, 1, 10, 1),
    recentMessages: bounded(raw.recentMessages, 6, 200, 12),
    maxMemoryChars: bounded(raw.maxMemoryChars, 1000, 20000, 12000),
    batchChars: bounded(raw.batchChars, 4000, 40000, 16000),
    maxOutputTokens: bounded(raw.maxOutputTokens, 2048, 8192, 4096),
  };
}
function bounded(value: unknown, min: number, max: number, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.floor(Math.max(min, Math.min(max, n))) : fallback;
}
export function normalizeSettings(settings?: AppSettings): AppSettings {
  const valid = Array.isArray(settings?.providers)
    ? settings.providers.filter((p) => p && typeof p.id === 'string')
    : [];
  const providers = valid.length
    ? valid.map((p) => ({ ...providerTemplates[0], ...p }))
    : [providerTemplates[0]];
  const personas = personasOf(settings);
  return {
    ...settings,
    providers,
    activeProviderId: providers.some((p) => p.id === settings?.activeProviderId)
      ? settings!.activeProviderId
      : providers[0].id,
    personas,
    activePersonaId: personaOf(settings).id,
    preferences: preferencesOf(settings),
    memory: memoryOf(settings),
  };
}
export function applyPreferences(p: Preferences) {
  document.documentElement.dataset.theme = p.theme;
  document.documentElement.dataset.motion = p.motion;
  document.documentElement.style.setProperty('--reader-width', `${p.messageWidth}px`);
  document.documentElement.style.setProperty('--reader-font', `${p.fontSize}px`);
}
export async function readAvatar(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type))
    throw new Error('请选择 PNG、JPG、WebP 或 GIF 图片');
  if (file.size > 8 * 1024 * 1024) throw new Error('头像不能超过 8 MB');
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('头像读取失败'));
    reader.readAsDataURL(file);
  });
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('无法解码头像'));
    img.src = data;
  });
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法处理头像');
  const side = Math.min(image.width, image.height);
  ctx.drawImage(
    image,
    (image.width - side) / 2,
    (image.height - side) / 2,
    side,
    side,
    0,
    0,
    256,
    256,
  );
  return canvas.toDataURL('image/webp', 0.88);
}
