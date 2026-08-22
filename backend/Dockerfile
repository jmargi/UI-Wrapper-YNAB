FROM node:20-alpine
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json .
RUN npm install
COPY src ./src
RUN mkdir -p /app/data
# Persist the SQLite store across rebuilds (mount a volume in compose).
VOLUME ["/app/data"]
EXPOSE 3001
CMD ["node", "src/index.js"]
