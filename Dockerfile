# 1. Use official Playwright image with all OS/browser deps
FROM mcr.microsoft.com/playwright:v1.43.1-jammy

# 2. Set working directory
WORKDIR /app

# 3. Copy and install dependencies
COPY package*.json ./
RUN npm install

# 4. Copy all source files
COPY . .

# 5. Install Playwright browser binaries + stealth plugin
RUN npx playwright install --with-deps
RUN npm install playwright-extra playwright-extra-plugin-stealth

# 6. Expose the port for Render
EXPOSE 3000

# 7. Run your server
CMD ["node", "newserver.js"]