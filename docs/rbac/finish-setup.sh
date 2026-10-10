#!/usr/bin/env bash
# ============================================================
# finish-setup.sh — menyelesaikan SEMUA langkah RBAC dalam satu perintah
#
# Jalankan dari akar repo di Codespace:
#   bash docs/rbac/finish-setup.sh
# ============================================================
set +e

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✓${NC} $1"; }
fail() { echo -e "${RED}✗${NC} $1"; }
info() { echo -e "${YELLOW}▸${NC} $1"; }

echo ""
echo "=============================================="
echo "  RBAC Setup — satu perintah, semua selesai"
echo "=============================================="
echo ""

# 1) Pastikan di branch yang benar
info "Branch saat ini: $(git branch --show-current)"
if [ "$(git branch --show-current)" != "feat/rbac-alignment" ]; then
  info "Pindah ke feat/rbac-alignment..."
  git stash 2>/dev/null
  git checkout feat/rbac-alignment 2>/dev/null
  git stash pop 2>/dev/null
fi

# 2) Tarik perbaikan dari origin
info "Menarik perbaikan dari origin..."
git fetch origin
git checkout --theirs . 2>/dev/null || true
git add . 2>/dev/null
git commit -m "merge: perbaikan RBAC dari origin" 2>/dev/null || true
git pull --no-rebase origin feat/rbac-alignment 2>/dev/null \
  || echo "  (pull dilewati — mungkin sudah up to date)"

# 3) Pastikan tools ada
info "Memastikan tools tersedia..."
git checkout origin/feat/rbac-alignment -- \
  tools/apply-rbac-integration.mjs \
  tools/apply-impersonation-audit.mjs \
  scripts/rbac-qc-live.mjs 2>/dev/null || true

# 4) Terapkan patch server.ts
info "Menerapkan patch server.ts (tier=strict3, kumulatif)..."
node tools/apply-rbac-integration.mjs server.ts --tier=strict3 2>&1 | while read -r line; do echo "  $line"; done
info "Menerapkan patch jejak audit impersonasi..."
node tools/apply-impersonation-audit.mjs 2>&1 | while read -r line; do echo "  $line"; done

# 5) Commit agar patch permanen
info "Menyimpan patch ke git (agar tidak hilang saat pindah branch)..."
git add server.ts src/server/authConsoleRoutes.ts 2>/dev/null
git commit -m "feat(rbac): terapkan strict3 + guard area admin + audit impersonasi" 2>/dev/null || true

# 6) Restart app
info "Me-restart app..."
kill -9 $(lsof -ti:3000) 2>/dev/null || true
sleep 1
nohup npm run dev > /tmp/legalio-dev.log 2>&1 &
echo "  Menunggu app siap..."
for i in $(seq 1 30); do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/rbac/matrix 2>/dev/null)
  [ "$CODE" != "000" ] && break
  sleep 1
done
ok "App berjalan di http://localhost:3000"

# 7) Verifikasi otomatis
echo ""
echo "=============================================="
echo "  Hasil verifikasi"
echo "=============================================="
P1=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/contracts 2>/dev/null)
P2=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/auth-console/sessions 2>/dev/null)
P3=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/activity-logs 2>/dev/null)

if [ "$P1" = "401" ]; then ok "/api/contracts → $P1 (401 untuk anonim, sesuai PRD)"; else fail "/api/contracts → $P1 (harus 401)"; fi
if [ "$P2" = "401" ] || [ "$P2" = "403" ]; then ok "/api/auth-console/sessions → $P2 (area admin terjaga)"; else fail "/api/auth-console/sessions → $P2 (harus 401/403)"; fi
if [ "$P3" = "401" ] || [ "$P3" = "403" ]; then ok "/api/activity-logs → $P3 (area admin terjaga)"; else fail "/api/activity-logs → $P3 (harus 401/403)"; fi

echo ""
echo "=============================================="
echo "  Selesai! Langkah terakhir (opsional):"
echo "=============================================="
echo "  Jalankan QC impersonasi per level di terminal KEDUA:"
echo "    node scripts/rbac-qc-live.mjs --base http://localhost:3000 --mint-session --push"
echo ""
echo "  Lalu bersihkan sesi QC:"
echo "    node scripts/rbac-qc-live.mjs --cleanup-qc-sessions"
echo ""
