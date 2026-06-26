# Single-image deploy for the Fly app: builds the static client and runs the Colyseus
# server, which serves BOTH the client (HTTP, via sirv) and the match websocket on one
# port (see packages/server/src/main.ts). Single-stage keeps the pnpm-workspace symlinks
# intact (multi-stage copying of a pnpm node_modules tree is fragile).
FROM node:22-slim

# Pin pnpm to the version that generated pnpm-lock.yaml — otherwise `--frozen-lockfile`
# fails (a different pnpm disagrees on the lockfile). Install directly via npm rather than
# corepack to dodge corepack's container signature-key issues.
RUN npm install -g pnpm@10.33.0
WORKDIR /app

# 1) Install deps first (cached unless a manifest/lockfile changes). Copy every workspace
#    manifest + the lockfile so pnpm can resolve the whole workspace.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/shared/package.json   packages/shared/package.json
COPY packages/sim-core/package.json packages/sim-core/package.json
COPY packages/server/package.json   packages/server/package.json
COPY packages/client/package.json   packages/client/package.json
COPY packages/content/package.json  packages/content/package.json
RUN pnpm install --frozen-lockfile

# 2) Copy the source and build the client bundle (packages/client/dist).
COPY . .
RUN pnpm --filter @deceive/client build

# 3) Run the server (it serves the built client + the websocket). tsx runs the TS entry
#    directly — fine for a hobby game server.
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080
CMD ["pnpm", "--filter", "@deceive/server", "dev"]
