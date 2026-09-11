# Nexora

Universal web platform with an embedded CMS.

## Local foundation

Nexora starts as a localhost-first pnpm/Nx monorepo with Next.js apps, NestJS services, shared packages, Docker Compose infrastructure, health checks, readiness checks, and strict TypeScript.

## Quick start

```bash
pnpm install
pnpm check:ports
pnpm docker:up
pnpm prisma:migrate
pnpm build
pnpm test
```

## Ports

The local stack uses the `481xx` range. See `.env.example` for the default values.
