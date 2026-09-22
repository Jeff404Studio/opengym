#!/bin/sh
set -eu
# Prefer the container's first nameserver (Railway private DNS / Docker DNS).
NS=$(awk '/^nameserver/{print $2; exit}' /etc/resolv.conf)
# nginx resolver wants brackets around IPv6 literals
case "$NS" in
  *:*) NS="[$NS]" ;;
esac
export NAMESERVER="${NS:-8.8.8.8}"
export API_HOST="${API_HOST:-api:3000}"
envsubst '${API_HOST} ${NAMESERVER}' \
  < /etc/nginx/templates/default.conf.template \
  > /etc/nginx/conf.d/default.conf
exec nginx -g 'daemon off;'
