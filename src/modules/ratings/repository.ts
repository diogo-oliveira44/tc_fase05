import type { Queryable } from "../../shared/db.ts";

export async function insert(
  db: Queryable,
  incidentId: string,
  authorId: string,
  score: number,
  comment: string | null,
) {
  const result = await db.query(
    `INSERT INTO ratings(incident_id,author_id,score,comment) VALUES($1,$2,$3,$4)
     RETURNING id,incident_id AS "incidentId",score,comment,created_at AS "createdAt"`,
    [incidentId, authorId, score, comment],
  );
  return result.rows[0];
}

export async function findByIncident(db: Queryable, incidentId: string) {
  const result = await db.query(
    `SELECT r.id,r.incident_id AS "incidentId",r.author_id AS "authorId",u.name AS "authorName",
            r.score,r.comment,r.created_at AS "createdAt"
     FROM ratings r JOIN users u ON u.id=r.author_id WHERE r.incident_id=$1`,
    [incidentId],
  );
  return result.rows[0];
}
