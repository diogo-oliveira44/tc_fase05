import { readdir, readFile } from "node:fs/promises";
import type { Pool } from "pg";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pool from "./pool.ts";

const migrationsDirectory = fileURLToPath(
  new URL("./migrations", import.meta.url),
);

export async function migrate(target: Pool = pool): Promise<void> {
  const client = await target.connect();

  try {
    // Isso evita de executar a mesma migrate 2 vezes. Basicamente como um orm
    // acompanha o que já foi executado
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    // Cuidado aqui. As migrates precisam seguir a nomenclaura (0001_banan.sql)
    // caso contrário vai ter problemas de criar uma chave de uma coluna que
    // não existe, por exemplo
    const files = (await readdir(migrationsDirectory))
      .filter((file) => file.endsWith(".sql"))
      .sort();

    for (const file of files) {
      const applied = await client.query(
        "SELECT 1 FROM schema_migrations WHERE name = $1",
        [file],
      );
      if (applied.rowCount) continue;

      const sql = await readFile(path.join(migrationsDirectory, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [
          file,
        ]);
        await client.query("COMMIT");
        console.log(`Applied migration ${file}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    client.release();
  }
}

if (import.meta.main) {
  migrate()
    .then(() => pool.end())
    .catch(async (error) => {
      console.error(error);
      await pool.end();
      process.exitCode = 1;
    });
}
