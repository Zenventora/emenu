import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import cookieParser from 'cookie-parser'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config()

import authRouter from './routes/auth'
import businessRouter from './routes/business'
import menuRouter from './routes/menu'
import qrRouter from './routes/qr'
import publicRouter from './routes/public'

const app = express()
const PORT = process.env.PORT || 4000
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:3000'

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(helmet({
  // Allow inline scripts in app.html (standalone mode)
  contentSecurityPolicy: false,
}))
app.use(cors({
  origin: [CLIENT_URL, `http://localhost:${PORT}`],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
}))
app.use(express.json({ limit: '20mb' }))   // 20mb for base64 logo images
app.use(express.urlencoded({ extended: true }))
app.use(cookieParser())

// ─── Static: serve app.html from root ────────────────────────────────────────
// When you open http://localhost:5000 you get app.html (same origin as the API)
// Local dev (ts-node): __dirname = server/src  → ../../ = Emenu/
// Production Docker:   __dirname = dist/       → ../   = /app (where app.html is copied)
const staticRoot = process.env.NODE_ENV === 'production'
  ? path.join(__dirname, '../')
  : path.join(__dirname, '../../')
app.use(express.static(staticRoot, {
  index: 'app.html',
  extensions: ['html'],
}))

// Static uploads folder
app.use('/uploads', express.static(path.join(__dirname, '../uploads')))

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/auth',     authRouter)
app.use('/api/business', businessRouter)
app.use('/api/menu',     menuRouter)
app.use('/api/qr',       qrRouter)
app.use('/api/public',   publicRouter)

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// ─── Public menu page (customer-facing) ──────────────────────────────────────
// When a customer scans a QR they land on /menu/:slug
// This serves the same app.html which renders the public menu client-side
app.get('/menu/:slug', (_req, res) => {
  res.sendFile(path.join(staticRoot, 'app.html'))
})

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 E-Menu server  →  http://localhost:${PORT}`)
  console.log(`📋 API base       →  http://localhost:${PORT}/api`)
  console.log(`🌐 App (owner)    →  http://localhost:${PORT}/app.html`)
})

export default app
