import { Request, Response, NextFunction } from 'express'
import { verifyAccessToken } from '../lib/jwt'
import { CommonAuthUser, resolveEmenuUser, verifyCommonAccessToken } from '../lib/common-auth'

export interface AuthRequest extends Request {
  userId?: string
  userEmail?: string
  commonUser?: CommonAuthUser
  authProvider?: 'zenventora' | 'legacy'
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const commonToken = req.cookies?.emenu_common_access_token

  if (commonToken) {
    try {
      const commonUser = await verifyCommonAccessToken(commonToken)
      const emenuUser = await resolveEmenuUser(commonUser)
      req.userId = emenuUser.id
      req.userEmail = commonUser.email
      req.commonUser = commonUser
      req.authProvider = 'zenventora'
      next()
      return
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid ZenVentora session.'
      res.status(401).json({ message })
      return
    }
  }

  // Temporary compatibility for existing EMenu sessions while users connect
  // their ZenVentora identity. New sign-ins are handled by Common Accounts.
  const legacyToken = req.cookies?.access_token || req.headers.authorization?.replace('Bearer ', '')
  if (!legacyToken) {
    res.status(401).json({ message: 'Authentication required' })
    return
  }

  try {
    const payload = verifyAccessToken(legacyToken)
    req.userId = payload.userId
    req.userEmail = payload.email
    req.authProvider = 'legacy'
    next()
  } catch {
    res.status(401).json({ message: 'Invalid or expired token' })
  }
}
