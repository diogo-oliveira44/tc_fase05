import type { Queryable } from "../../shared/db.ts";
import type { AppConfig } from "../../config.ts";

export interface Period {
  createdFrom?: string;
  createdTo?: string;
}

/**
 * Every aggregate shares one period filter. The queries run in parallel because
 * they are independent reads, and `overdue` appends the SLA hours after it.
 */
export async function summary(
  db: Queryable,
  period: Period,
  slaHours: AppConfig["slaHours"],
) {
  const values: unknown[] = [];
  let filter = "";

  if (period.createdFrom) {
    values.push(period.createdFrom);
    filter += ` AND created_at >= $${values.length}`;
  }
  if (period.createdTo) {
    values.push(period.createdTo);
    filter += ` AND created_at <= $${values.length}`;
  }

  const [status, category, priority, resolution, ratings, overdue] =
    await Promise.all([
      db.query(
        `SELECT status AS key,count(*)::int AS count FROM incidents WHERE true ${filter} GROUP BY status`,
        values,
      ),
      db.query(
        `SELECT c.id,c.name,count(*)::int AS count FROM incidents i JOIN categories c ON c.id=i.category_id WHERE true ${filter.replaceAll("created_at", "i.created_at")} GROUP BY c.id,c.name`,
        values,
      ),
      db.query(
        `SELECT priority AS key,count(*)::int AS count FROM incidents WHERE true ${filter} GROUP BY priority`,
        values,
      ),
      db.query(
        `SELECT avg(extract(epoch FROM (resolved_at-created_at)))::float8 AS "averageResolutionSeconds" FROM incidents WHERE status='resolved' ${filter}`,
        values,
      ),
      db.query(
        `SELECT avg(r.score)::float8 AS average,json_object_agg(r.score,r.count) AS distribution FROM (SELECT score,count(*)::int AS count FROM ratings GROUP BY score) r`,
      ),
      db.query(
        `SELECT count(*)::int AS count FROM incidents
         WHERE status NOT IN ('resolved','cancelled') ${filter}
           AND created_at < now() - ((CASE priority
                WHEN 'critical' THEN $${values.length + 1}
                WHEN 'high' THEN $${values.length + 2}
                WHEN 'medium' THEN $${values.length + 3}
                ELSE $${values.length + 4} END)::int * interval '1 hour')`,
        [
          ...values,
          slaHours.critical,
          slaHours.high,
          slaHours.medium,
          slaHours.low,
        ],
      ),
    ]);

  return {
    byStatus: status.rows,
    byCategory: category.rows,
    byPriority: priority.rows,
    averageResolutionSeconds: resolution.rows[0].averageResolutionSeconds,
    overdue: overdue.rows[0].count,
    slaHours,
    ratings: ratings.rows[0],
  };
}
