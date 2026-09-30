import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeGoogleReviewUrl } from './LocationService';

test('GR-1. Empty clears', () => {
  assert.deepEqual(normalizeGoogleReviewUrl(''), { ok: true, url: null });
  assert.deepEqual(normalizeGoogleReviewUrl(null), { ok: true, url: null });
  assert.deepEqual(normalizeGoogleReviewUrl('   '), { ok: true, url: null });
});

test('GR-2. Accepts Google review hosts', () => {
  const r = normalizeGoogleReviewUrl('https://g.page/r/AbCdEf/review');
  assert.equal(r.ok, true);
  if (r.ok) assert.match(r.url!, /^https:\/\/g\.page\//);
});

test('GR-3. Rejects non-Google hosts', () => {
  const r = normalizeGoogleReviewUrl('https://evil.example/phish');
  assert.equal(r.ok, false);
});

test('GR-4. Rejects http', () => {
  const r = normalizeGoogleReviewUrl('http://maps.google.com/maps?cid=1');
  assert.equal(r.ok, false);
});
