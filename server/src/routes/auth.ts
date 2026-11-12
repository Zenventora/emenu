import { Router, Request, Response } from 'express'
import bcrypt from 'bcryptjs'
import { v4 as uuidv4 } from 'uuid'
import rateLimit from 'express-rate-limit'
import prisma from '../lib/prisma'
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../lib/jwt'
import { sendOTPEmail } from '../lib/mailer'
import { requireAuth, AuthRequest } from '../middleware/auth'
import { CommonAuthUser, refreshCommonSession, resolveEmenuUser, revokeCommonSession, signUpCommonIdentity, verifyCommonAccessToken, verifyCommonSignupOtp } from '../lib/common-auth'

const router = Router()

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: 'Too many requests' })

// Cookie helper
function setAuthCookies(res: Response, accessToken: string, refreshToken: string) {
  res.cookie('access_token', accessToken, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production',
    sameSite: 'none', path: '/', maxAge: 15 * 60 * 1000,
  })
  res.cookie('refresh_token', refreshToken, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production',
    sameSite: 'none', path: '/', maxAge: 30 * 24 * 60 * 60 * 1000,
  })
}


function setCommonAuthCookies(res: Response, accessToken: string, refreshToken: string, expiresIn = 3600) {
  // Keep both Supabase tokens in HttpOnly, same-origin cookies. The browser never
  // reads either token; EMenu rotates them server-side through Supabase Auth.
  res.cookie('emenu_common_access_token', accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: Math.max(60, expiresIn) * 1000,
  })
  res.cookie('emenu_common_refresh_token', refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  })
}

function clearCommonAuthCookies(res: Response) {
  const options = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
  }
  res.clearCookie('emenu_common_access_token', options)
  res.clearCookie('emenu_common_refresh_token', options)
}

function commonUserResponse(user: any, authUser: AuthRequest['commonUser'] | null) {
  const metadata = authUser?.user_metadata || {}
  const avatarUrl = typeof metadata.avatar_url === 'string' ? metadata.avatar_url : (typeof metadata.picture === 'string' ? metadata.picture : null)
  return {
    id: user.id,
    name: String(metadata.full_name || metadata.name || user.name),
    email: authUser?.email || user.email,
    phone: String(metadata.phone_number || metadata.phone || user.phone || ''),
    authUserId: authUser?.id || null,
    avatar: avatarUrl,
    authProvider: authUser ? 'zenventora' : 'legacy',
  }
}

// ─── POST /api/auth/legacy/verify ────────────────────────────────────────────
// One-time compatibility check for existing EMenu users signing in through
// Common Accounts. This verifies the old bcrypt hash without creating a session,
// changing the password hash, or exposing any legacy credential material.
router.post('/legacy/verify', authLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase()
    const password = String(req.body?.password || '')
    if (!email || !password || email.length > 254 || password.length > 1024) {
      res.status(401).json({ message: 'Invalid email or password.' })
      return
    }

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, name: true, phone: true, passwordHash: true },
    })
    if (!user) {
      res.status(401).json({ message: 'Invalid email or password.' })
      return
    }

    // Never let an old product password bypass an already-linked Common identity.
    const existingLink = await prisma.emenuIdentityLink.findUnique({
      where: { emenuUserId: user.id },
      select: { id: true },
    })
    if (existingLink) {
      res.status(401).json({ message: 'Invalid email or password.' })
      return
    }

    const valid = await bcrypt.compare(password, user.passwordHash)
    if (!valid) {
      res.status(401).json({ message: 'Invalid email or password.' })
      return
    }

    res.setHeader('Cache-Control', 'no-store')
    res.json({
      verified: true,
      profile: {
        name: user.name,
        phone: user.phone || '',
      },
    })
  } catch (err) {
    console.error('Legacy EMenu credential verification failed:', err)
    res.status(503).json({ message: 'Legacy account verification is temporarily unavailable.' })
  }
})

