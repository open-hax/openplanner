FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json tsconfig.json ./

# Use npm install to regenerate lock file if needed
RUN npm install

COPY src ./src
COPY .env.example ./.env.example

RUN npm run build

# Remove dev dependencies to slim image
RUN npm prune --production

USER 1000:1000

ENV NODE_ENV=production
ENV OPENPLANNER_HOST=0.0.0.0
ENV OPENPLANNER_PORT=7777

EXPOSE 7777

CMD ["node", "dist/main.js"]
