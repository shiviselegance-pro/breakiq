const { setGlobalOptions } = require("firebase-functions/v2");

setGlobalOptions({
  memory: "256MiB",
  cpu: 0.25,
  maxInstances: 1,
  timeoutSeconds: 60
});

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");

// ⚡ WhatsApp is safely mocked for local test if not configured.
const { sendWhatsAppText } = require("./whatsapp");

admin.initializeApp();
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const Timestamp = admin.firestore.Timestamp;

const WHATSAPP_TOKEN = defineSecret("WHATSAPP_TOKEN");
const ORG_DOMAIN = "breakapp.internal";

const DEFAULT_SETTINGS = {
  shiftDurationHours: 9, mealBreakMin: 40, shortBreakMin: 20,
  lockoutStartMin: 60, lockoutEndMin: 60, maxConcurrentBreaks: 2,
  alertMode: "INDIVIDUAL", supervisorBroadcastNumbers: [],
  emergencyLockout: false, emergencyReason: null,
};

// ============================================================================
// INTERNAL SYSTEM HELPERS
// ============================================================================

function assertAuth(request) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Strict IAM sign-in required.");
  return request.auth.uid;
}

// ⚡ REPAIRED: Reads settings PER TENANT instead of globally!
async function getSettings(project) {
  const pStr = (project || "GENERAL").toUpperCase();
  const pSnap = await db.doc(`project_settings/${pStr}`).get();
  if (pSnap.exists) return { ...DEFAULT_SETTINGS, ...pSnap.data() };
  return { ...DEFAULT_SETTINGS };
}

async function getUserDoc(uid) {
  const snap = await db.doc(`users/${uid}`).get();
  if (!snap.exists) throw new HttpsError("not-found", "User directory record missing.");
  return { id: snap.id, ...snap.data() };
}

function requireRole(user, roles) {
  if (!roles.includes(user.role)) throw new HttpsError("permission-denied", `Action restricted. Required clearance: ${roles.join(", ")}`);
}

async function nextSeq(counterPath, field = "value") {
  const ref = db.doc(counterPath);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists ? snap.data()[field] || 0 : 0;
    const next = current + 1;
    tx.set(ref, { [field]: next }, { merge: true });
    return next;
  });
}

function genPassword(length = 10) {
  const charset = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let out = ""; for (let i = 0; i < length; i++) out += charset[Math.floor(Math.random() * charset.length)];
  return out;
}

function bumpBudget(budget, category, minutes) {
  if (category === "MEAL") return { ...budget, mealUsedMin: budget.mealUsedMin + minutes };
  return { ...budget, shortUsedMin: budget.shortUsedMin + minutes };
}

function windowCheck(shift, settings, atMillis) {
  const opensAt = shift.shiftStart.toMillis() + settings.lockoutStartMin * 60000;
  const closesAt = shift.shiftEnd.toMillis() - settings.lockoutEndMin * 60000;
  if (atMillis < opensAt) return { ok: false, reason: "TOO_EARLY", unlocksAtMillis: opensAt };
  if (atMillis > closesAt) return { ok: false, reason: "TOO_LATE" };
  return { ok: true };
}

// ============================================================================
// 1. MULTI-TENANT WORKFORCE PROVISIONING, EDITING & NUCLEAR PURGE
// ============================================================================

