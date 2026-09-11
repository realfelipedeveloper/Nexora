import type { HealthResponse } from "@nexora/contracts";

export async function fetchHealth(baseUrl: string): Promise<HealthResponse> {
  const response = await fetch(new URL("/health", baseUrl));
  if (!response.ok) {
    throw new Error(`Health request failed with status ${response.status}`);
  }

  return (await response.json()) as HealthResponse;
}
