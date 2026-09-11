const endpoints = [
  ["core-api", process.env.CORE_API_HEALTH_URL ?? "http://localhost:48120/health"],
  ["notification-api", process.env.NOTIFICATION_API_HEALTH_URL ?? "http://localhost:48121/health"],
];

for (const [name, url] of endpoints) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${name} smoke check failed with ${response.status}`);
  }
  console.log(`${name} is healthy.`);
}
