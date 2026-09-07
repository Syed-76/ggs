FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY bot/package.json bot/package.json
RUN npm install
COPY bot bot
COPY package.json tsconfig.json ./
RUN npm run build:bot
FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/bot/dist ./bot/dist
CMD ["node", "bot/dist/index.js"]