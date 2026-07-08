# =====================================================================
# Dockerfile — runs the MSRTC Checklist app with a properly installed
# system Chromium, so headless PDF generation (Puppeteer) works reliably.
#
# WHY DOCKER: Render's native Node runtime is missing several system
# libraries Chrome needs to start (libatk, libnss, etc.) and doesn't allow
# installing them. Docker lets us apt-get install Chromium AND all its
# dependencies together, guaranteed to match — this is the standard,
# reliable way to run Puppeteer on any restrictive host.
# =====================================================================
FROM node:22-slim

# Install Chromium (matched to its own dependencies by apt, so nothing
# is missing) plus fonts for correct text rendering (including Devanagari
# fallback glyphs, though we self-host Noto Sans Devanagari separately).
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    fonts-noto-color-emoji \
    ca-certificates \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libcairo2 \
    && rm -rf /var/lib/apt/lists/*

# Tell Puppeteer to use the system Chromium above instead of downloading
# its own bundled copy (faster build, avoids the cache-path issues we hit
# on the native Node runtime).
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# Install dependencies first (better Docker layer caching on rebuilds).
COPY package.json ./
RUN npm install --omit=dev

# Now copy the rest of the app.
COPY . .

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "server/server.js"]
