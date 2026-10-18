import $ from 'jquery';
import _ from 'lodash';
import * as Vue from 'vue/dist/vue.esm-bundler.js';
import * as Zod from 'zod';
import * as Pinia from 'pinia';
import * as YAML from 'yaml';

type Obj = Record<string, any>;
const w = window as unknown as Obj;
const init = w.__COMFY_CARD__ as Obj;
const token = init.token as string;
let snapshot = init.snapshot as Obj;
const listeners = new Map<string, Set<(...args: any[]) => unknown>>();
const pending = new Map<
  string,
  { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
>();
const post = (type: string, data: Obj = {}) =>
  window.parent.postMessage({ channel: 'comfysilly-card-v1', token, type, ...data }, '*');
let lastInteraction = 0;
for (const name of ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart'])
  document.addEventListener(
    name,
    () => {
      if (Date.now() - lastInteraction < 100) return;
      lastInteraction = Date.now();
      post('interaction');
    },
    { capture: true, passive: true },
  );
const rpc = (method: string, args: any[] = []): Promise<any> =>
  new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`宿主调用超时：${method}`));
    }, 180000);
    pending.set(id, { resolve, reject, timer });
    post('call', { id, method, args });
  });
const cardNetworkRequest = async (request: any) => {
  const value = (await rpc('networkRequest', [request])) as {
    status: number;
    headers?: Record<string, string>;
    body: string;
  };
  return new Response(value.body ?? '', { status: value.status, headers: value.headers ?? {} });
};
const nativeFetch = globalThis.fetch?.bind(globalThis);
if (nativeFetch && (window as any).__COMFY_CARD__?.networkProxy) {
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (/^https?:\/\//i.test(url)) {
      const headers: Record<string, string> = {};
      new Headers(init?.headers ?? (typeof input === 'object' && 'headers' in input ? input.headers : undefined)).forEach((v, k) => (headers[k] = v));
      return cardNetworkRequest({ url, method: init?.method ?? 'GET', headers, body: typeof init?.body === 'string' ? init.body : undefined });
    }
    return nativeFetch(input, init);
  }) as typeof fetch;
}
class CardXMLHttpRequest {
  method = 'GET'; url = ''; async = true; status = 0; readyState = 0; responseText = ''; response = '';
  onload: (() => void) | null = null; onerror: (() => void) | null = null; onreadystatechange: (() => void) | null = null;
  private headers: Record<string, string> = {};
  open(method: string, url: string, async = true) { this.method = method; this.url = url; this.async = async; this.readyState = 1; this.onreadystatechange?.(); }
  setRequestHeader(name: string, value: string) { this.headers[name] = value; }
  send(body?: string) { void cardNetworkRequest({ url: this.url, method: this.method, headers: this.headers, body }).then((r) => { this.status = r.status; return r.text(); }).then((text) => { this.responseText = text; this.response = text; this.readyState = 4; this.onreadystatechange?.(); this.onload?.(); }).catch(() => { this.readyState = 4; this.onreadystatechange?.(); this.onerror?.(); }); }
  abort() {}
  getAllResponseHeaders() { return ''; }
}
if ((window as any).__COMFY_CARD__?.networkProxy) (globalThis as any).XMLHttpRequest = CardXMLHttpRequest;
let lastReportedError = '';
let lastReportedAt = 0;
const report = (error: unknown) => {
  const message = String(error).slice(0, 3000);
  const now = Date.now();
  // jQuery ajaxError + window.onerror commonly report the same failed request
  // in the same tick. Do not turn one network failure into a wall of duplicates.
  if (message === lastReportedError && now - lastReportedAt < 1500) return;
  lastReportedError = message;
  lastReportedAt = now;
  post('error', { message });
};
const clone = <T>(v: T): T => structuredClone(v);
const eventOn = (name: string, fn: (...a: any[]) => unknown) => {
  if (!listeners.has(name)) listeners.set(name, new Set());
  listeners.get(name)!.add(fn);
  return { stop: () => listeners.get(name)?.delete(fn) };
};
const eventRemoveListener = (name: string, fn: (...a: any[]) => unknown) =>
  listeners.get(name)?.delete(fn);
