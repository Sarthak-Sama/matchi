import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-6 py-16">
      <div className="border-t-2 border-ink pt-5">
        <p className="label-utility text-vermilion-deep">404</p>
        <h1 className="mt-2 font-serif text-3xl leading-tight font-medium tracking-editorial text-balance sm:text-4xl">
          There’s nothing at this address
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-ink-muted">
          The page may have moved, or the link may have been mistyped.
        </p>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Link
          href="/find"
          className="min-h-12 border border-ink bg-ink px-5 py-3 text-[15px] text-paper transition-colors hover:bg-ink-muted"
        >
          Find a neighborhood
        </Link>
        <Link
          href="/"
          className="min-h-12 border border-line-strong px-5 py-3 text-[15px] transition-colors hover:border-ink"
        >
          Back to the start
        </Link>
      </div>
    </main>
  );
}
