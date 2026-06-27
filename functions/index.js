const { setGlobalOptions } = require("firebase-functions/v2");

setGlobalOptions({
  memory: "256MiB",
  cpu: 0.25,
  maxInstances: 1,
  timeoutSeconds: 60
});

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");
const axios = require("axios"); // ⚡ Used for WhatsApp API Gateway

admin.initializeApp();
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const Timestamp = admin.firestore.Timestamp;

const ORG_DOMAIN = "breakapp.internal";
const WHATSAPP_GATEWAY_URL = "https://wa-gateway-production-aaa5.up.railway.app/send-message"; 
const WHATSAPP_TOKEN = "ARES_SECRET_WA_KEY_2026";

const DEFAULT_SETTINGS = {
  shiftDurationHours: 9, 
  mealBreakMin: 40, 
  shortBreakMin: 20,
  lockoutStartMin: 60, 
  lockoutEndMin: 60, 
  maxConcurrentBreaks: 2,
  emergencyLockout: false, 
  emergencyReason: null,
};

// ============================================================================
// ⚡ WHATSAPP ROUTING ENGINE
// ============================================================================

async function sendWhatsAppAlert(toPhone, messageText) {
  if (!toPhone || !messageText) return false;

  let formattedPhone = toPhone.trim().replace(/[+\s-]/g, "");
  if (!formattedPhone.startsWith("91") && formattedPhone.length === 10) {
    formattedPhone = "91" + formattedPhone;
  }

  console.log(`📤 Attempting WA send to: ${formattedPhone}`);

  try {
    const response = await axios.post(WHATSAPP_GATEWAY_URL, {
      token: WHATSAPP_TOKEN,
      phone: formattedPhone,
      message: messageText
    }, {
      headers: { "Content-Type": "application/json" },
      timeout: 8000 
    });

    if (response.status === 200) {
      console.log(`✅ WA Alert Sent to ${formattedPhone}`);
      return true;
    }
    console.warn(`⚠️ WA Response not 200: ${response.status}`);
    return false;
  } catch (error) {
    console.error(`❌ WA Node Failed for ${formattedPhone}:`, error.message);
    return false;
  }
}

async function getManagementContacts(projectId) {
  const contacts = [];
  try {
    console.log(`🔍 Searching supervisors/admins for project: ${projectId}`);
    const snap = await db.collection("users")
      .where("project", "==", projectId)
      .where("role", "in", ["SUPERVISOR", "ADMIN", "SUPER_ADMIN"])
      .get();

    console.log(`📋 Raw query returned ${snap.size} documents`);

    snap.forEach(docSnap => {
      const u = docSnap.data();
      console.log(`   → Found: ${u.name} | role: ${u.role} | active: ${u.active} | phone: ${u.phone}`);
      if (u.phone && u.active) {
        contacts.push(u.phone);
      } else {
        console.warn(`   ⚠️ Skipped ${u.name}: phone=${u.phone}, active=${u.active}`);
      }
    });

    console.log(`✅ Final contact list for ${projectId}:`, contacts);
  } catch (err) {
    console.error("Error fetching management routing roster:", err);
  }
  return contacts;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function assertAuth(request) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Strict IAM sign-in required.");
  return request.auth.uid;
}

async function getSettings(project) {
  let finalConfig = { ...DEFAULT_SETTINGS };
  const legacySnap = await db.doc("break_settings/config").get();
  if (legacySnap.exists) finalConfig = { ...finalConfig, ...legacySnap.data() };
  
  const genSnap = await db.doc("project_settings/GENERAL").get();
  if (genSnap.exists) finalConfig = { ...finalConfig, ...genSnap.data() };
  
  const pStr = (project || "GENERAL").toUpperCase();
  if (pStr !== "GENERAL") {
    const pSnap = await db.doc(`project_settings/${pStr}`).get();
    if (pSnap.exists) finalConfig = { ...finalConfig, ...pSnap.data() };
  }
  return finalConfig;
}

async function getUserDoc(uid) {
  const snap = await db.doc(`users/${uid}`).get();
  if (!snap.exists) throw new HttpsError("not-found", "User directory record missing.");
  return { id: snap.id, ...snap.data() };
}

function requireRole(user, roles) {
  if (!roles.includes(user.role)) {
    throw new HttpsError("permission-denied", `Action restricted. Required clearance: ${roles.join(", ")}`);
  }
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
  let out = "";
  for (let i = 0; i < length; i++) out += charset[Math.floor(Math.random() * charset.length)];
  return out;
}

function bumpBudget(budget, category, minutes) {
  if (category === "MEAL") return { ...budget, mealUsedMin: budget.mealUsedMin + minutes };
  return { ...budget, shortUsedMin: budget.shortUsedMin + minutes };
}

