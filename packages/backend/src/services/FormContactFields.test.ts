import { test } from 'node:test';
import assert from 'node:assert';
import { ensurePhoneAndEmailFields } from './FormContactFields';

test('ensurePhoneAndEmailFields keeps phone and email visible and restores missing ones', () => {
  const result = ensurePhoneAndEmailFields([
    { label: 'Full Name', fieldType: 'text', required: true, visible: true },
    { label: 'Phone Number', fieldType: 'tel', required: true, visible: false },
    { label: 'Notes', fieldType: 'textarea', required: false, visible: true },
  ]);
  const phone = result.find((field) => field.fieldType === 'tel');
  const email = result.find((field) => field.fieldType === 'email');
  assert.ok(phone);
  assert.ok(email);
  assert.strictEqual(phone?.visible, true);
  assert.strictEqual(email?.visible, true);
  assert.strictEqual(email?.required, false);
});
