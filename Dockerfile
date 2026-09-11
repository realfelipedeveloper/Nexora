FROM node:24-alpine

WORKDIR /workspace

ENV NEXT_TELEMETRY_DISABLED=1

RUN npm install --global pnpm@11.20.0

COPY . .

ARG NEXORA_TARGET
ENV NEXORA_TARGET=${NEXORA_TARGET}

RUN pnpm install --frozen-lockfile
RUN pnpm build

CMD ["sh", "-c", "pnpm --filter \"$NEXORA_TARGET\" start"]
