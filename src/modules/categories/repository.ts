import type { Queryable } from "../../shared/db.ts";

export async function listActive(db: Queryable) {
  const result = await db.query(
    `SELECT id,name,slug FROM categories WHERE active ORDER BY name`,
  );
  return result.rows;
}
