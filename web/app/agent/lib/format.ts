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

/** Rent is a model output, so it is shown rounded and hedged: "about ¥99k". */
export function aboutYen(value: number): string {
  return `about ¥${Math.round(value / 1000).toLocaleString("en-US")}k`;
}

/** A Google search for rentals in the area; needs no portal-specific URL format. */
export function listingsSearchUrl(nameJa: string, layout?: string): string {
  const query = [nameJa, "賃貸", layout].filter(Boolean).join(" ");
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}
