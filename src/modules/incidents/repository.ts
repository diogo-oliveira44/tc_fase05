import type { Queryable } from "../../shared/db.ts";
import type { IncidentStatus } from "./domain.ts";

/** The single projection every endpoint returns, so the shape never drifts. */
const incidentSelect = `SELECT i.id, i.requester_id AS "requesterId", requester.name AS "requesterName",
 i.assignee_id AS "assigneeId", assignee.name AS "assigneeName",
 i.category_id AS "categoryId", c.name AS "categoryName", i.title, i.description, i.address,
 i.location_details AS "locationDetails", i.latitude::float8, i.longitude::float8, i.status,
 i.priority, i.solution, i.resolved_at AS "resolvedAt", i.version, i.created_at AS "createdAt",
 i.updated_at AS "updatedAt" FROM incidents i
 JOIN categories c ON c.id=i.category_id
 JOIN users requester ON requester.id=i.requester_id
 LEFT JOIN users assignee ON assignee.id=i.assignee_id`;

export interface ListFilters {
  requesterId?: string;
  status?: string;
  priority?: string;
  categoryId?: string;
  assigneeId?: string;
  createdFrom?: string;
  createdTo?: string;
}

const sorts: Record<string, string> = {
  createdAt: "i.created_at ASC",
  "-createdAt": "i.created_at DESC",
  priority: "i.priority ASC",
  "-priority": "i.priority DESC",
};

export async function findById(db: Queryable, id: string) {
  const result = await db.query(`${incidentSelect} WHERE i.id=$1`, [id]);
  return result.rows[0];
}

export async function categoryExists(db: Queryable, categoryId: string) {
  const result = await db.query(
    "SELECT 1 FROM categories WHERE id=$1 AND active",
    [categoryId],
  );
  return Boolean(result.rowCount);
}

export async function isEligibleAssignee(db: Queryable, userId: string) {
  const result = await db.query(
    "SELECT 1 FROM users WHERE id=$1 AND role='manager' AND active",
    [userId],
  );
  return Boolean(result.rowCount);
}

export async function insert(
  db: Queryable,
  values: {
    requesterId: string;
    categoryId: string;
    title: string;
    description: string;
    address: string;
    locationDetails: string | null;
    latitude: number | null;
    longitude: number | null;
  },
): Promise<string> {
  const result = await db.query(
    `INSERT INTO incidents(requester_id,category_id,title,description,address,location_details,latitude,longitude)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [
      values.requesterId,
      values.categoryId,
      values.title,
      values.description,
      values.address,
      values.locationDetails,
      values.latitude,
      values.longitude,
    ],
  );
  return result.rows[0].id;
}

export async function list(
  db: Queryable,
  filters: ListFilters,
  sort: string | undefined,
  page: number,
  pageSize: number,
) {
  const where: string[] = [];
  const values: unknown[] = [];
  const add = (sql: string, value: unknown) => {
    values.push(value);
    where.push(sql.replace("?", `$${values.length}`));
  };

  if (filters.requesterId) add("i.requester_id=?", filters.requesterId);
  if (filters.status) add("i.status=?", filters.status);
  if (filters.priority) add("i.priority=?", filters.priority);
  if (filters.categoryId) add("i.category_id=?", filters.categoryId);
  if (filters.assigneeId) add("i.assignee_id=?", filters.assigneeId);
  if (filters.createdFrom) add("i.created_at>=?", filters.createdFrom);
  if (filters.createdTo) add("i.created_at<=?", filters.createdTo);

  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const count = await db.query(
    `SELECT count(*) FROM incidents i ${clause}`,
    values,
  );

  values.push(pageSize, (page - 1) * pageSize);
  const rows = await db.query(
    `${incidentSelect} ${clause} ORDER BY ${sorts[String(sort)] ?? "i.created_at DESC"} LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );

  return { rows: rows.rows, total: Number(count.rows[0].count) };
}

