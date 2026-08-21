/**
 * rent_stats: one e-Stat row per ward for 2023 (Shibuya highest, Setagaya
 * lowest, as required), plus one more-recent REINS row for Shibuya only so
 * Task 6's source-preference logic (`pickRentStat`) has a fixture where a
 * recent REINS row should be preferred over the older e-Stat one.
 *
 * NOTE on `source` semantics for this table specifically: unlike every
 * other seeded table, `rent_stats.source` is NOT "where this row came
 * from the seed process" (that would always be 'seed') — it is the data
 * *provider* ('estat' | 'reins'), because Task 6's pickRentStat reads this
 * exact column to decide which provider's row to prefer. So rent_stats
 * rows carry provider values here, never 'seed'.
 */

export interface RentStatFixture {
  readonly ward_code: string;
  readonly period: string;
  readonly source: string;
  readonly rent_per_sqm_yen: number;
  readonly management_fee_yen: number;
  readonly sample_count: number;
}

export const RENT_STATS: readonly RentStatFixture[] = [
  {
    ward_code: "13113",
    period: "2023",
    source: "estat",
    rent_per_sqm_yen: 4200,
    management_fee_yen: 8000,
    sample_count: 412,
  },
  {
    ward_code: "13104",
    period: "2023",
    source: "estat",
    rent_per_sqm_yen: 3600,
    management_fee_yen: 7000,
    sample_count: 388,
  },
  {
    ward_code: "13110",
    period: "2023",
    source: "estat",
    rent_per_sqm_yen: 3300,
    management_fee_yen: 6000,
    sample_count: 265,
  },
  {
    ward_code: "13112",
    period: "2023",
    source: "estat",
    rent_per_sqm_yen: 2600,
    management_fee_yen: 5000,
    sample_count: 501,
  },
  // More recent than every e-Stat row above; Task 7 exercises the
  // preference for this row over Shibuya's 2023 e-Stat row.
  {
    ward_code: "13113",
    period: "2026Q2",
    source: "reins",
    rent_per_sqm_yen: 4450,
    management_fee_yen: 8500,
    sample_count: 96,
  },
];
