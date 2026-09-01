import { db } from "./firebase-config.js";
import { requireRole, initSidebarWho } from "./auth.js";
import {
  collection, addDoc, doc, updateDoc, arrayUnion,
  query, where, onSnapshot, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

let currentUser = null;
let currentProfile = null;

requireRole(["teacher", "mtss_team", "admin"], (user, profile) => {
  currentUser = user;
  currentProfile = profile;
  initSidebarWho(profile);
  if (profile.role === "mtss_team" || profile.role === "admin") {
    document.getElementById("nav-dashboard").style.display = "block";
  }
  if (profile.role === "admin") {
    document.getElementById("nav-reports").style.display = "block";
  }
  listenToMySubmissions(user.uid);
});

// ── Intervention rows ────────────────────────────────────────
const listEl = document.getElementById("intervention-list");
const template = document.getElementById("intervention-template");

function addInterventionRow() {
  const node = template.content.cloneNode(true);
  node.querySelector(".remove-iv").addEventListener("click", (e) => {
    e.target.closest(".intervention-item").remove();
  });
  listEl.appendChild(node);
}
document.getElementById("add-intervention").addEventListener("click", addInterventionRow);
addInterventionRow(); // start with one

// ── Submit form ──────────────────────────────────────────────
document.getElementById("concern-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errEl = document.getElementById("submit-error");
  errEl.textContent = "";

  const areas = Array.from(document.querySelectorAll("#area-group input:checked")).map(i => i.value);
  const interventionEls = document.querySelectorAll("#intervention-list .intervention-item");
  const interventions = Array.from(interventionEls).map(el => ({
    description: el.querySelector(".iv-description").value.trim(),
    frequency: el.querySelector(".iv-frequency").value.trim(),
    effectiveness: el.querySelector(".iv-effectiveness").value,
    loggedAt: new Date().toISOString(),
  })).filter(iv => iv.description);

  if (interventions.length === 0) {
    errEl.textContent = "Add at least one intervention you've tried.";
    return;
  }
  if (areas.length === 0) {
    errEl.textContent = "Select at least one area of concern.";
    return;
  }

  const submitBtn = document.getElementById("submit-btn");
  submitBtn.disabled = true;

  try {
    await addDoc(collection(db, "concerns"), {
      studentName: document.getElementById("studentName").value.trim(),
      studentGrade: document.getElementById("studentGrade").value.trim(),
      className: document.getElementById("className").value.trim(),
      areasOfConcern: areas,
      description: document.getElementById("description").value.trim(),
      tier: Number(document.getElementById("tier").value),
      interventions,
      status: "new",
      mtssNotes: [],
      teacherUid: currentUser.uid,
      teacherName: currentProfile.displayName || currentProfile.email,
      dateSubmitted: serverTimestamp(),
      lastUpdated: serverTimestamp(),
    });
    e.target.reset();
    listEl.innerHTML = "";
    addInterventionRow();
  } catch (err) {
    errEl.textContent = "Couldn't submit — please try again.";
    console.error(err);
  } finally {
    submitBtn.disabled = false;
  }
});

// ── My submissions ───────────────────────────────────────────
const myListEl = document.getElementById("my-list");

function listenToMySubmissions(uid) {
  const q = query(collection(db, "concerns"), where("teacherUid", "==", uid));
  onSnapshot(q, (snap) => {
    if (snap.empty) {
      myListEl.innerHTML = `<div class="empty-state">No submissions yet — the form above will show up here once you submit one.</div>`;
      return;
    }
    const docs = snap.docs.slice().sort((a, b) => {
      const at = a.data().dateSubmitted?.toMillis?.() || 0;
      const bt = b.data().dateSubmitted?.toMillis?.() || 0;
      return bt - at;
    });
    myListEl.innerHTML = "";
    docs.forEach(d => myListEl.appendChild(renderRow(d.id, d.data())));
  });
}

function renderRow(id, c) {
  const row = document.createElement("div");
  row.className = "concern-row";
  row.innerHTML = `
    <div class="tier-badge tier-${c.tier}">Tier ${c.tier}</div>
    <div>
      <div class="who">${escapeHtml(c.studentName)} <span class="meta">· ${escapeHtml(c.studentGrade)}</span></div>
      <div class="meta">${escapeHtml((c.areasOfConcern || []).join(", "))}</div>
    </div>
    <div class="spacer"></div>
    <span class="status-pill status-${c.status}">${statusLabel(c.status)}</span>
  `;
  row.addEventListener("click", () => openDetail(id, c));
  return row;
}

