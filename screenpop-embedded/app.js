// ═══════════════════════════════════════════════════════════════════════════
// Screen Pop — Webex Calling Embedded Sidebar App (Static / GitHub Pages)
// Uses: EAF SDK v2 (CDN) + MockAPI (no backend needed)
// ═══════════════════════════════════════════════════════════════════════════

const MOCKAPI_URL = "https://67fad7058ee14a542628b6d7.mockapi.io/userDB";

// ─── State ─────────────────────────────────────────────────────────────────
let state = {
  callState: "idle",
  caller: null,
  demoMode: false,
  sdkReady: false,
  callHistory: [],
  callStartTime: null,
  timerInterval: null,
  logOpen: false,
  eafApp: null,
  currentPhone: null,       // track current call's phone for state transitions
};

let contactsCache = null;

// ─── Utility ───────────────────────────────────────────────────────────────
function logEvent(type, msg) {
  var ts = new Date().toLocaleTimeString("en-US", { hour12: false });
  var el = document.getElementById("logContainer");
  var entry = document.createElement("div");
  entry.className = "log-entry";
  entry.innerHTML =
    '<span class="log-time">' + ts + '</span>' +
    '<span class="log-type ' + type + '">' + type.toUpperCase() + '</span>' +
    '<span class="log-msg">' + escapeHtml(msg) + '</span>';
  el.prepend(entry);
  while (el.children.length > 100) el.removeChild(el.lastChild);
  console.log("[" + type.toUpperCase() + "] " + msg);
}

