FROM node:22.22.0-slim

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

COPY backend ./backend

ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "backend/index.js"]
