// Starts the API server and the Vite dev server together, and explains itself if either cannot start.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname || path.dirname(new URL(import.meta.url).pathname), '..');
const [major, minor] = process.versions.node.split('.').map(Number);
const line = '\n----------------------------------------------------------------\n';

if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`${line}Anonymous cannot start: it needs Node.js 22.13 or newer, and this computer has ${process.versions.node}.\n\nInstall the current LTS version from https://nodejs.org, close and reopen VS Code,\nthen run "npm install" and "npm run dev" again.${line}`);
  process.exit(1);
}
const vite = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
if (!fs.existsSync(vite)) {
  console.error(`${line}Anonymous cannot start yet: its packages are not installed in this folder.\n\nRun "npm install" here (the folder that contains package.json), then "npm run dev" again.${line}`);
  process.exit(1);
}

const server = spawn(process.execPath, ['server/index.js'], { cwd: root, stdio: 'inherit' });
const web = spawn(process.execPath, [vite], { cwd: root, stdio: 'inherit' });

let stopping = false;
const stop = (code = 0) => { if (stopping) return; stopping = true; server.kill(); web.kill(); process.exit(code); };
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
server.on('exit', (code) => { if (!stopping) { console.error(`${line}The Anonymous server stopped (code ${code}). The reason is printed just above this line.${line}`); stop(1); } });
web.on('exit', (code) => { if (!stopping) { console.error(`${line}Vite stopped (code ${code}). The reason is printed just above this line.${line}`); stop(1); } });

console.log(`${line}Starting Anonymous. When both lines below appear, open http://localhost:5173\n  "Anonymous server listening on http://localhost:8787"\n  "VITE ... ready"${line}`);
