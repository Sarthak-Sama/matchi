"use client";

const HOURS = Array.from({ length: 12 }, (_, index) => index + 1);
const MINUTES = Array.from({ length: 12 }, (_, index) => index * 5);

function from24Hour(value: string): { hour: number; minute: number; period: "AM" | "PM" } {
  const [hourPart = "8", minutePart = "30"] = value.split(":");
  const hour24 = Number(hourPart);
  const minute = Number(minutePart);
  const period = hour24 >= 12 ? "PM" : "AM";
  const hour = hour24 % 12 || 12;

  return { hour, minute: Number.isFinite(minute) ? minute : 30, period };
}

function to24Hour(hour: number, minute: number, period: "AM" | "PM"): string {
  const hour24 = (hour % 12) + (period === "PM" ? 12 : 0);
  return `${String(hour24).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function TimePicker({
  id,
  value,
  onChange,
}: {
  readonly id: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  const { hour, minute, period } = from24Hour(value);
  const update = (next: Partial<{ hour: number; minute: number; period: "AM" | "PM" }>) => {
    onChange(to24Hour(next.hour ?? hour, next.minute ?? minute, next.period ?? period));
  };

  return (
    <div
      id={id}
      role="group"
      aria-labelledby={`${id}-label`}
      className="field-control mt-2 flex min-h-12 items-center gap-1 px-2 py-1.5 sm:gap-2"
    >
      <label className="sr-only" htmlFor={`${id}-hour`}>
        Hour
      </label>
      <select
        id={`${id}-hour`}
        value={hour}
        onChange={(event) => update({ hour: Number(event.target.value) })}
        className="time-picker-select"
      >
        {HOURS.map((option) => (
          <option key={option} value={option}>
            {String(option).padStart(2, "0")}
          </option>
        ))}
      </select>
      <span aria-hidden="true" className="text-ink-muted">:</span>
      <label className="sr-only" htmlFor={`${id}-minute`}>
        Minute
      </label>
      <select
        id={`${id}-minute`}
        value={minute}
        onChange={(event) => update({ minute: Number(event.target.value) })}
        className="time-picker-select"
      >
        {MINUTES.map((option) => (
          <option key={option} value={option}>
            {String(option).padStart(2, "0")}
          </option>
        ))}
      </select>
      <div className="ml-auto inline-flex self-stretch overflow-hidden border border-line-strong" aria-label="AM or PM">
        {(["AM", "PM"] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={period === option}
            onClick={() => update({ period: option })}
            className={`min-w-11 px-2 text-[11px] font-semibold tracking-[0.12em] transition-colors ${
              period === option
                ? "bg-moss text-white"
                : "bg-paper-soft text-ink-muted hover:bg-sage"
            }`}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}