function windowCheck(shift, settings, atMillis) {
  const lockStart = Number(settings.lockoutStartMin) || 0;
  const lockEnd = Number(settings.lockoutEndMin) || 0;
  const opensAt = shift.shiftStart.toMillis() + (lockStart * 60000);
  const closesAt = shift.shiftEnd.toMillis() - (lockEnd * 60000);
  
  if (atMillis < (opensAt - 30000)) return { ok: false, reason: `Start Lock active for ${lockStart}m` };
  if (atMillis > (closesAt + 30000)) return { ok: false, reason: `End Lock active for ${lockEnd}m` };
  return { ok: true };
}

// ============================================================================
// QUEUE HEALING & PROMOTION LOGIC
// ============================================================================

async function processQueue(projectId) {
  const settings = await getSettings(projectId);
  const max = settings.maxConcurrentBreaks || 2;
  const now = Timestamp.now();

  const activeSnap = await db.collection("break_sessions")
    .where("project", "==", projectId)
    .where("status", "in", ["ON_BREAK", "NOTIFIED_TO_START"])
    .get();

  if (activeSnap.size >= max) return; 

  const queueSnap = await db.collection("break_sessions")
    .where("project", "==", projectId)
    .where("status", "in", ["AWAITING_SLOT", "IN_QUEUE"])
    .get();

  if (queueSnap.empty) return;

  const sorted = queueSnap.docs.sort((a, b) => (a.data().requestedAt?.toMillis() || 0) - (b.data().requestedAt?.toMillis() || 0));
  const headDoc = sorted[0];

  if (headDoc) {
    const pData = headDoc.data();
    
    await headDoc.ref.set({ status: "NOTIFIED_TO_START", notifiedAt: now }, { merge: true });
    await db.doc(`users/${pData.uid}`).set({ status: "NOTIFIED_TO_START", activeBreakId: headDoc.id }, { merge: true });

    // ⚡ WHATSAPP ALERT: Break is ready
    const uSnap = await db.doc(`users/${pData.uid}`).get();
    if (uSnap.exists && uSnap.data().phone) {
      sendWhatsAppAlert(uSnap.data().phone, `🔔 BREAK READY: Hello ${pData.agentName}, your ${pData.breakCategory} break slot is ready! Please accept within 3 mins on your console.`);
    }
  }
}

async function endAndPromote(breakId, forcedBy) {
  const breakRef = db.doc(`break_sessions/${breakId}`);
  const breakSnap = await breakRef.get();
  
  if (!breakSnap.exists || breakSnap.data().status !== "ON_BREAK") {
    throw new HttpsError("failed-precondition", "Agent not on active break.");
  }

  const b = breakSnap.data();
  const shiftRef = db.doc(`shift_sessions/${b.shiftId}`);
  const shiftSnap = await shiftRef.get();
  const now = Timestamp.now();
  
  const elapsedMin = Math.round((now.toMillis() - b.breakStartedAt.toMillis()) / 60000);
  const refundMin = Math.max(0, b.requestedDurationMin - elapsedMin);

  await breakRef.set({
    status: "COMPLETED",
    breakEndedAt: now,
    actualMinutesUsed: elapsedMin,
    forceEndedBy: forcedBy || null,
    wasForceEnded: !!forcedBy,
  }, { merge: true });

  await db.doc(`users/${b.uid}`).set({ status: "AVAILABLE", activeBreakId: FieldValue.delete() }, { merge: true });

  if (refundMin > 0 && shiftSnap.exists) {
    await shiftRef.set({ breakBudget: bumpBudget(shiftSnap.data().breakBudget, b.breakCategory, -refundMin) }, { merge: true });
  }

  await processQueue(b.project || "GENERAL");
  return { ok: true };
}

exports.acceptBreakStart = onCall(async (request) => {
  const uid = assertAuth(request);
  const user = await getUserDoc(uid);
  
  if (!user.activeBreakId) throw new HttpsError("failed-precondition", "No pending session.");

  const breakRef = db.doc(`break_sessions/${user.activeBreakId}`);
  
  return db.runTransaction(async (tx) => {
    const bSnap = await tx.get(breakRef);
    if (!bSnap.exists || bSnap.data().status !== "NOTIFIED_TO_START") {
      throw new HttpsError("failed-precondition", "Slot expired or invalid.");
    }
    
    const b = bSnap.data();
    const now = Timestamp.now();
    const intervalEnd = now.toMillis() + (b.requestedDurationMin * 60000);

    tx.set(breakRef, { 
      status: "ON_BREAK", breakStartedAt: now, expectedEndAt: Timestamp.fromMillis(intervalEnd) 
    }, { merge: true });
    
    tx.set(db.doc(`users/${uid}`), { status: "ON_BREAK" }, { merge: true });
    return { ok: true };
  });
});

// ============================================================================
// USER MANAGEMENT
// ============================================================================

