"use client";

import { useEffect, useState } from "react";

import { getJson } from "../../../lib/api";
import { googleMapsUrl } from "../../../lib/format";
import { ExternalLinkIcon, MapPinIcon } from "../../components/icons";
import { areaName } from "../lib/evidence";
import type { ShortlistItem } from "../lib/types";
import { linkBtn } from "./ui";

interface LocalityLocation {
  lat: number;
  lon: number;
}

/** The guide returns locality ids; resolve their actual coordinates rather than searching an ambiguous name. */
export function AreaMapLink({ item }: { item: ShortlistItem }) {
  const [location, setLocation] = useState<LocalityLocation | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setLocation(null);
    setFailed(false);
    getJson<LocalityLocation>(`/v1/localities/${encodeURIComponent(item.localityId)}`)
      .then((place) => {
        if (!Number.isFinite(place.lat) || !Number.isFinite(place.lon)) {
          throw new Error("Location unavailable");
        }
        if (active) setLocation({ lat: place.lat, lon: place.lon });
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [item.localityId, attempt]);

  if (failed) {
    return (
      <button className={`${linkBtn} min-h-11`} onClick={() => setAttempt((n) => n + 1)}>
        Retry map link
      </button>
    );
  }
  if (!location) {
    return (
      <span
        role="status"
        className="inline-flex min-h-11 items-center gap-1.5 text-[11px] text-ink-muted"
      >
        <MapPinIcon className="size-3.5" />
        Loading map…
      </span>
    );
  }
  // Share the /find link's URL builder and icon treatment without coupling the guide to its scoring response.
  return (
    <a
      href={googleMapsUrl(location.lat, location.lon)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`View ${areaName(item)} on Google Maps (opens in a new tab)`}
      className="group/maps inline-flex min-h-11 shrink-0 items-center gap-1.5 px-0.5 text-[11px] font-semibold tracking-[0.1em] text-ink-muted uppercase underline decoration-line-strong underline-offset-4 transition-colors hover:text-vermilion-deep hover:decoration-vermilion-deep motion-reduce:transition-none"
    >
      <MapPinIcon className="size-3.5" />
      <span>Google Maps</span>
      <ExternalLinkIcon className="size-3 transition-transform group-hover/maps:-translate-y-0.5 group-hover/maps:translate-x-0.5 motion-reduce:transform-none motion-reduce:transition-none" />
    </a>
  );
}