export async function history(db: Queryable, incidentId: string) {
  const result = await db.query(
    `SELECT h.id,h.type,h."previousValue",h."newValue",h."changedBy",h.reason,h."createdAt",
            actor.name AS "changedByName",
            previous_assignee.name AS "previousLabel",
            new_assignee.name AS "newLabel"
     FROM (
      SELECT id,'status' AS type,previous_status::text AS "previousValue",new_status::text AS "newValue",changed_by AS "changedBy",observation AS reason,created_at AS "createdAt" FROM status_history WHERE incident_id=$1
      UNION ALL SELECT id,'assignment',previous_assignee_id::text,new_assignee_id::text,changed_by,reason,created_at FROM assignment_history WHERE incident_id=$1
      UNION ALL SELECT id,'priority',previous_priority::text,new_priority::text,changed_by,reason,created_at FROM priority_history WHERE incident_id=$1
    ) h
     JOIN users actor ON actor.id=h."changedBy"
     LEFT JOIN users previous_assignee ON previous_assignee.id=(CASE WHEN h.type='assignment' THEN h."previousValue" END)::uuid
     LEFT JOIN users new_assignee ON new_assignee.id=(CASE WHEN h.type='assignment' THEN h."newValue" END)::uuid
     ORDER BY h."createdAt",h.id`,
    [incidentId],
  );
  return result.rows;
}

/** Locks the incident row for the rest of the transaction. */
export async function lock(db: Queryable, columns: string, id: string) {
  const result = await db.query(
    `SELECT ${columns},version FROM incidents WHERE id=$1 FOR UPDATE`,
    [id],
  );
  return result.rows[0];
}

export async function updatePriority(
  db: Queryable,
  id: string,
  priority: string,
) {
  await db.query(
    "UPDATE incidents SET priority=$2,version=version+1,updated_at=now() WHERE id=$1",
    [id, priority],
  );
}

export async function insertPriorityHistory(
  db: Queryable,
  id: string,
  previous: string,
  next: string,
  changedBy: string,
  reason: string,
) {
  await db.query(
    "INSERT INTO priority_history(incident_id,previous_priority,new_priority,changed_by,reason) VALUES($1,$2,$3,$4,$5)",
    [id, previous, next, changedBy, reason],
  );
}

export async function updateAssignee(
  db: Queryable,
  id: string,
  assigneeId: string,
) {
  await db.query(
    "UPDATE incidents SET assignee_id=$2,version=version+1,updated_at=now() WHERE id=$1",
    [id, assigneeId],
  );
}

export async function insertAssignmentHistory(
  db: Queryable,
  id: string,
  previous: string | null,
  next: string,
  changedBy: string,
  reason: string,
) {
  await db.query(
    "INSERT INTO assignment_history(incident_id,previous_assignee_id,new_assignee_id,changed_by,reason) VALUES($1,$2,$3,$4,$5)",
    [id, previous, next, changedBy, reason],
  );
}

/** `solution`, `resolved_by` and `resolved_at` are only kept while the status is resolved. */
export async function applyTransition(
  db: Queryable,
  id: string,
  to: IncidentStatus,
  solution: string | null,
  resolvedBy: string,
) {
  await db.query(
    `UPDATE incidents SET status=$2::incident_status,solution=CASE WHEN $2::text='resolved' THEN $3::text ELSE NULL END,resolved_by=CASE WHEN $2::text='resolved' THEN $4::uuid ELSE NULL END,resolved_at=CASE WHEN $2::text='resolved' THEN now() ELSE NULL END,version=version+1,updated_at=now() WHERE id=$1`,
    [id, to, solution, resolvedBy],
  );
}

export async function insertStatusHistory(
  db: Queryable,
  id: string,
  previous: string,
  next: string,
  changedBy: string,
  observation: string | null,
) {
  await db.query(
    "INSERT INTO status_history(incident_id,previous_status,new_status,changed_by,observation) VALUES($1,$2,$3,$4,$5)",
    [id, previous, next, changedBy, observation],
  );
}