exports.createUserAccount = onCall(async (request) => {
  const callerUid = assertAuth(request);
  const caller = await getUserDoc(callerUid);
  
  const { name, role, phone, project } = request.data || {};
  let assignedProject = (project || "GENERAL").trim().toUpperCase();

  if (role === "SUPER_ADMIN" || role === "ADMIN") {
    requireRole(caller, ["ADMIN", "SUPER_ADMIN"]);
  } else {
    requireRole(caller, ["ADMIN", "SUPER_ADMIN", "SUPERVISOR"]);
  }

  if (caller.role === "SUPERVISOR") {
    if (role !== "AGENT") {
      throw new HttpsError("permission-denied", "Supervisors exclusively onboard Shift Agents.");
    }
    assignedProject = (caller.project || "GENERAL").trim().toUpperCase();
  }

  const prefix = role === "AGENT" ? "AGT" : role === "SUPERVISOR" ? "SUP" : "ADM";
  const seq = await nextSeq("counters/employeeId", prefix);
  const employeeId = `${prefix}-${String(seq).padStart(4, "0")}`;
  const password = genPassword();
  const email = `${employeeId.toLowerCase()}@${ORG_DOMAIN}`;

  const authUser = await admin.auth().createUser({ 
    email, 
    password, 
    displayName: name.trim() 
  });
  
  await admin.auth().setCustomUserClaims(authUser.uid, { 
    role, 
    project: assignedProject 
  });

  await db.doc(`users/${authUser.uid}`).set({
    uid: authUser.uid, 
    employeeId, 
    name: name.trim(), 
    role, 
    phone: phone.trim(),
    project: assignedProject, 
    active: true, 
    status: "OFFLINE",
    createdAt: FieldValue.serverTimestamp(), 
    createdBy: callerUid,
  });

  return { uid: authUser.uid, employeeId, password, project: assignedProject };
});

exports.editUserAccount = onCall(async (request) => {
  const callerUid = assertAuth(request);
  const caller = await getUserDoc(callerUid);
  requireRole(caller, ["ADMIN", "SUPER_ADMIN"]);

  const { targetUid, name, role, phone, project } = request.data || {};
  const target = await getUserDoc(targetUid);
  const assignedProject = project ? project.trim().toUpperCase() : target.project;
  const assignedRole = role || target.role;

  if (name) {
    await admin.auth().updateUser(targetUid, { displayName: name.trim() });
  }
  
  if (role || project) {
    await admin.auth().setCustomUserClaims(targetUid, { 
      role: assignedRole, 
      project: assignedProject 
    });
  }

  const updates = { 
    updatedAt: FieldValue.serverTimestamp(), 
    updatedBy: callerUid 
  };
  
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
  const target = await getUserDoc(targetUid);
  
  if (target.role === "SUPER_ADMIN" || (target.role === "ADMIN" && caller.role !== "SUPER_ADMIN")) {
    throw new HttpsError("permission-denied", "Root Administrators cannot be deleted remotely.");
  }
  
  if (caller.role === "SUPERVISOR") {
    if (target.role !== "AGENT" || target.project !== caller.project) {
      throw new HttpsError("permission-denied", "Clearance fenced.");
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
    throw new HttpsError("permission-denied", "Restricted.");
  }
    
  const password = genPassword();
  await admin.auth().updateUser(targetUid, { password });
  return { password };
});

exports.agentUpdateOwnPassword = onCall(async (request) => {
  const uid = assertAuth(request);
  const { newPass } = request.data || {};
  await admin.auth().updateUser(uid, { password: newPass });
  return { ok: true };
});

// ============================================================================
// SHIFT MANAGEMENT
// ============================================================================

exports.startShift = onCall(async (request) => {
  const uid = assertAuth(request);
  const user = await getUserDoc(uid);
  
  if (user.role !== "AGENT") {
    throw new HttpsError("failed-precondition", "Exclusively agents hold active shift horizons.");
  }
  if (!user.active) {
    throw new HttpsError("permission-denied", "Account disabled.");
  }

  const settings = await getSettings(user.project);
  const now = Timestamp.now();

  if (user.activeShiftId) {
    const existing = await db.doc(`shift_sessions/${user.activeShiftId}`).get();
    if (existing.exists && existing.data().status === "ON_SHIFT" && existing.data().shiftEnd.toMillis() > now.toMillis()) {
      await db.doc(`users/${uid}`).set({ status: "AVAILABLE" }, { merge: true });
      console.log(`↩️ Shift resumed for ${user.name}, skipping WA alert.`);
      return { shiftId: user.activeShiftId, resumed: true };
    }
  }

  const shiftId = `${uid}_${now.toMillis()}`;
  const shiftEnd = Timestamp.fromMillis(now.toMillis() + settings.shiftDurationHours * 3600 * 1000);

  await db.doc(`shift_sessions/${shiftId}`).set({
    uid, 
    employeeId: user.employeeId, 
    name: user.name, 
    project: user.project || "GENERAL",
    shiftStart: now, 
    shiftEnd, 
    loginAt: now, 
    logoutAt: null, 
    status: "ON_SHIFT",
    breakBudget: { 
      mealUsedMin: 0, 
      shortUsedMin: 0, 
      mealTotalMin: settings.mealBreakMin, 
      shortTotalMin: settings.shortBreakMin 
    },
  });

  await db.doc(`users/${uid}`).set({ 
    activeShiftId: shiftId, 
    status: "AVAILABLE" 
  }, { merge: true });

  // ============================================================
  // ⚡ WHATSAPP ALERT: Notify Management about agent login
  // FIXED: Using await so Firebase doesn't kill the thread early
  // ============================================================
  console.log(`🚀 startShift: New shift created for ${user.name} in project ${user.project}. Fetching contacts...`);
  
  try {
    const mgmtContacts = await getManagementContacts(user.project);
    
    if (mgmtContacts.length === 0) {
      console.warn(`⚠️ No supervisors/admins found for project: ${user.project}. WhatsApp alert skipped.`);
    } else {
      console.log(`📨 Sending shift-start alerts to ${mgmtContacts.length} contact(s)...`);
      for (const phone of mgmtContacts) {
        await sendWhatsAppAlert(
          phone,
          `🟢 SHIFT START: Agent ${user.name} (${user.employeeId}) has clocked in for project ${user.project}.`
        );
      }
      console.log(`✅ All shift-start alerts dispatched.`);
    }
  } catch (waErr) {
    // WhatsApp failure should NEVER crash the shift creation
    console.error(`❌ WA alert block failed (non-critical):`, waErr.message);
  }

  return { shiftId, resumed: false };
});

exports.endShiftLogout = onCall(async (request) => {
  const uid = assertAuth(request);
  const userRef = db.doc(`users/${uid}`);
  const userSnap = await userRef.get();
  const userData = userSnap.data();

  if (userData?.activeShiftId) {
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
        closedBy: "MANUAL_AGENT",
      });
      await shiftRef.delete();
    }
  }

  await userRef.update({
    activeShiftId: FieldValue.delete(), 
    activeBreakId: FieldValue.delete(),
    workMode: FieldValue.delete(), 
    workModeDate: FieldValue.delete(), 
    status: "OFFLINE",
  });
  
  return { ok: true, message: "Shift closed and ledger reset successfully." };
});

