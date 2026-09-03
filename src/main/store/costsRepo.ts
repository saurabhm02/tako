import { randomUUID } from "node:crypto";
import { getDatabase } from "./db";
import { getCurrentRunId } from "./runsRepo";
import type { UsageReport } from "../adapters/Adapter";
import type { CostSummary, CostTotals } from "../../shared/types";

// CT1 (docs/06-decisions-log.md): never invent a cost. Every row is either
// a real reported number or explicitly flagged unknown — there is no
// estimation path anywhere in this file.
export function insertCost(runId: string, nodeId: string, usage: UsageReport | "unknown"): void {
  const isUnknown = usage === "unknown";
  getDatabase()
    .prepare(
      `INSERT INTO costs (id, run_id, node_id, tokens_or_units, dollar_cost, unknown, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      randomUUID(),
      runId,
      nodeId,
      isUnknown ? null : (usage.tokensOrUnits ?? null),
      isUnknown ? null : (usage.dollarCost ?? null),
      isUnknown ? 1 : 0,
      Date.now(),
    );
}

interface Totals {
  dollarTotal: number;
  tokensOrUnits: number;
  hasUnknown: boolean;
}

// A row counts as "unknown" for display purposes either when the adapter
// reported no usage at all, or when it reported real token usage but the
// model wasn't in the pricing table (dollar_cost stayed null) — either way
// the dollar total shown is a lower bound, never the full picture.
const INCOMPLETE_ROW = "(unknown = 1 OR (unknown = 0 AND tokens_or_units IS NOT NULL AND dollar_cost IS NULL))";

function totalsFor(whereClause: string, params: unknown[]): Totals {
  const db = getDatabase();
  const sums = db
    .prepare(
      `SELECT COALESCE(SUM(dollar_cost), 0) as dollarTotal, COALESCE(SUM(tokens_or_units), 0) as tokensOrUnits
       FROM costs WHERE ${whereClause} AND unknown = 0`,
    )
    .get(...params) as { dollarTotal: number; tokensOrUnits: number };
  const incompleteCount = db
    .prepare(`SELECT COUNT(*) as count FROM costs WHERE ${whereClause} AND ${INCOMPLETE_ROW}`)
    .get(...params) as { count: number };
  return { dollarTotal: sums.dollarTotal, tokensOrUnits: sums.tokensOrUnits, hasUnknown: incompleteCount.count > 0 };
}

// Same query shape getCostSummary already uses for the live run, just for
// an arbitrary past one — Run History has real per-run cost data sitting
// in this table (run_id is already there), nothing was exposing it.
export function getCostSummaryForRun(runId: string): CostTotals {
  return totalsFor("run_id = ?", [runId]);
}

export function getCostSummary(): CostSummary {
  const runId = getCurrentRunId();
  const allTime = totalsFor("1 = 1", []);

  if (!runId) {
    return { currentRun: null, allTime, perNode: [] };
  }

  const currentRun = totalsFor("run_id = ?", [runId]);
  const perNodeRows = getDatabase()
    .prepare(
      `SELECT node_id,
              COALESCE(SUM(CASE WHEN unknown = 0 THEN dollar_cost ELSE 0 END), 0) as dollarTotal,
              COALESCE(SUM(CASE WHEN unknown = 0 THEN tokens_or_units ELSE 0 END), 0) as tokensOrUnits,
              SUM(CASE WHEN ${INCOMPLETE_ROW} THEN 1 ELSE 0 END) as unknownCount
       FROM costs WHERE run_id = ? GROUP BY node_id`,
    )
    .all(runId) as Array<{ node_id: string; dollarTotal: number; tokensOrUnits: number; unknownCount: number }>;

  return {
    currentRun,
    allTime,
    perNode: perNodeRows.map((row) => ({
      nodeId: row.node_id,
      dollarTotal: row.dollarTotal,
      tokensOrUnits: row.tokensOrUnits,
      hasUnknown: row.unknownCount > 0,
    })),
  };
}
