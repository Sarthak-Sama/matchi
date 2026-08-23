import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "Tokyo Neighborhood Optimizer",
  description:
    "Ranks Tokyo neighborhoods by modeled affordability, commute time, and lifestyle fit for your destination station and budget.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
