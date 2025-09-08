# ✅ Uses Playwright's official image that bundles Chromium/ffmpeg/fonts/deps
FROM mcr.microsoft.com/playwright:v1.47.0-jammy

WORKDIR /app

# Install app deps
COPY package*.json ./
# Try ci first; fall back to i on first deploy
RUN npm ci --omit=dev || npm i --omit=dev

# Copy app code
COPY . .

ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]
