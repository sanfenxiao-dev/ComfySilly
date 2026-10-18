import fs from 'fs';

let cs = fs.readFileSync('src/components/CharacterShelf.tsx', 'utf8');
cs = cs.replace(
  'lorebook?: {\n    name: string;\n    entries: any[];\n  };',
  'lorebook?: {\n    name: string;\n    entries: any;\n  };'
);
fs.writeFileSync('src/components/CharacterShelf.tsx', cs, 'utf8');
console.log('CharacterShelf.tsx type relaxed!');
