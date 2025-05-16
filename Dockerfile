FROM mcr.microsoft.com/playwright:v1.43.1-jammy


WORKDIR /app
COPY package*.json ./
RUN npm install
RUN npx playwright install 
COPY . .
EXPOSE 3000
CMD ["node", "newserver.js"]