function escapeHtml(str) {
  var d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

function formatPhone(raw) {
  var digits = (raw || "").replace(/\D/g, "");
  var d = digits.length === 11 && digits[0] === "1" ? digits.slice(1) : digits;
  if (d.length === 10) return "(" + d.slice(0,3) + ") " + d.slice(3,6) + "-" + d.slice(6);
  return raw || "Unknown";
}

function normalizePhone(raw) {
  var digits = (raw || "").replace(/\D/g, "");
  if (digits.length === 11 && digits[0] === "1") return digits.slice(1);
  return digits;
}

function formatDuration(ms) {
  var secs = Math.floor(ms / 1000);
  var m = Math.floor(secs / 60).toString().padStart(2, "0");
  var s = (secs % 60).toString().padStart(2, "0");
  return m + ":" + s;
}

function getInitials(name) {
  if (!name) return "?";
  return name.split(" ").map(function(w) { return w[0]; }).join("").toUpperCase().slice(0, 2);
}

function getBadgeClass(accountType) {
  var t = (accountType || "").toLowerCase();
  if (t === "checking") return "badge-checking";
  if (t === "savings") return "badge-savings";
  if (t === "investment") return "badge-investment";
  if (t === "mortgage") return "badge-mortgage";
  return "badge-unknown";
}

// ─── Extract caller phone from v2 SDK call object ──────────────────────────
// v2 ICall: { id, state, callType, localParticipant, remoteParticipants[] }
// IParticipant: { callerID, name, isMuted }
function extractCallerPhone(call) {
  // v2 SDK: remoteParticipants[0].callerID is the primary source
  if (call.remoteParticipants && call.remoteParticipants.length > 0) {
    var rp = call.remoteParticipants[0];
    if (rp.callerID) return rp.callerID;
  }
  // Fallback: some older clients put it in callerID or callerId at top level
  if (call.callerID) return call.callerID;
  if (call.callerId) return call.callerId;
  // Last resort: call.id (v1 style)
  if (call.id) return call.id;
  return "unknown";
}

// ─── MockAPI CRM Lookup ────────────────────────────────────────────────────
async function fetchContacts() {
  if (contactsCache) return contactsCache;
  try {
    logEvent("crm", "Fetching contacts from MockAPI...");
    var res = await fetch(MOCKAPI_URL);
    if (!res.ok) throw new Error("HTTP " + res.status);
    contactsCache = await res.json();
    logEvent("crm", "Loaded " + contactsCache.length + " contacts");
    return contactsCache;
  } catch (err) {
    logEvent("error", "MockAPI fetch failed: " + err.message);
    return [];
  }
}

async function lookupCaller(phoneNumber) {
  var contacts = await fetchContacts();
  var normalized = normalizePhone(phoneNumber);
  if (!normalized) return null;
  var match = contacts.find(function(c) { return normalizePhone(c.phoneNumber) === normalized; });
  return match || null;
}

// ─── UI Rendering ──────────────────────────────────────────────────────────
function setStatus(label, cssClass) {
  var el = document.getElementById("statusBadge");
  el.textContent = label;
  el.className = "header-status " + cssClass;
}

function showView(viewId) {
  ["idleView", "ringingView", "callerView", "unknownView", "historyDetailView"].forEach(function(id) {
    document.getElementById(id).style.display = "none";
  });
  var showHistory = viewId === "idleView";
  document.getElementById("historySection").style.display = showHistory ? "" : "none";
  document.getElementById(viewId).style.display = "";
}

function renderCallerCard(caller, callSt) {
  var el = document.getElementById("callerView");
  var address = [caller.addressStreet, caller.addressCity, caller.addressState, caller.addressZip]
    .filter(Boolean).join(", ");

  var timerHtml = "";
  if (callSt === "active") {
    timerHtml = '<div class="call-timer-bar active"><span class="timer-label">Duration</span><span class="timer-value active" id="callTimer">00:00</span></div>';
  } else if (callSt === "ended") {
    var dur = state.callStartTime ? formatDuration(Date.now() - state.callStartTime) : "—";
    timerHtml = '<div class="call-timer-bar ended"><span class="timer-label">Duration</span><span class="timer-value ended">' + dur + '</span></div><div class="call-ended-note">Call ended — clearing in 30s</div>';
  }

  el.innerHTML =
    '<div class="caller-header">' +
      '<div class="caller-avatar">' + getInitials(caller.fullName) + '</div>' +
      '<div>' +
        '<div class="caller-name">' + escapeHtml(caller.fullName) + '</div>' +
        '<span class="caller-account-badge ' + getBadgeClass(caller.accountType) + '">' + escapeHtml(caller.accountType || "Unknown") + '</span>' +
      '</div>' +
    '</div>' +
    timerHtml +
    '<div class="info-grid">' +
      '<div class="info-cell"><div class="info-label">Phone</div><div class="info-value mono">' + formatPhone(caller.phoneNumber) + '</div></div>' +
      '<div class="info-cell"><div class="info-label">PIN</div><div class="info-value pin">' + escapeHtml(caller.pin || "—") + '</div></div>' +
      '<div class="info-cell full"><div class="info-label">Address</div><div class="info-value">' + escapeHtml(address || "—") + '</div></div>' +
      '<div class="info-cell"><div class="info-label">First Name</div><div class="info-value">' + escapeHtml(caller.firstName || "—") + '</div></div>' +
      '<div class="info-cell"><div class="info-label">Last Name</div><div class="info-value">' + escapeHtml(caller.lastName || "—") + '</div></div>' +
    '</div>';
  showView("callerView");
}

function renderHistory() {
  var list = document.getElementById("historyList");
  var count = document.getElementById("historyCount");
  count.textContent = state.callHistory.length;
  if (state.callHistory.length === 0) {
    list.innerHTML = '<li class="history-empty">No calls yet.</li>';
    return;
  }
  list.innerHTML = state.callHistory.map(function(h, i) {
    return '<li class="history-item" onclick="viewHistoryItem(' + i + ')">' +
      '<div class="history-avatar">' + getInitials(h.name) + '</div>' +
      '<div class="history-info"><div class="history-name">' + escapeHtml(h.name) + '</div><div class="history-time">' + h.time + '</div></div>' +
      '<div class="history-duration">' + h.duration + '</div></li>';
  }).join("");
}

function viewHistoryItem(index) {
  var h = state.callHistory[index];
  if (!h) return;
  var el = document.getElementById("historyDetailView");
  var address = [h.caller.addressStreet, h.caller.addressCity, h.caller.addressState, h.caller.addressZip]
    .filter(Boolean).join(", ");
  el.innerHTML =
    '<button class="history-detail-back" onclick="closeHistoryDetail()">← Back to Call History</button>' +
    '<div class="caller-header"><div class="caller-avatar">' + getInitials(h.name) + '</div><div><div class="caller-name">' + escapeHtml(h.name) + '</div><span class="caller-account-badge ' + getBadgeClass(h.caller.accountType) + '">' + escapeHtml(h.caller.accountType || "Unknown") + '</span></div></div>' +
    '<div class="call-timer-bar"><span class="timer-label">Duration</span><span class="timer-value">' + h.duration + '</span></div>' +
    '<div class="info-grid">' +
      '<div class="info-cell"><div class="info-label">Phone</div><div class="info-value mono">' + formatPhone(h.caller.phoneNumber) + '</div></div>' +
      '<div class="info-cell"><div class="info-label">PIN</div><div class="info-value pin">' + escapeHtml(h.caller.pin || "—") + '</div></div>' +
      '<div class="info-cell full"><div class="info-label">Address</div><div class="info-value">' + escapeHtml(address || "—") + '</div></div>' +
      '<div class="info-cell"><div class="info-label">Time</div><div class="info-value">' + h.time + '</div></div>' +
      '<div class="info-cell"><div class="info-label">Date</div><div class="info-value">' + h.date + '</div></div>' +
    '</div>';
  showView("historyDetailView");
}

function closeHistoryDetail() {
  showView("idleView");
  document.getElementById("historySection").style.display = "";
}

// ─── Call State Machine ────────────────────────────────────────────────────
// v2 SDK call states: Started, Connecting, Connected, Disconnecting,
//                     Disconnected, Rejected, Hold, Ended
async function handleCallEvent(call) {
  var callSt = (call.state || "").toString();
  var rawPhone = extractCallerPhone(call);

  logEvent("call", "State: " + callSt + " | Caller: " + rawPhone + " | Type: " + (call.callType || "n/a"));

  switch (callSt) {
    case "Started":
    case "Connecting": {
      state.callState = "ringing";
      state.caller = null;
      state.callStartTime = null;
      state.currentPhone = rawPhone;
      setStatus("Ringing", "status-ringing");

      document.getElementById("ringingNumber").textContent = formatPhone(rawPhone);
      showView("ringingView");

      // Show badge
      if (state.eafApp) {
        try {
          var sidebar = await state.eafApp.getSidebar();
          await sidebar.showBadge({ badgeType: "count", count: 1 });
        } catch (e) { logEvent("info", "Badge show: " + e); }
      }

      // CRM lookup
      var match = await lookupCaller(rawPhone);
      if (match) {
        state.caller = match;
        logEvent("crm", "Found: " + match.fullName + " (" + match.accountType + ")");
        renderCallerCard(match, "ringing");
        setStatus("Ringing", "status-ringing");
      } else {
        logEvent("warn", "No CRM match for: " + rawPhone);
        document.getElementById("unknownNumber").textContent = formatPhone(rawPhone);
        showView("unknownView");
      }
      break;
    }

    case "Connected": {
      state.callState = "active";
      state.callStartTime = Date.now();
      setStatus("Active", "status-active");
      logEvent("call", "Call connected");

      if (state.caller) {
        renderCallerCard(state.caller, "active");
        clearInterval(state.timerInterval);
        state.timerInterval = setInterval(function() {
          var el = document.getElementById("callTimer");
          if (el && state.callStartTime) {
            el.textContent = formatDuration(Date.now() - state.callStartTime);
          }
        }, 1000);
      }
      break;
    }

    case "Disconnecting":
      logEvent("call", "Call disconnecting...");
      break;

    case "Ended":
    case "Disconnected":
    case "Rejected": {
      state.callState = "ended";
      setStatus("Ended", "status-ended");
      logEvent("call", "Call " + callSt.toLowerCase());
      clearInterval(state.timerInterval);

      // Clear badge
      if (state.eafApp) {
        try {
          var sidebar = await state.eafApp.getSidebar();
          await sidebar.clearBadge();
        } catch (e) { /* ignore */ }
      }

      // Save to history
      if (state.caller) {
        var duration = state.callStartTime ? formatDuration(Date.now() - state.callStartTime) : "0:00";
        var now = new Date();
        state.callHistory.unshift({
          name: state.caller.fullName,
          duration: duration,
          time: now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
          date: now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
          caller: Object.assign({}, state.caller),
        });
        if (state.callHistory.length > 50) state.callHistory.pop();
        renderHistory();
        renderCallerCard(state.caller, "ended");
      }

      setTimeout(function() {
        if (state.callState === "ended") resetToIdle();
      }, 30000);
      break;
    }

    case "Hold":
      logEvent("call", "Call on hold");
      break;

    default:
      logEvent("info", "Unhandled call state: " + callSt);
  }
}

function resetToIdle() {
  state.callState = "idle";
  state.caller = null;
  state.callStartTime = null;
  state.currentPhone = null;
  clearInterval(state.timerInterval);
  setStatus("Ready", "status-ready");
  showView("idleView");
  document.getElementById("historySection").style.display = "";
  renderHistory();
  var btn = document.getElementById("demoCallBtn");
  if (btn) btn.disabled = false;
}

// ─── Demo Mode ─────────────────────────────────────────────────────────────
async function simulateCall() {
  var btn = document.getElementById("demoCallBtn");
  btn.disabled = true;
  var contacts = await fetchContacts();
  if (contacts.length === 0) {
    logEvent("error", "No contacts loaded");
    btn.disabled = false;
    return;
  }
  var contact = contacts[Math.floor(Math.random() * contacts.length)];
  logEvent("demo", "Simulating call from " + contact.fullName);

  // Simulate v2 SDK call object shape
  await handleCallEvent({
    state: "Started",
    callType: "Received",
    id: "demo-" + Date.now(),
    remoteParticipants: [{ callerID: contact.phoneNumber, name: contact.fullName }],
    localParticipant: { callerID: "+15550000000", name: "Demo Agent" },
  });

  setTimeout(function() {
    handleCallEvent({
      state: "Connected",
      callType: "Received",
      id: "demo-" + Date.now(),
      remoteParticipants: [{ callerID: contact.phoneNumber, name: contact.fullName }],
      localParticipant: { callerID: "+15550000000", name: "Demo Agent" },
    });
  }, 2000);

  var duration = 8000 + Math.random() * 7000;
  setTimeout(function() {
    handleCallEvent({
      state: "Ended",
      callType: "Received",
      id: "demo-" + Date.now(),
      remoteParticipants: [{ callerID: contact.phoneNumber, name: contact.fullName }],
      localParticipant: { callerID: "+15550000000", name: "Demo Agent" },
    });
  }, 2000 + duration);
}

async function simulateUnknownCall() {
  logEvent("demo", "Simulating unknown caller");
  var fakeNumber = "+1555" + Math.floor(1000000 + Math.random() * 9000000);
  await handleCallEvent({
    state: "Started",
    callType: "Received",
    id: "demo-" + Date.now(),
    remoteParticipants: [{ callerID: fakeNumber, name: null }],
    localParticipant: { callerID: "+15550000000", name: "Demo Agent" },
  });
  setTimeout(function() {
    handleCallEvent({ state: "Connected", remoteParticipants: [{ callerID: fakeNumber }], localParticipant: {} });
  }, 2000);
  setTimeout(function() {
    handleCallEvent({ state: "Ended", remoteParticipants: [{ callerID: fakeNumber }], localParticipant: {} });
  }, 7000);
}

// ─── Log Toggle ────────────────────────────────────────────────────────────
function toggleLog() {
  state.logOpen = !state.logOpen;
  document.getElementById("logContainer").style.display = state.logOpen ? "" : "none";
  document.getElementById("logChevron").className = "log-chevron" + (state.logOpen ? " open" : "");
}

// ─── Initialization ────────────────────────────────────────────────────────
async function init() {
  logEvent("info", "Screen Pop initializing...");
  fetchContacts();

  try {
    // v2 SDK: window.webex.Application (lowercase webex)
    // Also check window.Webex.Application (v1 fallback, though shouldn't hit)
    var AppClass = null;
    if (window.webex && window.webex.Application) {
      AppClass = window.webex.Application;
      logEvent("info", "Found EAF SDK v2 (window.webex.Application)");
    } else if (window.Webex && window.Webex.Application) {
      AppClass = window.Webex.Application;
      logEvent("info", "Found EAF SDK v1 (window.Webex.Application)");
    } else {
      throw new Error("EAF SDK not available — not inside Webex");
    }

    var app = new AppClass();
    state.eafApp = app;

    await app.onReady();
    state.sdkReady = true;
    logEvent("info", "EAF SDK ready — app initialized");

    // Log some context
    try {
      logEvent("info", "Device: " + (app.deviceType || "unknown"));
      logEvent("info", "Display: " + (app.displayContext || "unknown"));
      if (app.application && app.application.states && app.application.states.user) {
        logEvent("info", "User: " + (app.application.states.user.displayName || "unknown"));
      }
    } catch (e) { /* non-critical */ }

    await app.listen();
    logEvent("info", "Listening for sidebar call events");

    setStatus("Ready", "status-ready");
    logEvent("info", "Screen pop active — waiting for calls");

    // ─── Listen for call state changes (v2 event) ─────────────
    app.on("sidebar:callStateChanged", function(call) {
      logEvent("call", "EVENT sidebar:callStateChanged fired");
      logEvent("call", "Raw call object: " + JSON.stringify(call));
      handleCallEvent(call);
    });

    app.on("application:viewStateChanged", function(vs) {
      logEvent("info", "View state: " + vs);
    });

    // ─── Also try polling via getSidebar().getCalls() ─────────
    try {
      var sidebar = await app.getSidebar();
      logEvent("info", "getSidebar() succeeded — polling for active calls");

      var pollCalls = async function() {
        try {
          var result = await sidebar.getCalls();
          var callList = result && result.calls ? result.calls : (Array.isArray(result) ? result : []);
          if (callList.length > 0) {
            logEvent("call", "Poll: found " + callList.length + " active call(s)");
            callList.forEach(function(c) {
              logEvent("call", "Poll call: " + JSON.stringify(c));
              handleCallEvent(c);
            });
          }
        } catch (e) {
          if (!pollCalls._logged) {
            logEvent("info", "getCalls(): " + e);
            pollCalls._logged = true;
          }
        }
      };

      setInterval(pollCalls, 3000);
      pollCalls();
    } catch (e) {
      logEvent("info", "getSidebar() not available: " + e);
    }

  } catch (err) {
    logEvent("info", "Not inside Webex: " + err.message);
    logEvent("demo", "Enabling demo mode — use buttons to simulate calls");
    state.demoMode = true;
    document.getElementById("demoBar").style.display = "";
    setStatus("Demo", "status-ready");
  }

  renderHistory();
}

init();
