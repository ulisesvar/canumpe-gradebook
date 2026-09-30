# syntax=docker/dockerfile:1
FROM node:22-alpine AS base
WORKDIR /app
COPY package.json package-lock.json ./

# ---- development: full deps, source is bind-mounted by compose.yml ----
FROM base AS dev
RUN npm ci
COPY . .
ENV PORT=3000
EXPOSE 3000
CMD ["npm", "run", "dev"]

# ---- build: lint-free production bundle ----
FROM dev AS build
RUN npm run build

# ---- production: runtime deps + built output only ----
FROM base AS prod
ENV NODE_ENV=production PORT=3000
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
COPY data ./data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist-server/index.js"]
