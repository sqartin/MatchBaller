# Match Baller sunucusu
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY public ./public
COPY scripts ./scripts
COPY data/teams.json data/countries.json data/players.json ./data/
# Kullanıcı verisi kalıcı disk üzerinde dursun (barındırma servisinde /data'ya bir volume bağla)
ENV DATA_DIR=/data
RUN mkdir -p /data
EXPOSE 3000
CMD ["node", "server/index.js"]
