import net from "node:net";

const ports = [
  ["WEB_PUBLIC", Number(process.env.WEB_PUBLIC_PORT ?? 48110)],
  ["CMS", Number(process.env.CMS_PORT ?? 48111)],
  ["CORE_API", Number(process.env.CORE_API_PORT ?? 48120)],
  ["NOTIFICATION_API", Number(process.env.NOTIFICATION_API_PORT ?? 48121)],
  ["POSTGRES", Number(process.env.POSTGRES_PORT ?? 48130)],
  ["REDIS", Number(process.env.REDIS_PORT ?? 48140)],
  ["RABBIT_AMQP", Number(process.env.RABBIT_AMQP_PORT ?? 48150)],
  ["RABBIT_UI", Number(process.env.RABBIT_UI_PORT ?? 48151)],
  ["MINIO", Number(process.env.MINIO_PORT ?? 48160)],
  ["MINIO_UI", Number(process.env.MINIO_UI_PORT ?? 48161)],
  ["MAILPIT_SMTP", Number(process.env.MAILPIT_SMTP_PORT ?? 48170)],
  ["MAILPIT_UI", Number(process.env.MAILPIT_UI_PORT ?? 48171)],
  ["CLAMAV", Number(process.env.CLAMAV_PORT ?? 48180)],
  ["PROMETHEUS", Number(process.env.PROMETHEUS_PORT ?? 48190)],
  ["GRAFANA", Number(process.env.GRAFANA_PORT ?? 48191)],
];

const check = ([name, port]) =>
  new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve({ name, port, available: false }));
    server.once("listening", () => {
      server.close(() => resolve({ name, port, available: true }));
    });
    server.listen(port, "0.0.0.0");
  });

const results = await Promise.all(ports.map(check));
const blocked = results.filter((result) => !result.available);

if (blocked.length > 0) {
  for (const result of blocked) {
    console.error(`${result.name} port ${result.port} is already in use.`);
  }
  process.exit(1);
}

for (const result of results) {
  console.log(`${result.name} port ${result.port} is available.`);
}
