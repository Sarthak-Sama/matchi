"use client";
import { useEffect, useState } from "react";
import { AgentHeader } from "./components/AgentHeader";
import { Chat } from "./components/Chat";
import { DetailsSheet } from "./components/DetailsSheet";
import { Shortlist } from "./components/Shortlist";
import { WorkingDrawer } from "./components/WorkingDrawer";
import { Toasts } from "./components/Toasts";
import { btn } from "./components/ui";
import { useAgent } from "./lib/useAgent";
export default function AgentPage() {
 const agent=useAgent(); const [detailsOpen,setDetailsOpen]=useState(false); const [workingOpen,setWorkingOpen]=useState(false);
 useEffect(() => {try{setWorkingOpen(localStorage.getItem("matchi.agent.working")==="true");}catch{}},[]);
 function working(open:boolean){setWorkingOpen(open);try{localStorage.setItem("matchi.agent.working",String(open));}catch{}}
 return <div className="h-dvh overflow-hidden"><AgentHeader busy={agent.busy||agent.streaming} workingOpen={workingOpen} onWorking={() => working(!workingOpen)} onRestart={() => void agent.startSession()}/><main className="mx-auto grid h-[calc(100dvh-3.5rem)] max-w-[1360px] grid-cols-1 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]"><h1 className="sr-only">Matchi guide</h1><section aria-label="Conversation" className="min-h-0 overflow-y-auto overscroll-contain p-5 sm:p-8">{agent.sessionError ? <div role="alert"><h2 className="font-serif text-3xl">I couldn’t reach the guide.</h2><p className="my-4 text-sm text-ink-muted">{agent.sessionError}</p><button className={btn} onClick={() => void agent.startSession()}>Try again</button></div>:<Chat agent={agent}/>}<button className={`${btn} mt-4`} onClick={() => setDetailsOpen(true)}>Edit details</button></section><section aria-label="Your shortlist" className="hidden min-h-0 overflow-y-auto overscroll-contain border-l border-line p-5 sm:p-8 lg:block"><Shortlist agent={agent}/></section></main><DetailsSheet key={agent.sessionId} agent={agent} open={detailsOpen} onClose={() => setDetailsOpen(false)}/><WorkingDrawer agent={agent} open={workingOpen} onClose={() => working(false)}/><Toasts notices={agent.notices} dismissNotice={agent.dismissNotice} local={[]} dismissLocal={() => {}}/></div>;
}
