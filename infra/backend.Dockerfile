# syntax=docker/dockerfile:1.7

FROM node:24-alpine AS build
ARG NPM_REGISTRY=https://registry.npmjs.org/
WORKDIR /workspace

COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/package.json
COPY apps/partner-agent-backend/package.json apps/partner-agent-backend/package.json
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund --registry=${NPM_REGISTRY} --include-workspace-root \
    --workspace @partner-agent/contracts \
    --workspace @partner-agent/backend

COPY packages/contracts packages/contracts
COPY apps/partner-agent-backend apps/partner-agent-backend
RUN npm run build --workspace @partner-agent/contracts \
    && npm run build --workspace @partner-agent/backend

FROM build AS production-dependencies
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --no-audit --no-fund --registry=${NPM_REGISTRY} --include-workspace-root \
    --workspace @partner-agent/contracts \
    --workspace @partner-agent/backend

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /workspace

COPY --from=build /workspace/package.json /workspace/package-lock.json ./
COPY --from=production-dependencies /workspace/node_modules node_modules
COPY --from=production-dependencies /workspace/apps/partner-agent-backend/node_modules apps/partner-agent-backend/node_modules
COPY --from=build /workspace/packages/contracts/package.json packages/contracts/package.json
COPY --from=build /workspace/packages/contracts/dist packages/contracts/dist
COPY --from=build /workspace/apps/partner-agent-backend/package.json apps/partner-agent-backend/package.json
COPY --from=build /workspace/apps/partner-agent-backend/dist apps/partner-agent-backend/dist

USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health/ready').then(response=>{if(!response.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["npm", "run", "start:prod", "--workspace", "@partner-agent/backend"]
