import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Frontend Direction Study · Matchi",
  description:
    "Ten distinct product and visual directions explored for the Matchi frontend.",
};

export default function DirectionsLayout({ children }: { children: ReactNode }) {
  return children;
}
