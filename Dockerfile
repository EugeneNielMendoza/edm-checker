# 1. Build the page (React + Tailwind) into dist/
FROM node:22.13-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts tailwind.config.js postcss.config.js ./
COPY client ./client
RUN npm run build

# 2. The server, with only what it needs to run
FROM node:22.13-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY local-server.js render_worker.js ./
COPY lib ./lib
COPY --from=build /app/dist ./dist
RUN mkdir -p /app/data && chown node:node /app/data
VOLUME /app/data
USER node
EXPOSE 3000
CMD ["node", "local-server.js"]
