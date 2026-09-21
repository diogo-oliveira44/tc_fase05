import type { Pool } from "pg";
import type { AppConfig } from "../../config.ts";
import { transaction, type Queryable } from "../../shared/db.ts";
import { AppError } from "../../shared/errors.ts";
import { createAccessToken, tokenHash } from "../../shared/tokens.ts";
import * as repository from "./repository.ts";

export interface Principal {
  id: string;
  role: "requester" | "manager" | "admin";
}

/** Mints an access token and stores the hash of a fresh refresh token. */
export async function issueTokens(
  config: AppConfig,
  db: Queryable,
  user: Principal,
) {
  const accessToken = await createAccessToken(
    { sub: user.id, role: user.role },
    config.jwtSecret,
    config.accessTokenTtlSeconds,
  );
  const refreshToken =
    `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");

  await repository.insertRefreshToken(
    db,
    user.id,
    await tokenHash(refreshToken),
    config.refreshTokenTtlSeconds,
  );

  return {
    accessToken,
    refreshToken,
    tokenType: "Bearer",
    expiresIn: config.accessTokenTtlSeconds,
  };
}

export async function register(
  pool: Pool,
  name: string,
  email: string,
  password: string,
  role: "requester" | "manager" = "requester",
) {
  const hash = await Bun.password.hash(password, { algorithm: "argon2id" });

  try {
    return await repository.insertUser(pool, name, email, hash, role);
  } catch (error: any) {
    if (error?.code === "23505")
      throw new AppError(
        409,
        "EMAIL_ALREADY_EXISTS",
        "Email is already registered",
      );
    throw error;
  }
}

export async function login(
  pool: Pool,
  config: AppConfig,
  email: string,
  password: string,
) {
  const user = await repository.findActiveByEmail(pool, email);

  if (!user || !(await Bun.password.verify(password, user.password_hash)))
    throw new AppError(
      401,
      "INVALID_CREDENTIALS",
      "Email or password is invalid",
    );

  return {
    ...(await issueTokens(config, pool, user)),
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  };
}

/** Single-use refresh: the presented token is revoked and replaced in one transaction. */
export async function refresh(
  pool: Pool,
  config: AppConfig,
  refreshToken: string,
) {
  const hash = await tokenHash(refreshToken);

  return transaction(pool, async (client) => {
    const row = await repository.lockLiveRefreshToken(client, hash);

    if (!row)
      throw new AppError(
        401,
        "INVALID_REFRESH_TOKEN",
        "Refresh token is invalid or expired",
      );

    await repository.revokeRefreshToken(client, row.id);
    return issueTokens(config, client, { id: row.user_id, role: row.role });
  });
}

export async function logout(pool: Pool, userId: string, refreshToken: string) {
  await repository.revokeUserRefreshToken(
    pool,
    userId,
    await tokenHash(refreshToken),
  );
}
