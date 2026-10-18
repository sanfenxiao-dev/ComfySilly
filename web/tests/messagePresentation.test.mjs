import test from 'node:test';
import assert from 'node:assert/strict';
import { applyDisplayRules, splitMessageParts, inspectFrontend, buildStaticPreview, getHelperScripts } from '../src/utils/messagePresentation.ts';

test('unlabelled remote loader strips fences (ERA regression)', () => {
  const html = '<body>\n<script>$("body").load("https://example.invalid/start.html")</script>\n</body>';
  const result = splitMessageParts('```\n' + html + '\n```');
  assert.deepEqual(result, [{ kind: 'html', content: html }]);
  assert.equal(inspectFrontend(result[0].content).loaderOnly, true);
});
test('multiple HTML fences preserve text order and CRLF', () => {
  assert.deepEqual(splitMessageParts('前言\r\n```html\r\n<div>一</div>\r\n```\r\n间隔\r\n~~~html\r\n<div>二</div>\r\n~~~\r\n后文').map(p => p.kind), ['text','html','text','html','text']);
});
test('do not render HTML literals in JS code as a frontend', () => {
  const input = '```javascript\nconst a = "<body>hi</body>";\n```';
  assert.equal(splitMessageParts(input)[0].kind, 'text');
  assert.equal(splitMessageParts(input)[0].content, input);
});
test('standalone document is recognized; prose containing HTML is not', () => {
  assert.equal(splitMessageParts('<!doctype html><html><body>ok</body></html>')[0].kind, 'html');
  assert.equal(splitMessageParts('这是 <body> 标签')[0].kind, 'text');
});
test('raw interactive fragments are mounted instead of escaped as Markdown', () => {
  const raw = '</details><div class="choices"><button data-choice="1">继续</button></div>';
  assert.deepEqual(splitMessageParts(raw), [{ kind: 'html', content: raw }]);
});
test('mixed prose followed by an un-fenced details block keeps the prose and mounts the block', () => {
  const result = splitMessageParts('正文说明\n</div></details><details><summary>状态</summary><button>继续</button></details>');
  assert.deepEqual(result.map((part) => part.kind), ['text', 'html']);
  assert.match(result[1].content, /<button>继续<\/button>/);
});
test('display rules respect disabled, prompt-only and message role', () => {
  const rules = [
    { findRegex: 'a', replaceString: 'bad', disabled: true },
    { findRegex: 'a', replaceString: 'bad', promptOnly: true },
    { findRegex: 'a', replaceString: 'bad', placement: [1] },
    { findRegex: 'a', replaceString: 'b', placement: [2] },
  ];
  assert.equal(applyDisplayRules('a', rules).text, 'b');
  assert.equal(applyDisplayRules('a', rules, 'user').text, 'bad');
});
test('regex flags, sequential rules and captures', () => {
  assert.equal(applyDisplayRules('AA', [{findRegex:'/a/gi',replaceString:'b'}, {findRegex:'/(b)(b)/',replaceString:'$2-$1-$$-$&'}]).text, 'b-b-$-bb');
});
test('invalid regex reports a named diagnostic and preserves content', () => {
  const result = applyDisplayRules('source', [{scriptName:'坏规则',findRegex:'/[/',replaceString:'x'}]);
  assert.equal(result.text, 'source');
  assert.equal(result.diagnostics[0].name, '坏规则');
});
test('depth bounds use null and -1 as unbounded', () => {
  assert.equal(applyDisplayRules('a', [{findRegex:'a',replaceString:'b',minDepth:2}], 'assistant', 0).text, 'a');
  assert.equal(applyDisplayRules('a', [{findRegex:'a',replaceString:'b',maxDepth:0}], 'assistant', 1).text, 'a');
  assert.equal(applyDisplayRules('a', [{findRegex:'a',replaceString:'b',minDepth:-1,maxDepth:null}], 'assistant', 8).text, 'b');
});
test('trim match macro, optional captures and lookbehind preserve context', () => {
  assert.equal(applyDisplayRules('>abc<', [{findRegex:'/>abc</',replaceString:'{{match}}',trimStrings:['>','<']}]).text, 'abc');
  assert.equal(applyDisplayRules('ab', [{findRegex:'/(?<=a)(b)(c)?/',replaceString:'$1$2'}]).text, 'ab');
});
test('replacement semantics agree with native JS including two digit captures', () => {
  const source = 'xxabcxx';
  for (const replacement of ['$1-$2-$99-$10-$01', '$$-$&-$`-$\'', '$<a>-$<absent>']) {
    const regex = /(?<a>a)(b)(c)?/g;
    assert.equal(applyDisplayRules(source, [{findRegex:regex.toString(),replaceString:replacement}]).text, source.replace(regex, replacement));
  }
});
test('normalize tuple/object/legacy helper scripts without duplicates', () => {
  const enabled = {name:'ERA',content:'example',enabled:true};
  const disabled = {name:'off',content:'example',enabled:false};
  assert.equal(getHelperScripts({tavern_helper:[['scripts',[enabled, disabled]]]}).length, 1);
  assert.equal(getHelperScripts({tavern_helper:{scripts:[enabled]},TavernHelper_scripts:[{type:'script',value:enabled}]}).length, 1);
  assert.equal(getHelperScripts({TavernHelper_scripts:[{type:'script',value:enabled}]}).length, 1);
});
test('static preview denies network/scripts/forms and contains no bridge', () => {
  const doc = buildStaticPreview('<div>test</div>');
  assert.match(doc, /default-src 'none'/);
  assert.match(doc, /form-action 'none'/);
  assert.doesNotMatch(doc, /allow-same-origin|postMessage|setInterval/);
});
test('external dependencies are deduplicated and inspect does not fetch', () => {
  const info = inspectFrontend('<script src="https://example.invalid/a.js"></script><img src="https://example.invalid/a.js">');
  assert.equal(info.scripted, true);
  assert.deepEqual(info.urls, ['https://example.invalid/a.js']);
});
