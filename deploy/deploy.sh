#!/usr/bin/env bash
# Build the backend jar locally and ship it to the VM.
#   deploy/deploy.sh                       # uses defaults below
#   IRIS_HOST=1.2.3.4 IRIS_KEY=~/.ssh/k deploy/deploy.sh
# The server's ~/iris/.env is created on first run (random secrets) and never
# copied back or overwritten.
set -euo pipefail

HOST="${IRIS_HOST:-129.225.92.235}"
USER_="${IRIS_USER:-opc}"
KEY="${IRIS_KEY:-$HOME/.ssh/iris-oracle.key}"
JAVA_HOME="${JAVA_HOME_IRIS:-${JAVA_HOME:-}}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SSH=(ssh -i "$KEY" -o ConnectTimeout=15 "$USER_@$HOST")

echo "==> building backend jar"
(cd "$ROOT/backend" && JAVA_HOME="$JAVA_HOME" ./mvnw -q -DskipTests package)
JAR="$(ls "$ROOT"/backend/target/*.jar | grep -v plain | head -1)"

echo "==> uploading"
"${SSH[@]}" 'mkdir -p ~/iris/secrets && chmod 700 ~/iris/secrets'
scp -i "$KEY" -q "$ROOT/deploy/docker-compose.prod.yml" "$ROOT/deploy/Caddyfile" \
  "$ROOT/deploy/.env.example" "$USER_@$HOST:~/iris/"
scp -i "$KEY" -q "$JAR" "$USER_@$HOST:~/iris/app.jar.new"

echo "==> (re)starting"
"${SSH[@]}" 'set -e; cd ~/iris
  mv app.jar.new app.jar
  if [ ! -f .env ]; then
    # First deploy: fresh random secrets, everything else from the template.
    sed -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -hex 24)|" \
        -e "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -base64 48 | tr -d "\n")|" \
        -e "s|^MEDIA_MASTER_KEY=.*|MEDIA_MASTER_KEY=$(openssl rand -base64 32)|" \
        .env.example > .env
    chmod 600 .env
    echo "    created ~/iris/.env — fill in VAPID/TURN/FCM values if needed"
  fi
  docker compose -f docker-compose.prod.yml up -d --remove-orphans
  docker compose -f docker-compose.prod.yml restart backend >/dev/null'
echo "==> done"
