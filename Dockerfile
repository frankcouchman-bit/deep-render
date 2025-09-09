# Uses Playwright image with browsers preinstalled
FROM mcr.microsoft.com/playwright:v1.46.1-jammy

WORKDIR /app

# Small init + healthcheck tools
RUN apt-get update && apt-get install -y --no-install-recommends dumb-init curl \
 && rm -rf /var/lib/apt/lists/*

# Copy manifests first for layer caching
COPY package.json package-lock.json* ./

# Install runtime deps — tolerate missing lock by using npm install
RUN npm install --omit=dev

# Use baked-in browsers; skip any downloads
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PORT=8080

# Copy source
COPY server.js ./server.js

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -fsS http://localhost:8080/health || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.js"]
