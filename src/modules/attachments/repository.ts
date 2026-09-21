import type { Queryable } from "../../shared/db.ts";

export async function countByIncident(db: Queryable, incidentId: string) {
  const result = await db.query(
    "SELECT count(*) FROM attachments WHERE incident_id=$1",
    [incidentId],
  );
  return Number(result.rows[0].count);
}

export async function insert(
  db: Queryable,
  values: {
    incidentId: string;
    uploadedBy: string;
    objectKey: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
  },
) {
  const result = await db.query(
    `INSERT INTO attachments(incident_id,uploaded_by,object_key,file_name,mime_type,size_bytes)
     VALUES($1,$2,$3,$4,$5,$6)
     RETURNING id,incident_id AS "incidentId",file_name AS "fileName",mime_type AS "mimeType",size_bytes::int AS size,created_at AS "createdAt"`,
    [
      values.incidentId,
      values.uploadedBy,
      values.objectKey,
      values.fileName,
      values.mimeType,
      values.sizeBytes,
    ],
  );
  return result.rows[0];
}

export async function listByIncident(db: Queryable, incidentId: string) {
  const result = await db.query(
    `SELECT id,incident_id AS "incidentId",uploaded_by AS "uploadedBy",file_name AS "fileName",
            mime_type AS "mimeType",size_bytes::int AS size,created_at AS "createdAt"
     FROM attachments WHERE incident_id=$1 ORDER BY created_at,id`,
    [incidentId],
  );
  return result.rows;
}

export async function findContent(
  db: Queryable,
  id: string,
  incidentId: string,
) {
  const result = await db.query(
    "SELECT object_key,file_name,mime_type FROM attachments WHERE id=$1 AND incident_id=$2",
    [id, incidentId],
  );
  return result.rows[0];
}
