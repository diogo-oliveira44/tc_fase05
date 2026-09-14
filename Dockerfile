# syntax=docker/dockerfile:1
FROM oven/bun:1-slim
WORKDIR /api
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

ENV NODE_ENV=production \
    PORT=3000 \
    UPLOAD_DIRECTORY=/api/uploads

COPY openapi.json ./
COPY src ./src
COPY db ./db
COPY scripts ./scripts

RUN mkdir -p /api/uploads && chown -R bun:bun /api/uploads && chmod +x ./scripts/start.sh

# 
USER bun
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:'+(process.env.PORT??3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["./scripts/start.sh"]
