import runtimeSource from '../generated/card-runtime.js?raw';
import { invoke } from '@tauri-apps/api/core';
export interface RuntimeMessage {
  message_id: number;
  role: string;
  name: string;
  message: string;
  data: Record<string, unknown>;
  extra: Record<string, unknown>;
  is_hidden: boolean;
}
export interface RuntimeSnapshot {
  userName?: string;
  character: Record<string, any>;
  messages: RuntimeMessage[];
  variables: Record<string, Record<string, unknown>>;
  regexes: unknown[];
}
interface Frame {
  window: Window;
  token: string;
  onResize: (height: number) => void;
  onError: (message: string) => void;
}
export class CardBridge {
  private frames = new Map<string, Frame>();
  private globals = new Map<string, { owner: string; descriptor: any }>();
  private globalCalls = new Map<
    string,
    {
      owner: string;
      resolve: (v: any) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private acknowledgements = new Map<
    string,
    { remaining: Set<string>; resolve: () => void; timer: ReturnType<typeof setTimeout> }
  >();
  snapshot: RuntimeSnapshot;
  getSnapshot = (): RuntimeSnapshot => this.snapshot;
  onCall: (method: string, args: any[]) => Promise<any> = async () => {
    throw new Error('运行环境尚未就绪');
  };
  onNotice: (text: string) => void = () => {};
  onInteraction: () => void = () => {};
  constructor(snapshot: RuntimeSnapshot) {
    this.snapshot = snapshot;
  }
  start() {
    window.addEventListener('message', this.receive);
  }
  destroy() {
    window.removeEventListener('message', this.receive);
    this.frames.clear();
    this.globals.clear();
    for (const call of this.globalCalls.values()) {
      clearTimeout(call.timer);
      call.reject(new Error('卡片已关闭'));
    }
    this.globalCalls.clear();
    for (const a of this.acknowledgements.values()) {
      clearTimeout(a.timer);
      a.resolve();
    }
    this.acknowledgements.clear();
  }
  register(id: string, frame: Frame) {
    this.frames.set(id, frame);
    return () => {
      this.frames.delete(id);
      for (const [name, global] of this.globals) if (global.owner === id) this.globals.delete(name);
      for (const [callId, call] of this.globalCalls)
        if (call.owner === id) {
          clearTimeout(call.timer);
          call.reject(new Error('共享接口所在页面已关闭'));
          this.globalCalls.delete(callId);
        }
      for (const [eventId, a] of this.acknowledgements) {
        a.remaining.delete(id);
        if (!a.remaining.size) {
          clearTimeout(a.timer);
          a.resolve();
          this.acknowledgements.delete(eventId);
        }
      }
    };
  }
  update(snapshot: RuntimeSnapshot) {
    this.snapshot = snapshot;
    for (const frame of this.frames.values()) this.send(frame, { type: 'snapshot', snapshot });
  }
  updateVariable(key: string, value: Record<string, unknown>) {
    this.snapshot.variables[key] = value;
    for (const frame of this.frames.values()) this.send(frame, { type: 'variable', key, value });
  }
  updateMessages(messages: RuntimeMessage[], variables?: RuntimeSnapshot['variables']) {
    this.snapshot.messages = messages;
    if (variables) this.snapshot.variables = variables;
    for (const frame of this.frames.values())
      this.send(frame, {
        type: 'messages',
        messages,
        variables: variables ?? this.snapshot.variables,
      });
  }
  private send(frame: Frame, data: Record<string, unknown>) {
    frame.window.postMessage({ channel: 'comfysilly-card-v1', token: frame.token, ...data }, '*');
  }
  async emit(name: string, args: unknown[] = []) {
    if (typeof name !== 'string' || name.length > 200) throw new Error('事件名称无效');
    const id = crypto.randomUUID();
    const remaining = new Set(this.frames.keys());
    if (!remaining.size) return;
    const completed = new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.acknowledgements.delete(id);
        resolve();
      }, 10000);
      this.acknowledgements.set(id, { remaining, resolve, timer });
    });
    for (const frame of this.frames.values()) this.send(frame, { type: 'event', name, args, id });
    await completed;
  }
  private receive = (event: MessageEvent) => {
    const data = event.data;
    if (!data || data.channel !== 'comfysilly-card-v1') return;
    // WebView2 can report a null/unstable source for messages crossing a
    // sandboxed srcDoc boundary. The per-frame unguessable token is the
    // capability; use it as the fallback while still checking the source
    // whenever the browser supplies one.
    const entry = [...this.frames.entries()].find(
      ([, f]) => f.token === data.token && (!event.source || f.window === event.source),
    );
    if (!entry) return;
    const [frameId, frame] = entry;
    if (
      data.type === 'publishGlobal' &&
      typeof data.name === 'string' &&
      /^[A-Za-z_$][\w$]{0,99}$/.test(data.name) &&
      !['constructor', 'prototype', '__proto__'].includes(data.name)
    ) {
      this.globals.set(data.name, { owner: frameId, descriptor: data.descriptor });
      for (const other of this.frames.values())
        if (other !== frame)
          this.send(other, { type: 'sharedGlobal', name: data.name, descriptor: data.descriptor });
    }
    if (data.type === 'globalResult') {
      const call = this.globalCalls.get(data.id);
      if (call?.owner === frameId) {
        clearTimeout(call.timer);
        this.globalCalls.delete(data.id);
        if (data.error) call.reject(new Error(String(data.error)));
        else call.resolve(data.value);
      }
    }
    if (data.type === 'interaction') this.onInteraction();
    if (data.type === 'ready') {
      this.send(frame, { type: 'snapshot', snapshot: this.getSnapshot() });
      for (const [name, global] of this.globals)
        if (global.owner !== frameId)
          this.send(frame, { type: 'sharedGlobal', name, descriptor: global.descriptor });
    }
    if (data.type === 'resize' && Number.isFinite(data.height))
      frame.onResize(Math.min(1600, Math.max(120, data.height)));
    if (data.type === 'error') frame.onError(String(data.message).slice(0, 3000));
    if (data.type === 'toast') this.onNotice(String(data.message).slice(0, 1000));
    if (data.type === 'eventDone') {
      const a = this.acknowledgements.get(data.id);
      if (a) {
        a.remaining.delete(frameId);
        if (!a.remaining.size) {
          clearTimeout(a.timer);
          a.resolve();
          this.acknowledgements.delete(data.id);
        }
      }
    }
    if (data.type === 'backgroundReady') void this.emit('chat_id_changed', []);
    if (data.type === 'rendered') void this.emit('character_message_rendered', [data.messageId]);
    if (data.type === 'call' && typeof data.id === 'string' && Array.isArray(data.args)) {
      if (data.args.length > 20) {
        this.send(frame, { type: 'result', id: data.id, error: '参数过多' });
        return;
      }
      const work =
        data.method === 'callGlobal'
          ? this.callGlobal(data.args[0], data.args[1], data.args[2])
          : data.method === 'eventEmit'
            ? this.emit(String(data.args[0]), data.args[1])
            : data.method === 'networkRequest'
              ? invoke('card_network_request', { requestJson: JSON.stringify(data.args[0] ?? {}) })
              : this.onCall(String(data.method), data.args);
      Promise.resolve(work)
        .then((value) => this.send(frame, { type: 'result', id: data.id, value }))
        .catch((error) => this.send(frame, { type: 'result', id: data.id, error: String(error) }));
    }
  };
  private callGlobal(name: string, path: string[], args: unknown[]): Promise<unknown> {
    const global = this.globals.get(name),
      frame = global && this.frames.get(global.owner);
    if (!global || !frame) return Promise.reject(new Error('共享接口未初始化'));
    let descriptor = global.descriptor;
    if (
      !Array.isArray(path) ||
      path.length > 5 ||
      !path.every(
        (key) =>
          typeof key === 'string' && !['constructor', 'prototype', '__proto__'].includes(key),
      )
    )
      return Promise.reject(new Error('共享接口路径无效'));
    for (const key of path) descriptor = descriptor?.entries?.[key];
    if (descriptor?.kind !== 'function' || !Array.isArray(args) || args.length > 20)
      return Promise.reject(new Error('未公开的共享接口或参数无效'));
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => {
        this.globalCalls.delete(id);
        reject(new Error('共享接口调用超时'));
      }, 180000);
      this.globalCalls.set(id, { owner: global.owner, resolve, reject, timer });
      this.send(frame, { type: 'invokeGlobal', name, path, args, id });
    });
  }
}
const scriptJson = (v: unknown) =>
  JSON.stringify(v)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
