// `npm run dev`: starts the backend (port 3000) and the Vite frontend (port 5173) together.
// Open http://localhost:5173 to play; Vite forwards /api calls to the backend.
import { spawn } from "node:child_process";

const children = [
  spawn("npm", ["run", "dev", "-w", "backend"], { stdio: "inherit", shell: true }),
  spawn("npm", ["run", "dev", "-w", "frontend"], { stdio: "inherit", shell: true }),
];

function stopAll(code = 0) {
  for (const child of children) if (!child.killed) child.kill();
  process.exit(code);
}

for (const child of children) child.on("exit", (code) => stopAll(code ?? 0));
process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));
