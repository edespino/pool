import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRole, ROLE_NAMES } from '../src/circuitRoles.js';

const circuits = [
  { id: 6, name: 'Pool', on: false },
  { id: 1, name: 'Spa', on: false },
  { id: 7, name: 'Spillway', on: false },
  { id: 3, name: 'Pool Light', on: false },
  { id: 5, name: 'Yard Light', on: false },
];

test('resolves a known role to its circuit id (case-insensitive)', () => {
  assert.equal(resolveRole('pool', circuits), 6);
  assert.equal(resolveRole('spillway', circuits), 7);
  assert.equal(resolveRole('poolLight', circuits), 3);
});

test('returns null for an unknown role key', () => {
  assert.equal(resolveRole('nope', circuits), null);
});

test('returns null when the role circuit is absent', () => {
  assert.equal(resolveRole('spaLight', circuits), null); // not in list
});

test('ROLE_NAMES covers the six controllable roles', () => {
  assert.deepEqual(Object.keys(ROLE_NAMES).sort(), ['pool', 'poolLight', 'spa', 'spaLight', 'spillway', 'yardLight'].sort());
});
