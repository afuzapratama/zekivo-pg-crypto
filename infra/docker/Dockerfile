FROM node:24.11.1-bookworm-slim AS base
WORKDIR /app
RUN npm install --global pnpm@12.14.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/solana/package.json packages/solana/package.json
COPY packages/testkit/package.json packages/testkit/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY packages/webhooks/package.json packages/webhooks/package.json
COPY apps/webhook-receiver/package.json apps/webhook-receiver/package.json
RUN pnpm install --frozen-lockfile
COPY . .
FROM base AS build
RUN pnpm build && pnpm exec esbuild packages/monitoring/src/main.ts --bundle --platform=node --format=esm --packages=external --outfile=packages/monitoring/dist/main.js
FROM node:24.11.1-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app /app
USER node
CMD ["node", "apps/api/dist/main.js"]
