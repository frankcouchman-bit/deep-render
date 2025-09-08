FROM node:20-bullseye
RUN npx -y playwright@1.47.0 install --with-deps chromium
WORKDIR /app
COPY package*.json ./
RUN npm i --omit=dev
COPY . .
ENV PORT=8080
EXPOSE 8080
CMD ["node","server.js"]
