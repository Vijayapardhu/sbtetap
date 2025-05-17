# 1. Use Playwright base image
FROM mcr.microsoft.com/playwright:v1.43.1-jammy

# 2. Set working directory
WORKDIR /app

# 3. Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# 4. Copy the full project
COPY . .

# 5. Install Playwright browser binaries
RUN npx playwright install --with-deps
RUN npm install playwright-extra playwright-extra-plugin-stealth

EXPOSE 3000
# 6. Start the app
CMD ["node", "newserver.js"]  # Change this to your actual entry point if different

