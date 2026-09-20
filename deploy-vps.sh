#!/usr/bin/env bash
# =============================================================================
# Robinity Intelligence — Tek Tuşla VPS Dağıtım & Kurulum Scripti
# =============================================================================
set -euo pipefail

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "\n${CYAN}=================================================================${NC}"
echo -e "${CYAN}    Robinity Intelligence — VPS Dağıtım ve Kurulum Sihirbazı     ${NC}"
echo -e "${CYAN}=================================================================${NC}\n"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ─── 1. Sistem Bağımlılıklarının Kontrolü ─────────────────────────────────────
echo -e "${CYAN}[1/7] Sistem gereksinimleri kontrol ediliyor...${NC}"

command -v node >/dev/null 2>&1 || { echo -e "${RED}Hata: Node.js kurulu değil. Lütfen Node.js v20+ kurun.${NC}"; exit 1; }
command -v npm >/dev/null 2>&1 || { echo -e "${RED}Hata: npm kurulu değil.${NC}"; exit 1; }
command -v docker >/dev/null 2>&1 || { echo -e "${RED}Hata: Docker kurulu değil. Lütfen Docker Engine kurun.${NC}"; exit 1; }
docker compose version >/dev/null 2>&1 || { echo -e "${RED}Hata: Docker Compose eklentisi bulunamadı.${NC}"; exit 1; }

NODE_MAJOR=$(node -v | cut -d'.' -f1 | tr -d 'v')
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo -e "${YELLOW}Uyarı: Node.js sürümünüz ($NODE_MAJOR). Node.js 20 veya üzeri önerilir.${NC}"
fi
echo -e "${GREEN}✔ Bağımlılıklar doğrulandı (Node $(node -v), $(docker --version))${NC}"

# ─── 2. Ortam Dosyası (.env) Yapılandırması ────────────────────────────────────
echo -e "\n${CYAN}[2/7] Ortam (.env) yapılandırması kontrol ediliyor...${NC}"

if [ ! -f .env ]; then
  echo -e "${YELLOW}.env dosyası bulunamadı. .env.example üzerinden güvenli şifrelerle oluşturuluyor...${NC}"
  cp .env.example .env

  # Güvenli rastgele şifreler üret
  RANDOM_PG_PASS=$(openssl rand -hex 16 2>/dev/null || node -e 'console.log(require("crypto").randomBytes(16).toString("hex"))')
  RANDOM_REDIS_PASS=$(openssl rand -hex 16 2>/dev/null || node -e 'console.log(require("crypto").randomBytes(16).toString("hex"))')
  RANDOM_MASTER_KEY=$(openssl rand -hex 32 2>/dev/null || node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')

  # .env içeriğini güncelle
  sed -i "s/your_strong_postgres_password_here/$RANDOM_PG_PASS/g" .env
  sed -i "s/your_strong_redis_password_here/$RANDOM_REDIS_PASS/g" .env
  sed -i "s/ADMIN_AUTH_MASTER_KEY=/ADMIN_AUTH_MASTER_KEY=$RANDOM_MASTER_KEY/g" .env

  echo -e "${GREEN}✔ .env dosyası güçlü rastgele şifrelerle otomatik oluşturuldu.${NC}"
  echo -e "${YELLOW}DİKKAT: GoPlus, Bitquery, Helius anahtarlarınızı '.env' içine eklemeyi unutmayın!${NC}"
else
  echo -e "${GREEN}✔ Mevcut .env dosyası korundu.${NC}"
fi

# ─── 3. NPM Paketlerinin Yüklenmesi ───────────────────────────────────────────
echo -e "\n${CYAN}[3/7] Node.js bağımlılıkları kuruluyor...${NC}"
npm install --no-audit --prefer-offline
echo -e "${GREEN}✔ Bağımlılıklar hazır.${NC}"

# ─── 4. Docker Container'larının (PostgreSQL & Redis) Başlatılması ────────────
echo -e "\n${CYAN}[4/7] PostgreSQL ve Redis container'ları başlatılıyor...${NC}"
docker compose up -d redis postgres

echo -e "Container'ların sağlıklı (healthy) duruma gelmesi bekleniyor..."
for i in {1..30}; do
  REDIS_STATUS=$(docker inspect --format='{{json .State.Health.Status}}' robinity-redis 2>/dev/null || echo '"starting"')
  PG_STATUS=$(docker inspect --format='{{json .State.Health.Status}}' robinity-postgres 2>/dev/null || echo '"starting"')

  if [[ "$REDIS_STATUS" == '"healthy"' && "$PG_STATUS" == '"healthy"' ]]; then
    echo -e "${GREEN}✔ PostgreSQL ve Redis sağlıklı şekilde çalışıyor.${NC}"
    break
  fi

  if [ "$i" -eq 30 ]; then
    echo -e "${RED}Zaman aşımı: Container'lar beklenen sürede sağlıklı duruma geçemedi.${NC}"
    docker compose ps
    exit 1
  fi
  sleep 1
done

# ─── 5. Veritabanı Migration'ının Çalıştırılması ──────────────────────────────
echo -e "\n${CYAN}[5/7] Veritabanı tabloları oluşturuluyor (migrate.js)...${NC}"
node scripts/queue/migrate.js
echo -e "${GREEN}✔ Veritabanı şeması doğrulandı ve hazır.${NC}"

# ─── 6. Web Uygulamasının Derlenmesi (React / esbuild) ────────────────────────
echo -e "\n${CYAN}[6/7] Web arayüzü derleniyor (npm run build)...${NC}"
npm run build
echo -e "${GREEN}✔ Frontend derlemesi tamamlandı.${NC}"

# ─── 7. Systemd Servisi Kurulumu / Yeniden Başlatma ───────────────────────────
echo -e "\n${CYAN}[7/7] Uygulama servisi yapılandırılıyor...${NC}"

if command -v systemctl >/dev/null 2>&1 && [ -d /etc/systemd/system ]; then
  # Çalışma dizinine göre robinity.service dosyasını ayarla
  sed "s|WorkingDirectory=/var/www/curve|WorkingDirectory=$SCRIPT_DIR|g" robinity.service \
    | sed "s|EnvironmentFile=/var/www/curve/.env|EnvironmentFile=$SCRIPT_DIR/.env|g" \
    | sed "s|ExecStart=/usr/bin/node|ExecStart=$(which node)|g" \
    > /etc/systemd/system/robinity.service

  systemctl daemon-reload
  systemctl enable robinity.service
  systemctl restart robinity.service
  echo -e "${GREEN}✔ robinity.service systemd servisi olarak başlatıldı.${NC}"
else
  echo -e "${YELLOW}Systemd bulunamadı veya yetki yok. Uygulamayı doğrudan arka planda başlatmak için:${NC}"
  echo -e "  npm run serve (veya nohup node scripts/serve-app.js &)"
fi

sleep 2

# ─── Sağlık Denetimi ─────────────────────────────────────────────────────────
echo -e "\n${CYAN}Son sistem denetimi yürütülüyor...${NC}"
node scripts/queue/check-vps-health.js || true

echo -e "\n${GREEN}=================================================================${NC}"
echo -e "${GREEN}   Robinity Intelligence Kurulumu Başarıyla Tamamlandı!           ${NC}"
echo -e "${GREEN}=================================================================${NC}"
echo -e "Uygulama Portu: http://127.0.0.1:4173"
echo -e "Nginx yapılandırması için: 'nginx-robinity.conf' dosyasını '/etc/nginx/sites-available/' altına kopyalayın."
echo -e "Servis Logları: 'journalctl -u robinity -f' veya 'docker compose logs -f'\n"
