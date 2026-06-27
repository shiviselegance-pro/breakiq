import React, { useState } from "react";
import { signOut } from "firebase/auth";
import { auth } from "./firebase";
import { AuthProvider, useAuth } from "./context/AuthContext";
import LoginPage       from "./pages/LoginPage";
import AgentConsole    from "./pages/AgentConsole";
import SupervisorTower from "./pages/SupervisorTower";
import AdminConsole    from "./pages/AdminConsole";
import { Loader2, RefreshCw } from "lucide-react";

// ── Loading screen ─────────────────────────────────────────────────────────
function LoadingScreen({ message = "Verifying IAM Clearance...", onForceWipe }) {
  return (
    <div className="min-h-screen bg-[#f8fafc] flex flex-col items-center justify-center gap-4 font-sans selection:bg-indigo-500">
      <Loader2 className="animate-spin text-indigo-600" size={36} />
      <p className="text-xs font-mono font-bold text-slate-400">{message}</p>
      {onForceWipe && (
        <button
          onClick={onForceWipe}
          className="mt-6 px-4 py-2 bg-rose-50 border border-rose-200 text-rose-600 rounded-xl text-[11px] font-mono font-bold hover:bg-rose-100 transition-all cursor-pointer flex items-center gap-1.5 shadow-sm active:scale-95"
        >
          <RefreshCw size={13} /> Force Clear Stuck Session
        </button>
      )}
    </div>
  );
}

// ── Router ─────────────────────────────────────────────────────────────────
function Router() {
  const { currentUser, profile, authLoading, profileLoading } = useAuth();
  const [purging, setPurging] = useState(false);

  const handleEmergencyWipe = async () => {
    setPurging(true);
    try { await signOut(auth); } catch (_) {}
    localStorage.clear();
    sessionStorage.clear();
    window.location.replace("/");
  };

  // 1. Hard reset in progress
  if (purging) return <LoadingScreen message="Clearing session..." />;

  // 2. Firebase Auth SDK still initialising
  if (authLoading) {
    return (
      <LoadingScreen
        message="Verifying Capgemini IAM Clearance..."
        onForceWipe={handleEmergencyWipe}
      />
    );
  }

  // 3. Auth resolved — no user logged in
  if (!currentUser) return <LoginPage />;

  // 4. User logged in, Firestore profile still loading
  if (profileLoading) {
    return (
      <LoadingScreen
        message="Hydrating Workforce Matrix..."
        onForceWipe={handleEmergencyWipe}
      />
    );
  }

  // 5. Profile fetch done but doc missing — orphaned auth account
  if (!profile) return <LoginPage />;

  // 6. Happy path — route by role
  switch (profile.role) {
    case "SUPER_ADMIN":
    case "ADMIN":      return <AdminConsole />;
    case "SUPERVISOR": return <SupervisorTower />;
    case "AGENT":      return <AgentConsole />;
    default:           return <LoginPage />;
  }
}

// ── App root ───────────────────────────────────────────────────────────────
export default function App() {
  return (
    <AuthProvider>
      <Router />
    </AuthProvider>
  );
}