// ─── POST /api/auth/common/session ───────────────────────────────────────────
// Exchanges the one-time browser handoff for HttpOnly EMenu-origin session cookies.
// Supabase verifies the access token and email; EMenu then links the immutable identity.
router.post('/common/session', authLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const accessToken = String(req.body?.accessToken || '')
    const refreshToken = String(req.body?.refreshToken || '')
    const provisionOnly = req.body?.provisionOnly === true
    if (!accessToken || !refreshToken || refreshToken.length > 2048) {
      res.status(400).json({ message: 'A complete ZenVentora account session is required.' })
      return
    }
    // A handoff can arrive just as the one-hour access token expires. In that
    // case rotate the refresh token first, then verify the fresh access token.
    let sessionAccessToken = accessToken
    let sessionRefreshToken = refreshToken
    let commonUser: CommonAuthUser
    try {
      commonUser = await verifyCommonAccessToken(sessionAccessToken)
    } catch {
      const refreshed = await refreshCommonSession(sessionRefreshToken)
      sessionAccessToken = refreshed.access_token
      sessionRefreshToken = refreshed.refresh_token
      commonUser = await verifyCommonAccessToken(sessionAccessToken)
      if (!provisionOnly) setCommonAuthCookies(res, sessionAccessToken, sessionRefreshToken, refreshed.expires_in)
    }
    const productFlow = String(req.body?.productFlow || '')
    // A verified Common Accounts user who reaches EMenu through the Connected Products
    // flow is allowed to activate the product on first access. Product signup still owns
    // the explicit signup experience; this prevents a valid account from being bounced
    // back to Accounts simply because its EMenu profile has not been provisioned yet.
    const emenuUser = await resolveEmenuUser(commonUser, { allowCreate: productFlow === 'signup' || productFlow === 'signin' })
    if (!provisionOnly) {
      setCommonAuthCookies(res, sessionAccessToken, sessionRefreshToken)
    }
    res.json({ message: provisionOnly ? 'ZenVentora account provisioned for EMenu.' : 'ZenVentora account connected.', user: commonUserResponse(emenuUser, commonUser) })
  } catch (err) {
    console.error('Common account handoff failed:', err)
    res.status(401).json({ message: err instanceof Error ? err.message : 'Could not connect your ZenVentora account.' })
  }
})

// ─── GET /api/auth/public-config ──────────────────────────────────────────────
// Exposes only the public Supabase project URL and publishable/anon key so product
// pages can launch OAuth directly without sending users through the Accounts UI.
router.get('/public-config', (_req: Request, res: Response): void => {
  const url = process.env.COMMON_SUPABASE_URL?.replace(/\/$/, '')
  const key = process.env.COMMON_SUPABASE_PUBLISHABLE_KEY
  if (!url || !key) {
    res.status(503).json({ message: 'Google sign-in is not configured.' })
    return
  }
  res.setHeader('Cache-Control', 'public, max-age=300')
  res.json({ url, key })
})

// ─── POST /api/auth/signup ────────────────────────────────────────────────────
// EMenu owns the product signup experience; credentials are created in Common Accounts.
router.post('/signup', authLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, email, phone, password } = req.body
    if (!name || !email || !phone || !password) {
      res.status(400).json({ message: 'Name, phone, email, and password are required' })
      return
    }
    if (String(password).length < 8) {
      res.status(400).json({ message: 'Password must be at least 8 characters' })
      return
    }

    const result = await signUpCommonIdentity({
      name: String(name),
      email: String(email),
      phone: String(phone),
      password: String(password),
      origin: String(req.get('origin') || ''),
    })

    if (!result.access_token) {
      res.status(202).json({
        message: 'Your ZenVentora account has been created. Check your email to verify it; you will return to EMenu automatically.',
        requiresVerification: true,
      })
      return
    }

    const commonUser = await verifyCommonAccessToken(result.access_token)
    const emenuUser = await resolveEmenuUser(commonUser, { allowCreate: true })
    if (!result.refresh_token) throw new Error('ZenVentora did not return a complete signup session. Please sign in again.')
    setCommonAuthCookies(res, result.access_token, result.refresh_token)
    res.status(201).json({
      message: 'Account created successfully.',
      user: commonUserResponse(emenuUser, commonUser),
      requiresVerification: false,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Something went wrong. Please try again.'
    const status = message.includes('already exist') ? 409 : 400
    res.status(status).json({ message })
  }
})

