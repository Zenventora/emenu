# ─── Stage 1: Build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

# Install deps first (layer cache)
COPY server/package*.json ./
RUN npm ci

# Copy server source + app.html into same build context
COPY server/ ./
COPY app.html ./app.html

# Generate Prisma client + compile TypeScript
RUN npx prisma generate
RUN npm run build

# ─── Stage 2: Production runner ──────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

# Non-root user for security
RUN addgroup -S emenu && adduser -S emenu -G emenu

COPY --from=builder /app/dist         ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma       ./prisma
COPY --from=builder /app/app.html     ./app.html
COPY server/package*.json             ./

RUN mkdir -p uploads && chown emenu:emenu uploads

USER emenu

# Railway injects PORT automatically — expose it
EXPOSE ${PORT:-4000}

# Run migrations then start server
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
