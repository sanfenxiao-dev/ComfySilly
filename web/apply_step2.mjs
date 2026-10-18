import fs from 'fs';

let s = fs.readFileSync('src/App.tsx', 'utf8');

// 增加 refreshWorldbookLibrary
const newMethods = `  const refreshWorldbookLibrary = useCallback(async () => {
    try {
      const rawList = await invoke<Array<{ name: string; path: string }>>('list_worldbook_library');
      const metas: GlobalWorldbookMeta[] = [];
      for (const item of rawList) {
        try {
          const content = await invoke<string>('load_preset_file', { filePath: item.path });
          const parsed = JSON.parse(content);
          const entries = Array.isArray(parsed.entries)
            ? parsed.entries
            : parsed.entries
            ? Object.values(parsed.entries)
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
  }, []);

  const handleImportWorldbook = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: 'SillyTavern WorldBook JSON', extensions: ['json'] }],
        title: '请选择酒馆世界书 JSON 文件',
      });
      if (!selected) return;
      const filePath = typeof selected === 'string' ? selected : selected[0];
      setStatusMessage(\`正在读取世界书: \${filePath}...\`);
      const fileContent = await invoke<string>('load_preset_file', { filePath });
      const fileName = (filePath.split('\\\\').pop() || 'WorldBook').replace('.json', '');
      await invoke('save_worldbook_to_library', {
        name: fileName,
        content: fileContent,
      });
      await refreshWorldbookLibrary();
      setStatusMessage(\`世界书《\${fileName}》已成功导入并持久化入库！\`);
    } catch (err: any) {
      setStatusMessage(\`导入世界书失败: \${err?.message}\`);
    }
  };

  const handleNewWorldbook = async () => {
    const newName = \`New-Lorebook-\${Date.now().toString().slice(-4)}\`;
    const blankData = {
      name: newName,
      entries: [
        {
          uid: 0,
          comment: '世界观总览',
          key: ['世界', '大陆'],
          content: '请在此填写世界观全局设定...',
          constant: true,
          selective: false,
          depth: 4,
          order: 100,
        },
      ],
    };
    await invoke('save_worldbook_to_library', {
      name: newName,
      content: JSON.stringify(blankData, null, 2),
    });
    await refreshWorldbookLibrary();
    setStatusMessage(\`已新建空白世界书《\${newName}》！\`);
  };

  const handleDeleteWorldbook = async (name: string, path: string) => {
    try {
      await invoke('delete_worldbook_from_library', { path });
      setStatusMessage(\`已删除世界书《\${name}》\`);
      await refreshWorldbookLibrary();
    } catch (err: any) {
      setStatusMessage(\`删除失败: \${err?.message}\`);
    }
  };

  const handleToggleWorldbook = (name: string, enabled: boolean) => {
    setGlobalWorldbooks((prev) =>
      prev.map((wb) => (wb.name === name ? { ...wb, enabled } : wb))
    );
    setStatusMessage(\`世界书《\${name}》已\${enabled ? '启用全局监听' : '已停用'}\`);
  };

  const handleOpenGlobalWorldbookEditor = (wb: GlobalWorldbookMeta) => {
    setLorebookModalState({
      isOpen: true,
      title: \`全局世界书编辑 - 《\${wb.name}》\`,
      data: wb.data,
      onSaveCallback: async (updated) => {
        await invoke('save_worldbook_to_library', {
          name: wb.name,
          content: JSON.stringify(updated, null, 2),
        });
        await refreshWorldbookLibrary();
        setStatusMessage(\`世界书《\${wb.name}》已更新保存！\`);
      },
    });
  };

  const handleOpenCharacterLorebook = (char: CharacterCardData) => {
    setLorebookModalState({
      isOpen: true,
      title: \`角色专属世界书 - 《\${char.name}》\`,
      data: char.lorebook || { name: \`\${char.name}的世界书\`, entries: [] },
      onSaveCallback: async (updated) => {
        const updatedChar = {
          ...char,
          lorebook: {
            name: updated.name,
            entries: updated.entries,
          },
        };
        await handleUpdateCharacter(updatedChar);
        setStatusMessage(\`角色卡《\${char.name}》专属世界书已更新（\${updated.entries.length} 条）！\`);
      },
    });
  };
`;

s = s.replace(
  'const refreshCharacterLibrary = useCallback(async () => {',
  newMethods + '\n  const refreshCharacterLibrary = useCallback(async () => {'
);

fs.writeFileSync('src/App.tsx', s, 'utf8');
console.log('Step 2 applied!');
