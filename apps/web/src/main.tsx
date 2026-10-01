import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AdminApp } from './admin/AdminApp.tsx'
import { AffiliateApp } from './affiliate/AffiliateApp.tsx'

// No router in this app (see App.tsx) — /admin and /partner are the two
// other top-level entry points, each a console entirely separate from the
// tenant-facing app and from each other (own auth, own token, no shared state).
const path = window.location.pathname
const isAdminRoute = path.startsWith('/admin')
const isPartnerRoute = path.startsWith('/partner')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isAdminRoute ? <AdminApp /> : isPartnerRoute ? <AffiliateApp /> : <App />}
  </StrictMode>,
)
