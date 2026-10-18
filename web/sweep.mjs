import fs from 'fs';

// 彻底清除 CharacterDetail.tsx 里面的冗余 imports
let cd = fs.readFileSync('src/components/CharacterDetail.tsx', 'utf8');
cd = cd.replace(/import\s*\{[\s\S]*?\}\s*from\s*'lucide-react';/, `import { 
  ArrowLeft, 
  BookOpen, 
  Save, 
  Play, 
  History, 
  ChevronRight
} from 'lucide-react';`);
fs.writeFileSync('src/components/CharacterDetail.tsx', cd, 'utf8');

// 彻底清除 LorebookModal.tsx 里面的冗余 imports
let lm = fs.readFileSync('src/components/LorebookModal.tsx', 'utf8');
lm = lm.replace(/import\s*\{[\s\S]*?\}\s*from\s*'lucide-react';/, `import { 
  X, 
  Search, 
  BookOpen, 
  Save, 
  Plus, 
  Trash2, 
  Key
} from 'lucide-react';`);
fs.writeFileSync('src/components/LorebookModal.tsx', lm, 'utf8');

// 彻底清除 WorldbookView.tsx 里面的冗余 imports
let wv = fs.readFileSync('src/components/WorldbookView.tsx', 'utf8');
wv = wv.replace(/import\s*\{[\s\S]*?\}\s*from\s*'lucide-react';/, `import { 
  BookOpen, 
  Upload, 
  Plus, 
  Trash2, 
  Search, 
  Edit3
} from 'lucide-react';`);
fs.writeFileSync('src/components/WorldbookView.tsx', wv, 'utf8');

// 清理 App.tsx 里的 handleNewSessionForCard
let app = fs.readFileSync('src/App.tsx', 'utf8');
app = app.replace(/const handleNewSessionForCard =[\s\S]*?setActiveCharacter\(updated\);\s*\};/, '');
app = app.replace(/const handleNewSessionForCard =[\s\S]*?setChatCharacter\(updated\);\s*\};/, '');
fs.writeFileSync('src/App.tsx', app, 'utf8');

console.log('Precision sweep completed!');
