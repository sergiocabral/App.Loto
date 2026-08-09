# syntax=docker/dockerfile:1

# Node 22 mais recente (>= 22.19) — corrige os avisos EBADENGINE do build NixPacks
# (undici, vite, etc. exigiam versão acima do 22.11 que o NixPacks resolvia).
ARG NODE_IMAGE=node:22-alpine

# --- Stage 1: dependências (inclui devDependencies, necessárias para o build) ---
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
# libc6-compat evita erros de módulos nativos em bases Alpine (musl).
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
RUN npm ci

# --- Stage 2: build (gera .next/standalone) ---
FROM ${NODE_IMAGE} AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# --- Stage 3: runtime (imagem final enxuta, sem toolchain nem devDependencies) ---
FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# server.js do standalone escuta PORT/HOSTNAME; 0.0.0.0 é obrigatório no container.
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# public/ não faz parte do standalone; precisa ser copiado à parte.
COPY --from=builder /app/public ./public
# .next/standalone traz server.js + node_modules mínimo (tree-shaken).
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
# assets estáticos gerados pelo build.
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]
