# syntax=docker/dockerfile:1
FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
ARG VITE_SITE_URL=https://microtechnique.in
ARG VITE_GOOGLE_SITE_VERIFICATION=
ENV VITE_SITE_URL=$VITE_SITE_URL
ENV VITE_GOOGLE_SITE_VERIFICATION=$VITE_GOOGLE_SITE_VERIFICATION
# Build-only memory: `tsc` + Vite load the whole project graph (not per-user runtime). On small VPS, Node may cap heap from cgroup unless raised — add swap or use --build-arg VITE_BUILD_HEAP_MB=1536 if needed.
ARG VITE_BUILD_HEAP_MB=2048
RUN NODE_OPTIONS="--max-old-space-size=${VITE_BUILD_HEAP_MB}" npm run build

FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