exports.supervisorForceEndShift = onCall(async (request) => {
  const callerUid = assertAuth(request);
  const caller = await getUserDoc(callerUid);
  requireRole(caller, ["ADMIN", "SUPER_ADMIN", "SUPERVISOR"]);

  const { targetUid } = request.data || {};
  if (!targetUid) {
    throw new HttpsError("invalid-argument", "Target UID required.");
  }

  const userRef = db.doc(`users/${targetUid}`);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    throw new HttpsError("not-found", "User not found");
  }

  const userData = userSnap.data();
  const proj = userData.project || "GENERAL";

  if (userData.activeShiftId) {
    const shiftRef = db.doc(`shift_sessions/${userData.activeShiftId}`);
    const shiftSnap = await shiftRef.get();

    if (shiftSnap.exists) {
      const shiftData = shiftSnap.data();
      const elapsedMs = Date.now() - shiftData.shiftStart.toMillis();

      await db.collection("shift_reports").add({
        ...shiftData, 
        shiftEnd: FieldValue.serverTimestamp(),
        totalDurationMs: elapsedMs, 
        closedBy: "SUPERVISOR_FORCE_LOGOUT", 
        closedByUid: callerUid
      });
      await shiftRef.delete();
    }
  }

  if (userData.activeBreakId) {
      await db.doc(`break_sessions/${userData.activeBreakId}`).set({ 
        status: "CANCELLED", 
        forceEndedBy: callerUid 
      }, { merge: true });
  }

  await userRef.update({
    activeShiftId: FieldValue.delete(), 
    activeBreakId: FieldValue.delete(),
    workMode: FieldValue.delete(), 
    workModeDate: FieldValue.delete(), 
    status: "OFFLINE"
  });

  await processQueue(proj);
  return { ok: true, message: "Agent shift forcefully closed." };
});

exports.toggleEmergencyLockout = onCall(async (request) => {
  const callerUid = assertAuth(request);
  const caller = await getUserDoc(callerUid);
  requireRole(caller, ["ADMIN", "SUPER_ADMIN", "SUPERVISOR"]);
  
  const { locked, reason } = request.data || {};
  const targetProj = caller.role === "SUPERVISOR" ? caller.project : "GENERAL";
  
  const payload = {
    emergencyLockout: !!locked,
    emergencyReason: locked ? (reason || "Breaks Paused by Supervisor") : null,
  };

  await Promise.all([
    db.doc(`project_settings/${targetProj}`).set(payload, { merge: true }),
    db.doc("break_settings/config").set(payload, { merge: true })
  ]);
  
  return { ok: true };
});

// ============================================================================
// BREAK MANAGEMENT
// ============================================================================

