
FROM node:24-bookworm-slim AS base

WORKDIR /app

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN npm install --global pnpm@10 && \
  apt-get update && \
  apt-get install --no-install-recommends --yes openssl ca-certificates && \
  rm -rf /var/lib/apt/lists/*

FROM base AS development

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm exec prisma generate && pnpm run build

FROM base AS production-deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile

FROM base AS production

RUN groupadd --system --gid 1001 nodejs && \
  useradd --system --uid 1001 --gid nodejs nestjs

COPY --from=production-deps /app/node_modules ./node_modules
COPY --from=development /app/dist ./dist
COPY --chown=nestjs:nodejs package.json ./

USER nestjs

EXPOSE 7100

CMD ["node", "dist/src/main"]