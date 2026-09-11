export function expectIsoTimestamp(value: string) {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    throw new Error(`Expected ISO timestamp, received ${value}`);
  }
}
