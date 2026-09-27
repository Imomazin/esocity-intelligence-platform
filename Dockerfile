# Esocity web app — production container (Next.js standalone output).
# Vercel is the primary deployment target; this image is for self-hosting and local parity.

FROM node:24-alpine AS base
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

FROM base AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_OUTPUT=standalone
RUN pnpm build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN addgroup -S -g 10001 esocity && adduser -S -u 10001 -G esocity esocity
COPY --from=build --chown=esocity:esocity /app/.next/standalone ./
COPY --from=build --chown=esocity:esocity /app/.next/static ./.next/static
COPY --from=build --chown=esocity:esocity /app/public ./public
USER esocity
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
CMD ["node", "server.js"]
