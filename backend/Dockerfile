# Simple Node API image: production dependencies only, run as non-root when possible.
FROM node:20-alpine
RUN apk add --no-cache ffmpeg chromium
ENV CHROMIUM_PATH=/usr/bin/chromium-browser
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 4000
ENV NODE_ENV=production
CMD ["node", "index.js"]