exports.createUserAccount = onCall(async (request) => {
  const callerUid = assertAuth(request);
  const caller = await getUserDoc(callerUid);
  const { name, role, phone, project } = request.data || {};
  
  if (!name || !phone || !["AGENT", "SUPERVISOR", "ADMIN", "SUPER_ADMIN"].includes(role)) {
    throw new HttpsError("invalid-argument", "Malformed onboarding payload.");
  }
  
  let assignedProject = (project || "GENERAL").trim().toUpperCase();

  if (role === "SUPER_ADMIN" || role === "ADMIN") requireRole(caller, ["ADMIN", "SUPER_ADMIN"]);
  else requireRole(caller, ["ADMIN", "SUPER_ADMIN", "SUPERVISOR"]);

  if (caller.role === "SUPERVISOR") {
    if (role !== "AGENT") throw new HttpsError("permission-denied", "Supervisors exclusively onboard Shift Agents.");
    assignedProject = (caller.project || "GENERAL").trim().toUpperCase();
  }

  const prefix = role === "AGENT" ? "AGT" : role === "SUPERVISOR" ? "SUP" : "ADM";
  const seq = await nextSeq("counters/employeeId", prefix);
  const employeeId = `${prefix}-${String(seq).padStart(4, "0")}`;
  const password = genPassword();
  const email = `${employeeId.toLowerCase()}@${ORG_DOMAIN}`;

  const authUser = await admin.auth().createUser({ email, password, displayName: name.trim() });
  await admin.auth().setCustomUserClaims(authUser.uid, { role, project: assignedProject });
  
  await db.doc(`users/${authUser.uid}`).set({
    uid: authUser.uid, employeeId, name: name.trim(), role, phone: phone.trim(),
    project: assignedProject, active: true, status: "OFFLINE",
    activeShiftId: null, activeBreakId: null,
    createdAt: FieldValue.serverTimestamp(), createdBy: callerUid,
  });

  return { uid: authUser.uid, employeeId, password, project: assignedProject };
});

exports.editUserAccount = onCall(async (request) => {
  const callerUid = assertAuth(request);
  const caller = await getUserDoc(callerUid);
  requireRole(caller, ["ADMIN", "SUPER_ADMIN"]); 

  const { targetUid, name, role, phone, project } = request.data || {};
  if (!targetUid) throw new HttpsError("invalid-argument", "Missing target identifier.");

  const target = await getUserDoc(targetUid);
  const assignedProject = project ? project.trim().toUpperCase() : target.project;
  const assignedRole = role || target.role;

  if (name) await admin.auth().updateUser(targetUid, { displayName: name.trim() });
  
  if (role || project) {
    await admin.auth().setCustomUserClaims(targetUid, {
      role: assignedRole, project: assignedProject
    });
  }

  const updates = { updatedAt: FieldValue.serverTimestamp(), updatedBy: callerUid };
  if (name) updates.name = name.trim();
  if (phone) updates.phone = phone.trim();
  if (role) updates.role = assignedRole;
  if (project) updates.project = assignedProject;

  await db.doc(`users/${targetUid}`).set(updates, { merge: true });
  return { ok: true, updatedId: targetUid };
});

exports.deleteUserAccount = onCall(async (request) => {
  const callerUid = assertAuth(request);
  const caller = await getUserDoc(callerUid);
  requireRole(caller, ["ADMIN", "SUPER_ADMIN", "SUPERVISOR"]);

  const { targetUid } = request.data || {};
  if (!targetUid) throw new HttpsError("invalid-argument", "Target identifier required.");
  
  const target = await getUserDoc(targetUid);
  if (target.role === "SUPER_ADMIN" || (target.role === "ADMIN" && caller.role !== "SUPER_ADMIN")) {
    throw new HttpsError("permission-denied", "Root Administrators cannot be deleted remotely.");
  }

  if (caller.role === "SUPERVISOR") {
    if (target.role !== "AGENT" || target.project !== caller.project) {
      throw new HttpsError("permission-denied", "Clearance strictly fenced inside your project tenant.");
    }
  }

  await admin.auth().deleteUser(targetUid);
  await db.doc(`users/${targetUid}`).delete();
  await db.doc(`presence/${targetUid}`).delete().catch(() => {});

  return { ok: true, removedId: target.employeeId };
});

exports.resetPassword = onCall(async (request) => {
  const callerUid = assertAuth(request);
  const caller = await getUserDoc(callerUid);
  requireRole(caller, ["ADMIN", "SUPER_ADMIN", "SUPERVISOR"]);
  
  const { targetUid } = request.data || {};
  const target = await getUserDoc(targetUid);
  
  if (caller.role === "SUPERVISOR" && (target.role !== "AGENT" || target.project !== caller.project)) {
    throw new HttpsError("permission-denied", "Restricted strictly to your project tenant.");
  }
  
  const password = genPassword();
  await admin.auth().updateUser(targetUid, { password });
  return { password };
});

exports.agentUpdateOwnPassword = onCall(async (request) => {
  const uid = assertAuth(request);
  const { newPass } = request.data || {};
  if (!newPass || newPass.length < 6) throw new HttpsError("invalid-argument", "Passphrase must be at least 6 characters.");
  
  await admin.auth().updateUser(uid, { password: newPass });
  return { ok: true };
});