export function buildInteractiveDocument(html: string, init: Record<string, unknown>) {
  const policy =
    "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob: https: http:; style-src 'unsafe-inline' https: http:; connect-src https: http:; img-src data: blob: https: http:; font-src data: https: http:; media-src data: blob: https: http:; frame-src https: http:; form-action 'none'; base-uri 'none'";
  const prelude = `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${policy}"><script>window.__COMFY_CARD__=${scriptJson(init)};window.addEventListener('error',function(e){if(!window.__COMFY_RUNTIME_READY__)parent.postMessage({channel:'comfysilly-card-v1',token:window.__COMFY_CARD__.token,type:'error',message:'运行环境启动失败：'+e.message},'*');});</script><script>${runtimeSource.replace(/<\/script/gi, '<\\/script')}</script><style>html,body{margin:0;min-height:80px;overflow-wrap:anywhere}*{box-sizing:border-box}</style>`;
  if (/<head\b[^>]*>/i.test(html))
    return html.replace(/<head\b[^>]*>/i, (match) => match + prelude);
  if (/<html\b[^>]*>/i.test(html))
    return html.replace(/<html\b[^>]*>/i, (match) => match + `<head>${prelude}</head>`);
  return `<!doctype html><html><head>${prelude}</head><body>${html}</body></html>`;
}
