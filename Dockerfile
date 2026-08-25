FROM node:22-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY public ./public
COPY src ./src
COPY scripts ./scripts
RUN mkdir -p /app/data && chown -R node:node /app

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

USER node

CMD ["node", "--no-warnings", "src/server.js"]