// ============================================================================
// 2. SHIFT ATTENDANCE, MANUAL LOGOUT & AUTO-CRON CLEANUP
// ============================================================================

exports.startShift = onCall(async (request) => {
  const uid = assertAuth(request);
  const user = await getUserDoc(uid);
  if (user.role !== "AGENT") throw new HttpsError("failed-precondition", "Exclusively agents hold active shift horizons.");
  if (!user.active) throw new HttpsError("permission-denied", "Account disabled.");

  const settings = await getSettings(user.project);
  const now = Timestamp.now();

  if (user.activeShiftId) {
    const existing = await db.doc(`shift_sessions/${user.activeShiftId}`).get();
    if (existing.exists && existing.data().status === "ON_SHIFT" && existing.data().shiftEnd.toMillis() > now.toMillis()) {
      await db.doc(`users/${uid}`).set({ status: "AVAILABLE" }, { merge: true });
      return { shiftId: user.activeShiftId, resumed: true };
    }
  }

  const shiftId = `${uid}_${now.toMillis()}`;
  const shiftEnd = Timestamp.fromMillis(now.toMillis() + settings.shiftDurationHours * 3600 * 1000);
  
  await db.doc(`shift_sessions/${shiftId}`).set({
    uid, employeeId: user.employeeId, name: user.name, project: user.project || "GENERAL",
    shiftStart: now, shiftEnd, loginAt: now, logoutAt: null, status: "ON_SHIFT",
    breakBudget: { mealUsedMin: 0, shortUsedMin: 0, mealTotalMin: settings.mealBreakMin, shortTotalMin: settings.shortBreakMin },
  });
  
  await db.doc(`users/${uid}`).set({ activeShiftId: shiftId, status: "AVAILABLE" }, { merge: true });
  return { shiftId, resumed: false };
});

exports.endShiftLogout = onCall(async (request) => {
  const uid = assertAuth(request);
  const userRef = db.doc(`users/${uid}`);
  const userSnap = await userRef.get();
  if (!userSnap.exists) throw new HttpsError("not-found", "User not found");

  const userData = userSnap.data();
  if (userData.activeShiftId) {
    const shiftRef = db.doc(`shift_sessions/${userData.activeShiftId}`);
    const shiftSnap = await shiftRef.get();

    if (shiftSnap.exists) {
      const shiftData = shiftSnap.data();
      const settings = await getSettings(userData.project);
      const requiredMillis = (settings.shiftDurationHours || 9) * 3600000;
      const elapsedMs = Date.now() - shiftData.shiftStart.toMillis();

      if (elapsedMs < requiredMillis) {
        throw new HttpsError("failed-precondition", "SLA Violation: Shift cannot be closed before fulfillment.");
      }

      await db.collection("shift_reports").add({
        ...shiftData,
        shiftEnd: FieldValue.serverTimestamp(),
        totalDurationMs: elapsedMs,
        closedBy: "MANUAL_AGENT"
      });

      await shiftRef.delete();
    }
  }

  await userRef.update({
    activeShiftId: FieldValue.delete(),
    activeBreakId: FieldValue.delete(),
    workMode: FieldValue.delete(),
    workModeDate: FieldValue.delete(),
    status: "OFFLINE"
  });

  return { ok: true, message: "Shift closed and ledger reset successfully." };
});

exports.autoCloseStaleShifts = onSchedule("every 1 hours", async (event) => {
  const now = Date.now();
  const killThresholdMs = now - 39600000; 
  const killDate = Timestamp.fromMillis(killThresholdMs);

  const staleShifts = await db.collection("shift_sessions")
    .where("shiftStart", "<=", killDate)
    .get();

  if (staleShifts.empty) return;

  const batch = db.batch();
  staleShifts.forEach((docSnap) => {
    const data = docSnap.data();
    
    const reportRef = db.collection("shift_reports").doc();
    batch.set(reportRef, {
      ...data,
      shiftEnd: Timestamp.fromMillis(data.shiftStart.toMillis() + 32400000), 
      closedBy: "SYSTEM_CRON_AUTO_KILL"
    });

    batch.delete(docSnap.ref);

    const userRef = db.doc(`users/${data.uid}`);
    batch.update(userRef, {
      activeShiftId: FieldValue.delete(),
      activeBreakId: FieldValue.delete(),
      workMode: FieldValue.delete(),
      workModeDate: FieldValue.delete(),
      status: "OFFLINE"
    });
  });

  await batch.commit();
  console.log(`Auto-killed ${staleShifts.size} stale ghost shifts.`);
});

