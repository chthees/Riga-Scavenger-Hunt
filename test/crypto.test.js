import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalize,
  createLock,
  openLock,
  encryptJson,
  decryptJson,
  randomBytes,
  toHex,
  fromHex,
  toB64,
  fromB64,
} from '../src/crypto.js';

const FAST = { iterations: 1000 };

test('normalize ignores case, accents, spaces and punctuation', () => {
  assert.equal(normalize('Vecā Ļaudīs'), 'vecalaudis');
  assert.equal(normalize('  Grüne Brücke! '), 'grunebrucke');
  assert.equal(normalize('SKIP-K7QM-2X'), 'skipk7qm2x');
  assert.equal(normalize('Mēness un Saulīte'), 'menessunsaulite');
  assert.equal(normalize('Straße'), 'strasse');
  assert.equal(normalize('St. Anne’s Garden'), 'stannesgarden');
  assert.equal(normalize('   '), '');
  assert.equal(normalize('The Hall of Mirrors'), 'hallofmirrors');
  assert.equal(normalize('  the  green bridges'), 'greenbridges');
  assert.equal(normalize('Theatre'), 'theatre');
});

test('hex and base64 round trips', () => {
  const b = randomBytes(100);
  assert.deepEqual(fromHex(toHex(b)), b);
  assert.deepEqual(fromB64(toB64(b)), b);
});

test('json encrypt/decrypt round trip', async () => {
  const key = randomBytes(32);
  const box = await encryptJson(key, { hello: 'Rīga', n: 1 });
  assert.deepEqual(await decryptJson(key, box), { hello: 'Rīga', n: 1 });
  await assert.rejects(decryptJson(randomBytes(32), box));
});

test('every accepted variant opens the lock and yields the same key', async () => {
  const secret = randomBytes(32);
  const prev = toHex(randomBytes(32));
  const lock = await createLock(
    prev,
    ['Green Bridges', 'Zaļie tilti', 'grüne brücken'].map((answer) => ({ answer, secret })),
    FAST
  );
  assert.equal(lock.slots.length, 8);
  for (const a of ['green bridges', 'GREEN-BRIDGES', 'zalie tilti', 'Grune Brucken']) {
    const got = await openLock(lock, prev, a, FAST.iterations);
    assert.ok(got, `should open with "${a}"`);
    assert.deepEqual(got, secret);
  }
});

test('wrong answers and wrong chain do not open the lock', async () => {
  const secret = randomBytes(32);
  const prev = toHex(randomBytes(32));
  const lock = await createLock(prev, [{ answer: 'architecture', secret }], FAST);
  assert.equal(await openLock(lock, prev, 'architectur', FAST.iterations), null);
  assert.equal(await openLock(lock, prev, '', FAST.iterations), null);
  assert.equal(await openLock(lock, toHex(randomBytes(32)), 'architecture', FAST.iterations), null);
});

test('too many variants is an error', async () => {
  const secret = randomBytes(32);
  const entries = Array.from({ length: 9 }, (_, i) => ({ answer: 'answer' + i, secret }));
  await assert.rejects(createLock('', entries, FAST), /Too many/);
});
