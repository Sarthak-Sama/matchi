"use client";
import type { AgentController } from "../lib/useAgent";
import { ProfileForm } from "./ProfileForm";
import { Sheet } from "./Sheet";
export function DetailsSheet({ agent, open, onClose }: { agent: AgentController; open: boolean; onClose: () => void }) {
  return <Sheet open={open} onClose={onClose} title="Your details"><p className="mb-5 text-sm text-ink-muted">The guide fills these in from the chat. Change anything here.</p><ProfileForm agent={agent}/></Sheet>;
}
