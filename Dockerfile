# syntax=docker/dockerfile:1

# ---- build stage: install deps + build the Vue frontend ----
FROM node:20-bookworm AS build
WORKDIR /app
RUN corepack enable
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
# Use the lockfile when present; fall back for the very first build.
RUN pnpm install --frozen-lockfile || pnpm install
RUN pnpm --filter @starwonder/web run build

# ---- runtime stage: run the server (which serves the built frontend) ----
FROM node:20-bookworm-slim AS runner
WORKDIR /app
RUN corepack enable
ENV NODE_ENV=production
# native modules (better-sqlite3) were built on bookworm in the build stage and
# are ABI-compatible with bookworm-slim, so we can copy them as-is.
COPY --from=build /app /app
EXPOSE 8080
VOLUME ["/app/data"]
CMD ["pnpm", "--filter", "@starwonder/server", "run", "start"]
