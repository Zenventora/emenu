import { useEffect } from 'react'
import { useAuthStore } from '@/store/authStore'
import api from '@/lib/api'

async function consumeAccountHandoff(): Promise<boolean> {
  const hash = window.location.hash.replace(/^#/, '')
  if (!hash) return false

  const params = new URLSearchParams(hash)
  const accessToken = params.get('access_token')
  const refreshToken = params.get('refresh_token')
  const type = params.get('type')
  const product = params.get('product')

  if (!accessToken || !refreshToken || type !== 'account_handoff' || product !== 'emenu') {
    return false
  }

  // The Accounts service intentionally delivers the one-time session in the
  // URL fragment because fragments are not sent to the server. Consume it
  // immediately, exchange it for EMenu HttpOnly cookies, then remove the
  // fragment so the credentials do not remain in the address bar/history.
  window.history.replaceState({}, document.title, window.location.pathname + window.location.search)

  await api.post('/auth/common/session', {
    accessToken,
    refreshToken,
    productFlow: 'signin',
    provisionOnly: false,
  })

  return true
}

export function useAuth() {
  const { user, isAuthenticated, isLoading, setUser, setLoading, logout } = useAuthStore()

  useEffect(() => {
    // On app load, first consume a ZenVentora Accounts handoff if one exists.
    // This is the bridge from accounts.zenventora.in back to the EMenu
    // same-origin session. Without it, the product receives the tokens but
    // never creates its own HttpOnly session cookies.
    const verifySession = async () => {
      setLoading(true)
      try {
        await consumeAccountHandoff()
        const res = await api.get('/auth/me')
        setUser(res.data.user)
      } catch {
        setUser(null)
      }
    }
    verifySession()

    // Listen for auth:logout events (triggered by axios interceptor on refresh failure)
    const handleLogout = () => logout()
    window.addEventListener('auth:logout', handleLogout)
    return () => window.removeEventListener('auth:logout', handleLogout)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const signOut = async () => {
    try {
      await api.post('/auth/logout')
    } finally {
      logout()
    }
  }

  return { user, isAuthenticated, isLoading, logout: signOut, setLoading }
}
