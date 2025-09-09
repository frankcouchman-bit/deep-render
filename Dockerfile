# Use the official Playwright image with all deps
FROM mcr.microsoft.com/playwright:v1.46.0-jammy

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY server.js ./server.js

ENV PORT=8080
EXPOSE 8080

# playwright image already has browsers installed
CMD ["node", "server.js"]
