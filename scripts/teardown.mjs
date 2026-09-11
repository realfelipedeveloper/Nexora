import { spawn } from "node:child_process";

const child = spawn("docker", ["compose", "down", "--remove-orphans"], {
  shell: true,
  stdio: "inherit",
});

child.on("exit", (code) => process.exit(code ?? 0));
