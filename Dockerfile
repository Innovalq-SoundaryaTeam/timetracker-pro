# ─── Stage 1: Build React frontend ───────────────────────────────────────────
FROM node:24-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build          # outputs to /app/dist

# ─── Stage 2: Production image ────────────────────────────────────────────────
FROM node:24-alpine AS runner

WORKDIR /app

# Copy only what's needed to run the server
COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY db.ts ./db.ts
COPY server.ts ./server.ts

# tsx is needed to run TypeScript directly (it's in devDependencies — install it globally)
RUN npm install -g tsx

# Persistent volume for SQLite database (mounted at /data on Fly.io)
RUN mkdir -p /data
ENV DATA_DIR=/data

EXPOSE 8080
ENV PORT=8080

CMD ["tsx", "server.ts"]
