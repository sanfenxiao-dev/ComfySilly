export interface DisplayRule {
  id?: string;
  scriptName?: string;
  disabled?: boolean;
  promptOnly?: boolean;
  markdownOnly?: boolean;
  placement?: number[];
  minDepth?: number | null;
  maxDepth?: number | null;
  findRegex?: string;
  replaceString?: string;
  trimStrings?: string[];
}
export type MessagePart = { kind: 'text' | 'html'; content: string };
export interface RuleDiagnostic {
  name: string;
  error: string;
}

/** Display processing must never overwrite the persisted original message. */
export function applyDisplayRules(
  content: string,
  rules: DisplayRule[],
  role = 'assistant',
  depth = 0,
) {
  let text = content;
  const diagnostics: RuleDiagnostic[] = [];
  for (const [index, rule] of rules.entries()) {
    if (!rule || typeof rule !== 'object') {
      diagnostics.push({ name: `正则 ${index + 1}`, error: '规则必须是对象' });
      continue;
    }
    if (rule.disabled || (rule.promptOnly && !rule.markdownOnly)) continue;
    const placement = role === 'user' ? 1 : role === 'assistant' ? 2 : 0;
    if (rule.placement?.length && !rule.placement.includes(placement)) continue;
    if (rule.minDepth != null && rule.minDepth >= 0 && depth < rule.minDepth) continue;
    if (rule.maxDepth != null && rule.maxDepth >= 0 && depth > rule.maxDepth) continue;
    if (!rule.findRegex) continue;
    try {
      const source = rule.findRegex;
      const slash = source.lastIndexOf('/');
      const regex =
        source.startsWith('/') && slash > 0
          ? new RegExp(source.slice(1, slash), source.slice(slash + 1))
          : new RegExp(source, 'g');
      // Preserve JS replacement tokens ($1, $&, $$) and trim only the matched text.
      text = text.replace(regex, (...args: unknown[]) => {
        const match = String(args[0]);
        let trimmed = match;
        for (const trim of rule.trimStrings ?? []) if (trim) trimmed = trimmed.split(trim).join('');
        const replacement = (rule.replaceString ?? '').split('{{match}}').join(trimmed);
        // Reapply to the isolated match; lookbehinds/lookaheads require the original context.
        const groups =
          typeof args.at(-1) === 'object' ? (args.at(-1) as Record<string, string>) : undefined;
        const offsetIndex = groups ? args.length - 3 : args.length - 2;
        const captures = args.slice(1, offsetIndex) as (string | undefined)[];
        const offset = args[offsetIndex] as number;
        const input = args[offsetIndex + 1] as string;
        return replacement.replace(/\$(\$|&|`|'|\d{1,2}|<[^>]+>)/g, (token, key: string) => {
          if (key === '$') return '$';
          if (key === '&') return match;
          if (key === '`') return input.slice(0, offset);
          if (key === "'") return input.slice(offset + match.length);
          if (key.startsWith('<')) return groups ? (groups[key.slice(1, -1)] ?? '') : token;
          const n = Number(key);
          if (n > 0 && n <= captures.length) return captures[n - 1] ?? '';
          if (key.length === 2 && Number(key[0]) > 0 && Number(key[0]) <= captures.length)
            return (captures[Number(key[0]) - 1] ?? '') + key[1];
          return token;
        });
      });
    } catch (error) {
      diagnostics.push({
        name: rule.scriptName || rule.id || `正则 ${index + 1}`,
        error: String(error),
      });
    }
  }
  return { text, diagnostics };
}

const htmlTag =
  /<\/?(?:!doctype\s+html|html\b|head\b|body\b|script\b|style\b|div\b|section\b|main\b|article\b|details\b|summary\b|button\b|form\b|input\b|textarea\b|select\b|option\b|label\b|table\b|ul\b|ol\b|li\b|iframe\b)/i;

