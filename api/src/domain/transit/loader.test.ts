/**
 * `loadRailEdges` is thin by design — this test only checks it queries the
 * right tables and passes rows through untouched, using a fake pool (no
 * real database, matching `health.test.ts`'s pattern).
 */

import { describe, expect, it, vi } from "vitest";

import type { DbPool } from "../../db.js";
import { loadRailEdges } from "./loader.js";

describe("loadRailEdges", () => {
  it("queries rail_edges joined to rail_lines and returns the rows unchanged", async () => {
    const fakeRow = {
      fromStationGroupId: "sg-a",
      toStationGroupId: "sg-b",
      railLineId: "rl-1",
      railLineName: "Line One",
      edgeType: "ride",
      peakTravelMinutes: 5,
      offpeakTravelMinutes: 3,
      peakWaitMinutes: 0,
      offpeakWaitMinutes: 0,
      confidence: "high",
    };
    const pool: DbPool = { query: vi.fn().mockResolvedValue({ rows: [fakeRow] }) };

    const rows = await loadRailEdges(pool);

    expect(rows).toEqual([fakeRow]);
    expect(pool.query).toHaveBeenCalledTimes(1);
    const [sql] = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(sql).toContain("FROM rail_edges");
    expect(sql).toContain("LEFT JOIN rail_lines");
  });
});
