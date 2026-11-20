// Runs the relay (with auto-reload) and the Vite dev server together.
import { spawn } from 'node:child_process';

const procs = [
  ['relay', ['run', 'dev', '-w', 'apps/relay'], '\x1b[36m'],
  ['web', ['run', 'dev', '-w', 'apps/web'], '\x1b[35m'],
].map(([name, args, color]) => {
  const p = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
  const out = (d) => d.toString().split('\n').filter(Boolean).forEach((l) => console.log(`${color}[${name}]\x1b[0m ${l}`));
  p.stdout.on('data', out);
  p.stderr.on('data', out);
  p.on('exit', (code) => {
    console.log(`[${name}] exited with ${code}`);
    procs.forEach((q) => q.kill());
    process.exit(code ?? 0);
  });
  return p;
});
process.on('SIGINT', () => procs.forEach((p) => p.kill('SIGINT')));
