import type { Metadata } from "next";
import type { ReactNode } from "react";

import { SHARED_PACKAGE_NAME } from "@tokyo/shared";

import "./globals.css";

// Importing from @tokyo/shared here exercises the workspace package's
// `exports` map under Next.js (as opposed to plain Node ESM, which the
// shared/src/index.test.ts smoke test already covers).
export const metadata: Metadata = {
  title: "Tokyo Neighborhood Optimizer",
  description: `Scaffolded with ${SHARED_PACKAGE_NAME}`,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
