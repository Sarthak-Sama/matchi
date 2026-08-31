/**
 * The overall fit score as a circular dial — one of the few genuinely
 * circular concepts in the system. Vermilion arc on a hairline track,
 * tabular numeral, always paired with a "/100" context label nearby so
 * the number never floats without meaning.
 */
export function ScoreRing({
  score,
  size = 64,
  label,
}: {
  readonly score: number;
  readonly size?: number;
  readonly label: string;
}) {
  const rounded = Math.round(score);
  const stroke = size >= 64 ? 3 : 2.5;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.min(Math.max(score, 0), 100) / 100);

  return (
    <span
      role="img"
      aria-label={label}
      className="relative inline-grid shrink-0 place-items-center"
      style={{ width: size, height: size }}
    >
      <svg aria-hidden="true" width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className="stroke-line-strong"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="stroke-vermilion transition-ring"
        />
      </svg>
      <span
        aria-hidden="true"
        className="absolute font-serif text-[1.15em] font-medium tnum"
        style={{ fontSize: size * 0.3 }}
      >
        {rounded}
      </span>
    </span>
  );
}
