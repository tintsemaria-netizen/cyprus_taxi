import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { osmImportDue } from './importer';

// Worker hook (2026-11-19): starts the weekly address-base refresh as a separate process, so the
// ~1 minute, few-hundred-MB build never blocks dispatch. At most one run at a time.
let child: ChildProcess | null = null;

export async function maybeStartOsmImport(now = new Date()): Promise<'started' | 'running' | 'not-due' | 'disabled'> {
  if (process.env.OSM_IMPORT === 'off') return 'disabled';
  if (child && child.exitCode === null) return 'running';
  if (!(await osmImportDue(now))) return 'not-due';
  const cwd = process.cwd();
  const cli = path.join(cwd, 'node_modules/tsx/dist/cli.mjs');
  if (!existsSync(cli) || !existsSync(path.join(cwd, 'scripts/osm-import.ts'))) return 'disabled';
  child = spawn(process.execPath, ['--max-old-space-size=640', cli, '--tsconfig', 'tsconfig.json', 'scripts/osm-import.ts'], { cwd, stdio: 'inherit', env: process.env });
  child.on('exit', (code) => { console.log(`[osm-import] exited with ${code}`); child = null; });
  return 'started';
}
