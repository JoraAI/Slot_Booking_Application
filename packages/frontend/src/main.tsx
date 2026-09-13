import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import App from './App'
import { HtmlDocumentOverlay } from './components/HtmlDocumentOverlay'
import { NativeBackHandler } from './components/NativeBackHandler'
import { hydrateOwnerToken } from './lib/tokenStorage'
import { api } from './lib/api'
import { useStore } from './store'
import { configureNativeChrome } from './lib/nativeChrome'
import { requestStartupPermissions } from './lib/startupPermissions'
import './index.css'

async function boot() {
  await configureNativeChrome()
  // Fire-and-forget so the first-launch permission sheet does not block UI paint.
  void requestStartupPermissions()

  const token = await hydrateOwnerToken()
  if (token) {
    api.setToken(token)
    useStore.getState().setIsAuthenticated(true)
  }

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <BrowserRouter>
        <NativeBackHandler />
        <App />
        <HtmlDocumentOverlay />
        <Toaster position="bottom-right" toastOptions={{ duration: 4000 }} />
      </BrowserRouter>
    </React.StrictMode>,
  )
}

void boot()
