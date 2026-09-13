import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CAPACITOR_NATIVE_STRATEGY, isIosDevice, qrDownloadStrategy, sanitizeQrFileName } from './qrDownload'

const devices = [
  {
    name: 'iPhone Safari (iOS 18 / Pro Max style)',
    nav: {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1',
      platform: 'iPhone',
      maxTouchPoints: 5,
    },
    expectIos: true,
    expectStrategy: 'ios-share-or-overlay' as const,
  },
  {
    name: 'iPadOS desktop-mode Safari',
    nav: {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15',
      platform: 'MacIntel',
      maxTouchPoints: 5,
    },
    expectIos: true,
    expectStrategy: 'ios-share-or-overlay' as const,
  },
  {
    name: 'Android Chrome',
    nav: {
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
      platform: 'Linux armv8l',
      maxTouchPoints: 5,
    },
    expectIos: false,
    expectStrategy: 'blob-anchor-download' as const,
  },
  {
    name: 'Android Capacitor WebView',
    nav: {
      userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      platform: 'Linux armv8l',
      maxTouchPoints: 10,
    },
    expectIos: false,
    expectStrategy: 'blob-anchor-download' as const,
  },
  {
    name: 'Mac desktop Safari',
    nav: {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
      platform: 'MacIntel',
      maxTouchPoints: 0,
    },
    expectIos: false,
    expectStrategy: 'blob-anchor-download' as const,
  },
  {
    name: 'Mac desktop Chrome',
    nav: {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      platform: 'MacIntel',
      maxTouchPoints: 0,
    },
    expectIos: false,
    expectStrategy: 'blob-anchor-download' as const,
  },
]

for (const d of devices) {
  test(`detect: ${d.name}`, () => {
    assert.equal(isIosDevice(d.nav), d.expectIos)
    assert.equal(qrDownloadStrategy(d.nav), d.expectStrategy)
  })
}

test('Android must NOT use iOS share path even when canShare would be true', () => {
  const android = devices.find((d) => d.name === 'Android Chrome')!
  // Simulate the page rule: only enter share branch when strategy is ios-share-or-overlay
  const strategy = qrDownloadStrategy(android.nav)
  const wouldPreferShare = strategy === 'ios-share-or-overlay' && true /* canShare */
  assert.equal(wouldPreferShare, false)
})

test('capacitor-native label matches QRCodePage branch (regression)', () => {
  // QRCodePage checks strategy === CAPACITOR_NATIVE_STRATEGY. A renamed return
  // value silently falls through to blob download and breaks Capacitor apps.
  assert.equal(CAPACITOR_NATIVE_STRATEGY, 'capacitor-native')
})

test('Mac desktop uses blob download, not iOS overlay', () => {
  const mac = devices.find((d) => d.name === 'Mac desktop Safari')!
  assert.equal(qrDownloadStrategy(mac.nav), 'blob-anchor-download')
})

test('sanitizeQrFileName strips unsafe characters', () => {
  assert.equal(sanitizeQrFileName('Villasita salon'), 'Villasita_salon-booking-qr.png')
  assert.equal(sanitizeQrFileName('Demo/Salon #1'), 'Demo_Salon_1-booking-qr.png')
  assert.equal(sanitizeQrFileName(''), 'business-booking-qr.png')
})
