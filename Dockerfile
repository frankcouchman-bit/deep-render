# Match the Playwright version with the NPM package (1.46.0)
FROM mcr.microsoft.com/playwright:v1.46.0-jammy

WORKDIR /app

# Only copy manifests first for better layer caching
COPY package.json package-lock.json* ./

# We only need runtime deps in the container
RUN npm ci --omit=dev

# The Playwright image already contains the browsers at /ms-playwright.
# Tell the Node package to use them and skip downloads.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Copy the app source
COPY server.js ./server.js

ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]
