import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { TestProject } from "vitest/node";

const POSTGRES_IMAGE = "postgres:17.5-alpine";

async function applySchema(connectionString: string) {
  const schemaPath = fileURLToPath(new URL("../../database/schema.sql", import.meta.url));
  const client = new Client({ connectionString });

  await client.connect();
  try {
    await client.query(await readFile(schemaPath, "utf8"));
  } finally {
    await client.end();
  }
}

export default async function setupPostgres(project: TestProject) {
  let container: StartedPostgreSqlContainer;

  try {
    container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
    await applySchema(container.getConnectionUri());
  } catch (error) {
    throw new Error(
      "O projeto postgres exige um runtime de containers ativo (Docker, Podman ou Colima). Inicie-o e execute npm test novamente.",
      { cause: error },
    );
  }

  project.provide("postgresUrl", container.getConnectionUri());

  return async () => {
    await container.stop();
  };
}

declare module "vitest" {
  export interface ProvidedContext {
    postgresUrl: string;
  }
}
