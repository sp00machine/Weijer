# VPS image: Bun server + built PWA. The scraper is a separate container on a
# residential machine (see scraper/).

FROM oven/bun:1 AS build
WORKDIR /repo
COPY package.json bun.lock tsconfig.json ./
COPY server/package.json server/
COPY app/package.json app/
RUN bun install --frozen-lockfile
COPY server/ server/
COPY app/ app/
RUN cd app && bun run build

FROM oven/bun:1-slim
WORKDIR /repo
COPY --from=build /repo/package.json /repo/bun.lock ./
COPY --from=build /repo/node_modules node_modules/
COPY --from=build /repo/server server/
# Server serves the PWA from ./app/dist relative to the repo root workdir.
COPY --from=build /repo/app/dist app/dist/

ENV PORT=3000
EXPOSE 3000
CMD ["bun", "run", "server/index.ts"]
