# Use official Playwright image with all dependencies
FROM mcr.microsoft.com/playwright:v1.42.1-focal

# Set working directory
WORKDIR /app

# Install dependencies first for caching
COPY package*.json ./
RUN npm ci --omit=dev

# Install specific browser (chromium only to reduce image size)
RUN npx playwright install chromium

# Copy application files
COPY . .

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Expose port and run application
EXPOSE 3000
CMD ["node", "server.js"]