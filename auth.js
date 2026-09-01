import { auth, db } from "./firebase-config.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  doc,
  setDoc,
  getDoc,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

export async function signUp(email, password, displayName) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await setDoc(doc(db, "users", cred.user.uid), {
    displayName,
    email,
    role: "teacher", // everyone starts as teacher; an admin can promote later
    createdAt: new Date().toISOString(),
  });
  return cred.user;
}

export async function logIn(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

export function logOut() {
  return signOut(auth);
}

export async function getProfile(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? snap.data() : null;
}

const ROLE_LABEL = {
  teacher: "Teacher",
  mtss_team: "MTSS Team",
  admin: "Admin",
};

/**
 * Guards a page: redirects to index.html if not signed in,
 * or to submit-concern.html if signed in but not in allowedRoles.
 * Calls onReady(user, profile) once both are resolved.
 */
export function requireRole(allowedRoles, onReady) {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = "index.html";
      return;
    }
    const profile = await getProfile(user.uid);
    if (!profile) {
      window.location.href = "index.html";
      return;
    }
    if (!allowedRoles.includes(profile.role)) {
      window.location.href = "submit-concern.html";
      return;
    }
    onReady(user, profile);
  });
}

export function roleLabel(role) {
  return ROLE_LABEL[role] || role;
}

export function initSidebarWho(profile) {
  const el = document.getElementById("who");
  if (!el) return;
  el.innerHTML = `
    <div>${profile.displayName || profile.email}</div>
    <div>${roleLabel(profile.role)}</div>
    <button class="secondary" id="signout-btn">Sign out</button>
  `;
  document.getElementById("signout-btn").addEventListener("click", async () => {
    await logOut();
    window.location.href = "index.html";
  });
}