exports.toggleEmergencyLockout = onCall(async (request) => {
  const callerUid = assertAuth(request);
  const caller = await getUserDoc(callerUid);
  requireRole(caller, ["ADMIN", "SUPER_ADMIN", "SUPERVISOR"]);
  
  const { locked, reason } = request.data || {};
  // Save to the specific project of the admin/supervisor!
  const targetProj = caller.role === "SUPERVISOR" ? caller.project : "GENERAL"; // Defaulting to general if global outage triggered
  
  await db.doc(`project_settings/${targetProj}`).set({ emergencyLockout: !!locked, emergencyReason: locked ? (reason || "P1 Outage Active - Breaks Paused") : null }, { merge: true });
  return { ok: true };
});

// ============================================================================
// 3. ⚡ THE NEW STATELESS OVERLAP ENGINE (REPLACES AGGREGATES!)
// ============================================================================

exports.requestBreakNow = onCall(async (request) => {
  const uid = assertAuth(request);
  const { category, minutesNow, targetUid } = request.data || {};
  const effectiveUid = targetUid || uid;

  const user = await getUserDoc(effectiveUid);
  if (!user.activeShiftId) throw new HttpsError("failed-precondition", "Shift inactive.");
  
  const shiftSnap = await db.doc(`shift_sessions/${user.activeShiftId}`).get();
  const shift = { id: shiftSnap.id, ...shiftSnap.data() };
  
  const settings = await getSettings(user.project);
  if (settings.emergencyLockout) throw new HttpsError("failed-precondition", `🚨 FLOOR FROZEN: ${settings.emergencyReason}.`);

  if (user.activeBreakId) throw new HttpsError("already-exists", "Active break session ongoing.");
  
  const now = Timestamp.now();
  const w = windowCheck(shift, settings, now.toMillis());
  if (!w.ok) throw new HttpsError("failed-precondition", "Break window closed by WFM policy.");

  const budget = shift.breakBudget;
  let minutesToUse;
  if (category === "MEAL") {
    if (budget.mealUsedMin > 0) throw new HttpsError("already-exists", "Meal break already completed.");
    minutesToUse = budget.mealTotalMin;
  } else {
    const shortRemaining = budget.shortTotalMin - budget.shortUsedMin;
    if (shortRemaining <= 0) throw new HttpsError("failed-precondition", "Short break bank exhausted.");
    minutesToUse = Math.min(Math.max(1, Math.round(minutesNow || shortRemaining)), shortRemaining);
  }

  const intervalStart = now.toMillis();
  const intervalEnd = intervalStart + minutesToUse * 60000;

  // ⚡ DYNAMIC OVERLAP CALCULATION (No more dumb aggregate counters!)
  const activeAndScheduled = await db.collection("break_sessions")
    .where("project", "==", user.project || "GENERAL")
    .where("status", "in", ["ON_BREAK", "APPROVED_SCHEDULED"])
    .get();

  let overlapCount = 0;
  let earliestEnd = null;

  activeAndScheduled.docs.forEach(d => {
      const b = d.data();
      const s = (b.status === "ON_BREAK" ? b.breakStartedAt : b.scheduledFor).toMillis();
      const e = b.expectedEndAt.toMillis();
      
      // Math: Starts before my end, and Ends after my start (Intersection)
      if (s < intervalEnd && e > intervalStart) {
          overlapCount++;
          if (!earliestEnd || e < earliestEnd) earliestEnd = e;
      }
  });

  const breakRef = db.collection("break_sessions").doc();
  const shiftRef = db.doc(`shift_sessions/${shift.id}`);
  const userRef = db.doc(`users/${effectiveUid}`);

  const base = {
    uid: effectiveUid, employeeId: user.employeeId, agentName: user.name, project: user.project || "GENERAL", shiftId: shift.id,
    breakCategory: category, requestedDurationMin: minutesToUse, mode: "NOW", requestedAt: now, scheduledFor: null,
    notifiedReady: false, readyToStart: false, breakEndedAt: null, actualMinutesUsed: null, exceeded: false, wasForceEnded: false, forceEndedBy: null,
  };

  if (overlapCount >= settings.maxConcurrentBreaks) {
    // ⚡ QUEUE IT
    await db.runTransaction(async (tx) => {
      const sSnap = await tx.get(shiftRef);
      tx.set(breakRef, {
        ...base, status: "AWAITING_SLOT", 
        suggestedTime: earliestEnd ? Timestamp.fromMillis(earliestEnd) : null,
        breakStartedAt: null, expectedEndAt: null
      });
      tx.set(shiftRef, { breakBudget: bumpBudget(sSnap.data().breakBudget, category, minutesToUse) }, { merge: true });
      tx.set(userRef, { status: "IN_QUEUE", activeBreakId: breakRef.id }, { merge: true });
    });
    return { status: "AWAITING_SLOT", breakId: breakRef.id, suggestedTime: earliestEnd };
  } else {
    // ⚡ GRANT IT
    await db.runTransaction(async (tx) => {
      const sSnap = await tx.get(shiftRef);
      tx.set(breakRef, { 
        ...base, status: "ON_BREAK", breakStartedAt: now, 
        expectedEndAt: Timestamp.fromMillis(intervalEnd), suggestedTime: null 
      });
      tx.set(shiftRef, { breakBudget: bumpBudget(sSnap.data().breakBudget, category, minutesToUse) }, { merge: true });
      tx.set(userRef, { status: "ON_BREAK", activeBreakId: breakRef.id }, { merge: true });
    });
    return { status: "ON_BREAK", breakId: breakRef.id };
  }
});