// ─── POST /api/auth/verify-signup ─────────────────────────────────────────────
router.post('/verify-signup', authLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase()
    const token = String(req.body?.token || '').trim()
    if (!email || !/^\\d{6,8}$/.test(token)) {
      res.status(400).json({ message: 'Enter the verification code from your email.' })
      return
    }
    const session = await verifyCommonSignupOtp(email, token)
    const commonUser = await verifyCommonAccessToken(session.access_token)
    const emenuUser = await resolveEmenuUser(commonUser, { allowCreate: true })
    setCommonAuthCookies(res, session.access_token, session.refresh_token, session.expires_in)
    res.setHeader('Cache-Control', 'no-store')
    res.json({ message: 'Email verified. Your eMenu account is ready.', user: commonUserResponse(emenuUser, commonUser) })
  } catch (err) {
    res.status(400).json({ message: err instanceof Error ? err.message : 'Email verification failed.' })
  }
})

// ─── POST /api/auth/login ─────────────────────────────────────────────────────
router.post('/login', authLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body

    if (!email || !password) {
      res.status(400).json({ message: 'Email and password are required' })
      return
    }

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } })
    if (!user) {
      res.status(401).json({ message: 'Invalid email or password' })
      return
    }

    const valid = await bcrypt.compare(password, user.passwordHash)
    if (!valid) {
      res.status(401).json({ message: 'Invalid email or password' })
      return
    }

    const accessToken = signAccessToken({ userId: user.id, email: user.email })
    const refreshToken = signRefreshToken({ userId: user.id, email: user.email })

    await prisma.session.create({
      data: {
        userId: user.id,
        refreshToken,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    })

    setAuthCookies(res, accessToken, refreshToken)
    res.json({
      message: 'Login successful',
      user: { id: user.id, name: user.name, email: user.email, phone: user.phone },
    })
  } catch (err) {
    console.error('Login error:', err)
    res.status(500).json({ message: 'Something went wrong. Please try again.' })
  }
})

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────
router.get('/me', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { id: true, name: true, email: true, phone: true },
    })
    if (!user) { res.status(404).json({ message: 'User not found' }); return }
    res.json({ user: commonUserResponse(user, req.commonUser || null) })
  } catch (err) {
    res.status(500).json({ message: 'Server error' })
  }
})

// ─── PATCH /api/auth/me ───────────────────────────────────────────────────────
router.patch('/me', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, phone } = req.body
    const user = await prisma.user.update({
      where: { id: req.userId },
      data: { ...(name && { name }), ...(phone !== undefined && { phone }) },
      select: { id: true, name: true, email: true, phone: true },
    })
    res.json({ user })
  } catch (err) {
    res.status(500).json({ message: 'Server error' })
  }
})

// ─── POST /api/auth/refresh ───────────────────────────────────────────────────
router.post('/refresh', async (req: Request, res: Response): Promise<void> => {
  const commonRefreshToken = req.cookies?.emenu_common_refresh_token
  if (commonRefreshToken) {
    try {
      const refreshed = await refreshCommonSession(commonRefreshToken)
      await verifyCommonAccessToken(refreshed.access_token)
      setCommonAuthCookies(res, refreshed.access_token, refreshed.refresh_token, refreshed.expires_in)
      res.json({ message: 'ZenVentora session refreshed.' })
    } catch {
      clearCommonAuthCookies(res)
      res.status(401).json({ message: 'ZenVentora session expired. Please sign in again.' })
    }
    return
  }

  // Compatibility for sessions created before EMenu stored the refresh token.
  const commonToken = req.cookies?.emenu_common_access_token
  if (commonToken) {
    try {
      await verifyCommonAccessToken(commonToken)
      res.json({ message: 'ZenVentora session is valid.' })
    } catch {
      clearCommonAuthCookies(res)
      res.status(401).json({ message: 'ZenVentora session expired. Please sign in again.' })
    }
    return
  }

  // Temporary compatibility for pre-migration EMenu sessions.
  try {
    const token = req.cookies?.refresh_token
    if (!token) { res.status(401).json({ message: 'No refresh token' }); return }
    const payload = verifyRefreshToken(token)
    const session = await prisma.session.findUnique({ where: { refreshToken: token } })
    if (!session || session.expiresAt < new Date()) {
      res.status(401).json({ message: 'Session expired' }); return
    }
    const newAccessToken = signAccessToken({ userId: payload.userId, email: payload.email })
    res.cookie('access_token', newAccessToken, {
      httpOnly: true, secure: process.env.NODE_ENV === 'production',
      sameSite: 'none', path: '/', maxAge: 15 * 60 * 1000,
    })
    res.json({ message: 'Token refreshed' })
  } catch {
    res.status(401).json({ message: 'Invalid refresh token' })
  }
})

