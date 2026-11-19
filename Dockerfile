FROM oven/bun:1.4-alpine
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0 DATA_DIR=/data
WORKDIR /app
COPY --chown=bun:bun package.json ./
COPY --chown=bun:bun server.js ./
COPY --chown=bun:bun public ./public
RUN mkdir -p /data && chown bun:bun /data
USER bun
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 CMD bun -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["bun", "run", "server.js"]
