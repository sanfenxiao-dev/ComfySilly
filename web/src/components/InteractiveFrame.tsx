import { useEffect, useMemo, useRef, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import type { CardBridge } from '../runtime/cardBridge';
import { buildInteractiveDocument } from '../runtime/cardBridge';
const EMPTY_SCRIPTS: unknown[] = [];
export function InteractiveFrame({
  html,
  bridge,
  messageId,
  background = false,
  scripts = EMPTY_SCRIPTS,
}: {
  html: string;
  bridge: CardBridge;
  messageId: number;
  background?: boolean;
  scripts?: unknown[];
}) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(360);
  const [errors, setErrors] = useState<string[]>([]);
  const identity = useMemo(
    () => ({ id: crypto.randomUUID(), token: crypto.randomUUID() }),
    [bridge, html],
  );
  const doc = useMemo(
    () =>
      buildInteractiveDocument(html, {
        token: identity.token,
        snapshot: bridge.getSnapshot(),
        messageId,
        mode: background ? 'background' : 'message',
        scripts,
        networkProxy: isTauri(),
      }),
    [html, bridge, identity, messageId, background, scripts],
  );
  useEffect(() => {
    const win = ref.current?.contentWindow;
    if (!win) return;
    return bridge.register(identity.id, {
      window: win,
      token: identity.token,
      onResize: (h) => setHeight((prev) => (Math.abs(prev - h) > 2 ? h : prev)),
      onError: (e) =>
        setErrors((old) => {
          // Third-party pages often report one failed request through both jQuery
          // ajaxError and window.onerror. Keep the card readable and actionable.
          if (old.at(-1) === e) return old;
          return [...old.slice(-9), e];
        }),
    });
  }, [bridge, identity]);
  const status = errors.length > 0 && (
    <div className="rounded-lg border border-rose-500/40 bg-rose-950/50 p-3 text-xs text-rose-200 select-text">
      <p>卡片运行错误（未伪造成功）：</p>
      {errors.map((e, i) => (
        <pre key={i} className="mt-1 whitespace-pre-wrap break-all">
          {e}
        </pre>
      ))}
    </div>
  );
  return (
    <div className={background ? 'px-4 pt-2' : ''}>
      {status}
      <iframe
        ref={ref}
        onPointerEnter={() => bridge.onInteraction()}
        onMouseEnter={() => bridge.onInteraction()}
        title={background ? '角色卡后台脚本' : '角色卡交互前端'}
        srcDoc={doc}
        sandbox="allow-scripts allow-modals"
        referrerPolicy="no-referrer"
        style={
          background
            ? { width: 1, height: 1, position: 'absolute', opacity: 0, pointerEvents: 'none' }
            : {
                height,
                width: '100%',
                border: 0,
                display: 'block',
                borderRadius: 12,
                background: 'transparent',
              }
        }
      />
    </div>
  );
}
