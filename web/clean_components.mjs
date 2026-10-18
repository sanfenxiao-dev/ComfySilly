import fs from 'fs';

// 1. 修复 CharacterDetail.tsx
let cd = fs.readFileSync('src/components/CharacterDetail.tsx', 'utf8');
cd = cd.replace("import { \n  ArrowLeft, \n  MessageSquare, \n  Plus, \n  Trash2, \n  BookOpen, \n  Edit3, \n  Save, \n  Play, \n  Calendar, \n  User, \n  Sparkles,\n  Sliders,\n  History, ChevronRight\n} from 'lucide-react';", 
`import { 
  ArrowLeft, 
  BookOpen, 
  Save, 
  Play, 
  History, 
  ChevronRight
} from 'lucide-react';`);
fs.writeFileSync('src/components/CharacterDetail.tsx', cd, 'utf8');

// 2. 修复 LorebookModal.tsx
let lm = fs.readFileSync('src/components/LorebookModal.tsx', 'utf8');
lm = lm.replace("SlidersHorizontal, \n  ChevronRight\n", "");
fs.writeFileSync('src/components/LorebookModal.tsx', lm, 'utf8');

// 3. 修复 WorldbookView.tsx
let wv = fs.readFileSync('src/components/WorldbookView.tsx', 'utf8');
wv = wv.replace("XCircle, \n  SlidersHorizontal,\n  Layers,\n", "");
fs.writeFileSync('src/components/WorldbookView.tsx', wv, 'utf8');

console.log('Cleaned unused imports in components!');