exports.requestBreakNow = onCall(async (request) => {
  const uid = assertAuth(request);
  const { category, minutesNow, targetUid } = request.data || {};
  const effectiveUid = targetUid || uid;

  const user = await getUserDoc(effectiveUid);
  if (!user.activeShiftId) {
    throw new HttpsError("failed-precondition", "Shift inactive.");
  }

  const shiftSnap = await db.doc(`shift_sessions/${user.activeShiftId}`).get();
  const shift = { id: shiftSnap.id, ...shiftSnap.data() };
  
  const settings = await getSettings(user.project);
  if (settings.emergencyLockout) {
    throw new HttpsError("failed-precondition", `🚨 FLOOR FROZEN: ${settings.emergencyReason}.`);
  }
  
  if (user.activeBreakId) {
    throw new HttpsError("already-exists", "Active break session ongoing.");
  }

  const now = Timestamp.now();
  const w = windowCheck(shift, settings, now.toMillis());
  if (!w.ok) throw new HttpsError("failed-precondition", `WFM Policy Guard: ${w.reason}`);

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

  const activeAndScheduled = await db.collection("break_sessions")
    .where("project", "==", user.project || "GENERAL")
    .where("status", "in", ["ON_BREAK", "NOTIFIED_TO_START", "APPROVED_SCHEDULED"])
    .get();

  let overlapCount = 0;
  let earliestEnd = null;

  activeAndScheduled.docs.forEach(d => {
    const b = d.data();
    const e = b.expectedEndAt ? b.expectedEndAt.toMillis() : (b.scheduledFor?.toMillis() + (b.requestedDurationMin * 60000));
    if (e < now.toMillis()) return;
    
    const s = b.status === "APPROVED_SCHEDULED" ? b.scheduledFor.toMillis() : (b.breakStartedAt?.toMillis() || now.toMillis());
    if (s < intervalEnd && e > intervalStart) {
      overlapCount++;
      if (!earliestEnd || e < earliestEnd) {
        earliestEnd = e;
      }
    }
  });

  const breakRef = db.collection("break_sessions").doc();
  const shiftRef = db.doc(`shift_sessions/${shift.id}`);
  const userRef = db.doc(`users/${effectiveUid}`);

  const base = {
    uid: effectiveUid, 
    employeeId: user.employeeId, 
    agentName: user.name,
    project: user.project || "GENERAL", 
    shiftId: shift.id, 
    breakCategory: category, 
    requestedDurationMin: minutesToUse, 
    mode: "NOW", 
    requestedAt: now, 
    scheduledFor: null,
    notifiedReady: false, 
    readyToStart: false, 
    breakEndedAt: null, 
    actualMinutesUsed: null, 
    exceeded: false, 
    warningSent: false, 
    exceededAlertSent: false
  };

  if (overlapCount >= settings.maxConcurrentBreaks) {
    await db.runTransaction(async (tx) => {
      const sSnap = await tx.get(shiftRef);
      tx.set(breakRef, {
        ...base, 
        status: "AWAITING_SLOT", 
        suggestedTime: earliestEnd ? Timestamp.fromMillis(earliestEnd) : null, 
        breakStartedAt: null, 
        expectedEndAt: null,
      });
      tx.set(shiftRef, { breakBudget: bumpBudget(sSnap.data().breakBudget, category, minutesToUse) }, { merge: true });
      tx.set(userRef, { status: "IN_QUEUE", activeBreakId: breakRef.id }, { merge: true });
    });
    return { status: "AWAITING_SLOT", breakId: breakRef.id, suggestedTime: earliestEnd };
  } else {
    await db.runTransaction(async (tx) => {
      const sSnap = await tx.get(shiftRef);
      tx.set(breakRef, {
        ...base, 
        status: "NOTIFIED_TO_START", 
        notifiedAt: now, 
        suggestedTime: null,
      });
      tx.set(shiftRef, { breakBudget: bumpBudget(sSnap.data().breakBudget, category, minutesToUse) }, { merge: true });
      tx.set(userRef, { status: "NOTIFIED_TO_START", activeBreakId: breakRef.id }, { merge: true });
    });
    
    // ⚡ WHATSAPP ALERT: Break is immediately ready
    if (user.phone) {
      sendWhatsAppAlert(user.phone, `🔔 BREAK READY: Hello ${user.name}, your ${category} break slot is ready! Please accept within 3 mins on your console.`);
    }

    return { status: "NOTIFIED_TO_START", breakId: breakRef.id };
  }
});

