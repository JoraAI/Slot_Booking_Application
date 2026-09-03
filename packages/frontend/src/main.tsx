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
import './index.css'

async function boot() {
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
