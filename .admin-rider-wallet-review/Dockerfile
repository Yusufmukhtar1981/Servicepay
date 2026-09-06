FROM node:22-alpine

WORKDIR /app

COPY backend/package*.json ./

RUN npm install --omit=dev

COPY backend/ .

ENV NODE_ENV=production

EXPOSE 3000

CMD ["npm", "start"]# Fly.io deployment
