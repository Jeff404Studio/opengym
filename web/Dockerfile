# Multi-stage: build the React app, then serve it with nginx.
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci 2>/dev/null || npm install
COPY frontend/ ./
# Exercise media (~140 MB) is not shipped in the image. Default to the same
# pinned CDN used by the mobile/demo builds so Railway (and any host without
# ./media mounts) still shows thumbnails + animated demos. Self-host compose
# overrides these to relative img/ + gif/ and mounts the local media volumes.
ARG VITE_IMG_BASE=https://cdn.jsdelivr.net/gh/hasaneyldrm/exercises-dataset@7455efae41b330c265e7cd4b78dfa848e7ce5ebd/images/
ARG VITE_GIF_BASE=https://cdn.jsdelivr.net/gh/hasaneyldrm/exercises-dataset@7455efae41b330c265e7cd4b78dfa848e7ce5ebd/videos/
ENV VITE_IMG_BASE=$VITE_IMG_BASE VITE_GIF_BASE=$VITE_GIF_BASE
RUN npm run build

FROM nginx:alpine
ENV API_HOST=api:3000
# Disable the image's default /docker-entrypoint.d template rendering; we render once in our entrypoint.
ENV NGINX_ENTRYPOINT_QUIET_LOGS=1
COPY web/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY web/docker-entrypoint.sh /docker-entrypoint-opengym.sh
RUN chmod +x /docker-entrypoint-opengym.sh \
 && rm -f /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
ENTRYPOINT ["/docker-entrypoint-opengym.sh"]