exports.requestBreakLater = onCall(async (request) => {
  const uid = assertAuth(request);
  const { category, minutesNow, scheduledFor } = request.data || {};
  const user = await getUserDoc(uid);
  
  if (!user.activeShiftId) {
    throw new HttpsError("failed-precondition", "Shift inactive.");
  }

  const shiftSnap = await db.doc(`shift_sessions/${user.activeShiftId}`).get();
  const shift = { id: shiftSnap.id, ...shiftSnap.data() };
  const settings = await getSettings(user.project);
  
  if (settings.emergencyLockout) {
    throw new HttpsError("failed-precondition", `🚨 FLOOR FROZEN: ${settings.emergencyReason}.`);
  }
  if (user.activeBreakId) {
    throw new HttpsError("already-exists", "Active request in progress.");
  }

  const schedMs = Number(scheduledFor);
  const w = windowCheck(shift, settings, schedMs);
  if (!w.ok) throw new HttpsError("invalid-argument", `WFM Policy Guard: ${w.reason}`);
  if (schedMs <= Date.now()) throw new HttpsError("invalid-argument", "Must schedule in the future.");

  const budget = shift.breakBudget;
  let minutesToUse = category === "MEAL" 
    ? budget.mealTotalMin 
    : Math.min(minutesNow || 15, budget.shortTotalMin - budget.shortUsedMin);

  const intervalStart = schedMs;
  const intervalEnd = schedMs + minutesToUse * 60000;

  const activeAndScheduled = await db.collection("break_sessions")
    .where("project", "==", user.project || "GENERAL")
    .where("status", "in", ["ON_BREAK", "NOTIFIED_TO_START", "APPROVED_SCHEDULED"])
    .get();

  let overlapCount = 0; 
  let earliestEnd = null; 
  const nowMs = Date.now();

  activeAndScheduled.docs.forEach(d => {
    const b = d.data();
    const e = b.expectedEndAt ? b.expectedEndAt.toMillis() : (b.scheduledFor?.toMillis() + (b.requestedDurationMin * 60000));
    if (e < nowMs) return;
    
    const s = b.status === "APPROVED_SCHEDULED" ? b.scheduledFor.toMillis() : (b.breakStartedAt?.toMillis() || nowMs);
    if (s < intervalEnd && e > intervalStart) {
      overlapCount++;
      if (!earliestEnd || e < earliestEnd) earliestEnd = e;
    }
  });

  if (overlapCount >= settings.maxConcurrentBreaks) {
    return { ok: false, status: "SLOT_FULL", suggestedTime: earliestEnd || intervalStart + 15 * 60000 };
  }

  const breakRef = db.collection("break_sessions").doc();
  await db.runTransaction(async (tx) => {
    const shiftRef = db.doc(`shift_sessions/${shift.id}`);
    const sSnap = await tx.get(shiftRef);
    tx.set(breakRef, {
      uid, 
      employeeId: user.employeeId, 
      agentName: user.name,
      project: user.project || "GENERAL", 
      shiftId: shift.id,
      breakCategory: category, 
      requestedDurationMin: minutesToUse,
      mode: "LATER", 
      status: "APPROVED_SCHEDULED",
      requestedAt: Timestamp.now(), 
      scheduledFor: Timestamp.fromMillis(intervalStart),
      expectedEndAt: Timestamp.fromMillis(intervalEnd),
      breakStartedAt: null, 
      breakEndedAt: null, 
      actualMinutesUsed: null, 
      exceeded: false,
      warningSent: false, 
      exceededAlertSent: false
    });
    tx.set(shiftRef, { breakBudget: bumpBudget(sSnap.data().breakBudget, category, minutesToUse) }, { merge: true });
    tx.set(db.doc(`users/${uid}`), { status: "IN_QUEUE", activeBreakId: breakRef.id }, { merge: true });
  });

  return { ok: true, breakId: breakRef.id, scheduledFor: intervalStart };
});

exports.goingForBreak = onCall(async (request) => {
  const uid = assertAuth(request);
  const user = await getUserDoc(uid);
  if (!user.activeBreakId) {
    throw new HttpsError("failed-precondition", "No pending session.");
  }

  const breakRef = db.doc(`break_sessions/${user.activeBreakId}`);
  const settings = await getSettings(user.project);

  const activeAndScheduled = await db.collection("break_sessions")
    .where("project", "==", user.project || "GENERAL")
    .where("status", "in", ["ON_BREAK", "NOTIFIED_TO_START", "APPROVED_SCHEDULED"])
    .get();

  return db.runTransaction(async (tx) => {
    const bSnap = await tx.get(breakRef);
    if (!bSnap.exists || bSnap.data().status !== "APPROVED_SCHEDULED") {
      throw new HttpsError("failed-precondition", "Unstartable state.");
    }
    
    const b = bSnap.data();
    const now = Timestamp.now();
    
    const intervalStart = now.toMillis();
    const intervalEnd = intervalStart + b.requestedDurationMin * 60000;

    let overlapCount = 0;
    activeAndScheduled.docs.forEach(d => {
      if (d.id === breakRef.id) return;
      const oc = d.data();
      const e = oc.expectedEndAt ? oc.expectedEndAt.toMillis() : (oc.scheduledFor?.toMillis() + (oc.requestedDurationMin * 60000));
      if (e < now.toMillis()) return;
      
      const s = oc.status === "APPROVED_SCHEDULED" ? oc.scheduledFor.toMillis() : (oc.breakStartedAt?.toMillis() || now.toMillis());
      if (s < intervalEnd && e > intervalStart) {
        overlapCount++;
      }
    });

    if (overlapCount < settings.maxConcurrentBreaks) {
      tx.set(breakRef, {
        status: "ON_BREAK", 
        breakStartedAt: now,
        expectedEndAt: Timestamp.fromMillis(intervalEnd),
      }, { merge: true });
      tx.set(db.doc(`users/${uid}`), { status: "ON_BREAK" }, { merge: true });
      return { status: "ON_BREAK" };
    }
    
    tx.set(breakRef, { status: "AWAITING_SLOT" }, { merge: true });
    tx.set(db.doc(`users/${uid}`), { status: "IN_QUEUE" }, { merge: true });
    return { status: "AWAITING_SLOT" };
  });
});

