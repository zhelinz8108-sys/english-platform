FROM node:24.14.0-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN set -eu; \
  for attempt in 1 2 3 4; do \
    if pnpm install --frozen-lockfile --filter @english/web...; then exit 0; fi; \
    if [ "$attempt" -eq 4 ]; then exit 1; fi; \
    sleep "$((attempt * 10))"; \
  done

FROM deps AS build
ARG API_ORIGIN=http://api:4000
ARG NEXT_PUBLIC_API_ORIGIN=
ARG NEXT_PUBLIC_DEMO_MODE=false
ENV API_ORIGIN=$API_ORIGIN
ENV NEXT_PUBLIC_API_ORIGIN=$NEXT_PUBLIC_API_ORIGIN
ENV NEXT_PUBLIC_DEMO_MODE=$NEXT_PUBLIC_DEMO_MODE
COPY tsconfig.base.json ./
COPY apps/web apps/web
COPY packages/shared packages/shared
RUN pnpm --filter @english/shared build && pnpm --filter @english/web build

FROM node:24.14.0-alpine AS runner
ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=build --chown=node:node /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=build --chown=node:node /app/apps/web/.next ./apps/web/.next
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public
COPY --from=build --chown=node:node /app/apps/web/data/commonlit-reading ./apps/web/data/commonlit-reading
COPY --from=build --chown=node:node /app/apps/web/data/commonlit-reading-answers ./apps/web/data/commonlit-reading-answers
COPY --from=build --chown=node:node /app/apps/web/data/commonlit-reading-vocabulary ./apps/web/data/commonlit-reading-vocabulary
COPY --from=build --chown=node:node /app/apps/web/data/vocabulary-book-content ./apps/web/data/vocabulary-book-content
COPY --from=build --chown=node:node /app/apps/web/data/listening-library.json ./apps/web/data/listening-library.json
COPY --from=build --chown=node:node /app/apps/web/package.json ./apps/web/package.json
COPY --from=build --chown=node:node /app/apps/web/next.config.ts ./apps/web/next.config.ts
COPY --from=build --chown=node:node /app/packages/shared/dist ./packages/shared/dist
COPY --from=build --chown=node:node /app/packages/shared/package.json ./packages/shared/package.json
USER node
EXPOSE 3000
CMD ["node", "apps/web/node_modules/next/dist/bin/next", "start", "apps/web", "-p", "3000"]
