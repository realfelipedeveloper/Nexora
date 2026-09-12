import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(new URL("../tests/performance/health.js", import.meta.url));
const coreApiHealthUrl =
  process.env.CORE_API_HEALTH_URL ?? "http://host.docker.internal:48120/health";
const notificationApiHealthUrl =
  process.env.NOTIFICATION_API_HEALTH_URL ?? "http://host.docker.internal:48121/health";

const child = spawn(
  "docker",
  [
    "run",
    "--rm",
    "--add-host",
    "host.docker.internal:host-gateway",
    "-e",
    `CORE_API_HEALTH_URL=${coreApiHealthUrl}`,
    "-e",
    `NOTIFICATION_API_HEALTH_URL=${notificationApiHealthUrl}`,
    "-v",
    `${scriptPath}:/scripts/health.js:ro`,
    "grafana/k6:latest",
    "run",
    "/scripts/health.js",
  ],
  { stdio: "inherit" },
);

child.on("exit", (code) => process.exit(code ?? 1));
