FROM node:22.13-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY app.js server.js render_worker.js ./
COPY web ./web
RUN mkdir -p /app/data && chown node:node /app/data
VOLUME /app/data
USER node
EXPOSE 3000
CMD ["node", "server.js"]
