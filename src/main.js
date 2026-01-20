import { auth, db } from "./firebase.js";
import { signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-auth.js";
import { ref, onValue, set, get, serverTimestamp, onDisconnect } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-database.js";
import { PATHS } from "./paths.js";
import { bindLobby } from "./lobby.js";
import { bindWatchAndGameCanvas } from "./watch.js";
import { bindInputSender } from "./input.js";

const el = {
  me: document.querySelector("#me"),
  statusLine: document.querySelector("#statusLine"),
  playHint: document.querySelector("#playHint"),
  sessionDebug: document.querySelector("#sessionDebug"),
  leaderboard: document.querySelector("#leaderboard"),
  nameInput: document.querySelector("#nameInput"),
  saveNameBtn: document.querySelector("#saveNameBtn"),
  nameHint: document.querySelector("#nameHint"),
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

async function getMyName(uid) {
  const snap = await get(ref(db, PATHS.names(uid)));
  const v = snap.val();
  return (typeof v === "string" && v.trim()) ? v.trim() : "";
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

function bindSessionDebug() {
  onValue(ref(db, PATHS.sessionCurrent), (snap) => {
    el.sessionDebug.textContent = JSON.stringify(snap.val(), null, 2);
  });
}

onAuthStateChanged(auth, async (user) => {
  if (!user) return;
  const uid = user.uid;
  el.me.textContent = `uid: ${uid.slice(0, 8)}…`;

  bindPresence(uid);
  bindName(uid);
  bindLeaderboard();
  bindSessionDebug();

  // 名前必須の案内
  const myName = await getMyName(uid);
  el.nameHint.textContent = myName ? `保存済み: ${myName}` : "名前を保存するとロビー操作できます";

  // clientState 初期
  await set(ref(db, PATHS.sessionClientState(uid)), "name");
  onDisconnect(ref(db, PATHS.sessionClientState(uid))).set("offline");

  // 入力送信（playingの時だけ有効化するのは input.js 側で制御）
  bindInputSender({ uid });

  // ロビー機能
  bindLobby({ uid, getMyName: () => getMyName(uid) });

  // 観戦＆描画
  bindWatchAndGameCanvas({ uid });
});

ensureAuth();
