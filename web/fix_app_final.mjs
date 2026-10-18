import fs from 'fs';

let s = fs.readFileSync('src/App.tsx', 'utf8');

// 修复 App.tsx 中的引用错误
s = s.replace("import { Sparkles, Layers, BookOpen } from 'lucide-react';", "import { Sparkles, Layers } from 'lucide-react';");

// 确保 handleUpdateCharacter 声明在前面
const updateFn = `  const handleUpdateCharacter = async (updated: CharacterCardData) => {
    setDetailCharacter(updated);
    if (chatCharacter?.id === updated.id) {
      setChatCharacter(updated);
    }
    await invoke('save_character_to_library', {
      id: updated.id,
      payloadJson: JSON.stringify(updated),
    });
    await refreshCharacterLibrary();
    setStatusMessage(\`角色卡《\${updated.name}》设定已保存！\`);
  };`;

if (!s.includes('const handleUpdateCharacter = async (updated: CharacterCardData) => {')) {
  s = s.replace('const handleOpenCharacterLorebook = (char: CharacterCardData) => {', updateFn + '\n\n  const handleOpenCharacterLorebook = (char: CharacterCardData) => {');
}

// 移除残留的 handleUpdateCharacterSessions 和 handleNewSessionForCard
s = s.replace(/const handleUpdateCharacterSessions = async[\s\S]*?refreshCharacterLibrary\(\);\s*\};/, '');
s = s.replace(/const handleNewSessionForCard = \(id: string[\s\S]*?setActiveCharacter\(updated\);\s*\};/, '');

// 清理 activeCharacter 残留
s = s.replaceAll('activeCharacter', 'chatCharacter');

fs.writeFileSync('src/App.tsx', s, 'utf8');
console.log('App.tsx final fixes applied!');
