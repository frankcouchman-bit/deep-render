# Use a Playwright image that bundles the right Chromium version
FROM mcr.microsoft.com/playwright:v1.55.0-jammy

# App dir
WORKDIR /app

# Install only prod deps
COPY package*.json ./
RUN npm i --omit=dev

# Copy source
COPY . .

# Playwright env (match what our server expects)
ENV PORT=10000
ENV NODE_ENV=production

# Optional: speed up cold starts
RUN npx playwright --version

EXPOSE 10000
CMD ["node", "app.js"]
