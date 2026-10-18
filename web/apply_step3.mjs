import fs from 'fs';

let s = fs.readFileSync('src/App.tsx', 'utf8');

// 替换 handleUpdateCharacter
s = s.replace(
  'const handleUpdateCharacterSessions = async (updated: CharacterCardData) => {\n    setActiveCharacter(updated);',
  `const handleUpdateCharacter = async (updated: CharacterCardData) => {
    setDetailCharacter(updated);
    if (chatCharacter?.id === updated.id) {
      setChatCharacter(updated);
    }`
);

// 替换渲染区域
const oldChatRender = `{/* 🌟 角色卡书架典藏馆与沉浸式对话视界 */}
        {currentTab === 'chat' && (
          <div className="w-full h-full relative">
            {activeCharacter ? (
              <ChatRoom
                character={activeCharacter}
                onBackToShelf={() => setActiveCharacter(null)}
                onUpdateCharacterSessions={handleUpdateCharacterSessions}
              />
            ) : (
              <CharacterShelf
                characters={characters}
                onImportCard={handleImportCharacterCard}
                onSelectCharacter={(card) => setActiveCharacter(card)}
                onDeleteCharacter={handleDeleteCharacter}
                onNewSessionForCard={handleNewSessionForCard}
              />
            )}
          </div>
        )}`;

const newChatRender = `{/* 🌟 角色卡层级中枢：书架 ➔ 详情界面 ➔ 对话房间 */}
        {currentTab === 'chat' && (
          <div className="w-full h-full relative">
            {chatCharacter ? (
              <ChatRoom
                character={chatCharacter}
                initialSessionId={chatSessionId}
                onBackToShelf={() => setChatCharacter(null)}
                onUpdateCharacterSessions={handleUpdateCharacter}
                onOpenLorebookModal={() => handleOpenCharacterLorebook(chatCharacter)}
              />
            ) : detailCharacter ? (
              <CharacterDetail
                character={detailCharacter}
                onBack={() => setDetailCharacter(null)}
                onStartChat={(sessionId) => {
                  setChatCharacter(detailCharacter);
                  setChatSessionId(sessionId);
                }}
                onUpdateCharacter={handleUpdateCharacter}
                onOpenLorebookModal={() => handleOpenCharacterLorebook(detailCharacter)}
              />
            ) : (
              <CharacterShelf
                characters={characters}
                onImportCard={handleImportCharacterCard}
                onSelectCharacter={(card) => setDetailCharacter(card)}
                onDeleteCharacter={handleDeleteCharacter}
                onNewSessionForCard={(id, e) => {
                  e.stopPropagation();
                  const target = characters.find((c) => c.id === id);
                  if (target) {
                    setDetailCharacter(target);
                  }
                }}
              />
            )}
          </div>
        )}

        {/* 🌟 全局世界书典藏库 (含独立开关、导入、新建、编辑《幻想乡缘起》) */}
        {currentTab === 'worldbook' && (
          <WorldbookView
            worldbooks={globalWorldbooks}
            onImportWorldbook={handleImportWorldbook}
            onNewWorldbook={handleNewWorldbook}
            onDeleteWorldbook={handleDeleteWorldbook}
            onToggleWorldbook={handleToggleWorldbook}
            onOpenEditor={handleOpenGlobalWorldbookEditor}
          />
        )}`;

s = s.replace(oldChatRender, newChatRender);

// 替换世界书静态视界
const oldWorldbookRender = `{/* 世界书专属图谱视界 */}
        {currentTab === 'worldbook' && (
          <div className="w-full h-full flex flex-col p-8 overflow-y-auto bg-slate-950">
            <div className="flex items-center space-x-3 pb-6 border-b border-slate-800">
              <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
                <BookOpen className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-100">世界书图谱与全局设定 (WorldBook Matrix)</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  已与导入的角色卡专属世界书（如《苍玄界》218条目）及预设全局世界书实现全量打通与触发。
                </p>
              </div>
            </div>

            <div className="py-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-2">
                <div className="text-xs font-bold text-amber-300">角色专属世界书</div>
                <div className="text-xs text-slate-400">
                  当前载入：《我的苍玄界，才不会这么跌宕起伏！》
                </div>
                <div className="text-[11px] font-mono text-slate-500">218 条设定 • 核心规则 • 故事基调 • 境界法宝</div>
              </div>
              <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-2">
                <div className="text-xs font-bold text-violet-300">预设全局世界书 (Global WI)</div>
                <div className="text-xs text-slate-400">
                  格式：{\`wi_format: "{0}"\`} • 扫描深度 5 条 • 支持递归激活
                </div>
                <div className="text-[11px] font-mono text-slate-500">随预设工作流一键切换联动</div>
              </div>
            </div>
          </div>
        )}`;

s = s.replace(oldWorldbookRender, '');

// 在 SettingsModal 之后插入 LorebookModal
s = s.replace(
  '<SettingsModal',
  `<LorebookModal
        isOpen={lorebookModalState.isOpen}
        title={lorebookModalState.title}
        lorebook={lorebookModalState.data}
        onClose={() => setLorebookModalState({ ...lorebookModalState, isOpen: false })}
        onSave={lorebookModalState.onSaveCallback}
      />\n\n      <SettingsModal`
);

// Tab 切换时清空子界面
s = s.replace(
  "if (t !== 'chat') {\n            setActiveCharacter(null);\n          }",
  "if (t !== 'chat') {\n            setDetailCharacter(null);\n            setChatCharacter(null);\n          }"
);

// 自动载入幻想乡缘起
const autoLoadWb = `const wbList = await refreshWorldbookLibrary();
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

s = s.replace(
  'const charList = await refreshCharacterLibrary();',
  autoLoadWb + '\n\n      const charList = await refreshCharacterLibrary();'
);

fs.writeFileSync('src/App.tsx', s, 'utf8');
console.log('Step 3 applied!');
