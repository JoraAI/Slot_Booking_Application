import { test } from 'node:test';
import assert from 'node:assert';
import {
  hashOwnerPassword,
  isHashedOwnerPassword,
  verifyOwnerPassword,
} from './OwnerPassword';

test('owner passwords are stored as bcrypt hashes', async () => {
  const hashed = await hashOwnerPassword('admin123');
  assert.equal(isHashedOwnerPassword(hashed), true);
  assert.equal(hashed.includes('admin123'), false);
  assert.equal(await verifyOwnerPassword(hashed, 'admin123'), true);
  assert.equal(await verifyOwnerPassword(hashed, 'wrongpass'), false);
});

test('legacy plaintext passwords still verify until they are upgraded', async () => {
  assert.equal(await verifyOwnerPassword('admin123', 'admin123'), true);
  assert.equal(await verifyOwnerPassword('admin123', 'nope'), false);
  assert.equal(isHashedOwnerPassword('admin123'), false);
});
