import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
// Preserve caller-supplied Vite options (for example --port); the backend stays on its own port.
const children = [spawn(process.execPath,['server/index.mjs'],{cwd:root,stdio:'inherit'}),spawn(process.execPath,['node_modules/vite/bin/vite.js','--configLoader','native','--host','127.0.0.1',...process.argv.slice(2)],{cwd:root,stdio:'inherit'})];
let stopping=false;
function stop(code=0){ if(stopping)return;stopping=true; for(const child of children) child.kill();process.exitCode=code; }
for(const child of children){child.on('error',error=>{console.error(error.message);stop(1)});child.on('exit',code=>stop(code??0));}
process.on('SIGINT',()=>stop());process.on('SIGTERM',()=>stop());
