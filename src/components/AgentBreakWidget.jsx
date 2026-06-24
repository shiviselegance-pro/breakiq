import React from "react";
import { Coffee, UtensilsCrossed, Clock, AlertTriangle } from "lucide-react";
import StatusPill from "./StatusPill";
import { formatCountdown, formatClock, toMillis } from "../utils/timeHelpers";

export default function AgentBreakWidget({ profile, activeBreak, budget, countdown }) {
  const status = profile?.status || "OFFLINE";
  const initials = profile?.name ? profile.name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2) : "?";

  return (
    <div className="overflow-hidden rounded-3xl border border-slate-800/80 bg-slate-900/40 shadow-2xl backdrop-blur-xl font-sans">
      
      {/* Identity Banner */}
      <div className="flex items-center justify-between border-b border-slate-800/80 px-6 py-4 bg-slate-950/60">
        <div className="flex items-center gap-3.5">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500/20 to-violet-500/20 border border-indigo-500/30 font-mono text-sm font-bold text-indigo-300 shadow-inner">
            {initials}
          </div>
          <div>
            <p className="font-extrabold text-slate-100 text-sm tracking-tight">{profile?.name || "—"}</p>
            <p className="font-mono text-xs text-indigo-400 font-medium mt-0.5">{profile?.employeeId || "—"}</p>
          </div>
        </div>
        <StatusPill status={status} />
      </div>

      {/* Entitlement Quota Cells */}
      <div className="grid grid-cols-2 divide-x divide-slate-800/80 bg-slate-950/30">
        <BudgetCell icon={UtensilsCrossed} label="Meal Entitlement" remaining={budget?.mealRemaining ?? 0} total={budget?.mealTotal ?? 40} color="indigo" />
        <BudgetCell icon={Coffee} label="Short Break Bank" remaining={budget?.shortRemaining ?? 0} total={budget?.shortTotal ?? 20} color="violet" />
      </div>

      {/* Live Countdown Arena */}
      {activeBreak?.status === "ON_BREAK" && countdown && (
        <div className={`border-t transition-all ${countdown.overrun ? "border-rose-800/60 bg-rose-950/30 animate-pulse" : "border-emerald-800/40 bg-emerald-950/20"} p-6`}>
          <div className="mb-1 flex items-center justify-center gap-2 text-xs uppercase font-mono tracking-widest text-slate-400">
            <Clock size={14} className={countdown.overrun ? "text-rose-400" : "text-emerald-400"} />
            <span>{countdown.overrun ? "SLA Overrun Active" : "Authorized Horizon"}</span>
          </div>
          <div className={`text-center font-mono text-5xl font-extrabold tabular-nums tracking-tight my-2 ${countdown.overrun ? "text-rose-400 animate-bounce" : "text-white"}`}>
            {countdown.overrun ? "+" : ""}{formatCountdown(countdown.remainingMs)}
          </div>
          <p className="text-center text-xs font-mono text-slate-400">
            {activeBreak.breakCategory === "MEAL" ? "Meal Break Slot" : "Short Break Bank"} · <strong className="text-slate-200">{activeBreak.requestedDurationMin}m</strong> Allocated
          </p>
          {countdown.overrun && (
            <div className="mt-4 flex items-center justify-center gap-2 rounded-2xl bg-rose-500/20 border border-rose-500/40 p-3 shadow-lg shadow-rose-500/10">
              <AlertTriangle size={15} className="text-rose-400" />
              <p className="text-xs font-mono font-bold text-rose-300">Shift Command Alert Triggered</p>
            </div>
          )}
        </div>
      )}

      {activeBreak?.status === "AWAITING_SLOT" && (
        <div className="border-t border-amber-800/40 bg-amber-950/20 p-6 text-center font-sans space-y-2">
          <div className="flex items-center justify-center gap-2 text-xs uppercase font-mono font-bold tracking-widest text-amber-400">
            <Clock size={14} className="animate-spin" /> Queued in FIFO Pipeline
          </div>
          <p className="text-xs text-amber-200/90 font-mono">
            {activeBreak.suggestedTime ? (
              <>Estimated floor slot: <strong className="text-white font-bold text-sm bg-amber-950 px-2.5 py-1 rounded-xl border border-amber-800">{formatClock(toMillis(activeBreak.suggestedTime))}</strong></>
            ) : "Calculating optimal non-colliding start slot..."}
          </p>
          <p className="text-[11px] text-slate-500">Autonomous spawn upon slot availability</p>
        </div>
      )}

      {activeBreak?.status === "APPROVED_SCHEDULED" && (
        <div className="border-t border-indigo-800/40 bg-indigo-950/20 p-6 text-center space-y-1.5">
          <div className="flex items-center justify-center gap-2 text-xs uppercase font-mono font-bold tracking-widest text-indigo-400">
            <Clock size={14} /> Scheduled Dispatch Locked
          </div>
          <div className="font-mono text-3xl font-extrabold text-white">
            {formatClock(toMillis(activeBreak.scheduledFor))}
          </div>
          <p className="text-xs font-mono text-indigo-300/80">
            {activeBreak.breakCategory} · {activeBreak.requestedDurationMin}m Span
          </p>
        </div>
      )}

    </div>
  );
}

function BudgetCell({ icon: Icon, label, remaining, total, color }) {
  const used = total - remaining;
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  const depleted = remaining <= 0;

  return (
    <div className="flex flex-col gap-2.5 p-5 font-sans">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs text-slate-400 font-mono font-medium"><Icon size={13} className={color === "indigo" ? "text-indigo-400" : "text-violet-400"} /> {label}</span>
        <span className={`font-mono text-xs font-bold ${depleted ? "text-rose-400 font-extrabold" : "text-slate-200"}`}>{depleted ? "Exhausted" : `${remaining}m Left`}</span>
      </div>
      <div className="h-2 w-full bg-slate-950 rounded-full overflow-hidden p-0.5 border border-slate-800/80">
        <div className={`h-full rounded-full transition-all duration-700 ${depleted ? "bg-rose-500 shadow-lg shadow-rose-500/50" : color === "indigo" ? "bg-indigo-500" : "bg-violet-500"}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-[11px] font-mono text-slate-500">{used}m / {total}m Quota Burned</p>
    </div>
  );
}