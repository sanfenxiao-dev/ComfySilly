import fs from 'fs';

let s = fs.readFileSync('src/App.tsx', 'utf8');

// 找到并替换从 {currentTab === 'chat' 开始到世界书结束的 JSX 区域
const startMarker = "{currentTab === 'chat' && (";
const endMarker = "{currentTab === 'plugins' && (";

const startIdx = s.indexOf(startMarker);
const endIdx = s.indexOf(endMarker);

if (startIdx !== -1 && endIdx !== -1) {
  const replacement = `{currentTab === 'chat' && (
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
        )}

        `;

  s = s.slice(0, startIdx) + replacement + s.slice(endIdx);
  fs.writeFileSync('src/App.tsx', s, 'utf8');
  console.log('App.tsx JSX section correctly replaced!');
} else {
  console.log('Markers not found:', startIdx, endIdx);
}
