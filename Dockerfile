FROM node:22-alpine AS builder

WORKDIR /app

# Sistem bağımlılıkları (gerekirse python/make derleme araçları)
RUN apk add --no-cache python3 make g++

# Bağımlılık manifestlerini kopyala ve yükle
COPY package.json package-lock.json ./
RUN npm ci

# Uygulama kaynak kodlarını kopyala
COPY . .

# Web bundle'ı derle (app/web/dist üretilir)
RUN npm run build

# Gereksiz derleme araçlarını temizle
RUN npm prune --production

# ─── Production Image ────────────────────────────────────────────────────────
FROM node:22-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

# Sadece gerekli çalışma zamanı dosyalarını al
COPY --from=builder /app /app

# data klasörünü garanti et
RUN mkdir -p /app/data

EXPOSE 4173

# Sağlık kontrolü
HEALTHCHECK --interval=20s --timeout=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:4173/api/risk/access/me || exit 1

CMD ["node", "scripts/serve-app.js"]
