import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Client } from "pg";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { TestProject } from "vitest/node";

const POSTGRES_IMAGE = "postgres:17.5-alpine";
const execFile = promisify(execFileCallback);

type PostgresContainer = {
  getConnectionUri: () => string;
  stop: () => Promise<unknown>;
};

type PostgresSetupDependencies = {
  applySchema: (connectionString: string) => Promise<void>;
  startContainer: () => Promise<PostgresContainer>;
};

async function applySchema(connectionString: string): Promise<void> {
  const schemaPath = fileURLToPath(new URL("../../database/schema.sql", import.meta.url));
  const client = new Client({ connectionString });

  await client.connect();
  try {
    await client.query(await readFile(schemaPath, "utf8"));
  } finally {
    await client.end();
  }
}

async function startContainer(): Promise<StartedPostgreSqlContainer> {
  return new PostgreSqlContainer(POSTGRES_IMAGE).start();
}

async function getAvailablePort(): Promise<number> {
  const server = createServer();

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Não foi possível reservar uma porta local para o PostgreSQL de teste."));
        return;
      }

      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

async function startLocalPostgres(): Promise<PostgresContainer> {
  const { stdout } = await execFile("pg_config", ["--bindir"]);
  const binDirectory = stdout.trim();
  const dataDirectory = await mkdtemp(path.join(tmpdir(), "luckygames-postgres-"));
  const port = await getAvailablePort();
  const initdb = path.join(binDirectory, "initdb");
  const pgCtl = path.join(binDirectory, "pg_ctl");
  let started = false;

  try {
    await execFile(initdb, [
      "-D",
      dataDirectory,
      "-U",
      "postgres",
      "--auth=trust",
      "--encoding=UTF8",
      "--no-locale",
    ]);
    await execFile(pgCtl, [
      "-D",
      dataDirectory,
      "-l",
      path.join(dataDirectory, "postgres.log"),
      "-o",
      `-h 127.0.0.1 -k ${dataDirectory} -p ${port}`,
      "-w",
      "start",
    ]);
    started = true;

    return {
      getConnectionUri: () => `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`,
      stop: async () => {
        if (started) {
          await execFile(pgCtl, ["-D", dataDirectory, "-m", "fast", "-w", "stop"]);
          started = false;
        }
        await rm(dataDirectory, { force: true, recursive: true });
      },
    };
  } catch (error) {
    if (started) {
      await execFile(pgCtl, ["-D", dataDirectory, "-m", "fast", "-w", "stop"]).catch(() => undefined);
    }
    await rm(dataDirectory, { force: true, recursive: true });
    throw error;
  }
}

async function startDisposablePostgres(): Promise<PostgresContainer> {
  try {
    return await startContainer();
  } catch (containerError) {
    try {
      return await startLocalPostgres();
    } catch (localError) {
      throw new AggregateError(
        [containerError, localError],
        "Nenhum runtime de containers nem servidor PostgreSQL local descartável está disponível.",
      );
    }
  }
}

export async function createPostgresSetup(
  project: TestProject,
  dependencies: PostgresSetupDependencies = { applySchema, startContainer: startDisposablePostgres },
) {
  let container: PostgresContainer;

  try {
    container = await dependencies.startContainer();
  } catch (error) {
    throw new Error(
      "O projeto postgres exige Docker, Podman, Colima ou os binários locais do PostgreSQL (pg_config/initdb/pg_ctl).",
      { cause: error },
    );
  }

  try {
    await dependencies.applySchema(container.getConnectionUri());
  } catch (error) {
    try {
      await container.stop();
    } catch (stopError) {
      throw new Error(
        "O container PostgreSQL foi iniciado, mas não pôde ser inicializado com o schema de teste nem encerrado após a falha.",
        { cause: new AggregateError([error, stopError], "Falhas de schema e cleanup do PostgreSQL de teste") },
      );
    }

    throw new Error(
      "O container PostgreSQL foi iniciado, mas não pôde ser inicializado com o schema de teste.",
      { cause: error },
    );
  }

  project.provide("postgresUrl", container.getConnectionUri());

  return async () => {
    await container.stop();
  };
}

export default function setupPostgres(project: TestProject) {
  return createPostgresSetup(project);
}

declare module "vitest" {
  export interface ProvidedContext {
    postgresUrl: string;
  }
}
