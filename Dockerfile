FROM node:20-alpine AS build
WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .
ARG NEXT_PUBLIC_BRAIN_API_URL=http://localhost:8000/api
ENV NEXT_PUBLIC_BRAIN_API_URL=${NEXT_PUBLIC_BRAIN_API_URL}
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3100

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/next.config.ts ./next.config.ts

EXPOSE 3100
CMD ["npm", "run", "start"]
