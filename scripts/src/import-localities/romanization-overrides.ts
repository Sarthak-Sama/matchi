// Checked-in overrides for the 11 measured e-Stat localities that have no Japan Post
// romanized-address match (see .superpowers/sdd/locality-romanized-labels for the
// measurement). Keyed by ward code + the *stored* e-Stat Japanese locality name, i.e.
// the name after import-localities.ts's normalizeLocalityName has already dissolved
// any chome suffix.
export interface RomanizationOverride {
  readonly wardCode: string;
  readonly nameJa: string;
  readonly nameEn: string;
  readonly reason: string;
}

// NOTE: the 13103 row's nameJa is the single character U+2010 HYPHEN ("‐"), not an
// ASCII hyphen-minus "-" and not an em/en dash. It is e-Stat's literal placeholder name
// for Minato's unnamed waterfront blocks. Do not "fix" it to a plain hyphen.
const MINATO_WATERFRONT_PLACEHOLDER_NAME_JA = "‐";

export const ROMANIZATION_OVERRIDES: readonly RomanizationOverride[] = [
  {
    wardCode: "13101",
    nameJa: "三崎町",
    nameEn: "Misakicho",
    reason: "Japan Post files this as 神田三崎町 (KANDAMISAKICHO)",
  },
  {
    wardCode: "13101",
    nameJa: "猿楽町",
    nameEn: "Sarugakucho",
    reason: "Japan Post files this as 神田猿楽町 (KANDASARUGAKUCHO)",
  },
  {
    wardCode: "13102",
    nameJa: "水面調査区",
    nameEn: "Water Survey Area",
    reason: "Tokyo Bay survey polygon, not a postal town",
  },
  {
    wardCode: "13103",
    nameJa: MINATO_WATERFRONT_PLACEHOLDER_NAME_JA,
    nameEn: "Minato Waterfront",
    reason: "e-Stat placeholder name for Minato's unnamed waterfront blocks",
  },
  {
    wardCode: "13111",
    nameJa: "羽田沖水面及び中央防波堤外側付近",
    nameEn: "Haneda Offshore and Outer Breakwater",
    reason: "water polygon, not a postal town",
  },
  {
    wardCode: "13111",
    nameJa: "多摩川河川敷(上流)",
    nameEn: "Tamagawa Riverbed (Upstream)",
    reason: "riverbed polygon, not a postal town",
  },
  {
    wardCode: "13111",
    nameJa: "多摩川河川敷(下流)",
    nameEn: "Tamagawa Riverbed (Downstream)",
    reason: "riverbed polygon, not a postal town",
  },
  {
    wardCode: "13113",
    nameJa: "鴬谷町",
    nameEn: "Uguisudanicho",
    reason: "e-Stat writes 鴬, Japan Post writes 鶯",
  },
  {
    wardCode: "13113",
    nameJa: "松涛",
    nameEn: "Shoto",
    reason: "e-Stat writes 涛, Japan Post writes 濤",
  },
  {
    wardCode: "13121",
    nameJa: "入谷町,舎人町",
    nameEn: "Iriyamachi / Tonerimachi",
    reason: "e-Stat merges two postal towns into one polygon",
  },
  {
    wardCode: "13123",
    nameJa: "堀江町",
    nameEn: "Horiecho",
    reason: "former town name retained by e-Stat, absent from Japan Post",
  },
];
