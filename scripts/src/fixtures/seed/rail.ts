import { PEAK_WAIT_MINUTES, OFFPEAK_WAIT_MINUTES } from "@tokyo/shared";
import type { Confidence } from "@tokyo/shared";

export interface RailLineFixture {
  readonly rail_line_id: string;
  readonly operator: string;
  readonly name_ja: string;
  readonly name_en: string;
  readonly mode: "subway" | "local_rail" | "commuter_rail" | "monorail";
}

export const RAIL_LINES: readonly RailLineFixture[] = [
  {
    rail_line_id: "rl-toyoko",
    operator: "Tokyu",
    name_ja: "東急東横線",
    name_en: "Tokyu Toyoko Line",
    mode: "local_rail",
  },
  {
    rail_line_id: "rl-yamanote",
    operator: "JR East",
    name_ja: "JR山手線",
    name_en: "JR Yamanote Line",
    mode: "commuter_rail",
  },
  {
    rail_line_id: "rl-keio",
    operator: "Keio",
    name_ja: "京王線",
    name_en: "Keio Line",
    mode: "local_rail",
  },
  {
    rail_line_id: "rl-inokashira",
    operator: "Keio",
    name_ja: "京王井の頭線",
    name_en: "Keio Inokashira Line",
    mode: "local_rail",
  },
  {
    rail_line_id: "rl-denentoshi",
    operator: "Tokyu",
    name_ja: "東急田園都市線",
    name_en: "Tokyu Den-en-toshi Line",
    mode: "commuter_rail",
  },
  {
    rail_line_id: "rl-chuo",
    operator: "JR East",
    name_ja: "JR中央線",
    name_en: "JR Chuo Line",
    mode: "commuter_rail",
  },
  {
    rail_line_id: "rl-fukutoshin",
    operator: "Tokyo Metro",
    name_ja: "東京メトロ副都心線",
    name_en: "Tokyo Metro Fukutoshin Line",
    mode: "subway",
  },
];

interface RideSegment {
  readonly rail_line_id: string;
  readonly from: string;
  readonly to: string;
  readonly offpeak: number;
  readonly peak: number;
  readonly confidence: Confidence;
}

