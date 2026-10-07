# syntax=docker/dockerfile:1
# jev-mcp Streamable HTTP server (AGENTS.md Phase 11). Secrets come from the
# environment at run time (compose.yaml reads .env); none are baked into the image.

# Official Node.js image, pinned by tag and digest. Update both together.
ARG NODE_IMAGE=node:22.21-alpine@sha256:0340fa682d72068edf603c305bfbc10e23219fb0e40df58d9ea4d6f33a9798bf

FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    JEV_HTTP_HOST=0.0.0.0 \
    PORT=8098
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# The official image's unprivileged user.
USER node
EXPOSE 8098
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD ["node", "dist/transport/http-healthcheck.js"]
CMD ["node", "dist/transport/http.js"]
