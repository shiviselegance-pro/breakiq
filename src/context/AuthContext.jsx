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
  const [currentUser, setCurrentUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setAuthLoading(false);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!currentUser) { setProfile(null); return; }
    setProfileLoading(true);
    const ref = doc(db, "users", currentUser.uid);
    const unsub = onSnapshot(ref, (snap) => {
      setProfile(snap.exists() ? { uid: snap.id, ...snap.data() } : null);
      setProfileLoading(false);
    }, (err) => {
      setError(err.message);
      setProfileLoading(false);
    });
    return () => unsub();
  }, [currentUser]);

  const login = useCallback(async (employeeId, password) => {
    setError(null);
    const email = `${employeeId.trim().toLowerCase()}@${ORG_DOMAIN}`;
    const cred = await signInWithEmailAndPassword(auth, email, password);

    // Presence ONLINE initialization
    try {
      await setDoc(doc(db, "presence", cred.user.uid),
        { uid: cred.user.uid, status: "ONLINE", lastHeartbeatAt: serverTimestamp() },
        { merge: true }
      );
    } catch (e) { console.warn("Presence stamp err:", e); }

    // Execute shift start exclusively for floor agents
    try {
      await httpsCallable(functions, "startShift")();
    } catch (e) {
      if (e.code !== "functions/failed-precondition") {
        console.warn("Shift handshake anomaly:", e.code, e.message);
      }
    }
    return cred.user;
  }, []);

  const logout = useCallback(async () => {
    if (currentUser) {
      try { await httpsCallable(functions, "endShiftLogout")(); } 
      catch (e) { console.warn("Shift termination anomaly:", e); }

      try {
        await setDoc(doc(db, "presence", currentUser.uid),
          { status: "OFFLINE", lastHeartbeatAt: serverTimestamp() },
          { merge: true }
        );
      } catch (e) { console.warn("Presence offline dispatch err:", e); }
    }
    await signOut(auth);
  }, [currentUser]);

  const value = {
    currentUser, profile, role: profile?.role ?? null,
    loading: authLoading || profileLoading, error, login, logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}