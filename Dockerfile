# Use a Playwright image that already contains the browsers
FROM mcr.microsoft.com/playwright:v1.46.1-jammy

WORKDIR /app

# System tools for healthcheck + init
RUN apt-get update && apt-get install -y --no-install-recommends \
    dumb-init curl \
 && rm -rf /var/lib/apt/lists/*

# Copy manifests first for better layer caching
COPY package.json package-lock.json* ./

# Install runtime deps. Use npm install so we don't fail if lockfile is absent.
RUN npm install --omit=dev

# Ensure we use the baked-in browsers and skip any downloads
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Render injects PORT; default for local runs
ENV PORT=8080

# Copy source
COPY server.js ./server.js

EXPOSE 8080

# Healthcheck so Render knows the service is up
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -fsS http://localhost:8080/health || exit 1

# Proper signal handling
ENTRYPOINT ["dumb-init", "--"]

CMD ["node", "server.js"]
