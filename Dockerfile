###############################################
# Stage 1: Builder
###############################################
FROM node:20-alpine AS builder

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

WORKDIR /app

# Install dependencies first (Docker layer caching)
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Copy source and build
COPY . .
RUN pnpm build

###############################################
# Stage 2: Runner
###############################################
FROM node:20-alpine AS runner

RUN apk add --no-cache tini tzdata

WORKDIR /app

# Copy everything needed for runtime + migrations
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/src/db ./src/db
COPY --from=builder /app/tsconfig.json ./

# Copy entrypoint script
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Create uploads directory
RUN mkdir -p /app/uploads

# Install tsx globally for running knex migrations (TypeScript knexfile + .ts migrations)
RUN npm install -g tsx

ENV TZ=Asia/Jakarta
RUN cp /usr/share/zoneinfo/Asia/Jakarta /etc/localtime && echo "Asia/Jakarta" > /etc/timezone

ENV NODE_ENV=production
EXPOSE 3004

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["/docker-entrypoint.sh"]
