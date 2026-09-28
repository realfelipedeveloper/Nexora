import { Injectable } from "@nestjs/common";

export type CacheOutcome =
  | "error"
  | "hit"
  | "invalidation"
  | "load"
  | "lock_wait"
  | "miss"
  | "negative_hit"
  | "oversize"
  | "write";

@Injectable()
export class CacheMetrics {
  private evictions = 0;
  private hotKeys = 0;
  private readonly operations = new Map<CacheOutcome, number>();

  record(outcome: CacheOutcome) {
    this.operations.set(outcome, (this.operations.get(outcome) ?? 0) + 1);
  }

  recordHotKey() {
    this.hotKeys += 1;
  }

  setEvictions(value: number) {
    if (Number.isSafeInteger(value) && value >= 0) this.evictions = value;
  }

  render() {
    const lines = ["# TYPE nexora_distributed_cache_operations_total counter"];
    for (const [outcome, count] of [...this.operations.entries()].sort()) {
      lines.push(`nexora_distributed_cache_operations_total{outcome="${outcome}"} ${count}`);
    }
    lines.push(
      "# TYPE nexora_distributed_cache_evictions gauge",
      `nexora_distributed_cache_evictions ${this.evictions}`,
      "# TYPE nexora_distributed_cache_hot_keys_total counter",
      `nexora_distributed_cache_hot_keys_total ${this.hotKeys}`,
    );
    return `${lines.join("\n")}\n`;
  }
}
