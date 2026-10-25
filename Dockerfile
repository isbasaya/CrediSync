# syntax=docker/dockerfile:1
#
# One image recipe for every Node workspace. Pick the workspace with TARGET:
#   docker build --build-arg TARGET=services/auth -t credisync/auth .
#   docker build --build-arg TARGET=packages/jobs -t credisync/jobs .
# The runtime command is set per service (see docker-compose.yml).
#
# Debian slim (not Alpine) so native modules such as bcrypt use prebuilt glibc binaries.

ARG NODE_VERSION=20.18-bookworm-slim

FROM node:${NODE_VERSION} AS build
ARG TARGET=services/api-gateway
WORKDIR /app
COPY . .
RUN npm ci --no-audit --no-fund \
 && npm run build:packages \
 && if [ -d "${TARGET}/src" ] && [ "${TARGET#packages/}" = "${TARGET}" ]; then npm run build -w "${TARGET}"; fi \
 && npm prune --omit=dev --no-audit --no-fund

FROM node:${NODE_VERSION} AS runtime
ARG TARGET=services/api-gateway
ENV NODE_ENV=production \
    TARGET=${TARGET}
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/packages ./packages
COPY --from=build --chown=node:node /app/db ./db
COPY --from=build --chown=node:node /app/${TARGET} ./${TARGET}
USER node
CMD ["sh", "-c", "node ${TARGET}/dist/index.js"]