// ─── POST /api/auth/logout ────────────────────────────────────────────────────
router.post('/logout', async (req: Request, res: Response): Promise<void> => {
  try {
    const legacyRefresh = req.cookies?.refresh_token
    if (legacyRefresh) await prisma.session.deleteMany({ where: { refreshToken: legacyRefresh } })
    clearCommonAuthCookies(res)
    res.clearCookie('access_token', { path: '/' })
    res.clearCookie('refresh_token', { path: '/' })
    res.json({ message: 'Local EMenu session cleared.' })
  } catch {
    res.status(500).json({ message: 'Logout failed' })
  }
})

// ─── POST /api/auth/forgot-password ──────────────────────────────────────────
router.post('/forgot-password', authLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { email } = req.body
    if (!email) { res.status(400).json({ message: 'Email is required' }); return }

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } })
    // Always respond OK — don't leak whether email exists
    if (!user) { res.json({ message: 'If this email exists, an OTP has been sent.' }); return }

    // Bug fix: invalidate all previous unused OTPs for this user before creating a new one.
    // Without this, an attacker who intercepts an old OTP email can still use it even after
    // the user has requested a new code.
    await prisma.oTP.updateMany({
      where: { userId: user.id, type: 'FORGOT_PASSWORD', used: false },
      data: { used: true },
    })

    const otp = Math.floor(100000 + Math.random() * 900000).toString()
    await prisma.oTP.create({
      data: {
        userId: user.id, email: user.email,
        code: otp, type: 'FORGOT_PASSWORD',
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    })

    await sendOTPEmail(user.email, user.name, otp)
    res.json({ message: 'If this email exists, an OTP has been sent.' })
  } catch (err) {
    console.error('Forgot password error:', err)
    res.status(500).json({ message: 'Failed to send OTP. Please try again.' })
  }
})

// ─── POST /api/auth/reset-password ───────────────────────────────────────────
router.post('/reset-password', authLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, otp, newPassword } = req.body
    if (!email || !otp || !newPassword) {
      res.status(400).json({ message: 'Email, OTP, and new password are required' }); return
    }
    if (newPassword.length < 8) {
      res.status(400).json({ message: 'Password must be at least 8 characters' }); return
    }

    const record = await prisma.oTP.findFirst({
      where: {
        email: email.toLowerCase(), code: otp,
        type: 'FORGOT_PASSWORD', used: false,
        expiresAt: { gt: new Date() },
      },
    })
    if (!record) { res.status(400).json({ message: 'Invalid or expired OTP' }); return }

    const passwordHash = await bcrypt.hash(newPassword, 12)
    await prisma.user.update({ where: { id: record.userId }, data: { passwordHash } })
    await prisma.oTP.update({ where: { id: record.id }, data: { used: true } })
    // Invalidate all sessions
    await prisma.session.deleteMany({ where: { userId: record.userId } })

    res.clearCookie('access_token', { path: '/' })
    res.clearCookie('refresh_token', { path: '/' })
    res.json({ message: 'Password reset successfully. Please log in.' })
  } catch (err) {
    console.error('Reset password error:', err)
    res.status(500).json({ message: 'Failed to reset password.' })
  }
})

