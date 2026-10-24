FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run test:unit && npm run build

FROM nginx:1.30.6-alpine
# OCI metadata is shown on the GHCR package page and with docker image inspect.
LABEL org.opencontainers.image.title="PlainMile PDF Tools" \
      org.opencontainers.image.description="Free, private, browser-local PDF tools for merging, splitting, organizing and converting PDFs" \
      org.opencontainers.image.url="https://pdf.plainmile.com/" \
      org.opencontainers.image.source="https://github.com/plainmile/pdf-tools" \
      org.opencontainers.image.documentation="https://github.com/plainmile/pdf-tools#self-host-the-public-image" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.vendor="PlainMile"
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist/ /usr/share/nginx/html/
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz | grep -qx 'ok' || exit 1
