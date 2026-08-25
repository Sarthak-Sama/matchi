/**
 * Classifies an MLIT N02 rail section into `rail_lines.mode`
 * (`subway` | `local_rail` | `commuter_rail` | `monorail`).
 *
 * `import-mlit/rail-lines.ts` requires every feature to carry an explicit
 * `mode`, and documents that raw N02 does not supply one — the
 * classification has to happen in a preprocessing pass. This is that pass.
 *
 * **The classification keys off `N02_001` (railway class) first, and only
 * consults the operator name for ordinary railways.** That ordering is
 * load-bearing, not stylistic. 東京都 — the Tokyo Metropolitan Government —
 * operates three different things: the Toei subway (`N02_001=12`), the
 * Toden Arakawa tram (`21`), and the Nippori-Toneri guideway (`24`).
 * Matching "東京都 means subway" on the operator name alone, which is the
 * obvious reading of "map Tokyo Metro/Toei to subway", would label a
 * streetcar and an automated people-mover as subway lines.
 *
 * The class codes below were read off the real 2025 N02 export rather than
 * assumed, by grouping all 21,933 nationwide sections by `N02_001` and
 * inspecting which operators carry each code:
 *
 *   11  JR ordinary railway   6 JR companies                  -> commuter_rail
 *   12  non-JR ordinary rail  129 operators: Tokyo Metro,      -> subway or
 *                             Toei, Tokyu, Keio, Tobu, Kintetsu   commuter_rail
 *   13  funicular             Mt. Oyama, Hieizan               -> local_rail
 *   14  suspended monorail    Shonan Monorail                  -> monorail
 *   15  straddle monorail     Tokyo Monorail, Maihama Resort   -> monorail
 *   16  guideway (AGT)        Saitama New Urban, Kobe New      -> local_rail
 *   21  tramway               Toden, Setagaya, Hiroshima       -> local_rail
 *   22  suspended monorail    Chiba Urban Monorail             -> monorail
 *   23  straddle monorail     Tama, Osaka, Okinawa, Kitakyushu -> monorail
 *   24  guideway (AGT)        Yurikamome, Nippori-Toneri,      -> local_rail
 *                             Yokohama Seaside Line
 *   25  maglev                Linimo                           -> local_rail
 *
 * Note that monorails carry FOUR different codes — MLIT separates
 * suspended (14, 22) from straddle (15, 23) and appears to have assigned
 * both an older and a newer code to each. Mapping only the two that happen
 * to appear inside Tokyo's bounding box would silently drop the Chiba,
 * Tama, Osaka and Okinawa monorails.
 *
 * Within class 12, subway means either a municipally operated ordinary
 * railway (`N02_002=3` — Toei, and Yokohama's municipal subway, which is
 * in the bounding box even though it is outside the 23 wards) or 東京地下鉄,
 * Tokyo Metro, which is a private company (`N02_002=4`) running a subway.
 * Everything else in class 12 — Tokyu, Keio, Tobu, Odakyu, Seibu, Keisei,
 * and the third-sector lines — is a commuter railway.
 *
 * Unknown classes are NOT silently bucketed: `classifyRailMode` returns
 * null so the caller can report them, per the plan's "report any line that
 * cannot be classified".
 */

export type RailMode = "subway" | "local_rail" | "commuter_rail" | "monorail";

/** MLIT N02_001 railway-class codes, as strings (the export stores them as text). */
const CLASS_JR_ORDINARY = "11";
const CLASS_ORDINARY = "12";
const MONORAIL_CLASSES = new Set(["14", "15", "22", "23"]);
/** Funicular, guideway/AGT, tramway and maglev — the plan's "remaining small rail systems". */
const LOCAL_RAIL_CLASSES = new Set(["13", "16", "21", "24", "25"]);

/** N02_002 operator-type code for a municipally operated line (公営). */
const OPERATOR_TYPE_MUNICIPAL = "3";

/** Tokyo Metro: a private operator (N02_002=4) that nonetheless runs a subway. */
const TOKYO_METRO = "東京地下鉄";

export interface RailModeInput {
  /** `N02_001` — railway class. */
  readonly railwayClass: string | null;
  /** `N02_002` — operator type. */
  readonly operatorType: string | null;
  /** `N02_004` — operator name. */
  readonly operator: string | null;
}

/**
 * Returns the `mode` for one N02 rail section, or null when the railway
 * class is one this project has not mapped — the caller reports those
 * rather than bucketing them.
 */
export function classifyRailMode(input: RailModeInput): RailMode | null {
  const { railwayClass, operatorType, operator } = input;
  if (railwayClass === null) return null;

  if (MONORAIL_CLASSES.has(railwayClass)) return "monorail";
  if (LOCAL_RAIL_CLASSES.has(railwayClass)) return "local_rail";
  if (railwayClass === CLASS_JR_ORDINARY) return "commuter_rail";

  if (railwayClass === CLASS_ORDINARY) {
    if (operatorType === OPERATOR_TYPE_MUNICIPAL) return "subway";
    if (operator === TOKYO_METRO) return "subway";
    return "commuter_rail";
  }

  return null;
}
