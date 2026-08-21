import type { Metadata } from "next";
import type { ReactNode } from "react";

import { LAYOUT_IDS } from "@tokyo/shared";

import "./globals.css";

// Importing from @tokyo/shared here exercises the workspace package's
// `exports` map under Next.js (as opposed to plain Node ESM, which the
// shared/src/*.test.ts suite already covers).
export const metadata: Metadata = {
  title: "Tokyo Neighborhood Optimizer",
  description: `Supports ${LAYOUT_IDS.length} apartment layouts`,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