// ─── POST /api/auth/google/redirect ──────────────────────────────────────────
// Handles Google GIS redirect mode — Google POSTs the credential here as a form body,
// we verify it, create a session, set cookies, and redirect back to the app.
// This avoids all popup/window.opener issues in Chrome.
router.post('/google/redirect', async (req: Request, res: Response): Promise<void> => {
  try {
    const credential = req.body.credential
    if (!credential) { res.redirect('/?google=error'); return }

    const clientId = process.env.GOOGLE_CLIENT_ID
    if (!clientId) { res.redirect('/?google=error'); return }

    const infoRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${credential}`)
    if (!infoRes.ok) { res.redirect('/?google=error'); return }

    const payload = await infoRes.json() as {
      aud: string; email: string; name?: string; sub: string
    }
    if (payload.aud !== clientId) { res.redirect('/?google=error'); return }
    if (!payload.email) { res.redirect('/?google=error'); return }

    const email = payload.email.toLowerCase()
    const name  = payload.name || email.split('@')[0]
    const sub   = payload.sub

    let user = await prisma.user.findUnique({ where: { email } })
    if (!user) {
      const passwordHash = await bcrypt.hash('__google__' + sub + uuidv4(), 12)
      user = await prisma.user.create({
        data: { name, email, passwordHash, isVerified: true },
      })
    }

    const accessToken  = signAccessToken({ userId: user.id, email: user.email })
    const refreshToken = signRefreshToken({ userId: user.id, email: user.email })

    await prisma.session.create({
      data: {
        userId: user.id, refreshToken,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        ipAddress: req.ip, userAgent: req.headers['user-agent'],
      },
    })

    setAuthCookies(res, accessToken, refreshToken)
    res.redirect('/?google=ok')
  } catch (err) {
    console.error('Google redirect auth error:', err)
    res.redirect('/?google=error')
  }
})

// ─── POST /api/auth/google ────────────────────────────────────────────────────
// Verifies the Google ID token via Google's tokeninfo API (no extra package needed).
// Never trust client-decoded JWT — always verify server-side.
router.post('/google', authLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { credential } = req.body
    if (!credential) { res.status(400).json({ message: 'Google credential is required' }); return }

    const clientId = process.env.GOOGLE_CLIENT_ID
    if (!clientId) { res.status(500).json({ message: 'Google Sign-In not configured on server' }); return }

    // Verify token via Google's tokeninfo endpoint (works on Node 18+ with native fetch)
    const infoRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${credential}`)
    if (!infoRes.ok) { res.status(401).json({ message: 'Invalid Google credential' }); return }

    const payload = await infoRes.json() as {
      aud: string; email: string; name?: string; sub: string; email_verified?: string
    }

    // Ensure token was issued for our app (prevents token substitution attacks)
    if (payload.aud !== clientId) {
      res.status(401).json({ message: 'Google token audience mismatch' }); return
    }
    if (!payload.email) { res.status(400).json({ message: 'No email from Google' }); return }

    const email = payload.email.toLowerCase()
    const name  = payload.name || email.split('@')[0]
    const sub   = payload.sub

    // Find or create user — Google has verified email ownership so we trust it
    let user = await prisma.user.findUnique({ where: { email } })
    if (!user) {
      // New user: store a secure random placeholder password (never used for login)
      const passwordHash = await bcrypt.hash('__google__' + sub + uuidv4(), 12)
      user = await prisma.user.create({
        data: { name, email, passwordHash, isVerified: true },
      })
    }

    const accessToken  = signAccessToken({ userId: user.id, email: user.email })
    const refreshToken = signRefreshToken({ userId: user.id, email: user.email })

    await prisma.session.create({
      data: {
        userId: user.id, refreshToken,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        ipAddress: req.ip, userAgent: req.headers['user-agent'],
      },
    })

    setAuthCookies(res, accessToken, refreshToken)
    res.json({
      message: 'Google sign-in successful',
      user: { id: user.id, name: user.name, email: user.email, phone: user.phone },
    })
  } catch (err) {
    console.error('Google auth error:', err)
    res.status(500).json({ message: 'Google sign-in failed. Please try again.' })
  }
})

export default router
