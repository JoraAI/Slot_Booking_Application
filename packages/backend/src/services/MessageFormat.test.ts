import { test } from 'node:test';
import assert from 'node:assert';
import { attributesFromFormData, contactMatchesFilters, attributeKeyFromLabel } from './CustomerAttributes';
import { htmlToPlainText, sanitizeMessageHtml } from './MessageFormat';

test('attribute keys normalize labels', () => {
  assert.strictEqual(attributeKeyFromLabel('Gender'), 'gender');
  assert.strictEqual(attributeKeyFromLabel('Hair Type'), 'hair_type');
});

test('attributesFromFormData keeps gender and skips phone/name', () => {
  const attrs = attributesFromFormData(
    [
      { id: 'n1', label: 'Full Name', fieldType: 'text' },
      { id: 'p1', label: 'Phone', fieldType: 'tel' },
      { id: 'g1', label: 'Gender', fieldType: 'select' },
      { id: 'a1', label: 'Age', fieldType: 'number' },
    ],
    { n1: 'Ada', p1: '+919999', g1: 'Female', a1: '28' }
  );
  assert.deepStrictEqual(attrs, { gender: 'Female', age: '28' });
});

test('contactMatchesFilters matches service and attributes', () => {
  const contact = { lastServiceName: 'Haircut', attributes: { gender: 'Female' } };
  assert.equal(contactMatchesFilters(contact, { service: 'Haircut', attributes: { gender: 'Female' } }), true);
  assert.equal(contactMatchesFilters(contact, { service: 'Facial' }), false);
  assert.equal(contactMatchesFilters(contact, { attributes: { gender: 'Male' } }), false);
});

test('sanitizeMessageHtml keeps safe formatting and strips scripts', () => {
  const cleaned = sanitizeMessageHtml('<b style="color:#DC2626">Hi</b><script>alert(1)</script>');
  assert.match(cleaned, /<b/);
  assert.doesNotMatch(cleaned, /script/i);
  assert.strictEqual(htmlToPlainText('<b>Hello</b><br>there'), 'Hello\nthere');
});
