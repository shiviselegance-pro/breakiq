import React, { useState } from "react";
import { Play, Square, Clock, Loader2, X, Coffee, UtensilsCrossed, ShieldAlert } from "lucide-react";
import { formatClock } from "../utils/timeHelpers";

export default function BreakRequestPanel({ 
  windowStatus, budget, activeBreak, readyToGo, busy,
  requestBreakNow, requestBreakLater, goingForBreak, endBreak, cancelScheduledBreak 
}) {
  const [category, setCategory] = useState("SHORT");
  const [minutesNow, setMinutesNow] = useState(15);
  const [schedTime, setSchedTime] = useState("");

  const isOutage = windowStatus?.reason === "EMERGENCY_LOCKOUT";

  if (isOutage && !activeBreak) {
    return (
      <div className="overflow-hidden rounded-3xl border border-rose-500/60 bg-rose-950/20 p-7 shadow-xl backdrop-blur-md text-center space-y-3 font-sans">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-500/20 border border-rose-500/30 text-rose-400 animate-bounce">
          <ShieldAlert className="h-6 w-6" />
        </div>
        <h3 className="text-base font-black uppercase tracking-wider text-rose-400 font-mono">
          Breaks frozen due to outage
        </h3>
        <p className="text-xs max-w-sm mx-auto text-rose-200/80 leading-relaxed font-medium">
          Command Tower has placed an emergency hold on all floor departures:
        </p>
        <div className="inline-block bg-rose-950/90 border border-rose-800/60 rounded-xl px-4 py-2.5">
          <p className="text-xs font-mono font-bold text-white">
            "{windowStatus?.message || "Critical Service Desk Outage Active"}"
          </p>
        </div>
      </div>
    );
  }

  if (windowStatus?.locked && !activeBreak) {
    return (
      <div className="overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-900/40 p-7 shadow-lg text-center space-y-3 font-sans">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-800 text-zinc-500">
          <Clock className="h-6 w-6" />
        </div>
        <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-300 font-mono">
          Break Window Closed
        </h3>
        <p className="text-xs max-w-sm mx-auto leading-relaxed text-zinc-400">
          {windowStatus.reason === "TOO_EARLY" && windowStatus.unlocksAtMillis ? (
            <>Breaks are restricted for the first hour of shift. Window opens at <span className="font-mono font-bold text-indigo-400">{formatClock(windowStatus.unlocksAtMillis)}</span>.</>
          ) : (
            "Standard policy restricts taking break requests during the final hour of your shift."
          )}
        </p>
      </div>
    );
  }

  if (activeBreak) {
    const isScheduled = activeBreak.status === "APPROVED_SCHEDULED";
    const isQueued = activeBreak.status === "AWAITING_SLOT";
    return (
      <div className="overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-900/40 p-7 shadow-xl space-y-4 font-sans text-center">
        <h3 className="text-xs font-mono font-bold uppercase tracking-widest text-zinc-400">Active Break Controls</h3>
        
        {/* CRITICAL FIX: Wrapped inside () => goingForBreak() to kill DOM events */}
        {isScheduled && (
          <button
            onClick={() => goingForBreak()} disabled={busy || !readyToGo}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 py-3.5 text-xs font-bold uppercase tracking-wider text-white shadow-lg transition-all disabled:opacity-40 cursor-pointer"
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} className="fill-white" />}
            <span>{busy ? "Processing..." : readyToGo ? "Start Break Now" : "Not Time Yet"}</span>
          </button>
        )}

        {activeBreak.status === "ON_BREAK" && (
          <button
            onClick={() => endBreak()} disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-600 hover:bg-amber-500 py-3.5 text-xs font-bold uppercase tracking-wider text-white shadow-lg transition-all disabled:opacity-50 cursor-pointer"
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Square size={15} className="fill-white" />}
            <span>{busy ? "Ending Break..." : "End Break & Resume Work"}</span>
          </button>
        )}

        {(isScheduled || isQueued) && (
          <button
            onClick={() => cancelScheduledBreak()} disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950 py-3 text-xs font-medium uppercase tracking-wider text-zinc-400 hover:border-rose-500/40 hover:text-rose-300 transition-all cursor-pointer"
          >
            <X size={14} /> <span>Cancel Request</span>
          </button>
        )}
      </div>
    );
  }

  const mealAvail = budget?.mealRemaining > 0;
  const shortAvail = budget?.shortRemaining > 0;

  const handleDispatchNow = () => {
    if (category === "MEAL" && !mealAvail) return alert("Meal break already completed.");
    if (category === "SHORT" && !shortAvail) return alert("Short break limit reached.");
    requestBreakNow({ category, minutesNow: category === "SHORT" ? Number(minutesNow) : 40 });
  };

  const handleDispatchLater = (e) => {
    e.preventDefault();
    if (!schedTime) return alert("Please select a time.");
    const [h, m] = schedTime.split(":").map(Number);
    const d = new Date(); d.setHours(h, m, 0, 0);
    requestBreakLater({ category, minutesNow: category === "SHORT" ? Number(minutesNow) : 40, scheduledFor: d.getTime() });
  };

  return (
    <div className="overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-900/40 p-7 shadow-xl space-y-5 font-sans">
      <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
        <span className="text-xs font-bold uppercase tracking-wider text-white flex items-center gap-2 font-mono"><Clock size={14} className="text-indigo-400"/> Request a Break</span>
        <span className="text-[10px] text-zinc-500 uppercase font-mono font-medium">Queue System</span>
      </div>

      <div className="grid grid-cols-2 gap-3 font-mono">
        <button
          type="button" onClick={() => setCategory("SHORT")}
          className={`flex items-center justify-center gap-2 rounded-xl border py-3 text-xs font-bold uppercase transition-all cursor-pointer ${category === "SHORT" ? "bg-indigo-600 text-white border-indigo-500 shadow-sm" : "bg-zinc-950 text-zinc-500 border-zinc-800"}`}
        >
          <Coffee size={14} /> Short Break
        </button>
        <button
          type="button" onClick={() => setCategory("MEAL")}
          className={`flex items-center justify-center gap-2 rounded-xl border py-3 text-xs font-bold uppercase transition-all cursor-pointer ${category === "MEAL" ? "bg-indigo-600 text-white border-indigo-500 shadow-sm" : "bg-zinc-950 text-zinc-500 border-zinc-800"}`}
        >
          <UtensilsCrossed size={14} /> Meal Break
        </button>
      </div>

      {category === "SHORT" && (
        <div className="space-y-1.5 font-sans">
          <div className="flex justify-between text-[11px] text-zinc-400 font-mono"><span>Duration (Mins)</span><strong className="text-indigo-400 font-bold">{minutesNow}m</strong></div>
          <input
            type="range" min="5" max={Math.max(5, budget?.shortRemaining ?? 15)} step="5" value={minutesNow} onChange={(e) => setMinutesNow(Number(e.target.value))}
            className="w-full accent-indigo-500 bg-zinc-950 rounded-lg cursor-pointer"
          />
        </div>
      )}

      <button
        type="button" disabled={busy || (category === "MEAL" ? !mealAvail : !shortAvail)} onClick={handleDispatchNow}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 py-3.5 text-xs font-bold uppercase tracking-wider text-white shadow-md transition-all disabled:opacity-40 cursor-pointer"
      >
        {busy ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} className="fill-white" />}
        <span>{busy ? "Processing..." : `Start ${category} Break Now`}</span>
      </button>

      <form onSubmit={handleDispatchLater} className="pt-4 border-t border-zinc-800 space-y-3">
        <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 block font-mono">Schedule for Later</span>
        <div className="flex gap-2.5">
          <input
            type="time" required value={schedTime} onChange={(e) => setSchedTime(e.target.value)}
            className="flex-1 rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-xs font-bold text-zinc-200 focus:outline-none focus:border-indigo-500 font-mono"
          />
          <button
            type="submit" disabled={busy || (category === "MEAL" ? !mealAvail : !shortAvail)}
            className="rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 px-4 py-2.5 text-xs font-bold uppercase transition-all cursor-pointer disabled:opacity-40 font-mono"
          >
            Schedule
          </button>
        </div>
      </form>
    </div>
  );
}