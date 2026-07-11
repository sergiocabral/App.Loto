import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { TestProject } from "vitest/node";

const POSTGRES_IMAGE = "postgres:17.5-alpine";

type PostgresContainer = Pick<StartedPostgreSqlContainer, "getConnectionUri" | "stop">;

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

export async function createPostgresSetup(
  project: TestProject,
  dependencies: PostgresSetupDependencies = { applySchema, startContainer },
) {
  let container: PostgresContainer;

  try {
    container = await dependencies.startContainer();
  } catch (error) {
    throw new Error(
      "O projeto postgres exige um runtime de containers ativo (Docker, Podman ou Colima). Inicie-o e execute npm test novamente.",
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
