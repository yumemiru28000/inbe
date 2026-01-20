import { auth, db } from "./firebase.js";
import { signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-auth.js";
import { ref, onValue, set, serverTimestamp, onDisconnect } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-database.js";
import { PATHS } from "./paths.js";
import { bindLobby } from "./lobby.js";
import { bindWatchAndGameCanvas } from "./watch.js";

const el = {
  me: document.querySelector("#me"),
  statusLine: document.querySelector("#statusLine"),
  playHint: document.querySelector("#playHint"),
  sessionDebug: document.querySelector("#sessionDebug"),
  leaderboard: document.querySelector("#leaderboard"),
  nameInput: document.querySelector("#nameInput"),
  saveNameBtn: document.querySelector("#saveNameBtn"),
};

async function ensureAuth() {
  await signInAnonymously(auth);
}

function bindPresence(uid) {
  const presRef = ref(db, PATHS.presence(uid));
  set(presRef, { online: true, lastSeen: serverTimestamp() });
  onDisconnect(presRef).set({ online: false, lastSeen: serverTimestamp() });
}

function bindLeaderboard() {
  const lbRef = ref(db, PATHS.leaderboardTop);
  onValue(lbRef, (snap) => {
    const data = snap.val() || [];
    el.leaderboard.innerHTML = "";
    if (!Array.isArray(data) || data.length === 0) {
      el.leaderboard.textContent = "まだ記録がありません";
      return;
    }
    const ol = document.createElement("ol");
    ol.style.margin = "0 0 0 18px";
    for (const row of data) {
      const li = document.createElement("li");
      li.textContent = `${row.name ?? "?"} - ${row.score ?? 0}`;
      ol.appendChild(li);
    }
    el.leaderboard.appendChild(ol);
  });
}

function bindName(uid) {
  const nameRef = ref(db, PATHS.names(uid));
  onValue(nameRef, (snap) => {
    const v = snap.val();
    if (typeof v === "string") el.nameInput.value = v;
  });
  el.saveNameBtn.onclick = async () => {
    const v = el.nameInput.value.trim().slice(0, 20);
    await set(nameRef, v || "no-name");
  };
}

onAuthStateChanged(auth, async (user) => {
  if (!user) return;
  const uid = user.uid;
  el.me.textContent = `uid: ${uid.slice(0, 8)}…`;

  bindPresence(uid);
  bindName(uid);
  bindLeaderboard();

  // ロビー機能
  bindLobby({ uid });

  // 観戦＆ゲーム描画（playing中は常に描画できるように）
  bindWatchAndGameCanvas({ uid });

  // セッションデバッグ表示
  onValue(ref(db, PATHS.sessionCurrent), (snap) => {
    el.sessionDebug.textContent = JSON.stringify(snap.val(), null, 2);
  });
});

ensureAuth();