const RIDES: readonly RideSegment[] = [
  {
    rail_line_id: "rl-toyoko",
    from: "sg-shibuya",
    to: "sg-daikanyama",
    offpeak: 2,
    peak: 3,
    confidence: "high",
  },
  {
    rail_line_id: "rl-toyoko",
    from: "sg-daikanyama",
    to: "sg-nakameguro",
    offpeak: 2,
    peak: 2,
    confidence: "high",
  },
  {
    rail_line_id: "rl-toyoko",
    from: "sg-nakameguro",
    to: "sg-yutenji",
    offpeak: 2,
    peak: 2,
    confidence: "high",
  },
  {
    rail_line_id: "rl-toyoko",
    from: "sg-yutenji",
    to: "sg-gakugeidaigaku",
    offpeak: 2,
    peak: 3,
    confidence: "high",
  },
  {
    rail_line_id: "rl-toyoko",
    from: "sg-gakugeidaigaku",
    to: "sg-toritsudaigaku",
    offpeak: 2,
    peak: 2,
    confidence: "high",
  },
  {
    rail_line_id: "rl-toyoko",
    from: "sg-toritsudaigaku",
    to: "sg-jiyugaoka",
    offpeak: 3,
    peak: 4,
    confidence: "high",
  },

  {
    rail_line_id: "rl-yamanote",
    from: "sg-shinjuku",
    to: "sg-yoyogi",
    offpeak: 2,
    peak: 3,
    confidence: "high",
  },
  {
    rail_line_id: "rl-yamanote",
    from: "sg-yoyogi",
    to: "sg-shibuya",
    offpeak: 3,
    peak: 4,
    confidence: "high",
  },
  {
    rail_line_id: "rl-yamanote",
    from: "sg-shibuya",
    to: "sg-ebisu",
    offpeak: 3,
    peak: 3,
    confidence: "high",
  },
  {
    rail_line_id: "rl-yamanote",
    from: "sg-ebisu",
    to: "sg-meguro",
    offpeak: 3,
    peak: 4,
    confidence: "high",
  },

  {
    rail_line_id: "rl-keio",
    from: "sg-shinjuku",
    to: "sg-hatsudai",
    offpeak: 3,
    peak: 4,
    confidence: "high",
  },
  {
    rail_line_id: "rl-keio",
    from: "sg-hatsudai",
    to: "sg-hatagaya",
    offpeak: 2,
    peak: 2,
    confidence: "high",
  },
  {
    rail_line_id: "rl-keio",
    from: "sg-hatagaya",
    to: "sg-sasazuka",
    offpeak: 2,
    peak: 3,
    confidence: "high",
  },

  {
    rail_line_id: "rl-inokashira",
    from: "sg-shibuya",
    to: "sg-shimokitazawa",
    offpeak: 6,
    peak: 7,
    confidence: "low",
  },

  {
    rail_line_id: "rl-denentoshi",
    from: "sg-shibuya",
    to: "sg-sangenjaya",
    offpeak: 5,
    peak: 6,
    confidence: "medium",
  },
  {
    rail_line_id: "rl-denentoshi",
    from: "sg-sangenjaya",
    to: "sg-komazawadaigaku",
    offpeak: 2,
    peak: 2,
    confidence: "high",
  },
  {
    rail_line_id: "rl-denentoshi",
    from: "sg-komazawadaigaku",
    to: "sg-sakurashinmachi",
    offpeak: 2,
    peak: 3,
    confidence: "high",
  },
  {
    rail_line_id: "rl-denentoshi",
    from: "sg-sakurashinmachi",
    to: "sg-yoga",
    offpeak: 2,
    peak: 2,
    confidence: "high",
  },

  {
    rail_line_id: "rl-chuo",
    from: "sg-shinjuku",
    to: "sg-nakano",
    offpeak: 4,
    peak: 5,
    confidence: "medium",
  },

  {
    rail_line_id: "rl-fukutoshin",
    from: "sg-shibuya",
    to: "sg-shinjuku",
    offpeak: 7,
    peak: 9,
    confidence: "low",
  },
];

export interface RailEdgeFixture {
  readonly from_station_group_id: string;
  readonly to_station_group_id: string;
  readonly rail_line_id: string | null;
  readonly edge_type: "ride" | "transfer";
  readonly peak_travel_minutes: number;
  readonly offpeak_travel_minutes: number;
  readonly peak_wait_minutes: number;
  readonly offpeak_wait_minutes: number;
  readonly confidence: Confidence;
}

const rideEdges: RailEdgeFixture[] = RIDES.flatMap((seg): RailEdgeFixture[] => [
  {
    from_station_group_id: seg.from,
    to_station_group_id: seg.to,
    rail_line_id: seg.rail_line_id,
    edge_type: "ride",
    peak_travel_minutes: seg.peak,
    offpeak_travel_minutes: seg.offpeak,
    peak_wait_minutes: PEAK_WAIT_MINUTES,
    offpeak_wait_minutes: OFFPEAK_WAIT_MINUTES,
    confidence: seg.confidence,
  },
  {
    from_station_group_id: seg.to,
    to_station_group_id: seg.from,
    rail_line_id: seg.rail_line_id,
    edge_type: "ride",
    peak_travel_minutes: seg.peak,
    offpeak_travel_minutes: seg.offpeak,
    peak_wait_minutes: PEAK_WAIT_MINUTES,
    offpeak_wait_minutes: OFFPEAK_WAIT_MINUTES,
    confidence: seg.confidence,
  },
]);

const TRANSFER_HUBS = ["sg-shibuya", "sg-shinjuku", "sg-meguro", "sg-nakameguro"] as const;

const transferEdges: RailEdgeFixture[] = TRANSFER_HUBS.map((hub) => ({
  from_station_group_id: hub,
  to_station_group_id: hub,
  rail_line_id: null,
  edge_type: "transfer",
  peak_travel_minutes: 0,
  offpeak_travel_minutes: 0,
  peak_wait_minutes: 0,
  offpeak_wait_minutes: 0,
  confidence: "high",
}));

export const RAIL_EDGES: readonly RailEdgeFixture[] = [...rideEdges, ...transferEdges];