const eventOnce = (name: string, fn: (...a: any[]) => unknown) => {
  const cb = (...args: any[]) => {
    eventRemoveListener(name, cb);
    return fn(...args);
  };
  return eventOn(name, cb);
};
const emissionQueues = new Map<string, Promise<unknown>>();
const eventEmit = (name: string, ...args: any[]) => {
  const next = (emissionQueues.get(name) ?? Promise.resolve())
    .catch(() => {})
    .then(() => rpc('eventEmit', [name, args]));
  emissionQueues.set(name, next);
  void next
    .finally(() => {
      if (emissionQueues.get(name) === next) emissionQueues.delete(name);
    })
    .catch(() => {});
  return next;
};
async function dispatch(name: string, args: any[]) {
  for (const fn of [...(listeners.get(name) ?? [])])
    try {
      await fn(...args);
    } catch (error) {
      report(error);
    }
}
window.addEventListener('message', (event) => {
  if (
    event.source !== window.parent ||
    event.data?.channel !== 'comfysilly-card-v1' ||
    event.data.token !== token
  )
    return;
  const data = event.data;
  if (data.type === 'result') {
    const item = pending.get(data.id);
    if (item) {
      clearTimeout(item.timer);
      pending.delete(data.id);
      if (data.error) item.reject(new Error(data.error));
      else item.resolve(data.value);
    }
  }
  if (data.type === 'snapshot') snapshot = data.snapshot;
  if (data.type === 'variable' && typeof data.key === 'string' && data.value)
    snapshot.variables[data.key] = data.value;
  if (data.type === 'event')
    void dispatch(data.name, data.args ?? []).finally(() => post('eventDone', { id: data.id }));
});
function scope(option: Obj = { type: 'chat' }): string {
  switch (option.type ?? 'chat') {
    case 'message': {
      let n = option.message_id ?? init.messageId ?? 'latest';
      if (n === 'latest') n = snapshot.messages.length - 1;
      if (n < 0) n = snapshot.messages.length + n;
      if (!Number.isInteger(n) || n < 0 || n >= snapshot.messages.length)
        throw new Error('消息变量楼层越界');
      return `message:${n}`;
    }
    case 'script':
      return `script:${option.script_id ?? w.__currentScriptId ?? 'default'}`;
    case 'extension':
      return `extension:${option.extension_id ?? 'default'}`;
    case 'global':
    case 'preset':
    case 'character':
    case 'chat':
      return option.type ?? 'chat';
    default:
      throw new Error(`未支持的变量作用域：${option.type}`);
  }
}
const getVariables = (option?: Obj) => clone(snapshot.variables[scope(option)] ?? {});
const replaceVariables = (value: Obj, option?: Obj) => {
  const key = scope(option);
  snapshot.variables[key] = clone(value);
  return rpc('replaceVariables', [key, value]).catch((error) => {
    report(error);
    throw error;
  });
};
const updateVariablesWith = (fn: (v: Obj) => Obj | Promise<Obj>, option?: Obj) => {
  const result = fn(getVariables(option));
  if (result && typeof (result as Promise<Obj>).then === 'function')
    return Promise.resolve(result).then((v) => {
      replaceVariables(v, option);
      return v;
    });
  replaceVariables(result as Obj, option);
  return result;
};
function getChatMessages(range: number | string = '0-{{lastMessageId}}', options: Obj = {}) {
  const count = snapshot.messages.length;
  const normalized = String(range).replace(/\{\{lastMessageId\}\}/gi, String(count - 1));
  let start: number, end: number;
  if (/^\d+-\d+$/.test(normalized)) {
    [start, end] = normalized.split('-').map(Number);
  } else {
    start = Number(normalized);
    if (start < 0) start = count + start;
    end = start;
  }
  if (!Number.isInteger(start) || !Number.isInteger(end)) throw new Error('不支持的消息范围');
  return clone(
    snapshot.messages
      .slice(Math.max(0, start), Math.min(count, end + 1))
      .filter(
        (m: Obj) =>
          (!options.role || options.role === 'all' || m.role === options.role) &&
          (!options.hide_state ||
            options.hide_state === 'all' ||
            (options.hide_state === 'hidden') === m.is_hidden),
      ),
  );
}
const setChatMessages = (messages: Obj[], options?: Obj) => {
  for (const patch of messages) {
    const message = snapshot.messages[patch.message_id];
    if (message && typeof patch.message === 'string') message.message = patch.message;
  }
  return rpc('setChatMessages', [messages, options]);
};
const createChatMessages = (messages: Obj[], options?: Obj) =>
  rpc('createChatMessages', [messages, options]);
