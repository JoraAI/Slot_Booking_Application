import { test } from 'node:test';
import assert from 'node:assert';
import { decryptSecret, encryptSecret } from './secretCrypto';

test('encryptSecret round-trips and is not stored in plaintext', () => {
  const cipher = encryptSecret('gmail-app-password');
  assert.ok(cipher.startsWith('enc:v1:'));
  assert.ok(!cipher.includes('gmail-app-password'));
  assert.strictEqual(decryptSecret(cipher), 'gmail-app-password');
});

test('decryptSecret returns plaintext legacy values unchanged', () => {
  assert.strictEqual(decryptSecret('already-plain'), 'already-plain');
  assert.strictEqual(decryptSecret(null), null);
  assert.strictEqual(decryptSecret(''), null);
});
