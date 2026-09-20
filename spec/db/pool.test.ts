import { describe, expect, it } from "bun:test";
import { createPool } from "../../db/pool.ts";

describe("Pool", () => {
  it("uses development defaults", () => {
    const pool = createPool({});

    expect(pool.options.user).toBe("postgres");
    expect(pool.options.password).toBe("postgres");
    expect(pool.options.database).toBe("tc_db_dev");
    expect(pool.options.host).toBe("db");
    expect(pool.options.port).toBe(5432);
  });

  it("uses informed values", () => {
    const pool = createPool({
      NODE_ENV: "test",
      POSTGRES_USER: "test_user",
      POSTGRES_PASSWORD: "test_password",
      POSTGRES_DB: "ignored_by_test_environment",
      POSTGRES_HOST: "test_host",
      POSTGRES_PORT: "5432",
    });

    expect(pool.options.user).toBe("test_user");
    expect(pool.options.password).toBe("test_password");
    expect(pool.options.database).toBe("tc_db_test");
    expect(pool.options.host).toBe("test_host");
    expect(pool.options.port).toBe(5432);
  });

  it("selects the database from NODE_ENV", () => {
    expect(createPool({ NODE_ENV: "test" }).options.database).toBe(
      "tc_db_test",
    );

    expect(createPool({ NODE_ENV: "production" }).options.database).toBe(
      "tc_db_prod",
    );
  });
});

describe("Pool TLS", () => {
  it("stays plaintext by default", () => {
    expect(createPool({}).options.ssl).toBeUndefined();
  });

  it("negotiates TLS when the managed database requires it", () => {
    expect(createPool({ POSTGRES_SSL: "true" }).options.ssl).toEqual({
      rejectUnauthorized: true,
    });
  });

  it("allows opting out of certificate verification", () => {
    expect(
      createPool({
        POSTGRES_SSL: "true",
        POSTGRES_SSL_REJECT_UNAUTHORIZED: "false",
      }).options.ssl,
    ).toEqual({ rejectUnauthorized: false });
  });
});
