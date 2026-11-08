import { Router, Request, Response } from 'express'
import bcrypt from 'bcryptjs'
import { v4 as uuidv4 } from 'uuid'
import rateLimit from 'express-rate-limit'
import prisma from '../lib/prisma'
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../lib/jwt'
import { sendOTPEmail } from '../lib/mailer'
import { requireAuth, AuthRequest } from '../middleware/auth'
import { resolveEmenuUser, revokeCommonSession, signUpCommonIdentity, verifyCommonAccessToken } from '../lib/common-auth'

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


function setCommonAuthCookie(res: Response, accessToken: string) {
  // Supabase refresh tokens stay on accounts.zenventora.in. EMenu stores only
  // a short-lived access token and asks Accounts for a fresh handoff at expiry.
  const maxAge = 60 * 60 * 1000
  res.cookie('emenu_common_access_token', accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge,
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

// ─── POST /api/auth/common/session ───────────────────────────────────────────
// Exchanges the one-time browser handoff for HttpOnly EMenu-origin session cookies.
// Supabase verifies the access token and email; EMenu then links the immutable identity.
router.post('/common/session', authLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const accessToken = String(req.body?.accessToken || '')
    if (!accessToken) {
      res.status(400).json({ message: 'A ZenVentora account session is required.' })
      return
    }
    const commonUser = await verifyCommonAccessToken(accessToken)
    const productFlow = String(req.body?.productFlow || '')
    const emenuUser = await resolveEmenuUser(commonUser, { allowCreate: productFlow === 'signup' })
    setCommonAuthCookie(res, accessToken)
    res.json({ message: 'ZenVentora account connected.', user: commonUserResponse(emenuUser, commonUser) })
  } catch (err) {
    console.error('Common account handoff failed:', err)
    res.status(401).json({ message: err instanceof Error ? err.message : 'Could not connect your ZenVentora account.' })
  }
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
    setCommonAuthCookie(res, result.access_token)
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
  const commonToken = req.cookies?.emenu_common_access_token
  if (commonToken) {
    try {
      await verifyCommonAccessToken(commonToken)
      res.json({ message: 'ZenVentora session is valid.' })
    } catch {
      clearCommonAuthCookies(res)
      res.status(401).json({ message: 'ZenVentora session expired. Reconnecting to Accounts.' })
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
