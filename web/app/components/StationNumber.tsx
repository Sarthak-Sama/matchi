/**
 * A station-number roundel in the Matchi line's colours: green frame, white
 * face, the line code over the stop number — used wherever a rank or step
 * is really "stop N on your line".
 */
export function StationNumber({
  code,
  line = "MC",
  size = "md",
  active = false,
}: {
  readonly code: string;
  readonly line?: string | null;
  readonly size?: "sm" | "md" | "lg";
  /** The current stop: framed in signal red instead of line green. */
  readonly active?: boolean;
}) {
  const frame = {
    sm: "size-8 rounded-[6px] border-[3px]",
    md: "size-10 rounded-[8px] border-4",
    lg: "size-12 rounded-[10px] border-[5px]",
  }[size];
  const number = { sm: "text-[12px]", md: "text-[14px]", lg: "text-[17px]" }[size];

  return (
    <span
      aria-hidden="true"
      className={`grid shrink-0 place-items-center bg-paper-soft leading-none transition-colors duration-200 motion-reduce:transition-none ${frame} ${
        active ? "border-vermilion" : "border-moss"
      }`}
    >
      <span className="text-center">
        {line && size !== "sm" && (
          <span className="block text-[8px] font-bold tracking-wider">{line}</span>
        )}
        <span className={`block font-display font-bold tnum ${number}`}>{code}</span>
      </span>
    </span>
  );
}
