import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Capacitor wraps the Vite `dist/` owner dashboard for Android + iOS.
 * Customer booking stays on the web app; native shell is owner-only.
 *
 * Build: set VITE_API_BASE_URL to the public API origin, then:
 *   pnpm --filter frontend build:mobile
 */
const config: CapacitorConfig = {
  appId: 'ai.jora.reservly',
  appName: 'Jora Reservly',
  webDir: 'dist',
  server: {
    // https scheme avoids cleartext/mixed-content issues talking to Render/Vercel APIs.
    androidScheme: 'https',
    // Allow Razorpay checkout / Google GIS redirects inside the WebView when needed.
    allowNavigation: [
      'checkout.razorpay.com',
      'api.razorpay.com',
      '*.razorpay.com',
      'accounts.google.com',
      '*.google.com',
      '*.gstatic.com',
    ],
  },
  plugins: {
    StatusBar: {
      overlaysWebView: false,
      style: 'LIGHT',
      backgroundColor: '#ffffff',
    },
  },
}

export default config
