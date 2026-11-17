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
