# API image (the web app is static and deployed separately). Build from the repository root:
#   docker build -t sessio-api .
FROM node:22-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @sessio/api
COPY apps/api apps/api
RUN pnpm --filter @sessio/api build \
  && pnpm --filter @sessio/api deploy --prod --legacy /out \
  && cp -r apps/api/dist apps/api/drizzle /out/

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out ./
USER node
EXPOSE 3000
# Migrations first: a deploy whose migration fails never serves traffic.
CMD ["sh", "-c", "node dist/db/migrate.js && exec node dist/main.js"]
