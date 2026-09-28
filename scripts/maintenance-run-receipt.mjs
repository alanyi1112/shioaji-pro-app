import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const groups = ['tick-tape', 'local-data', 'cloudflare'];
export function begin(previous, now) {
  if (previous?.status === 'running') return previous;
  return { version: 1, startedAt: now, status: 'running', groups: Object.fromEntries(groups.map(key => [key, { status: 'pending' }])) };
}
export function record(run, group, status, evidence, now) {
  if (run?.status !== 'running') throw new Error('No active run');
  if (!groups.includes(group) || !['verified', 'progress', 'blocked', 'deferred'].includes(status)) throw new Error('Invalid checkpoint');
  if (!evidence?.trim()) throw new Error('Evidence or concrete blocker required');
  return { ...run, groups: { ...run.groups, [group]: { status, evidence, checkedAt: now } } };
}
export function finish(run, now) {
  if (run?.status !== 'running') throw new Error('No active run');
  const pending = groups.filter(key => !run.groups[key] || run.groups[key].status === 'pending');
  if (pending.length) throw new Error(`Unattempted groups: ${pending.join(', ')}`);
  return { ...run, finishedAt: now, status: groups.every(key => run.groups[key].status === 'verified') ? 'verified' : 'incomplete' };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.codex/maintenance-runs');
  const target = path.join(directory, 'active.json');
  const now = new Date().toISOString();
  try {
    let run = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, 'utf8')) : null;
    if (command === 'status') {
      console.log(JSON.stringify(run ?? { status: 'missing' }, null, 2));
      process.exitCode = run?.status === 'verified' ? 0 : 2;
    } else {
      if (command === 'begin') run = begin(run, now);
      else if (command === 'record') run = record(run, ...args, now);
      else if (command === 'finish') run = finish(run, now);
      else throw new Error('Usage: begin | record GROUP STATUS EVIDENCE | finish | status');
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      const temporary = `${target}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify(run, null, 2) + '\n', { mode: 0o600 });
      fs.renameSync(temporary, target);
      if (command === 'finish') fs.writeFileSync(path.join(directory, `${run.startedAt.replaceAll(':', '-')}.json`), JSON.stringify(run, null, 2) + '\n', { mode: 0o600 });
      console.log(JSON.stringify(run, null, 2));
      if (command === 'finish' && run.status !== 'verified') process.exitCode = 2;
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
