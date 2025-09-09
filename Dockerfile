# Keep Docker image and NPM package versions in lockstep
# Choose the latest patch in the 1.46 line; 1.46.1 is fine if available.
FROM mcr.microsoft.com/playwright:v1.46.1-jammy

WORKDIR /app

# Copy manifests first for layer caching
COPY package.json package-lock.json* ./

# Install only runtime deps; nothing tries to download browsers
RUN npm ci --omit=dev

# Environment: use the browsers already baked into the image
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
# Render uses PORT; default to 8080 if not injected
ENV PORT=8080

# Copy source
COPY server.js ./server.js

EXPOSE 8080

# Graceful shutdown is handled in server.js
CMD ["node", "server.js"]
