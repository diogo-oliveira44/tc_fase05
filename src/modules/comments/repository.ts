import type { Queryable } from "../../shared/db.ts";

export async function insert(
  db: Queryable,
  incidentId: string,
  authorId: string,
  body: string,
) {
  const result = await db.query(
    `INSERT INTO comments(incident_id,author_id,body) VALUES($1,$2,$3)
     RETURNING id,incident_id AS "incidentId",author_id AS "authorId",body,created_at AS "createdAt"`,
    [incidentId, authorId, body],
  );
  return result.rows[0];
}

export async function listByIncident(db: Queryable, incidentId: string) {
  const result = await db.query(
    `SELECT c.id,c.author_id AS "authorId",u.name AS "authorName",c.body,c.created_at AS "createdAt"
     FROM comments c JOIN users u ON u.id=c.author_id WHERE incident_id=$1 ORDER BY c.created_at,c.id`,
    [incidentId],
  );
  return result.rows;
}
