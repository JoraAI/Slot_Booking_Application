# Reservly API — Docker image for Render (also works on Fly/Railway).
FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable \
  && corepack prepare pnpm@9.15.0 --activate

# Install workspace deps first (better layer caching).
# The backend tsconfig extends this root config, so it must exist in the image.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/backend/package.json ./packages/backend/
COPY packages/frontend/package.json ./packages/frontend/
RUN pnpm install --frozen-lockfile

# Build backend + generate Prisma client.
COPY packages/backend ./packages/backend
RUN pnpm --filter backend exec prisma generate \
  && pnpm --filter backend build

ENV NODE_ENV=production
# Render injects PORT at runtime (often 10000). Keep a local default for other hosts.
ENV PORT=10000
EXPOSE 10000

WORKDIR /app/packages/backend
# Migrate on boot, then start the API.
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && node dist/index.js"]
