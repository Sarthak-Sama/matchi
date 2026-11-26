"use client";

import { googleMapsUrl } from "../../../lib/format";
import { ExternalLinkIcon, MapPinIcon } from "../../components/icons";
import { trackArea } from "../lib/areaEvents";
import { areaName } from "../lib/evidence";
import type { ShortlistItem } from "../lib/types";

export function AreaMapLink({
  item,
  sessionId,
}: {
  item: ShortlistItem;
  sessionId: string | null;
}) {
  return (
    <a
      href={googleMapsUrl(item.lat, item.lon)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`View ${areaName(item)} on Google Maps (opens in a new tab)`}
      onClick={() => trackArea("map_click", sessionId, item.localityId)}
      className="group/maps inline-flex min-h-11 shrink-0 items-center gap-1.5 px-0.5 text-[11px] font-semibold tracking-[0.1em] text-ink-muted uppercase underline decoration-line-strong underline-offset-4 transition-colors hover:text-vermilion-deep hover:decoration-vermilion-deep motion-reduce:transition-none"
    >
      <MapPinIcon className="size-3.5" />
      <span>Google Maps</span>
      <ExternalLinkIcon className="size-3 transition-transform group-hover/maps:-translate-y-0.5 group-hover/maps:translate-x-0.5 motion-reduce:transform-none motion-reduce:transition-none" />
    </a>
  );
}
