FROM node:24-alpine

USER root

WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATA_DIR=/app/data

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY --chown=node:node ["server.mjs", "support.js", "image-slot.js", "Invitación Felipe y Sarita.dc.html", "./"]
COPY --chown=node:node _ds ./_ds
COPY --chown=node:node admin ./admin
COPY --chown=node:node img ./img
COPY --chown=node:node sounds ./sounds

RUN mkdir -p /app/data && chown node:node /app/data

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.mjs"]
