FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
RUN mkdir -p /app/data && chown -R node:node /app
USER node
ENV NODE_ENV=production MINEHIVE_API_HOST=0.0.0.0
EXPOSE 3000 3100-3125
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/health || exit 1
CMD ["node", "src/cli.js", "start"]
