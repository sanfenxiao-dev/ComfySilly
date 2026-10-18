import { build } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
await build({configFile:false,root,define:{'process.env.NODE_ENV':'"production"',__VUE_OPTIONS_API__:'true',__VUE_PROD_DEVTOOLS__:'false',__VUE_PROD_HYDRATION_MISMATCH_DETAILS__:'false'},build:{outDir:'src/generated',emptyOutDir:true,minify:true,lib:{entry:resolve(root,'src/runtime/frameRuntime.ts'),name:'ComfyCardRuntime',formats:['iife'],fileName:()=> 'card-runtime.js'}}});
