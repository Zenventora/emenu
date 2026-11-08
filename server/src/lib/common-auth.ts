import bcrypt from 'bcryptjs'
import { v4 as uuidv4 } from 'uuid'
import prisma from './prisma'

export interface CommonAuthUser {
  id: string
  email: string
  email_confirmed_at?: string | null
  confirmed_at?: string | null
  user_metadata?: Record<string, unknown>
  app_metadata?: Record<string, unknown>
}

function commonAuthConfig() {
  const url = process.env.COMMON_SUPABASE_URL?.replace(/\/$/, '')
  const key = process.env.COMMON_SUPABASE_PUBLISHABLE_KEY
  if (!url || !key) throw new Error('Common Accounts authentication is not configured on EMenu.')
  return { url, key }
}

/** Verify a Common Accounts access token with Supabase Auth itself. */
export async function verifyCommonAccessToken(accessToken: string): Promise<CommonAuthUser> {
  if (!accessToken || accessToken.length > 12000) throw new Error('Invalid account session.')
  const { url, key } = commonAuthConfig()
  const response = await fetch(`${url}/auth/v1/user`, {
    method: 'GET',
    headers: { apikey: key, Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) throw new Error('Your ZenVentora session has expired. Please sign in again.')
  const user = await response.json() as CommonAuthUser
  if (!user.id || !user.email) throw new Error('The ZenVentora account did not return a valid identity.')
  if (!user.email_confirmed_at && !user.confirmed_at && user.user_metadata?.email_verified !== true) {
    throw new Error('Verify your email address before accessing EMenu.')
  }
  return user
}

export async function revokeCommonSession(accessToken: string): Promise<void> {
  if (!accessToken) return
  const { url, key } = commonAuthConfig()
  const response = await fetch(`${url}/auth/v1/logout?scope=global`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok && response.status !== 401) {
    throw new Error('Could not sign out from your ZenVentora account. Please try again.')
  }
}

/**
 * Resolve a verified Common Accounts identity to the immutable EMenu users.id.
 * A same-email legacy record is linked in place; a new EMenu user is created only
 * when the person returns from the EMenu product-signup flow.
 */
export async function resolveEmenuUser(commonUser: CommonAuthUser, options: { allowCreate?: boolean } = {}) {
  const email = commonUser.email.trim().toLowerCase()
  if (!commonUser.id || !email) throw new Error('A verified ZenVentora identity is required.')

  const existingLink = await prisma.emenuIdentityLink.findUnique({
    where: { authUserId: commonUser.id },
    include: { user: true },
  })
  if (existingLink) {
    if (existingLink.user.email.toLowerCase() !== email && existingLink.email !== email) {
      await prisma.emenuIdentityLink.update({
        where: { id: existingLink.id },
        data: { email },
      })
    }
    return existingLink.user
  }

  let emenuUser = await prisma.user.findUnique({ where: { email } })
  if (!emenuUser && !options.allowCreate) {
    throw new Error('No EMenu profile is linked to this ZenVentora account yet. Choose Create EMenu Account to activate the product, or contact support to connect an existing profile.')
  }

  if (!emenuUser) {
    const metadata = commonUser.user_metadata || {}
    const fullName = String(metadata.full_name || metadata.name || email.split('@')[0]).trim().slice(0, 120)
    const phone = String(metadata.phone_number || metadata.phone || '').trim().slice(0, 40) || null
    const passwordHash = await bcrypt.hash(`common-account:${commonUser.id}:${uuidv4()}`, 12)
    emenuUser = await prisma.user.create({
      data: { name: fullName || email.split('@')[0], email, phone, passwordHash, isVerified: true },
    })
  }

  const existingOwner = await prisma.emenuIdentityLink.findUnique({
    where: { emenuUserId: emenuUser.id },
  })
  if (existingOwner && existingOwner.authUserId !== commonUser.id) {
    throw new Error('This EMenu profile is already connected to a different ZenVentora account. Contact support to verify ownership.')
  }

  try {
    await prisma.emenuIdentityLink.create({
      data: { authUserId: commonUser.id, emenuUserId: emenuUser.id, email },
    })
  } catch (error) {
    // Handle concurrent callbacks idempotently without ever changing a pre-existing link.
    const raced = await prisma.emenuIdentityLink.findUnique({
      where: { authUserId: commonUser.id },
      include: { user: true },
    })
    if (raced) return raced.user
    throw error
  }

  return emenuUser
}

export interface CommonSignupResult {
  access_token?: string
  user?: CommonAuthUser & { identities?: unknown[] }
  [key: string]: unknown
}

/** Create the canonical identity from EMenu's product-branded signup form. */
export async function signUpCommonIdentity(input: {
  name: string
  email: string
  phone: string
  password: string
  origin: string
}): Promise<CommonSignupResult> {
  const { url, key } = commonAuthConfig()
  const allowedOrigins = new Set([
    'https://emenu.zenventora.in',
    'https://emenu-x75b.onrender.com',
  ])
  const origin = allowedOrigins.has(input.origin) ? input.origin : 'https://emenu.zenventora.in'
  const callback = new URL('https://accounts.zenventora.in/')
  callback.searchParams.set('returnTo', origin)
  callback.searchParams.set('product', 'emenu')
  callback.searchParams.set('productFlow', 'signup')

  const response = await fetch(`${url}/auth/v1/signup?redirect_to=${encodeURIComponent(callback.toString())}`, {
    method: 'POST',
    headers: { apikey: key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: input.email.trim().toLowerCase(),
      password: input.password,
      data: {
        full_name: input.name.trim(),
        phone_number: input.phone.trim(),
      },
    }),
  })
  const payload = await response.json() as CommonSignupResult & { msg?: string; message?: string }
  if (!response.ok) {
    throw new Error(payload.msg || payload.message || 'Could not create your ZenVentora account.')
  }
  if (payload.user && Array.isArray(payload.user.identities) && payload.user.identities.length === 0) {
    throw new Error('An account with this email may already exist. Please use ZenVentora Sign in.')
  }
  return payload
}