exports.requestBreakLater = onCall(async (request) => {
  const uid = assertAuth(request);
  const { category, minutesNow, scheduledFor } = request.data || {};
  
  const user = await getUserDoc(uid);
  if (!user.activeShiftId) throw new HttpsError("failed-precondition", "Shift inactive.");
  
  const shiftSnap = await db.doc(`shift_sessions/${user.activeShiftId}`).get();
  const shift = { id: shiftSnap.id, ...shiftSnap.data() };
  
  const settings = await getSettings(user.project);
  if (settings.emergencyLockout) throw new HttpsError("failed-precondition", `🚨 FLOOR FROZEN: ${settings.emergencyReason}.`);
  if (user.activeBreakId) throw new HttpsError("already-exists", "Active request in progress.");

  const schedMs = Number(scheduledFor);
  const w = windowCheck(shift, settings, schedMs);
  if (!w.ok) throw new HttpsError("invalid-argument", "Schedule falls outside shift window.");
  if (schedMs <= Date.now()) throw new HttpsError("invalid-argument", "Must schedule in the future.");

  const budget = shift.breakBudget;
  let minutesToUse = category === "MEAL" ? budget.mealTotalMin : Math.min(minutesNow || 15, budget.shortTotalMin - budget.shortUsedMin);

  const intervalStart = schedMs;
  const intervalEnd = schedMs + minutesToUse * 60000;

  const activeAndScheduled = await db.collection("break_sessions")
    .where("project", "==", user.project || "GENERAL")
    .where("status", "in", ["ON_BREAK", "APPROVED_SCHEDULED"])
    .get();

  let overlapCount = 0;
  let earliestEnd = null;

  activeAndScheduled.docs.forEach(d => {
      const b = d.data();
      const s = (b.status === "ON_BREAK" ? b.breakStartedAt : b.scheduledFor).toMillis();
      const e = b.expectedEndAt.toMillis();
      if (s < intervalEnd && e > intervalStart) {
          overlapCount++;
          if (!earliestEnd || e < earliestEnd) earliestEnd = e;
      }
  });

  if (overlapCount >= settings.maxConcurrentBreaks) {
    return { ok: false, suggestedTime: earliestEnd || intervalStart + 15 * 60000 };
  }

  const breakRef = db.collection("break_sessions").doc();
  await db.runTransaction(async (tx) => {
    const shiftRef = db.doc(`shift_sessions/${shift.id}`);
    const sSnap = await tx.get(shiftRef);
    tx.set(breakRef, {
      uid, employeeId: user.employeeId, agentName: user.name, project: user.project || "GENERAL", shiftId: shift.id,
      breakCategory: category, requestedDurationMin: minutesToUse, mode: "LATER", status: "APPROVED_SCHEDULED",
      requestedAt: Timestamp.now(), scheduledFor: Timestamp.fromMillis(intervalStart), notifiedReady: false, readyToStart: false,
      breakStartedAt: null, expectedEndAt: Timestamp.fromMillis(intervalEnd),
      breakEndedAt: null, actualMinutesUsed: null, exceeded: false, wasForceEnded: false, forceEndedBy: null,
    });
    tx.set(shiftRef, { breakBudget: bumpBudget(sSnap.data().breakBudget, category, minutesToUse) }, { merge: true });
    tx.set(db.doc(`users/${uid}`), { status: "IN_QUEUE", activeBreakId: breakRef.id }, { merge: true });
  });

  return { ok: true, breakId: breakRef.id, scheduledFor: intervalStart };
});

