import fs from 'fs';

let s = fs.readFileSync('src/App.tsx', 'utf8');

// 增强世界书加载转换逻辑：确保无论格式如何，都提取出标准 entries 数组
const parseWbLogic = `      const wbList = await refreshWorldbookLibrary();
      if (wbList.length === 0) {
        const defaultWbPath = 'C:\\\\Users\\\\Administrator\\\\Downloads\\\\《幻想乡缘起》修改版 V2.⑨ - v0.1.json';
        try {
          const fileContent = await invoke('load_preset_file', { filePath: defaultWbPath });
          await invoke('save_worldbook_to_library', {
            name: '幻想乡缘起 V2.9',
            content: fileContent,
          });
          await refreshWorldbookLibrary();
        } catch {
          // ignore
        }
      }`;

// 增强 refreshWorldbookLibrary
const newRefreshWb = `  const refreshWorldbookLibrary = useCallback(async () => {
    try {
      const rawList = await invoke<Array<{ name: string; path: string }>>('list_worldbook_library');
      const metas: GlobalWorldbookMeta[] = [];
      for (const item of rawList) {
        try {
          const content = await invoke<string>('load_preset_file', { filePath: item.path });
          const parsed = JSON.parse(content);
          const rawEntries = parsed.entries || parsed;
          const entries = Array.isArray(rawEntries)
            ? rawEntries
            : typeof rawEntries === 'object'
            ? Object.values(rawEntries)
            : [];
          metas.push({
            name: item.name,
            path: item.path,
            entriesCount: entries.length,
            enabled: true,
            data: {
              name: item.name,
              entries,
            },
          });
        } catch {
          // ignore
        }
      }
      setGlobalWorldbooks(metas);
      return metas;
    } catch {
      return [];
    }
  }, []);`;

s = s.replace(/const refreshWorldbookLibrary = useCallback[\s\S]*?return \[\];\s*\}\s*\}, \[\]\);/, newRefreshWb);

// 增强 handleOpenCharacterLorebook 里的 entries 解析
const newCharLorebook = `  const handleOpenCharacterLorebook = (char: CharacterCardData) => {
    const rawEntries = char.lorebook?.entries;
    const entries = Array.isArray(rawEntries)
      ? rawEntries
      : rawEntries && typeof rawEntries === 'object'
      ? Object.values(rawEntries)
      : [];

    setLorebookModalState({
      isOpen: true,
      title: '角色专属世界书 - 《' + char.name + '》',
      data: {
        name: char.lorebook?.name || (char.name + '的世界书'),
        entries,
      },
      onSaveCallback: async (updated) => {
        const updatedChar = {
          ...char,
          lorebook: {
            name: updated.name,
            entries: updated.entries,
          },
        };
        await handleUpdateCharacter(updatedChar);
        setStatusMessage('角色卡《' + char.name + '》专属世界书已更新（' + updated.entries.length + ' 条）！');
      },
    });
  };`;

s = s.replace(/const handleOpenCharacterLorebook = \(char: CharacterCardData\) => \{[\s\S]*?setStatusMessage\([^)]+\);\s*\}\s*\}\);\s*\};/, newCharLorebook);

fs.writeFileSync('src/App.tsx', s, 'utf8');
console.log('App.tsx worldbook loaders upgraded!');
