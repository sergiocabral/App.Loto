const { spawn } = require("node:child_process");
const dotenv = require("dotenv");

dotenv.config({ path: [".env.local", ".env"], quiet: true });

const DEFAULT_PORT = "4000";
const VALID_COMMANDS = new Set(["dev", "start"]);

function resolvePort(value = process.env.APP_PORT ?? process.env.PORT) {
  const port = value?.trim() || DEFAULT_PORT;

  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    throw new Error(`PORT must be an integer between 1 and 65535; received ${JSON.stringify(value)}`);
  }

  return port;
}

function run() {
  const command = process.argv[2];

  if (!VALID_COMMANDS.has(command)) {
    throw new Error(`Expected one of: ${[...VALID_COMMANDS].join(", ")}`);
  }

  const args = process.argv.slice(3);
  const hasPortArgument = args.some((arg) => arg === "-p" || arg === "--port" || arg.startsWith("--port="));
  const nextArgs = hasPortArgument ? [command, ...args] : [command, "--port", resolvePort(), ...args];
  const child = spawn(process.execPath, [require.resolve("next/dist/bin/next"), ...nextArgs], {
    env: process.env,
    stdio: "inherit",
  });

  child.once("error", (error) => {
    console.error(error);
    process.exitCode = 1;
  });

  child.once("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exitCode = code ?? 1;
  });
}

if (require.main === module) {
  try {
    run();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

module.exports = { DEFAULT_PORT, resolvePort };
