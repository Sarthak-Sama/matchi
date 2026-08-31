export interface WardLookupEntry {
  readonly wardCode: string;
  readonly nameJa: string;
}

export function normalizeWardName(raw: string): string {
  return raw.normalize("NFKC").replace(/[\s\u3000]/g, "");
}

export function matchWard(
  rawCode: string | undefined,
  rawName: string | undefined,
  wards: readonly WardLookupEntry[],
  context: string,
): string {
  const trimmedCode = rawCode?.trim();
  if (trimmedCode) {
    const byCode = wards.find((w) => w.wardCode === trimmedCode);
    if (byCode) return byCode.wardCode;
  }

  const trimmedName = rawName?.trim();
  if (trimmedName) {
    const normalized = normalizeWardName(trimmedName);
    const byName = wards.find((w) => normalizeWardName(w.nameJa) === normalized);
    if (byName) return byName.wardCode;
  }

  const unmatchedValue = trimmedCode || trimmedName || "(no code or name given)";
  throw new Error(
    `${context}: no known ward matches "${unmatchedValue}" (checked the 5-digit municipality ` +
      `code, then the normalized Japanese ward name, against every ward currently in the ` +
      `database).`,
  );
}
