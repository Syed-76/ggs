FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY backend/api/package.json backend/api/package.json
RUN npm install
COPY backend/api backend/api
COPY package.json tsconfig.json ./
RUN npm run db:generate && npm run build:api
FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/backend/api/dist ./backend/api/dist
COPY --from=build /app/backend/api/package.json ./backend/api/package.json
CMD ["node", "backend/api/dist/index.js"]