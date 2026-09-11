const retryBaseline = {
  queue: "foundation.jobs",
  deadLetterQueue: "foundation.jobs.dlq",
  maxAttempts: 3,
};

console.log(JSON.stringify({ service: "worker", status: "ready", retryBaseline }));