const getLastMessageId = () => snapshot.messages.length - 1;
const getCurrentMessageId = () => init.messageId ?? getLastMessageId();
const substituteParams = (text: string) =>
  text.replace(
    /\{\{(char|user|lastMessageId|lastMessage)\}\}/gi,
    (_, key: string) =>
      ({
        char: snapshot.character.name,
        user: snapshot.userName || '用户',
        lastmessageid: String(getLastMessageId()),
        lastmessage: snapshot.messages.at(-1)?.message ?? '',
      })[key.toLowerCase()] ?? '',
  );
const context = () => ({
  chat: snapshot.messages.map((m: Obj) => ({
    name: m.name,
    mes: m.message,
    is_user: m.role === 'user',
    is_system: m.role === 'system',
    extra: m.extra ?? {},
  })),
  chatMetadata: getVariables({ type: 'chat' }),
  name1: snapshot.userName || '用户',
  name2: snapshot.character.name,
  characterId: snapshot.character.id,
  characters: [snapshot.character],
  eventSource: {
    on: eventOn,
    once: eventOnce,
    removeListener: eventRemoveListener,
    emit: eventEmit,
  },
  saveChat: () => rpc('flush'),
  saveMetadata: () => rpc('flush'),
});
const tavern_events = {
  CHAT_CHANGED: 'chat_id_changed',
  MESSAGE_SENT: 'message_sent',
  MESSAGE_RECEIVED: 'message_received',
  MESSAGE_UPDATED: 'message_updated',
  MESSAGE_EDITED: 'message_edited',
  MESSAGE_SWIPED: 'message_swiped',
  MESSAGE_DELETED: 'message_deleted',
  GENERATION_STARTED: 'generation_started',
  GENERATION_ENDED: 'generation_ended',
  CHARACTER_MESSAGE_RENDERED: 'character_message_rendered',
  USER_MESSAGE_RENDERED: 'user_message_rendered',
  APP_READY: 'app_ready',
};
const iframe_events = {
  MESSAGE_IFRAME_RENDER_STARTED: 'message_iframe_render_started',
  MESSAGE_IFRAME_RENDER_ENDED: 'message_iframe_render_ended',
  GENERATION_STARTED: 'js_generation_started',
  GENERATION_ENDED: 'js_generation_ended',
};
const helpers: Obj = {
  getVariables,
  replaceVariables,
  updateVariablesWith,
  getAllVariables: () =>
    _.merge(
      {},
      getVariables({ type: 'global' }),
      getVariables({ type: 'preset' }),
      getVariables({ type: 'character' }),
      getVariables({ type: 'chat' }),
      getVariables({ type: 'message', message_id: getCurrentMessageId() }),
    ),
  insertOrAssignVariables: (v: Obj, o?: Obj) => updateVariablesWith((old) => _.merge(old, v), o),
  insertVariables: (v: Obj, o?: Obj) => updateVariablesWith((old) => _.defaultsDeep(old, v), o),
  deleteVariable: (path: string, o?: Obj) =>
    updateVariablesWith((old) => {
      _.unset(old, path);
      return old;
    }, o),
  eventOn,
  eventOnce,
  eventEmit,
  eventRemoveListener,
  eventClearAll: () => listeners.clear(),
  eventRemoveAllListeners: (name: string) => listeners.delete(name),
  eventMakeLast: eventOn,
  eventMakeFirst: eventOn,
  getChatMessages,
  setChatMessages,
  createChatMessages,
  deleteChatMessages: (ids: number[]) => rpc('deleteChatMessages', [ids]),
  getLastMessageId,
  getCurrentMessageId,
  getScriptId: () => w.__currentScriptId ?? 'comfysilly-background',
  getScriptName: () => w.__currentScriptName ?? '脚本',
  getButtonEvent: (name: string) => `button:${name}`,
  getScriptButtons: () => [],
  replaceScriptButtons: (buttons: Obj[]) => rpc('scriptButtons', [buttons]),
  appendInexistentScriptButtons: (buttons: Obj[]) => rpc('scriptButtons', [buttons]),
  getTavernRegexes: () => clone(snapshot.regexes ?? []),
  replaceTavernRegexes: (rules: Obj[]) => rpc('replaceRegexes', [rules]),
  updateTavernRegexesWith: async (fn: (r: Obj[]) => Obj[] | Promise<Obj[]>) =>
    rpc('replaceRegexes', [await fn(clone(snapshot.regexes ?? []))]),
  getCharWorldbookNames: () => ({
    primary: snapshot.character.lorebook?.name ?? null,
    additional: [],
  }),
  getChatWorldbookName: () => snapshot.character.lorebook?.name ?? null,
  getWorldbook: (name: string) => rpc('getWorldbook', [name]),
  replaceWorldbook: (name: string, entries: Obj[]) => rpc('replaceWorldbook', [name, entries]),
  createWorldbook: (name: string, entries: Obj[]) => rpc('createWorldbook', [name, entries ?? []]),
  createWorldbookEntries: (name: string, entries: Obj[]) =>
    rpc('createWorldbookEntries', [name, entries]),
  updateWorldbookWith: async (name: string, fn: (v: Obj[]) => Obj[] | Promise<Obj[]>) => {
    await rpc('replaceWorldbook', [name, await fn(await rpc('getWorldbook', [name]))]);
    return rpc('getWorldbook', [name]);
  },
  generate: (options: Obj = {}) => rpc('generate', [options]),
  generateRaw: () =>
    Promise.reject(new Error('generateRaw 尚未支持，请使用 generate / triggerSlash')),
  triggerSlash: (command: string) => rpc('triggerSlash', [command]),
  substituteParams,
  // Only this frame's DOM is exposed. Background scripts cannot access host message DOM.
  retrieveDisplayedMessage: (id: number) =>
    init.mode === 'message' && id === getCurrentMessageId() ? $(document.body) : $(),
  formatAsDisplayedMessage: (message: string) => message,
  getSillyTavern: context,
  getContext: context,
  getCharacterName: () => snapshot.character.name,
  waitGlobalInitialized: async (name: string) => {
    const start = Date.now();
    while (!w[name]) {
      if (Date.now() - start > 30000) throw new Error(`等待全局对象超时：${name}`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return w[name];
  },
  registerMacro: () => {
    throw new Error('自定义宏注册尚未支持');
  },
};
Object.assign(w, {
  $,
  jQuery: $,
  _,
  Vue,
  z: Zod,
  Pinia,
  YAML,
  klona: clone,
  ...helpers,
  tavern_events,
  iframe_events,
  TavernHelper: helpers,
  SillyTavern: { getContext: context },
  toastr: Object.fromEntries(
    ['info', 'success', 'warning', 'error'].map((level) => [
      level,
      (message: unknown) => post('toast', { level, message: String(message) }),
    ]),
  ),
});
w.__COMFY_RUNTIME_READY__ = true;
// CDN modules must share the same Vue reactivity graph as the host-provided globals.
const moduleUrls: string[] = [];
const imports: Record<string, string> = {};
for (const [name, namespace] of Object.entries({
  vue: Vue,
  pinia: Pinia,
  zod: Zod,
  lodash: { default: _ },
})) {
  const globalName = { vue: 'Vue', pinia: 'Pinia', zod: 'z', lodash: '_' }[name];
  const names = Object.keys(namespace).filter(
    (key) => key !== 'default' && /^[A-Za-z_$][\w$]*$/.test(key),
  );
  const source =
    names
      .map(
        (key) =>
          `export const ${key}=globalThis[${JSON.stringify(globalName)}][${JSON.stringify(key)}];`,
      )
      .join('\n') + `\nexport default globalThis[${JSON.stringify(globalName)}];`;
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  moduleUrls.push(url);
  imports[name] = url;
  for (const domain of ['testingcf.jsdelivr.net', 'cdn.jsdelivr.net', 'fastly.jsdelivr.net'])
    imports[`https://${domain}/npm/${name}/+esm`] = url;
}
const importMap = document.createElement('script');
importMap.type = 'importmap';
importMap.textContent = JSON.stringify({ imports });
document.head.appendChild(importMap);
$(document).ajaxError((_event, xhr, options, error) =>
  report(`资源加载失败：${options.url ?? 'unknown'} · HTTP ${xhr.status} · ${String(error)}`),
);
window.addEventListener('pagehide', () => moduleUrls.forEach((url) => URL.revokeObjectURL(url)));
// An opaque-origin frame cannot use native Web Storage. This facade stores only card variables.
for (const name of ['localStorage', 'sessionStorage']) {
  const local = new Map<string, string>();
  try {
    Object.defineProperty(window, name, {
      configurable: false,
      value: {
        getItem: (key: string) => local.get(key) ?? null,
        setItem: (key: string, value: unknown) => {
          local.set(key, String(value));
        },
        removeItem: (key: string) => local.delete(key),
        clear: () => local.clear(),
        key: (index: number) => [...local.keys()][index] ?? null,
        get length() {
          return local.size;
        },
      },
    });
  } catch (error) {
    report(error);
  }
}
window.addEventListener(
  'error',
  (event) =>
    report(
      event.message || `资源加载失败：${(event.target as HTMLScriptElement)?.src ?? 'unknown'}`,
    ),
  true,
);
window.addEventListener('unhandledrejection', (event) => report(event.reason));
const resize = () =>
  post('resize', {
    height: Math.min(
      1600,
      Math.max(document.body?.scrollHeight ?? 0, document.documentElement.scrollHeight, 120),
    ),
  });
let resizeTimer: ReturnType<typeof setTimeout> | undefined;
new ResizeObserver(() => {
  if (!resizeTimer)
    resizeTimer = setTimeout(() => {
      resizeTimer = undefined;
      resize();
    }, 80);
}).observe(document.documentElement);
window.addEventListener('pagehide', () => {
  listeners.clear();
  for (const item of pending.values()) {
    clearTimeout(item.timer);
    item.reject(new Error('卡片界面已关闭'));
  }
  pending.clear();
});
$(async () => {
  post('ready');
  resize();
  if (init.mode === 'background') {
    for (const script of init.scripts ?? []) {
      w.__currentScriptId = script.id ?? script.name;
      w.__currentScriptName = script.name;
      try {
        const blob = URL.createObjectURL(
          new Blob([script.content + '\n//# sourceURL=comfysilly-card-script.js'], {
            type: 'text/javascript',
          }),
        );
        try {
          await import(/* @vite-ignore */ blob);
        } finally {
          URL.revokeObjectURL(blob);
        }
        post('scriptLoaded', { name: script.name });
      } catch (error) {
        report(`${script.name}: ${String(error)}`);
      }
    }
    post('backgroundReady');
  } else {
    await dispatch(iframe_events.MESSAGE_IFRAME_RENDER_ENDED, [getCurrentMessageId()]);
    post('rendered', { messageId: getCurrentMessageId() });
  }
});
