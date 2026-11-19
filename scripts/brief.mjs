// Assemble one task brief locally. Only read versioned templates, never the worktree's data.
import { readFileSync } from 'node:fs';

const pack = new URL('../prompts/', import.meta.url);
const cardVersions = { boardroom: 'v2', storage: 'v2', scene: 'v1', turn: 'v1', knowledge: 'v1' };
const areas = Object.keys(cardVersions);
const usage = `Usage: node scripts/brief.mjs <${areas.join('|')}> 'objective' 'observable pass condition'`;
const args = process.argv.slice(2).map(arg => arg.trim());
const [area, objective, acceptance] = args;

if (args.length === 1 && ['-h', '--help'].includes(area)) {
  console.log(usage);
} else if (args.length !== 3 || !areas.includes(area) || !objective || !acceptance) {
  console.error(usage);
  process.exitCode = 2;
} else {
  const card = readFileSync(new URL(`${cardVersions[area]}/cards/${area}.md`, pack), 'utf8').trimEnd();
  const template = readFileSync(new URL('v1/brief.md', pack), 'utf8');
  const fields = { objective, acceptance, card };
  // One pass: treat the caller's text literally, including '$&' or '{{card}}'.
  process.stdout.write(template.replace(/\{\{(objective|acceptance|card)\}\}/g, (_, key) => fields[key]));
}
