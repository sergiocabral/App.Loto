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

function run({ args = process.argv.slice(2), environment = process.env, spawnChild = spawn, processId = process.execPath, killProcess = process.kill, parentPid = process.pid } = {}) {
  const command = args[0];

  if (!VALID_COMMANDS.has(command)) {
    throw new Error(`Expected one of: ${[...VALID_COMMANDS].join(", ")}`);
  }

  const commandArgs = args.slice(1);
  const hasPortArgument = commandArgs.some((arg) => arg === "-p" || arg === "--port" || arg.startsWith("--port="));
  const nextArgs = hasPortArgument ? [command, ...commandArgs] : [command, "--port", resolvePort(environment.APP_PORT ?? environment.PORT), ...commandArgs];
  const child = spawnChild(processId, [require.resolve("next/dist/bin/next"), ...nextArgs], {
    env: environment,
    stdio: "inherit",
  });

  child.once("error", (error) => {
    console.error(error);
    process.exitCode = 1;
  });

  child.once("exit", (code, exitSignal) => {
    if (exitSignal) {
      killProcess(parentPid, exitSignal);
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

module.exports = { DEFAULT_PORT, resolvePort, run };
