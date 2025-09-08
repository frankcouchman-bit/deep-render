# Headless Chromium + fonts + everything preinstalled
FROM mcr.microsoft.com/playwright:v1.47.2-jammy

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

# Render injects PORT; your server MUST listen on it
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]
