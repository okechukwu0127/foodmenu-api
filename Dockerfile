FROM node:22-alpine AS deps
RUN apk add --no-cache openssl
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM deps AS build
WORKDIR /app
COPY . .
RUN npm run prisma:generate
RUN npm run build

FROM build AS tools
ENV NODE_ENV=production
CMD ["npx", "prisma", "migrate", "deploy"]

FROM node:22-alpine AS runner
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/public ./public
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
ARG SERVICE
ENV SERVICE=${SERVICE}
CMD ["sh", "-c", "node dist/apps/$SERVICE/main.js"]
