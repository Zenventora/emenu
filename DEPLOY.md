# E-Menu — Render Deployment Guide

## Step 1: Push to GitHub (Terminal)
```bash
cd ~/Downloads/Emenu
git add .
git commit -m "feat: production ready"
git push
```

---

## Step 2: Render — Create Web Service

1. render.com → New + → Web Service
2. Connect GitHub → select `emenu` repo
3. Settings:
   - Name: `emenu-app`
   - Region: Singapore
   - Runtime: Docker
   - Plan: Free
4. Click "Advanced" → Add Environment Variables (copy from below)
5. Click "Create Web Service"

---

## Step 3: Environment Variables (paste in Render dashboard)

| Key | Value |
|-----|-------|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | `postgresql://postgres:078%40Zenventora@db.zcqncbdfurhlnspzziyd.supabase.co:5432/postgres` |
| `JWT_ACCESS_SECRET` | `7f24778c5ab5304f62bad95d8df21b51bdbd42d9466d6aeaed2ddf92bec3efd42901aaafd00cd68a35bd8383fe66af0f1425b5b74d507a94e0a577ea51a020d4` |
| `JWT_REFRESH_SECRET` | `7b0d797639f6e81ce40e5e46953af0bd23f2fa32a1fb732e1a0c61c898b80e77a7e1a984dd8fdfd524d2fb178dc88eb455b99c1bd3fcb5d388af15a1fc7c46fa` |
| `SMTP_HOST` | `smtp.zoho.in` |
| `SMTP_PORT` | `465` |
| `SMTP_USER` | `support@zenventora.in` |
| `SMTP_PASS` | `8NPKwurh77tx` |
| `APP_URL` | ⚠️ Deploy ஆனதும் Render URL paste பண்ணுங்க (e.g. https://emenu-app.onrender.com) |
| `MENU_BASE_URL` | ⚠️ APP_URL + `/menu` (e.g. https://emenu-app.onrender.com/menu) |

---

## Step 4: After Deploy — UptimeRobot (sleep prevent)

1. uptimerobot.com → Free signup
2. New Monitor → HTTP(s)
3. URL: `https://emenu-app.onrender.com/api/health`
4. Interval: 5 minutes
→ Server never sleeps!

---

## Step 5: Final Test

- [ ] https://emenu-app.onrender.com → Landing page loads
- [ ] Signup → OTP email comes to inbox
- [ ] Create business → Add menu items
- [ ] Generate QR → Scan → Customer menu loads
- [ ] Forget password → OTP email works
- [ ] Today's Menu → toggle works
- [ ] Publish/Unpublish → Closed page shows

---

## Your URLs (after deploy)

- App: https://emenu-app.onrender.com
- Customer menu: https://emenu-app.onrender.com/menu/:slug
- Health check: https://emenu-app.onrender.com/api/health