exports.goingForBreak = onCall(async (request) => {
  const uid = assertAuth(request);
  const user = await getUserDoc(uid);
  if (!user.activeBreakId) throw new HttpsError("failed-precondition", "No pending session.");
  
  const breakRef = db.doc(`break_sessions/${user.activeBreakId}`);
  const settings = await getSettings(user.project);
  if (settings.emergencyLockout) throw new HttpsError("failed-precondition", `🚨 FLOOR FROZEN: ${settings.emergencyReason}.`);

  // ⚡ DYNAMIC OVERLAP CALCULATION (Excluding own break)
  const activeAndScheduled = await db.collection("break_sessions")
    .where("project", "==", user.project || "GENERAL")
    .where("status", "in", ["ON_BREAK", "APPROVED_SCHEDULED"])
    .get();

  return db.runTransaction(async (tx) => {
    const bSnap = await tx.get(breakRef);
    if (!bSnap.exists || bSnap.data().status !== "APPROVED_SCHEDULED") throw new HttpsError("failed-precondition", "Unstartable state.");
    const b = bSnap.data();
    const now = Timestamp.now();
    if (now.toMillis() < b.scheduledFor.toMillis() - 30000) throw new HttpsError("failed-precondition", "Not time yet.");

    const intervalStart = now.toMillis();
    const intervalEnd = intervalStart + b.requestedDurationMin * 60000;

    let overlapCount = 0;
    activeAndScheduled.docs.forEach(d => {
        if (d.id === breakRef.id) return; // Don't count self
        const oc = d.data();
        const s = (oc.status === "ON_BREAK" ? oc.breakStartedAt : oc.scheduledFor).toMillis();
        const e = oc.expectedEndAt.toMillis();
        if (s < intervalEnd && e > intervalStart) overlapCount++;
    });

    if (overlapCount < settings.maxConcurrentBreaks) {
      tx.set(breakRef, { status: "ON_BREAK", breakStartedAt: now, expectedEndAt: Timestamp.fromMillis(intervalEnd) }, { merge: true });
      tx.set(db.doc(`users/${uid}`), { status: "ON_BREAK" }, { merge: true });
      return { status: "ON_BREAK" };
    }
    tx.set(breakRef, { status: "AWAITING_SLOT" }, { merge: true });
    tx.set(db.doc(`users/${uid}`), { status: "IN_QUEUE" }, { merge: true });
    return { status: "AWAITING_SLOT" };
  });
});

