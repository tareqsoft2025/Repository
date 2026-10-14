#!/usr/bin/env bash
# تثبيت خادم المزامنة على VPS بنظام Ubuntu/Debian: Node 20 + خدمة systemd + Nginx + شهادة HTTPS مجانية.
# الاستخدام (كمستخدم root):  bash install-vps.sh hr.example.com you@example.com
# شرط: سجل DNS للنطاق (A) يشير إلى عنوان الخادم قبل التشغيل.
set -euo pipefail
DOMAIN="${1:?اكتب النطاق: bash install-vps.sh hr.example.com you@example.com}"
EMAIL="${2:?اكتب بريدك لإشعارات الشهادة}"
APP=/opt/hr-sync; DATA=/var/lib/hr-sync
SRC="$(cd "$(dirname "$0")" && pwd)"

apt-get update -y
apt-get install -y curl nginx certbot python3-certbot-nginx
command -v node >/dev/null || { curl -fsSL https://deb.nodesource.com/setup_20.x | bash -; apt-get install -y nodejs; }

useradd --system --home "$APP" --shell /usr/sbin/nologin hrsync 2>/dev/null || true
mkdir -p "$APP" "$DATA"; cp "$SRC/server.js" "$SRC/package.json" "$APP/"; chown -R hrsync:hrsync "$DATA"
KEYFILE=/etc/hr-sync.env
[ -f "$KEYFILE" ] || { echo "SETUP_KEY=$(head -c 12 /dev/urandom | xxd -p)" > "$KEYFILE"; chmod 600 "$KEYFILE"; }

cat > /etc/systemd/system/hr-sync.service <<UNIT
[Unit]
Description=HR sync server
After=network.target
[Service]
User=hrsync
WorkingDirectory=$APP
EnvironmentFile=$KEYFILE
Environment=PORT=8080 DATA_DIR=$DATA
ExecStart=$(command -v node) server.js
Restart=always
[Install]
WantedBy=multi-user.target
UNIT

cat > /etc/nginx/sites-available/hr-sync <<NGINX
server {
  listen 80; server_name $DOMAIN;
  client_max_body_size 120m;
  location / { proxy_pass http://127.0.0.1:8080; proxy_set_header Host \$host; proxy_set_header X-Forwarded-For \$remote_addr; }
}
NGINX
ln -sf /etc/nginx/sites-available/hr-sync /etc/nginx/sites-enabled/hr-sync
nginx -t && systemctl reload nginx
systemctl daemon-reload && systemctl enable --now hr-sync
certbot --nginx -d "$DOMAIN" -m "$EMAIL" --agree-tos --non-interactive --redirect

echo; echo "تم. عنوان الخادم:  https://$DOMAIN"
echo "مفتاح التهيئة الأولى (احفظه):  $(grep SETUP_KEY $KEYFILE | cut -d= -f2)"
echo "للتحقق:  curl https://$DOMAIN/api/health"