// ============================================================================
// CRON JOBS (WHATSAPP ALERTS & AUTOMATION ENGINE)
// ============================================================================

// ⚡ CRON 1: Auto-Promotes Scheduled Breaks when their time arrives!
exports.autoStartScheduledBreaks = onSchedule("every 1 minutes", async () => {
  const now = Timestamp.now();
  const snap = await db.collection("break_sessions")
    .where("status", "==", "APPROVED_SCHEDULED")
    .where("scheduledFor", "<=", now)
    .get();

  if (snap.empty) return;

  const batch = db.batch();
  for (let docSnap of snap.docs) {
    const b = docSnap.data();
    
    batch.update(docSnap.ref, { 
      status: "NOTIFIED_TO_START", 
      notifiedAt: now 
    });
    
    batch.update(db.doc(`users/${b.uid}`), { 
      status: "NOTIFIED_TO_START" 
    });

    // ⚡ WHATSAPP ALERT: Notify agent that scheduled break is ready
    const uSnap = await db.doc(`users/${b.uid}`).get();
    if (uSnap.exists && uSnap.data().phone) {
      await sendWhatsAppAlert(
        uSnap.data().phone, 
        `🔔 SCHEDULE READY: Hello ${b.agentName}, your scheduled ${b.breakCategory} break is ready! Please accept within 3 mins on your console.`
      );
    }
  }
  await batch.commit();
});

// ⚡ CRON 2: 3-Minute Missed SLA Reaper!
exports.autoReleaseMissedBreaks = onSchedule("every 1 minutes", async () => {
  const limitDate = Timestamp.fromMillis(Date.now() - (3 * 60000)); 
  
  const snap = await db.collection("break_sessions")
    .where("status", "==", "NOTIFIED_TO_START")
    .where("notifiedAt", "<=", limitDate)
    .get();

  if (snap.empty) return;

  for (let docSnap of snap.docs) {
    const b = docSnap.data();
    
    await db.runTransaction(async (tx) => {
      const shiftRef = db.doc(`shift_sessions/${b.shiftId}`);
      const sSnap = await tx.get(shiftRef);
      if (sSnap.exists) {
        tx.set(shiftRef, { 
          breakBudget: bumpBudget(sSnap.data().breakBudget, b.breakCategory, -b.requestedDurationMin) 
        }, { merge: true });
      }
      
      tx.set(docSnap.ref, { 
        status: "CANCELLED", 
        cancelReason: "MISSED_SLA" 
      }, { merge: true });
      
      tx.set(db.doc(`users/${b.uid}`), { 
        status: "AVAILABLE", 
        activeBreakId: FieldValue.delete() 
      }, { merge: true });
    });
    
    // ⚡ Heal the queue for the next waiting person
    await processQueue(b.project || "GENERAL"); 
  }
});

// ⚡ CRON 3: Meal Break 5-Minute Warning! (WhatsApp Alert)
exports.autoMealBreakWarning = onSchedule("every 1 minutes", async () => {
  const nowMs = Date.now();
  const targetMs = nowMs + (5 * 60000);

  const snap = await db.collection("break_sessions")
    .where("status", "==", "ON_BREAK")
    .where("breakCategory", "==", "MEAL")
    .where("warningSent", "in", [false, null])
    .get();

  if (snap.empty) return;

  const batch = db.batch();
  for (let docSnap of snap.docs) {
    const b = docSnap.data();
    const endMs = b.expectedEndAt?.toMillis() || 0;
    
    if (endMs > nowMs && endMs <= targetMs + 30000) { 
       batch.update(docSnap.ref, { warningSent: true });
       
       const uSnap = await db.doc(`users/${b.uid}`).get();
       if (uSnap.exists && uSnap.data().phone) {
         await sendWhatsAppAlert(
           uSnap.data().phone, 
           `⏳ MEAL WARNING: Hello ${b.agentName}, your MEAL break ends in 5 minutes! Please prepare to resume your shift.`
         );
       }
    }
  }
  await batch.commit();
});

// ⚡ CRON 4: Break Exceeded Hooter (To Sups & Admins)!
exports.autoBreakExceededAlert = onSchedule("every 1 minutes", async () => {
  const now = Timestamp.now();
  
  const snap = await db.collection("break_sessions")
    .where("status", "==", "ON_BREAK")
    .where("expectedEndAt", "<=", now)
    .get();

  if (snap.empty) return;

  const batch = db.batch();
  for (let docSnap of snap.docs) {
    const b = docSnap.data();
    
    if (b.exceededAlertSent) continue;

    batch.update(docSnap.ref, { 
      exceeded: true, 
      exceededAlertSent: true 
    });
    
    batch.update(db.doc(`users/${b.uid}`), { 
      status: "BREAK_EXCEEDED" 
    });

    // ⚡ WHATSAPP ALERT: Send to Project Supervisors and Admins
    const contacts = await getManagementContacts(b.project);
    for (let phone of contacts) {
       await sendWhatsAppAlert(
         phone, 
         `🚨 OVERRUN ALERT: Agent ${b.agentName} (${b.employeeId}) has exceeded their allotted ${b.breakCategory} break time! Please check the dashboard.`
       );
    }
  }
  await batch.commit();
});

