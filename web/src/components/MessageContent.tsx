import { InteractiveFrame } from './InteractiveFrame';
import type { CardBridge } from '../runtime/cardBridge';
import { memo, useMemo, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  applyDisplayRules,
  splitMessageParts,
  inspectFrontend,
  buildStaticPreview,
} from '../utils/messagePresentation';
import type { DisplayRule } from '../utils/messagePresentation';

function FrontendPreview({ html }: { html: string }) {
  const [showPreview, setShowPreview] = useState(false);
  const info = useMemo(() => inspectFrontend(html), [html]);
  const document = useMemo(() => buildStaticPreview(html), [html]);
  return (
    <section className="not-prose overflow-hidden rounded-xl border border-amber-500/30 bg-slate-950 text-sm">
      <div className="border-b border-slate-800 px-4 py-3">
        <div className="font-semibold text-amber-200">
          {info.scripted || info.loaderOnly
            ? '检测到角色卡交互前端 · 尚未授权执行'
            : '检测到 HTML · 可查看静态预览'}
        </div>
        <p className="mt-2 text-xs leading-6 text-slate-400">
          {info.loaderOnly
            ? '这段内容需要联网加载作者页面。请在聊天顶部点击“信任此卡并启用交互前端”，允许运行卡片及后台脚本。'
            : info.scripted
              ? '包含 JavaScript。未信任时只提供静态预览；启用交互后可使用已实现的变量、事件和模型接口。'
              : '支持静态 HTML/CSS；外部网络资源和脚本默认禁用。'}
        </p>
        {info.urls.length > 0 && (
          <details className="mt-2 text-xs text-slate-400">
            <summary className="cursor-pointer">外部依赖 ({info.urls.length}) · 未自动加载</summary>
            <ul className="mt-2 space-y-1 break-all">
              {info.urls.map((url) => (
                <li key={url}>{url}</li>
              ))}
            </ul>
          </details>
        )}
        {!info.loaderOnly && (
          <button
            type="button"
            onClick={() => setShowPreview((v) => !v)}
            className="mt-3 rounded-lg bg-slate-800 px-3 py-2 text-xs text-slate-200 hover:bg-slate-700"
          >
            {showPreview ? '关闭静态预览' : '打开静态预览（不含交互）'}
          </button>
        )}
      </div>
      {showPreview && (
        <iframe
          title="角色卡静态 HTML 预览"
          sandbox=""
          referrerPolicy="no-referrer"
          srcDoc={document}
          className="h-[420px] w-full resize-y bg-white"
        />
      )}
      <details className="px-4 py-3 text-xs text-slate-400">
        <summary className="cursor-pointer">查看 HTML 源码</summary>
        <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap select-text">{html}</pre>
      </details>
    </section>
  );
}

interface Props {
  content: string;
  role: string;
  rules: DisplayRule[];
  depth: number;
  bridge?: CardBridge;
  messageId?: number;
}
export const MessageContent = memo(function MessageContent({
  content,
  role,
  rules,
  depth,
  bridge,
  messageId = 0,
}: Props) {
  const result = useMemo(
    () => applyDisplayRules(content, rules, role, depth),
    [content, rules, role, depth],
  );
  const parts = useMemo(() => splitMessageParts(result.text), [result.text]);
  return (
    <div className="space-y-3 select-text">
      {result.diagnostics.length > 0 && (
        <details
          className="not-prose rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-200"
          open
        >
          <summary>有 {result.diagnostics.length} 条显示正则失败</summary>
          {result.diagnostics.map((d, i) => (
            <p key={i} className="mt-2 break-all">
              {d.name}: {d.error}
            </p>
          ))}
        </details>
      )}
      {parts.map((part, i) =>
        part.kind === 'html' ? (
          bridge && role === 'assistant' ? (
            <InteractiveFrame key={i} html={part.content} bridge={bridge} messageId={messageId} />
          ) : (
            <FrontendPreview key={i} html={part.content} />
          )
        ) : (
          <Markdown key={i} remarkPlugins={[remarkGfm]}>
            {part.content}
          </Markdown>
        ),
      )}
      {!result.text.trim() && (
        <p className="text-xs text-slate-500">消息内容被显示正则隐藏，可展开原文检查。</p>
      )}
      {(result.diagnostics.length > 0 ||
        !result.text.trim() ||
        parts.some((p) => p.kind === 'html')) && (
        <details className="not-prose border-t border-slate-700/40 pt-2 text-xs text-slate-500">
          <summary className="cursor-pointer">原始消息 / 排查显示问题</summary>
          <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap text-slate-400">
            {content}
          </pre>
        </details>
      )}
    </div>
  );
});
