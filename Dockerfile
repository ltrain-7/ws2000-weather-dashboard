FROM node:22-alpine

ARG APP_REVISION=""

WORKDIR /app

COPY package.json package-lock.json ./
COPY vendor ./vendor
RUN npm ci --omit=dev

COPY public ./public
COPY src ./src
COPY scripts ./scripts
RUN mkdir -p /app/data /app/backups && chown -R node:node /app

ENV NODE_ENV=production
ENV PORT=3000
ENV APP_REVISION=$APP_REVISION

EXPOSE 3000

USER node

CMD ["node", "--no-warnings", "src/server.js"]
