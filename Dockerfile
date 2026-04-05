FROM node:20-alpine
WORKDIR /app
COPY services/user-service/package*.json ./
RUN npm ci --only=production
COPY services/user-service/src ./src
EXPOSE 3001
CMD ["node", "src/index.js"]