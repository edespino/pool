/*
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const guardPath = fileURLToPath(new URL('../src/processGuards.js', import.meta.url));

// Runs a child Node process that triggers the same kind of orphan unhandled
// rejection node-screenlogic's closeAsync leaks during teardown, optionally with
// our guard installed. Returns the child's exit status.
function runChild(withGuard) {
  const script = `
    ${withGuard ? `const m = await import(${JSON.stringify(guardPath)}); m.installUnhandledRejectionGuard(() => {});` : ''}
    Promise.resolve().then(() => { throw new Error('time out waiting for remove client response'); });
    setTimeout(() => process.exit(0), 300);
  `;
  return spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
}

test('without the guard, an unhandled rejection crashes the process (non-zero exit)', () => {
  const r = runChild(false);
  assert.notEqual(r.status, 0);
});

test('with the guard installed, an unhandled rejection does not crash the process', () => {
  const r = runChild(true);
  assert.equal(r.status, 0);
});
