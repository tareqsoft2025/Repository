FROM node:20-slim
WORKDIR /app
COPY server.js package.json ./
ENV DATA_DIR=/data PORT=8080
VOLUME /data
EXPOSE 8080
CMD ["node", "server.js"]
