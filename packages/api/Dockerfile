FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json tsconfig.json ./
COPY prisma ./prisma/
RUN npm install
COPY src ./src/
RUN npm run build
RUN npx prisma generate

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./
EXPOSE 3100
CMD ["node", "dist/server.js"]
