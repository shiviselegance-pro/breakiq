import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { doc, onSnapshot, setDoc, serverTimestamp } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { auth, db, functions, ORG_DOMAIN } from "../firebase";

const AuthContext = createContext(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth strictly bound inside <AuthProvider>");
  return ctx;
}

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser]       = useState(null);
  const [profile, setProfile]               = useState(null);
  const [authLoading, setAuthLoading]       = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  const [error, setError]                   = useState(null);

  // ── Auth state listener ────────────────────────────────────────────────
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setAuthLoading(false);
    });
    return () => unsub();
  }, []);

  // ── Firestore profile listener ─────────────────────────────────────────
  useEffect(() => {
    if (!currentUser) { setProfile(null); return; }
    setProfileLoading(true);
    const unsub = onSnapshot(
      doc(db, "users", currentUser.uid),
      (snap) => {
        setProfile(snap.exists() ? { uid: snap.id, ...snap.data() } : null);
        setProfileLoading(false);
      },
      (err) => { setError(err.message); setProfileLoading(false); }
    );
    return () => unsub();
  }, [currentUser]);

  // ── Helpers ────────────────────────────────────────────────────────────
  // FIX: Presence writes mein role field bhi include karo taaki
  // firestore.rules ka role-check pass ho sake (login + logout dono mein).
  const writePresence = useCallback(async (uid, role, status) => {
    try {
      await setDoc(
        doc(db, "presence", uid),
        { uid, role, status, lastHeartbeatAt: serverTimestamp() },
        { merge: true }
      );
    } catch (e) {
      console.warn("Presence write err:", e);
    }
  }, []);

  // ── Login ──────────────────────────────────────────────────────────────
  const login = useCallback(async (employeeId, password) => {
    setError(null);
    const email = `${employeeId.trim().toLowerCase()}@${ORG_DOMAIN}`;
    const cred  = await signInWithEmailAndPassword(auth, email, password);

    // Read role from Firestore before writing presence
    // (custom claims may not be set; profile doc is the source of truth)
    const userSnap = await import("firebase/firestore").then(({ getDoc }) =>
      getDoc(doc(db, "users", cred.user.uid))
    );
    const userRole = userSnap.exists() ? userSnap.data().role : "AGENT";

    await writePresence(cred.user.uid, userRole, "ONLINE");

    // Start shift — only relevant for floor agents
    try {
      await httpsCallable(functions, "startShift")();
    } catch (e) {
      if (e.code !== "functions/failed-precondition") {
        console.warn("Shift handshake anomaly:", e.code, e.message);
      }
    }

    return cred.user;
  }, [writePresence]);

  // ── Logout ─────────────────────────────────────────────────────────────
  // FIX 1: endShiftLogout sirf AGENT / SUPERVISOR ke liye fire hoga.
  //         ADMIN / SUPER_ADMIN ke liye nahi — yahi root cause tha
  //         logout ke baad AdminConsole pe redirect hone ka.
  // FIX 2: presence write mein role field include ki — warna Firestore
  //         rule fail karta tha aur signOut bhi execute nahi hota tha.
  const logout = useCallback(async () => {
    if (currentUser) {
      const role = profile?.role;

      // End shift only for floor roles
      if (role === "AGENT" || role === "SUPERVISOR") {
        try {
          await httpsCallable(functions, "endShiftLogout")();
        } catch (e) {
          console.warn("Shift termination anomaly:", e);
        }
      }

      // Mark OFFLINE — role field zaroori hai Firestore rule ke liye
      await writePresence(currentUser.uid, role, "OFFLINE");
    }

    await signOut(auth);
  }, [currentUser, profile, writePresence]);

  // ── Context value ──────────────────────────────────────────────────────
  const value = {
    currentUser,
    profile,
    role:           profile?.role ?? null,
    loading:        authLoading || profileLoading,
    authLoading,
    profileLoading,
    error,
    login,
    logout,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
