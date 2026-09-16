import type { Queryable } from "../../shared/db.ts";

export async function findById(db: Queryable, id: string) {
  const result = await db.query(
    `SELECT id,name,email,role,created_at AS "createdAt",updated_at AS "updatedAt" FROM users WHERE id=$1`,
    [id],
  );
  return result.rows[0];
}

export async function listActive(db: Queryable, role?: string) {
  const result = await db.query(
    `SELECT id,name,email,role FROM users WHERE active ${role ? "AND role=$1" : ""} ORDER BY name`,
    role ? [role] : [],
  );
  return result.rows;
}
