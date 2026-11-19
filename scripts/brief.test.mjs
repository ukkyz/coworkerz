import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const cli = fileURLToPath(new URL('scripts/brief.mjs', root));
const run = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd: tmpdir(), encoding: 'utf8' });
const versions = { boardroom: 'v2', storage: 'v2', scene: 'v1', turn: 'v1', knowledge: 'v1' };
const areas = Object.keys(versions);
const cards = Object.fromEntries(areas.map(area => [
  area, readFileSync(new URL(`prompts/${versions[area]}/cards/${area}.md`, root), 'utf8').trim(),
]));

for (const area of areas) {
  test(`${area}: fill the contract and include only the selected card`, () => {
    const { status, stdout, stderr } = run(area, 'A synthetic objective.', 'A measurable result.');
    assert.equal(status, 0, stderr);
    assert.match(stdout, /implementation brief v1/);
    assert.ok(stdout.includes('A synthetic objective.') && stdout.includes('A measurable result.'));
    assert.doesNotMatch(stdout, /\{\{\w+\}\}/);
    for (const other of areas) assert.equal(stdout.includes(cards[other]), other === area);
    // A stale read-set pointer wastes the next agent's context window.
    for (const [, path] of stdout.matchAll(/`((?:docs|src|prompts)\/[^`\s]+)`/g)) {
      assert.ok(existsSync(new URL(path, root)), `Broken read-set path: ${path}`);
    }
  });
}

test('treat task text as literal, not template syntax or replacement tokens', () => {
  const objective = 'Budget $120,000; keep $& and {{card}} unchanged.';
  assert.ok(run('turn', objective, 'One gate.').stdout.includes(objective));
});

test('help is printable; reject missing criteria, extra arguments and unknown areas', () => {
  assert.equal(run('--help').status, 0);
  for (const args of [[], ['scene', 'Batch slats'], ['turn', '  ', 'Pass'], ['turn', 'Goal', '  '],
    ['../memory', 'Goal', 'Pass'], ['scene', 'Goal', 'Pass', 'extra']]) {
    const { status, stdout, stderr } = run(...args);
    assert.equal(status, 2);
    assert.equal(stdout, '');
    assert.match(stderr, /Usage:/);
  }
});
