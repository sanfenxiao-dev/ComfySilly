import fs from 'fs';

let s = fs.readFileSync('src/App.tsx', 'utf8');

// 1. 替换 imports
s = s.replace(
  "import { ChatRoom } from './components/ChatRoom';",
  "import { CharacterDetail } from './components/CharacterDetail';\nimport { ChatRoom } from './components/ChatRoom';\nimport { LorebookModal, type LorebookData } from './components/LorebookModal';\nimport { WorldbookView, type GlobalWorldbookMeta } from './components/WorldbookView';"
);

// 2. 替换状态定义
s = s.replace(
  'const [activeCharacter, setActiveCharacter] = useState<CharacterCardData | null>(null);',
  `const [detailCharacter, setDetailCharacter] = useState<CharacterCardData | null>(null);
  const [chatCharacter, setChatCharacter] = useState<CharacterCardData | null>(null);
  const [chatSessionId, setChatSessionId] = useState<string | undefined>();
  const [lorebookModalState, setLorebookModalState] = useState<{
    isOpen: boolean;
    title: string;
    data: LorebookData;
    onSaveCallback: (updated: LorebookData) => void;
  }>({
    isOpen: false,
    title: '',
    data: { name: '', entries: [] },
    onSaveCallback: () => {},
  });
  const [globalWorldbooks, setGlobalWorldbooks] = useState<GlobalWorldbookMeta[]>([]);`
);

fs.writeFileSync('src/App.tsx', s, 'utf8');
console.log('Step 1 applied!');
