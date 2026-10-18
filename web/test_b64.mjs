import fs from 'fs';

const buffer = fs.readFileSync('C:/Users/Administrator/Downloads/-v4.5.1.png');
const textPos = buffer.indexOf(Buffer.from('chara\0'));
const len = buffer.readUInt32BE(textPos - 4 - 4);
const rawData = buffer.slice(textPos + 6, textPos + 6 + len - 6).toString('utf8');
const card = JSON.parse(Buffer.from(rawData, 'base64').toString('utf8'));
const d = card.data || card;
const s3 = d.extensions.tavern_helper.scripts.find(s => s.name === '状态栏');

const m = s3.content.match(/STATUS_HTML_BASE64\s*=\s*"([^"]+)"/);
if (m) {
  const b64 = m[1];
  const decoded = Buffer.from(b64, 'base64').toString('utf8');
  console.log('STATUS_HTML_BASE64 length:', decoded.length);
  console.log('Decoded title:', decoded.slice(0, 400));
}
