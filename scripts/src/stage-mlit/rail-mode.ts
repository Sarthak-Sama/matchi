export type RailMode = "subway" | "local_rail" | "commuter_rail" | "monorail";

const CLASS_JR_ORDINARY = "11";
const CLASS_ORDINARY = "12";
const MONORAIL_CLASSES = new Set(["14", "15", "22", "23"]);

const LOCAL_RAIL_CLASSES = new Set(["13", "16", "21", "24", "25"]);

const OPERATOR_TYPE_MUNICIPAL = "3";

const TOKYO_METRO = "東京地下鉄";

export interface RailModeInput {
  readonly railwayClass: string | null;

  readonly operatorType: string | null;

  readonly operator: string | null;
}

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
