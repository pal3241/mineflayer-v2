FROM node:22-bookworm AS dependencies
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ pkg-config libcairo2-dev libpango1.0-dev libjpeg62-turbo-dev libgif-dev librsvg2-dev && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends dumb-init libcairo2 libpango-1.0-0 libjpeg62-turbo libgif7 librsvg2-2 && rm -rf /var/lib/apt/lists/*
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY src ./src
RUN mkdir -p /app/data && chown -R node:node /app
USER node
EXPOSE 3000 3100-3110
VOLUME ["/app/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:3000/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "src/cli.js", "start"]
