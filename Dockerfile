FROM node:22.13-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js render_worker.js ./
COPY public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]
