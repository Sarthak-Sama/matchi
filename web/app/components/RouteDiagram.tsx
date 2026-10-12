import type { NeighborhoodResult } from "@tokyo/shared";

type Stop = NeighborhoodResult["commute"]["path"][number];

/** Line ids are "<source>-<operator>-<line>"; a diagram only needs the line. */
function lineLabel(lineName: string | null): string | null {
  return lineName?.split("-").at(-1) ?? null;
}

/**
 * The commute path as a rail line diagram: boarding station, each stop, and
 * the destination as the red diamond. A stop where the line changes is drawn
 * as a transfer, and each new line is named where it begins.
 */
export function RouteDiagram({ path }: { readonly path: readonly Stop[] }) {
  return (
    <div className="-mx-1 mt-5 overflow-x-auto px-1 pb-1">
      <ol className="flex min-w-max items-start" aria-label="Route">
        {path.map((stop, index) => {
          const isFirst = index === 0;
          const isLast = index === path.length - 1;
          const previousLine = index > 0 ? path[index - 1]?.lineName : undefined;
          const nextLine = !isLast ? path[index + 1]?.lineName : undefined;
          const isTransfer =
            !isFirst &&
            !isLast &&
            nextLine != null &&
            previousLine != null &&
            nextLine !== stop.lineName;
          const startsLine = !isLast && (isFirst || isTransfer);
          const label = startsLine ? lineLabel(nextLine ?? stop.lineName) : null;

          return (
            <li
              key={`${stop.stationGroupId}-${index}`}
              className="relative flex w-[4.75rem] flex-col items-center"
            >
              <span
                lang="ja"
                className="h-4 self-start pl-[2.4rem] text-[10px] font-semibold whitespace-nowrap text-moss"
              >
                {label}
              </span>
              <span className="relative mt-1 flex h-5 w-full items-center justify-center">
                {!isFirst && (
                  <span
                    aria-hidden="true"
                    className="absolute top-1/2 left-0 h-1.5 w-1/2 -translate-y-1/2 bg-moss"
                  />
                )}
                {!isLast && (
                  <span
                    aria-hidden="true"
                    className="absolute top-1/2 right-0 h-1.5 w-1/2 -translate-y-1/2 bg-moss"
                  />
                )}
                {isLast ? (
                  <span
                    aria-hidden="true"
                    className="relative size-3.5 rotate-45 bg-vermilion ring-[3px] ring-paper"
                  />
                ) : isTransfer ? (
                  <span
                    aria-hidden="true"
                    className="relative h-4 w-6 rounded-full border-[3px] border-ink bg-paper-soft"
                  />
                ) : (
                  <span
                    aria-hidden="true"
                    className={`relative rounded-full border-[3px] border-moss bg-paper-soft ${isFirst ? "size-4" : "size-3"}`}
                  />
                )}
              </span>
              <span
                lang="ja"
                className={`mt-1.5 px-0.5 text-center text-[12px] leading-tight ${isFirst || isLast ? "font-bold" : "font-medium"}`}
              >
                {stop.nameJa}
              </span>
              <span className="mt-0.5 line-clamp-2 px-0.5 text-center text-[9.5px] leading-tight text-ink-muted">
                {stop.nameEn}
              </span>
              <span className="sr-only">
                {isFirst ? "Board" : isLast ? "Arrive" : isTransfer ? "Change lines" : "Stop"}
                {label ? `, ${label}` : ""}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
