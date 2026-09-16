import pool from "./pool.ts";
import { migrate } from "./migrate.ts";

async function seed() {
  await migrate();

  for (const role of ["manager", "admin"] as const) {
    const prefix = role.toUpperCase();
    const password = process.env[`${prefix}_PASSWORD`];
    if (!password) continue;
    if (password.length < 8)
      throw new Error(`${prefix}_PASSWORD must contain at least 8 characters`);
    const email = (process.env[`${prefix}_EMAIL`] ?? `${role}@resolveai.local`)
      .trim()
      .toLowerCase();
    const name = process.env[`${prefix}_NAME`] ?? `Resolve Aí ${role}`;
    const hash = await Bun.password.hash(password, { algorithm: "argon2id" });
    const result = await pool.query(
      `INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4)
       ON CONFLICT(email) DO UPDATE SET name=excluded.name,password_hash=excluded.password_hash,active=true,updated_at=now()
       WHERE users.role=excluded.role RETURNING id`,
      [name, email, hash, role],
    );
    if (!result.rowCount)
      throw new Error(`${prefix}_EMAIL belongs to a different role`);
    console.log(`${role} seeded: ${email}`);
  }
}
if (import.meta.main)
  seed()
    .then(() => pool.end())
    .catch(async (e) => {
      console.error(e);
      await pool.end();
      process.exitCode = 1;
    });