async function endAndPromote(breakId, forcedBy) {
  const breakRef = db.doc(`break_sessions/${breakId}`);
  const breakSnap = await breakRef.get();
  if (!breakSnap.exists || breakSnap.data().status !== "ON_BREAK") throw new HttpsError("failed-precondition", "Agent not on active break.");
  const b = breakSnap.data();

  // ⚡ Find the next person in queue to promote
  const queueSnap = await db.collection("break_sessions")
    .where("project", "==", b.project || "GENERAL")
    .where("status", "in", ["AWAITING_SLOT", "IN_QUEUE"])
    .orderBy("requestedAt", "asc")
    .limit(1)
    .get();
    
  const headId = queueSnap.empty ? null : queueSnap.docs[0].id;

  const summary = await db.runTransaction(async (tx) => {
    const shiftRef = db.doc(`shift_sessions/${b.shiftId}`);
    const promoteRef = headId ? db.doc(`break_sessions/${headId}`) : null;

    const [shiftSnap, promoteSnap] = await Promise.all([tx.get(shiftRef), promoteRef ? tx.get(promoteRef) : Promise.resolve(null)]);
    const now = Timestamp.now();
    const elapsedMin = Math.round((now.toMillis() - b.breakStartedAt.toMillis()) / 60000);
    const refundMin = Math.max(0, b.requestedDurationMin - elapsedMin);

    let promoted = null;

    tx.set(breakRef, { status: "COMPLETED", breakEndedAt: now, actualMinutesUsed: elapsedMin, forceEndedBy: forcedBy || null, wasForceEnded: !!forcedBy }, { merge: true });
    tx.set(db.doc(`users/${b.uid}`), { status: "AVAILABLE", activeBreakId: FieldValue.delete() }, { merge: true });
    if (refundMin > 0 && shiftSnap.exists) tx.set(shiftRef, { breakBudget: bumpBudget(shiftSnap.data().breakBudget, b.breakCategory, -refundMin) }, { merge: true });

    if (promoteSnap && promoteSnap.exists) {
      const pData = promoteSnap.data();
      tx.set(promoteRef, { status: "ON_BREAK", breakStartedAt: now, expectedEndAt: Timestamp.fromMillis(now.toMillis() + (Number(pData.requestedDurationMin) || 20) * 60000) }, { merge: true });
      tx.set(db.doc(`users/${pData.uid}`), { status: "ON_BREAK" }, { merge: true });
      promoted = { uid: pData.uid };
    }
    return { endedAgentUid: b.uid, promoted };
  });

  if (summary.promoted) {
    const pUser = await getUserDoc(summary.promoted.uid).catch(() => null);
    if (pUser?.phone) await sendWhatsAppText({ token: WHATSAPP_TOKEN.value(), to: pUser.phone, body: `Hi ${pUser.name}, a break slot opened up. Your break starts now.` }).catch(() => {});
  }
  return summary;
}

exports.endBreak = onCall({ secrets: [WHATSAPP_TOKEN] }, async (request) => {
  const uid = assertAuth(request);
  const user = await getUserDoc(uid);
  if (!user.activeBreakId) throw new HttpsError("failed-precondition", "No active break.");
  return endAndPromote(user.activeBreakId, null);
});

exports.adminForceEndBreak = onCall({ secrets: [WHATSAPP_TOKEN] }, async (request) => {
  const callerUid = assertAuth(request);
  const caller = await getUserDoc(callerUid);
  requireRole(caller, ["ADMIN", "SUPER_ADMIN", "SUPERVISOR"]);
  const { targetUid } = request.data || {};
  const target = await getUserDoc(targetUid);
  if (!target.activeBreakId) throw new HttpsError("failed-precondition", "Target not on break.");
  return endAndPromote(target.activeBreakId, callerUid);
});

exports.cancelScheduledBreak = onCall(async (request) => {
  const callerUid = assertAuth(request);
  const { targetUid } = request.data || {};
  const uid = targetUid || callerUid;

  if (targetUid && targetUid !== callerUid) {
     const caller = await getUserDoc(callerUid);
     requireRole(caller, ["SUPERVISOR", "ADMIN", "SUPER_ADMIN"]);
  }

  const user = await getUserDoc(uid);
  if (!user.activeBreakId) throw new HttpsError("failed-precondition", "No pending request.");
  const breakRef = db.doc(`break_sessions/${user.activeBreakId}`);
  const shiftRef = db.doc(`shift_sessions/${user.activeShiftId}`);

  await db.runTransaction(async (tx) => {
    const [breakSnap, shiftSnap] = await Promise.all([tx.get(breakRef), tx.get(shiftRef)]);
    if (!breakSnap.exists) throw new HttpsError("not-found", "Break missing.");
    const b = breakSnap.data();
    if (!["AWAITING_SLOT", "APPROVED_SCHEDULED", "IN_QUEUE"].includes(b.status)) throw new HttpsError("failed-precondition", "Cannot cancel active session.");

    const refundMin = Number(b.requestedDurationMin) || 0;
    if (shiftSnap.exists && refundMin > 0) tx.set(shiftRef, { breakBudget: bumpBudget(shiftSnap.data().breakBudget, b.breakCategory, -refundMin) }, { merge: true });
    tx.set(breakRef, { status: "CANCELLED" }, { merge: true });
    tx.set(db.doc(`users/${uid}`), { status: "AVAILABLE", activeBreakId: FieldValue.delete() }, { merge: true });
  });
  return { ok: true };
});

