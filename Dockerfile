FROM node:22-trixie-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends openjdk-21-jre-headless \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json tsconfig.json ./
COPY pnpm-workspace.yaml .
COPY pnpm-lock.yaml .
COPY packages/stores/document-hydration/package.json ./packages/stores/document-hydration/package.json

RUN corepack enable && corepack prepare pnpm@10 --activate
RUN pnpm install --no-frozen-lockfile

COPY src ./src
COPY packages/stores/document-hydration ./packages/stores/document-hydration
COPY .env.example ./.env.example

RUN pnpm build

# Remove dev dependencies to slim image
RUN CI=true pnpm prune --prod

USER 1000:1000

ENV NODE_ENV=production
ENV OPENPLANNER_HOST=0.0.0.0
ENV OPENPLANNER_PORT=7777

EXPOSE 7777

CMD ["node", "dist/main.js"]