function isLikelyHtmlFragment(text: string) {
  const trimmed = text.trim();
  if (!trimmed || !htmlTag.test(trimmed)) return false;
  // A raw fragment may be prefixed by a closing tag after an earlier regex
  // removed an opening wrapper. Require a real element attribute/content marker
  // so ordinary prose containing "<content>" is not turned into executable HTML.
  return /<\/?(?:details|summary|button|div|section|main|article|form|input|textarea|select|option|label|table|ul|ol|li|iframe)\b[^>]*>/i.test(trimmed);
}
/** Recognize fenced HTML without leaking the fences into the HTML document. */
export function splitMessageParts(text: string): MessagePart[] {
  const parts: MessagePart[] = [];
  const fences =
    /(^|\n)([ \t]*)(`{3,}|~{3,})([^\r\n]*)\r?\n([\s\S]*?)\r?\n[ \t]*\3[ \t]*(?=\r?\n|$)/g;
  let last = 0;
  for (const match of text.matchAll(fences)) {
    const language = match[4].trim().toLowerCase();
    const html = ['html', 'htm', 'xml'].includes(language) || (!language && htmlTag.test(match[5]));
    // Preserve non-HTML code fences as Markdown, even when they contain HTML strings.
    if (match.index > last) parts.push({ kind: 'text', content: text.slice(last, match.index) });
    parts.push({ kind: html ? 'html' : 'text', content: html ? match[5].trim() : match[0] });
    last = match.index + match[0].length;
  }
  const tail = text.slice(last);
  if (tail.trim()) {
    const fullDocument = /^\s*(?:<!doctype\s+html[^>]*>\s*)?<(?:html|body)\b/i.test(tail);
    parts.push({ kind: fullDocument || isLikelyHtmlFragment(tail) ? 'html' : 'text', content: tail });
  }
  return parts;
}

export function inspectFrontend(html: string) {
  const urls = [...new Set(html.match(/https?:\/\/[^\s"'<>` )]+/g) ?? [])];
  const scripted = /<script\b|\bon\w+\s*=|javascript\s*:/i.test(html);
  return {
    urls,
    scripted,
    remote: urls.length > 0,
    loaderOnly: /\.load\s*\(|<iframe\b/i.test(html),
  };
}

/** A static, opaque-origin preview: no scripts, requests, forms, or parent bridge. */
export function buildStaticPreview(html: string) {
  const policy =
    "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; form-action 'none'; base-uri 'none'";
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body{margin:0;padding:12px;background:#fff;color:#172033;font-family:system-ui,sans-serif;overflow-wrap:anywhere}*{box-sizing:border-box}</style></head><body>${html}</body></html>`;
}

export function getHelperScripts(extensions: Record<string, unknown> = {}) {
  const helper = extensions.tavern_helper;
  const settings = Array.isArray(helper)
    ? Object.fromEntries(helper.filter((v) => Array.isArray(v) && v.length === 2))
    : helper;
  const modern =
    settings && typeof settings === 'object'
      ? (settings as Record<string, unknown>).scripts
      : undefined;
  // Modern storage is authoritative; legacy copies can contain stale versions.
  const scripts = Array.isArray(modern)
    ? modern
    : Array.isArray(extensions.TavernHelper_scripts)
      ? extensions.TavernHelper_scripts
      : [];
  const result: Record<string, unknown>[] = [];
  const collect = (items: unknown[], depth = 0) => {
    if (depth > 10) return;
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const raw = item as Record<string, unknown>;
      if (raw.enabled === false || raw.disabled === true) continue;
      if (Array.isArray(raw.scripts)) {
        collect(raw.scripts, depth + 1);
        continue;
      }
      const value = (raw.type === 'script' && raw.value ? raw.value : raw) as Record<
        string,
        unknown
      >;
      if (typeof value.content === 'string' && value.enabled !== false && value.disabled !== true)
        result.push(value);
    }
  };
  collect(scripts);
  return result;
}