// ⚡ NUCLEAR FLUSH: Wipes ALL pending ghosts from a Tenant Pipeline!
exports.flushGhostQueue = onCall(async (request) => {
  const callerUid = assertAuth(request);
  const caller = await getUserDoc(callerUid);
  requireRole(caller, ["SUPERVISOR", "ADMIN", "SUPER_ADMIN"]);
  
  const { project } = request.data || {};
  const projFilter = (project || "GENERAL").trim().toUpperCase();

  const snap = await db.collection("break_sessions")
    .where("project", "==", projFilter)
    .where("status", "in", ["AWAITING_SLOT", "IN_QUEUE", "APPROVED_SCHEDULED"])
    .get();

  if (snap.empty) return { ok: true, cleared: 0 };

  const batch = db.batch();
  let count = 0;
  
  snap.forEach(docSnap => {
     batch.delete(docSnap.ref);
     batch.update(db.doc(`users/${docSnap.data().uid}`), { status: "AVAILABLE", activeBreakId: FieldValue.delete() }, { merge: true });
     count++;
  });

  await batch.commit();
  return { ok: true, cleared: count };
});

// ============================================================================
// 4. AUTOMATED TELEMETRY (CRON SCHEDULES)
// ============================================================================

exports.notifyApprovedScheduledBreaks = onSchedule({ schedule: "every 1 minutes", secrets: [WHATSAPP_TOKEN] }, async () => {
  const now = Timestamp.now();
  const snap = await db.collection("break_sessions").where("status", "==", "APPROVED_SCHEDULED").where("notifiedReady", "==", false).where("scheduledFor", "<=", now).get();
  for (const docSnap of snap.docs) {
    const b = docSnap.data();
    await docSnap.ref.set({ notifiedReady: true, readyToStart: true }, { merge: true });
    const user = await getUserDoc(b.uid).catch(() => null);
    if (user?.phone) await sendWhatsAppText({ token: WHATSAPP_TOKEN.value(), to: user.phone, body: `Hi ${user.name}, your break is approved. You may go now.` }).catch(() => {});
  }
});

exports.checkBreakOverruns = onSchedule({ schedule: "every 1 minutes", secrets: [WHATSAPP_TOKEN] }, async () => {
  const now = Timestamp.now();
  const snap = await db.collection("break_sessions").where("status", "==", "ON_BREAK").where("exceeded", "==", false).where("expectedEndAt", "<=", now).get();
  if (snap.empty) return;

  for (const docSnap of snap.docs) {
    const b = docSnap.data();
    await docSnap.ref.set({ exceeded: true }, { merge: true });
    const user = await getUserDoc(b.uid).catch(() => null);
    if (!user) continue;
    await db.doc(`users/${b.uid}`).set({ status: "BREAK_EXCEEDED" }, { merge: true });

    if (user.phone) await sendWhatsAppText({ token: WHATSAPP_TOKEN.value(), to: user.phone, body: "Your break time has exceeded the limit. Please return immediately." }).catch(() => {});

    const supervisorMessage = `Alert: ${user.name} (${user.employeeId}) has exceeded their ${b.breakCategory} break.`;
    const presenceSnap = await db.collection("presence").where("role", "==", "SUPERVISOR").where("status", "==", "ONLINE").get();
    for (const d of presenceSnap.docs) {
      const sup = await getUserDoc(d.id).catch(() => null);
      if (sup?.phone && (sup.project === "GENERAL" || sup.project === user.project)) {
        await sendWhatsAppText({ token: WHATSAPP_TOKEN.value(), to: sup.phone, body: supervisorMessage }).catch(() => {});
      }
    }
  }
});