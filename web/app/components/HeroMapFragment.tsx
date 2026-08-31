import { PLATE_STATIONS, WARD_PLATE_VIEWBOX, WARD_SHAPES } from "./tokyo-wards";

export function HeroMapFragment() {
  const { width, height } = WARD_PLATE_VIEWBOX;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      focusable="false"
      className="h-full w-full"
      preserveAspectRatio="xMidYMid meet"
    >
      <rect width={width} height={height} className="fill-sage" />

      <g className="fill-paper-soft stroke-line-strong" strokeWidth="1.1">
        {WARD_SHAPES.map((ward) => (
          <path key={ward.code} d={ward.d} fillRule="evenodd" />
        ))}
      </g>

      <g>
        {PLATE_STATIONS.map((station) => (
          <g key={station.nameJa}>
            <circle cx={station.x} cy={station.y} r="3.6" className="fill-vermilion" />
            <text
              x={station.x + 8}
              y={station.y + 1}
              className="fill-ink font-sans"
              fontSize="12.5"
              fontWeight="500"
            >
              {station.romanized}
            </text>
            <text
              x={station.x + 8}
              y={station.y + 14}
              className="fill-ink-muted font-serif"
              fontSize="11.5"
            >
              {station.nameJa}
            </text>
          </g>
        ))}
      </g>
    </svg>
  );
}
