import React, { useState } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "../firebase";
import { Lock, User, ArrowRight, Loader2, Sparkles, ShieldCheck } from "lucide-react";

export default function LoginPage() {
  const [empId, setEmpId] = useState("");
  const [pass, setPass] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!empId || !pass) return;
    
    setLoading(true); 
    setErr(null);
    
    try {
      const email = `${empId.trim().toLowerCase()}@breakapp.internal`;
      await signInWithEmailAndPassword(auth, email, pass);
    } catch (error) {
      setErr(error.message.includes("auth/") ? "Invalid ID or Passphrase" : error.message);
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen flex flex-col justify-between font-sans text-slate-800 selection:bg-indigo-500 selection:text-white">
      <div className="mesh-bg"><span className="mesh-orb" /></div>

      <header className="relative z-10 p-6 max-w-7xl mx-auto w-full flex justify-between items-center animate-rise">
        <div className="flex items-center gap-2.5">
          <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-600 flex items-center justify-center text-white font-black text-sm shadow-lg shadow-indigo-500/30">IQ</div>
          <span className="font-black text-xl tracking-tight text-slate-900">BreakIQ</span>
        </div>
        <div className="glass flex items-center gap-1.5 text-xs font-bold text-emerald-700 px-3.5 py-1.5 rounded-full">
          <ShieldCheck size={14} className="text-emerald-600" />
          <span className="hidden sm:inline"> Break management Gateway</span>
          <span className="sm:hidden">Enterprise Gate</span>
        </div>
      </header>

      <main className="relative z-10 flex-1 flex items-center justify-center p-6">
        <div className="glass animate-rise delay-1 w-full max-w-md rounded-[34px] p-8 sm:p-9 space-y-7">
          
          <div className="text-center space-y-2">
            <div className="inline-flex p-3.5 rounded-2xl text-indigo-600 mb-1 bg-white/60 border border-white/70 shadow-inner glow-pulse">
              <Sparkles size={24} />
            </div>
            <h2 className="text-2xl sm:text-[26px] font-black text-slate-900 tracking-tight">Break IQ</h2>
            <p className="text-xs text-slate-500 font-medium">Smart Break Management System</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label className="block text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2 font-mono">Workforce ID</label>
              <div className="relative">
                <User size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <input 
                  type="text" 
                  required 
                  value={empId} 
                  onChange={(e) => setEmpId(e.target.value)} 
                  placeholder="e.g. AGT-0001"
                  className="input-glass w-full rounded-2xl py-3.5 pl-11 pr-4 text-sm font-bold text-slate-900 placeholder-slate-400 outline-none font-mono tracking-wide" 
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2 font-mono">Secret Passphrase</label>
              <div className="relative">
                <Lock size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <input 
                  type="password" 
                  required 
                  value={pass} 
                  onChange={(e) => setPass(e.target.value)} 
                  placeholder="••••••••••••"
                  className="input-glass w-full rounded-2xl py-3.5 pl-11 pr-4 text-sm font-bold text-slate-900 placeholder-slate-400 outline-none font-mono tracking-widest" 
                />
              </div>
            </div>

            {err && (
              <div className="p-3.5 bg-rose-50/70 backdrop-blur-sm border border-rose-200/80 rounded-2xl text-center animate-rise">
                <p className="text-xs font-bold text-rose-600">{err}</p>
              </div>
            )}

            <button 
              type="submit" 
              disabled={loading}
              className="btn-glass mt-2 w-full font-black py-4 rounded-2xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 active:scale-95 transition-transform"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : (
                <>
                  <span>Sign In to Floor</span>
                  <ArrowRight size={15} />
                </>
              )}
            </button>
          </form>

        </div>
      </main>

      <footer className="relative z-10 py-6 text-center animate-rise delay-2">
        <p className="text-xs font-bold text-slate-400 tracking-wide">
          Made with <span className="text-rose-500 inline-block glow-pulse">❤️</span> by <strong className="text-slate-600 font-black">Harshit Sinha</strong>
        </p>
      </footer>
      
    </div>
  );
}