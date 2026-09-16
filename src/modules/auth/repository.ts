import type { Queryable } from "../../shared/db.ts";

export interface UserRow {
  id: string;
  name: string;
  email: string;
  role: "requester" | "manager" | "admin";
  password_hash: string;
}

export async function isActive(db: Queryable, userId: string) {
  const result = await db.query("SELECT 1 FROM users WHERE id=$1 AND active", [
    userId,
  ]);
  return Boolean(result.rowCount);
}

export async function insertUser(
  db: Queryable,
  name: string,
  email: string,
  passwordHash: string,
  role: "requester" | "manager" = "requester",
) {
  const result = await db.query(
    `INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4)
     RETURNING id,name,email,role,created_at AS "createdAt"`,
    [name, email, passwordHash, role],
  );
  return result.rows[0];
}

export async function findActiveByEmail(
  db: Queryable,
  email: string,
): Promise<UserRow | undefined> {
  const result = await db.query(
    "SELECT id,name,email,password_hash,role FROM users WHERE email=$1 AND active",
    [email],
  );
  return result.rows[0];
}

export async function insertRefreshToken(
  db: Queryable,
  userId: string,
  tokenHash: string,
  ttlSeconds: number,
) {
  await db.query(
    `INSERT INTO refresh_tokens(user_id, token_hash, expires_at)
     VALUES($1,$2,now()+($3 * interval '1 second'))`,
    [userId, tokenHash, ttlSeconds],
  );
}

/** Locks the row so two concurrent refreshes cannot rotate the same token twice. */
export async function lockLiveRefreshToken(db: Queryable, tokenHash: string) {
  const result = await db.query(
    `SELECT rt.id,u.id AS user_id,u.role FROM refresh_tokens rt JOIN users u ON u.id=rt.user_id
     WHERE rt.token_hash=$1 AND rt.revoked_at IS NULL AND rt.expires_at>now() AND u.active FOR UPDATE OF rt`,
    [tokenHash],
  );
  return result.rows[0];
}

export async function revokeRefreshToken(db: Queryable, id: string) {
  await db.query("UPDATE refresh_tokens SET revoked_at=now() WHERE id=$1", [
    id,
  ]);
}

export async function revokeUserRefreshToken(
  db: Queryable,
  userId: string,
  tokenHash: string,
) {
  await db.query(
    "UPDATE refresh_tokens SET revoked_at=now() WHERE user_id=$1 AND token_hash=$2 AND revoked_at IS NULL",
    [userId, tokenHash],
  );
}
