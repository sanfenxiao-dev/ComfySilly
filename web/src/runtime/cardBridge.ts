import runtimeSource from '../generated/card-runtime.js?raw';
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
  private acknowledgements = new Map<
    string,
    { remaining: Set<string>; resolve: () => void; timer: ReturnType<typeof setTimeout> }
  >();
  snapshot: RuntimeSnapshot;
  onCall: (method: string, args: any[]) => Promise<any> = async () => {
    throw new Error('运行环境尚未就绪');
  };
  onNotice: (text: string) => void = () => {};
  constructor(snapshot: RuntimeSnapshot) {
    this.snapshot = snapshot;
  }
  start() {
    window.addEventListener('message', this.receive);
  }
  destroy() {
    window.removeEventListener('message', this.receive);
    this.frames.clear();
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
    const entry = [...this.frames.entries()].find(
      ([, f]) => f.window === event.source && f.token === data.token,
    );
    if (!entry) return;
    const [frameId, frame] = entry;
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
        data.method === 'eventEmit'
          ? this.emit(String(data.args[0]), data.args[1])
          : this.onCall(String(data.method), data.args);
      Promise.resolve(work)
        .then((value) => this.send(frame, { type: 'result', id: data.id, value }))
        .catch((error) => this.send(frame, { type: 'result', id: data.id, error: String(error) }));
    }
  };
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
