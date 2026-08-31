/**
 * rent_stats: one e-Stat row per ward for 2023 (Shibuya highest, Setagaya
 * lowest, as required). REINS is deliberately absent until a licensed
 * production dataset is supplied.
 *
 * NOTE on `source` semantics for this table specifically: unlike every
 * other seeded table, `rent_stats.source` is NOT "where this row came
 * from the seed process" (that would always be 'seed') — it is the data
 * *provider* ('estat' | 'reins'), because pickRentStat reads this
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
];
