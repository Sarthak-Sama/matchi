"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-6 py-16">
      <div className="border-t-2 border-ink pt-5">
        <p className="label-utility text-vermilion-deep">Something broke</p>
        <h1 className="mt-2 font-serif text-3xl leading-tight font-medium tracking-editorial text-balance sm:text-4xl">
          This page didn’t load
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-ink-muted">
          The error has been logged. Trying again often clears it — the API may simply have been
          unreachable for a moment.
        </p>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="min-h-12 border border-ink bg-ink px-5 py-3 text-[15px] text-paper transition-colors hover:bg-ink-muted"
        >
          Try again
        </button>
        <a
          href="/"
          className="min-h-12 border border-line-strong px-5 py-3 text-[15px] transition-colors hover:border-ink"
        >
          Back to the start
        </a>
      </div>

      {error.digest ? (
        <p className="mt-6 border-t border-line pt-3 font-mono text-[12px] text-stone">
          Reference: {error.digest}
        </p>
      ) : null}
    </main>
  );
}
