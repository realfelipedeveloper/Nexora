import http from "k6/http";
import { check, sleep } from "k6";

const endpoints = [
  {
    name: "core-api",
    url: __ENV.CORE_API_HEALTH_URL ?? "http://host.docker.internal:48120/health",
    service: "core-api",
  },
  {
    name: "notification-api",
    url: __ENV.NOTIFICATION_API_HEALTH_URL ?? "http://host.docker.internal:48121/health",
    service: "notification-api",
  },
];

export const options = {
  scenarios: {
    health: {
      executor: "constant-vus",
      vus: 5,
      duration: "15s",
      gracefulStop: "0s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<10000"],
  },
};

export default function () {
  const endpoint = endpoints[(__VU + __ITER) % endpoints.length];
  const response = http.get(endpoint.url, { tags: { endpoint: endpoint.name } });

  check(response, {
    "returns HTTP 200": (result) => result.status === 200,
    "returns expected service": (result) => result.json("service") === endpoint.service,
    "returns ready status": (result) => result.json("status") === "ok",
  });

  sleep(0.25);
}
