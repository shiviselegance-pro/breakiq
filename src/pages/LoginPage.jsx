import React, { useState } from "react";
import { ShieldCheck, Loader2 } from "lucide-react";
import { useAuth } from "../context/AuthContext";

export default function LoginPage() {
  const { login } = useAuth();
  const [employeeId, setEmployeeId] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErr(null); setBusy(true);
    try {
      await login(employeeId, password);
    } catch (error) {
      setErr("Cryptographic handshake rejected. Check credentials.");
    } finally { setBusy(false); }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#020617] px-4 font-sans selection:bg-indigo-500 selection:text-white">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(120,119,198,0.15),rgba(255,255,255,0))] pointer-events-none" />
      
      <form onSubmit={handleSubmit} className="relative w-full max-w-sm rounded-3xl border border-slate-800/80 bg-slate-900/60 p-8 shadow-2xl backdrop-blur-xl space-y-5">
        <div className="flex items-center gap-3.5 border-b border-slate-800/80 pb-5">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 shadow-inner">
            <ShieldCheck size={26} />
          </div>
          <div>
            <h1 className="text-lg font-extrabold tracking-tight text-white font-sans">Shift Headquarters</h1>
            <p className="font-mono text-xs text-slate-400">Zero-Trust Authentication Gate</p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-[11px] font-mono font-semibold uppercase tracking-wider text-slate-400 mb-1.5">Principal ID</label>
            <input
              type="text" required value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} placeholder="AGT-0001"
              className="w-full rounded-2xl border border-slate-800 bg-slate-950/80 px-4 py-3.5 font-mono text-sm font-bold text-indigo-300 focus:outline-none focus:border-indigo-500"
            />
          </div>
          <div>
            <label className="block text-[11px] font-mono font-semibold uppercase tracking-wider text-slate-400 mb-1.5">Secret Passphrase</label>
            <input
              type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••••••"
              className="w-full rounded-2xl border border-slate-800 bg-slate-950/80 px-4 py-3.5 font-mono text-sm font-bold text-slate-100 focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>

        {err && <div className="rounded-2xl border border-rose-800/50 bg-rose-950/40 p-3 text-center"><p className="font-mono text-xs font-bold text-rose-300">{err}</p></div>}

        <button
          type="submit" disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-indigo-600 to-violet-600 py-4 font-mono text-xs font-extrabold uppercase tracking-wider text-white shadow-xl shadow-indigo-500/10 hover:from-indigo-500 hover:to-violet-500 active:scale-[0.99] disabled:opacity-40 transition-all cursor-pointer"
        >
          {busy && <Loader2 size={16} className="animate-spin" />}
          <span>{busy ? "Verifying Claims..." : "Authorize Handshake"}</span>
        </button>
      </form>
    </div>
  );
}