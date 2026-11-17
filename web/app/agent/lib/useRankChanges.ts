"use client";
import { useEffect, useRef, useState } from "react";
import { rankDeltas } from "./derive";
import { areaName } from "./evidence";
import type { ShortlistItem } from "./types";
export function useRankChanges(list: readonly ShortlistItem[]) {
  const previous = useRef<string[]>([]);
  const [deltas, setDeltas] = useState<Record<string, number | "New">>({});
  const [summary, setSummary] = useState("");
  const [newTop, setNewTop] = useState(false);
  const signature = list.map((s) => s.localityId).join("|");
  useEffect(() => {
    const next = signature ? signature.split("|") : [];
    const prev = previous.current;
    previous.current = next;
    if (!prev.length || prev.join("|") === signature) return;
    setDeltas(rankDeltas(prev, next));
    const changedTop = prev[0] !== next[0];
    setNewTop(changedTop);
    setSummary(
      changedTop && list[0]
        ? `Shortlist updated: ${areaName(list[0])} moved to first.`
        : "Shortlist updated. Your preferences are reflected in the order.",
    );
    const badges = setTimeout(() => setDeltas({}), 4000);
    const pill = setTimeout(() => setNewTop(false), 3000);
    return () => {
      clearTimeout(badges);
      clearTimeout(pill);
    };
    // Names are read only when the ordered ids change; new result objects must not reset the badge timer.
  }, [signature]);
  return { deltas, summary, newTop };
}
