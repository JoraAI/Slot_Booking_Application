import { test } from 'node:test'
import assert from 'node:assert'
import { geoFailureMessage, mapPositionError } from './geolocation'

// Batch 4 §18.1 acceptance test 4: the geolocation helper maps denied /
// unsupported / insecure / timeout contexts to clear messages without crashing.
test('geolocation helper handles denied/unsupported/timeout errors safely', () => {
  assert.strictEqual(mapPositionError(1), 'denied')
  assert.strictEqual(mapPositionError(3), 'timeout')
  assert.strictEqual(mapPositionError(2), 'unavailable')
  assert.strictEqual(mapPositionError(0), 'unavailable')

  assert.match(geoFailureMessage('denied'), /permission was denied/i)
  assert.match(geoFailureMessage('timeout'), /timed out/i)
  assert.match(geoFailureMessage('unsupported'), /not supported/i)
  assert.match(geoFailureMessage('insecure'), /secure context/i)
  assert.match(geoFailureMessage('unavailable'), /unable to get your location/i)
})
