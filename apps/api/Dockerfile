# CheqPay API — container image for Render (or any Docker host).
#
# Build context is the REPO ROOT, not apps/api: this is a bun workspace, so the
# API needs the root lockfile and the @cheqpay/db and @cheqpay/shared packages.
# Build with:  docker build -f apps/api/Dockerfile .
#
# Why Docker rather than a buildpack: the build has three ordering constraints
# (prisma generate -> build @cheqpay/shared -> next build) that are explicit
# here and reproducible anywhere, instead of depending on a host's monorepo
# and bun conventions.

# ---- deps -------------------------------------------------------------------
FROM oven/bun:1 AS deps
WORKDIR /app

# Only the manifests, so this layer caches until a dependency actually changes.
# EVERY workspace listed in the root package.json must be present or a frozen
# install fails — including the apps this image does not build.
COPY package.json bun.lock turbo.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/admin/package.json apps/admin/
COPY apps/mobile/package.json apps/mobile/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
RUN bun install --frozen-lockfile

# ---- build ------------------------------------------------------------------
FROM oven/bun:1 AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# 1. Prisma client must exist before anything imports @cheqpay/db.
RUN bunx prisma generate --schema packages/db/prisma/schema.prisma
# 2. @cheqpay/shared resolves through its package main (dist/), so build it.
RUN cd packages/shared && bun run build
# 3. Now the Next build can resolve every workspace import.
RUN cd apps/api && bun run build

# ---- runtime ----------------------------------------------------------------
FROM oven/bun:1 AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Copy the built workspace wholesale. Next is not run in `standalone` mode: the
# API imports workspace packages at runtime, and a full copy avoids a fragile
# hand-assembled bundle for the sake of a smaller image on a single service.
COPY --from=build /app ./

WORKDIR /app/apps/api

# Render injects PORT; the start script honours it and falls back to 4000.
EXPOSE 4000
CMD ["bun", "run", "start"]
