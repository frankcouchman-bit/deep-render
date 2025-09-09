# Use the official Playwright image with all dependencies & browsers
FROM mcr.microsoft.com/playwright:v1.46.0-jammy

WORKDIR /app

# Install only production deps (no need for dev/test libs)
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# App code
COPY server.js ./server.js

ENV PORT=8080
EXPOSE 8080

# Run as the default user from the Playwright image (pwuser) for safety
USER pwuser

CMD ["node", "server.js"]
