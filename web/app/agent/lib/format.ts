export function yen(value: number): string {
  const rounded = Math.round(value);
  const sign = rounded < 0 ? "−" : "";
  return `${sign}¥${Math.abs(rounded).toLocaleString("en-US")}`;
}

export function yenSigned(value: number): string {
  const rounded = Math.round(value);
  if (rounded === 0) return "¥0";
  return `${rounded > 0 ? "+" : "−"}¥${Math.abs(rounded).toLocaleString("en-US")}`;
}

export function percent(share: number, digits = 0): string {
  return `${(share * 100).toFixed(digits)}%`;
}
