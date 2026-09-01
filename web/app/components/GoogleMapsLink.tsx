import type { NeighborhoodResult } from "@tokyo/shared";

import { googleMapsUrl, localityDisplayName } from "../../lib/format";
import { ExternalLinkIcon, MapPinIcon } from "./icons";

export function GoogleMapsLink({
  result,
  compact = false,
}: {
  readonly result: NeighborhoodResult;
  readonly compact?: boolean;
}) {
  const name = localityDisplayName(result.nameEn, result.nameJa);

  return (
    <a
      href={googleMapsUrl(result.centroid.lat, result.centroid.lon)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`View ${name} on Google Maps (opens in a new tab)`}
      className={`group/maps inline-flex shrink-0 items-center gap-1.5 text-[11px] font-semibold tracking-[0.1em] text-ink-muted uppercase underline decoration-line-strong underline-offset-4 transition-colors hover:text-vermilion-deep hover:decoration-vermilion-deep ${
        compact ? "min-h-11 px-1 sm:min-h-8" : "min-h-11 px-0.5"
      }`}
    >
      <MapPinIcon className="size-3.5" />
      <span>{compact ? "Map" : "Google Maps"}</span>
      <ExternalLinkIcon className="size-3 transition-transform group-hover/maps:-translate-y-0.5 group-hover/maps:translate-x-0.5 motion-reduce:transition-none" />
    </a>
  );
}