function statusLabel(status) {
  return {
    new: "New",
    under_review: "Under review",
    monitoring: "Monitoring",
    referred_speced: "Referred — Special Ed",
    closed: "Closed",
  }[status] || status;
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str ?? "";
  return d.innerHTML;
}

// ── Detail / add-followup panel ─────────────────────────────
let detailPanel = null;

function openDetail(id, c) {
  if (detailPanel) detailPanel.remove();
  detailPanel = document.createElement("div");
  detailPanel.className = "card";
  detailPanel.style.marginTop = "16px";
  detailPanel.innerHTML = `
    <h2>${escapeHtml(c.studentName)} <span class="tier-badge tier-${c.tier}" style="margin-left:8px;">Tier ${c.tier}</span></h2>
    <p class="meta hint">${escapeHtml(c.className)} · Status: ${statusLabel(c.status)}</p>
    <p>${escapeHtml(c.description)}</p>
    <h3>Interventions logged</h3>
    <div id="detail-ivs"></div>
    <button type="button" class="secondary" id="add-followup">+ Log a new intervention update</button>
    <div id="followup-form" style="display:none;margin-top:14px;"></div>
    <h3 style="margin-top:20px;">MTSS team notes</h3>
    <div id="detail-notes"></div>
    <button type="button" class="secondary" id="close-detail" style="margin-top:16px;">Close</button>
  `;
  document.getElementById("my-list").after(detailPanel);
  detailPanel.scrollIntoView({ behavior: "smooth", block: "start" });

  const ivWrap = detailPanel.querySelector("#detail-ivs");
  (c.interventions || []).forEach(iv => {
    const el = document.createElement("div");
    el.className = "intervention-item";
    el.innerHTML = `<strong>${escapeHtml(iv.description)}</strong> <span class="hint">(${escapeHtml(iv.frequency || "")})</span><br>
      <span class="status-pill">${effLabel(iv.effectiveness)}</span>`;
    ivWrap.appendChild(el);
  });

  const notesWrap = detailPanel.querySelector("#detail-notes");
  if (!c.mtssNotes || c.mtssNotes.length === 0) {
    notesWrap.innerHTML = `<p class="hint">No notes yet.</p>`;
  } else {
    c.mtssNotes.forEach(n => {
      const el = document.createElement("p");
      el.innerHTML = `<strong>${escapeHtml(n.authorName)}</strong> <span class="hint">${new Date(n.date).toLocaleDateString()}</span><br>${escapeHtml(n.note)}`;
      notesWrap.appendChild(el);
    });
  }

  detailPanel.querySelector("#close-detail").addEventListener("click", () => {
    detailPanel.remove();
    detailPanel = null;
  });

  detailPanel.querySelector("#add-followup").addEventListener("click", () => {
    const formWrap = detailPanel.querySelector("#followup-form");
    formWrap.style.display = "block";
    formWrap.innerHTML = `
      <div class="field-row">
        <div class="field"><label>Intervention</label><input id="fu-desc" /></div>
        <div class="field"><label>Frequency</label><input id="fu-freq" /></div>
      </div>
      <div class="field">
        <label>Result</label>
        <select id="fu-eff">
          <option value="in_progress">Still in progress</option>
          <option value="effective">Working</option>
          <option value="partial">Partially working</option>
          <option value="not_effective">Not working</option>
        </select>
      </div>
      <button type="button" id="fu-save">Save update</button>
    `;
    formWrap.querySelector("#fu-save").addEventListener("click", async () => {
      const desc = formWrap.querySelector("#fu-desc").value.trim();
      if (!desc) return;
      await updateDoc(doc(db, "concerns", id), {
        interventions: arrayUnion({
          description: desc,
          frequency: formWrap.querySelector("#fu-freq").value.trim(),
          effectiveness: formWrap.querySelector("#fu-eff").value,
          loggedAt: new Date().toISOString(),
        }),
        lastUpdated: serverTimestamp(),
      });
      detailPanel.remove();
      detailPanel = null;
    });
  });
}

function effLabel(v) {
  return { effective: "Working", partial: "Partially working", not_effective: "Not working", in_progress: "In progress" }[v] || v;
}
