import fs from 'fs';

let s = fs.readFileSync('src/App.tsx', 'utf8');

// 统一 handleUpdateCharacter
s = s.replace(
  /const handleUpdateCharacter = async \(updated: CharacterCardData\) => \{[\s\S]*?setStatusMessage\([^)]+\);\s*\};/,
  `const handleUpdateCharacter = async (updated: CharacterCardData) => {
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
  };`
);

// 替换所有 residual 的 setActiveCharacter
s = s.replaceAll('setActiveCharacter', 'setChatCharacter');

fs.writeFileSync('src/App.tsx', s, 'utf8');
console.log('App.tsx handlers unified!');