exports.autoCloseStaleShifts = onSchedule("every 1 hours", async () => {
  const killDate = Timestamp.fromMillis(Date.now() - 39600000);
  const staleShifts = await db.collection("shift_sessions")
    .where("shiftStart", "<=", killDate)
    .get();

  if (staleShifts.empty) return;

  const batch = db.batch();
  staleShifts.forEach((docSnap) => {
    const data = docSnap.data();
    batch.set(db.collection("shift_reports").doc(), {
      ...data,
      shiftEnd: Timestamp.fromMillis(data.shiftStart.toMillis() + 32400000),
      closedBy: "SYSTEM_CRON_AUTO_KILL",
    });
    batch.delete(docSnap.ref);
    batch.update(db.doc(`users/${data.uid}`), {
      activeShiftId: FieldValue.delete(),
      activeBreakId: FieldValue.delete(),
      workMode: FieldValue.delete(),
      workModeDate: FieldValue.delete(),
      status: "OFFLINE",
    });
  });

  await batch.commit();
});

// ============================================================================
// END & FLUSH ACTIONS
// ============================================================================

exports.endBreak = onCall(async (request) => {
  const uid = assertAuth(request);
  const user = await getUserDoc(uid);
  
  if (!user.activeBreakId) {
    throw new HttpsError("failed-precondition", "No active break.");
  }
  return endAndPromote(user.activeBreakId, null);
});

exports.adminForceEndBreak = onCall(async (request) => {
  const callerUid = assertAuth(request);
  const { targetUid } = request.data || {};
  const target = await getUserDoc(targetUid);
  
  if (!target.activeBreakId) {
    throw new HttpsError("failed-precondition", "Target not on break.");
  }
  return endAndPromote(target.activeBreakId, callerUid);
});

exports.cancelScheduledBreak = onCall(async (request) => {
  const callerUid = assertAuth(request);
  const { targetUid } = request.data || {};
  const uid = targetUid || callerUid;

  const user = await getUserDoc(uid);
  if (!user.activeBreakId) {
    throw new HttpsError("failed-precondition", "No pending request.");
  }
  
  const breakRef = db.doc(`break_sessions/${user.activeBreakId}`);
  const shiftRef = db.doc(`shift_sessions/${user.activeShiftId}`);
  let proj = user.project || "GENERAL";

  await db.runTransaction(async (tx) => {
    const [breakSnap, shiftSnap] = await Promise.all([tx.get(breakRef), tx.get(shiftRef)]);
    
    if (!breakSnap.exists) {
      throw new HttpsError("not-found", "Break missing.");
    }
    
    const b = breakSnap.data();
    if (!["AWAITING_SLOT", "APPROVED_SCHEDULED", "IN_QUEUE", "NOTIFIED_TO_START"].includes(b.status)) {
      throw new HttpsError("failed-precondition", "Cannot cancel active session.");
    }

    const refundMin = Number(b.requestedDurationMin) || 0;
    if (shiftSnap.exists && refundMin > 0) {
      tx.set(shiftRef, { 
        breakBudget: bumpBudget(shiftSnap.data().breakBudget, b.breakCategory, -refundMin) 
      }, { merge: true });
    }
    
    tx.set(breakRef, { status: "CANCELLED" }, { merge: true });
    tx.set(db.doc(`users/${uid}`), { 
      status: "AVAILABLE", 
      activeBreakId: FieldValue.delete() 
    }, { merge: true });
  });

  await processQueue(proj);
  return { ok: true };
});

exports.flushGhostQueue = onCall(async (request) => {
  const callerUid = assertAuth(request);
  const caller = await getUserDoc(callerUid);
  requireRole(caller, ["SUPERVISOR", "ADMIN", "SUPER_ADMIN"]);
  
  const { project } = request.data || {};
  const projFilter = (project || "GENERAL").trim().toUpperCase();

  const snap = await db.collection("break_sessions")
    .where("project", "==", projFilter)
    .where("status", "in", ["AWAITING_SLOT", "IN_QUEUE", "APPROVED_SCHEDULED", "ON_BREAK", "NOTIFIED_TO_START"])
    .get();

  if (snap.empty) {
    return { ok: true, cleared: 0 };
  }

  const batch = db.batch();
  let count = 0;

  snap.forEach(docSnap => {
    batch.delete(docSnap.ref);
    batch.update(db.doc(`users/${docSnap.data().uid}`), { 
      status: "AVAILABLE", 
      activeBreakId: FieldValue.delete() 
    });
    count++;
  });

  await batch.commit();
  return { ok: true, cleared: count };
});
