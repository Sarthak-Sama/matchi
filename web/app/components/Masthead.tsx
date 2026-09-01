import Link from "next/link";
import Image from "next/image";

export function Masthead({ variant = "search" }: { readonly variant?: "search" | "landing" }) {
  const isLanding = variant === "landing";

  return (
    <header
      className={`z-40 border-b border-line bg-paper ${isLanding ? "relative" : "sticky top-0"}`}
    >
      <div className="mx-auto flex h-14 max-w-[1360px] items-center justify-between px-5 sm:px-8">
        <Link href="/" aria-label="Matchi home" className="flex items-center gap-2.5">
          <Image
            src="/matchi-logo.png"
            alt=""
            width={32}
            height={32}
            priority
            className="size-8 shrink-0"
          />
          <span className="font-serif text-lg leading-none font-semibold tracking-editorial">
            Matchi
          </span>
          <span lang="ja" className="font-serif text-sm leading-none text-vermilion-deep">
            街
          </span>
        </Link>

        <nav aria-label="Main" className="flex items-center gap-6">
          {isLanding ? (
            <>
              <a
                href="#method"
                className="label-utility hidden text-ink-muted transition-colors hover:text-ink sm:inline-block"
              >
                How it works
              </a>
              <Link
                href="/find"
                className="label-utility bg-moss px-3.5 py-2.5 text-white transition-colors hover:bg-moss-deep"
              >
                Find my Matchi
              </Link>
            </>
          ) : (
            <>
              <a
                href="#methodology"
                className="label-utility hidden text-ink-muted transition-colors hover:text-ink sm:inline-block"
              >
                How it works
              </a>
              <a
                href="#search"
                className="label-utility border border-line-strong px-3 py-2 text-ink transition-colors hover:border-ink"
              >
                New search
              </a>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
