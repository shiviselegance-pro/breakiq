import React from "react";

const MAP = {
  OFFLINE: { text: "Disconnected", cls: "bg-slate-800 text-slate-400 border border-slate-700" },
  AVAILABLE: { text: "On Floor", cls: "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-bold" },
  IN_QUEUE: { text: "Queued (FIFO)", cls: "bg-amber-500/15 text-amber-300 border border-amber-500/30" },
  ON_BREAK: { text: "On Break Slot", cls: "bg-amber-400/20 text-amber-300 border border-amber-400/40 animate-pulse font-bold" },
  BREAK_EXCEEDED: { text: "SLA BREACHED", cls: "bg-rose-500/25 text-rose-300 border border-rose-500/50 animate-bounce font-extrabold" },
};

export default function StatusPill({ status }) {
  const s = MAP[status] || MAP.OFFLINE;
  return <span className={`rounded-xl px-3 py-1 text-xs tracking-wider uppercase font-mono ${s.cls}`}>{s.text}</span>;
}