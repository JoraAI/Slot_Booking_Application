# SlotBook API — Fly.io / Docker image (pnpm monorepo, backend only).
FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable \
  && corepack prepare pnpm@9.15.0 --activate

# Install workspace deps first (better layer caching).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/backend/package.json ./packages/backend/
COPY packages/frontend/package.json ./packages/frontend/
RUN pnpm install --frozen-lockfile

# Build backend + generate Prisma client.
COPY packages/backend ./packages/backend
RUN pnpm --filter backend exec prisma generate \
  && pnpm --filter backend build

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# Fly release_command + runtime both start from the backend package dir.
WORKDIR /app/packages/backend
CMD ["node", "dist/index.js"]
