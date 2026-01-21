import { db } from "./firebase.js";
import {
  ref, onValue, get, set, update, remove,
  runTransaction, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.8.0/firebase-database.js";
import { PATHS } from "./paths.js";

const ui = {
  soloBtn: document.querySelector("#soloBtn"),
  multiBtn: document.querySelector("#multiBtn"),
  watchBtn: document.querySelector("#watchBtn"),
  readyBtn: document.querySelector("#readyBtn"),
  retireBtn: document.querySelector("#retireBtn"),
  leaveBtn: document.querySelector("#leaveBtn"),
  playHint: document.querySelector("#playHint"),
  statusLine: document.querySelector("#statusLine"),
  screenTitle: document.querySelector("#screenTitle"),
  screenSub: document.querySelector("#screenSub"),
  ann: document.querySelector("#ann"),
  annTitle: document.querySelector("#annTitle"),
  annBody: document.querySelector("#annBody"),
};

function uuidShort() {
  return Math.random().toString(16).slice(2, 10);
}

function showAnn(title, body) {
  ui.annTitle.textContent = title;
  ui.annBody.textContent = body;
  ui.ann.style.display = "flex";
}
function hideAnn() {
  ui.ann.style.display = "none";
}

export function bindLobby({ uid, getMyName }) {
  const sessionRef = ref(db, PATHS.sessionCurrent);

  // UI状態更新
  onValue(sessionRef, async (snap) => {
    const s = snap.val() || { state: "idle" };
    const state = s.state ?? "idle";

    // 名前必須：未保存ならプレイ系を無効化
    const myName = await getMyName();
    const nameOk = !!myName;

    const busy = state !== "idle";
    ui.soloBtn.disabled = !nameOk || busy;
    ui.multiBtn.disabled = !nameOk || busy;

    if (!nameOk) {
      ui.playHint.textContent = "名前を保存してください（保存後にプレイ選択できます）";
    } else if (!busy) {
      ui.playHint.textContent = "プレイ可能です（ソロ / マルチ）";
    } else {
      ui.playHint.textContent = "現在他の方がプレイ中です。観戦のみ可能です。";
    }

    ui.statusLine.textContent = `${state}${s.mode ? ` (${s.mode})` : ""}`;

    // playing中は画面をプレイ専用に
    document.body.classList.toggle("playing", state === "playing");

    // ボタン表示制御
    const isPlayer = s.p1Uid === uid || s.p2Uid === uid;
    const isHost = s.hostUid === uid;

    ui.readyBtn.style.display = (isPlayer && state === "preparing") ? "" : "none";
    ui.leaveBtn.style.display = (isPlayer && (state === "recruiting" || state === "preparing")) ? "" : "none";
    ui.retireBtn.style.display = (isHost && state === "playing" && s.mode === "multi") ? "" : "none";

    // スクリーン表示文言
    if (state === "idle") {
      ui.screenTitle.textContent = "ロビー";
      ui.screenSub.textContent = "";
      hideAnn();
    } else if (state === "recruiting") {
      ui.screenTitle.textContent = "準備中";
      ui.screenSub.textContent = "マルチ参加者を募集しています";
      hideAnn();
    } else if (state === "preparing") {
      ui.screenTitle.textContent = "準備中";
      ui.screenSub.textContent = "準備完了を押すと開始します";
      hideAnn();
    } else if (state === "playing") {
      ui.screenTitle.textContent = "プレイ中";
      ui.screenSub.textContent = "A/D移動・Space発射";
      hideAnn();
    } else if (state === "resetting") {
      ui.screenTitle.textContent = "リセット中";
      ui.screenSub.textContent = "";
      showAnn("データをリセットします", "全員がロビーに戻るまで待ってください");
    } else if (state === "finished") {
      ui.screenTitle.textContent = "終了";
      ui.screenSub.textContent = "ロビーに戻ります";
      showAnn("ゲーム終了", "ロビーに戻っています…");
    }
  });

  ui.watchBtn.onclick = async () => {
    // 観戦はUI的に「観戦選択」だけ。playing時は自動でプレイ画面になる。
    const s = (await get(sessionRef)).val();
    if (s?.state === "playing") {
      await set(ref(db, PATHS.sessionClientState(uid)), "watching");
    }
  };

  // ソロ開始
  ui.soloBtn.onclick = async () => {
    const s = (await get(sessionRef)).val();
    if (s?.state && s.state !== "idle") return;

    const sessionId = `sess_${Date.now()}_${uuidShort()}`;
    await set(sessionRef, {
      sessionId,
      state: "preparing",
      mode: "solo",
      hostUid: uid,
      p1Uid: uid,
      p2Uid: null,
      recruiting: null,
      ready: { [uid]: false },
      clientState: { [uid]: "preparing" },
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  };

  // マルチ募集
  ui.multiBtn.onclick = async () => {
    const s = (await get(sessionRef)).val();
    if (s?.state && s.state !== "idle") return;

    const sessionId = `sess_${Date.now()}_${uuidShort()}`;
    const promptId = `prompt_${Date.now()}_${uuidShort()}`;

    await set(sessionRef, {
      sessionId,
      state: "recruiting",
      mode: "multi",
      hostUid: uid,
      p1Uid: uid,
      p2Uid: null,
      recruiting: { promptId, joinerUid: null },
      ready: { [uid]: false },
      clientState: { [uid]: "preparing" },
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  };

  // 準備完了
  ui.readyBtn.onclick = async () => {
    await set(ref(db, PATHS.sessionReady(uid)), true);
    await set(ref(db, PATHS.sessionClientState(uid)), "preparing");

    // hostだけが開始判定
    const s = (await get(sessionRef)).val();
    if (!s || s.hostUid !== uid) return;
    if (s.state !== "preparing") return;

    const p1 = s.p1Uid;
    const p2 = s.p2Uid;
    const ready = s.ready || {};
    const ok1 = !!ready?.[p1];
    const ok2 = (s.mode === "solo") ? true : !!ready?.[p2];

    if (ok1 && ok2) {
      await update(sessionRef, {
        state: "playing",
        updatedAt: serverTimestamp(),
      });
      await set(ref(db, PATHS.sessionClientState(uid)), "playing");
    }
  };

  // 離脱（簡易：セッション破棄）
  ui.leaveBtn.onclick = async () => {
    const s = (await get(sessionRef)).val();
    if (!s) return;
    const isPlayer = s.p1Uid === uid || s.p2Uid === uid;
    if (!isPlayer) return;
    await remove(sessionRef);
  };

  // ホストの「ゲームリアタイア」＝強制終了
  ui.retireBtn.onclick = async () => {
    const s = (await get(sessionRef)).val();
    if (!s || s.hostUid !== uid) return;
    if (s.state !== "playing") return;
    await update(sessionRef, { state: "finished", finishedReason: "retire", updatedAt: serverTimestamp() });
  };

  // マルチ早押し参加（参加者以外にconfirm）
  onValue(sessionRef, async (snap) => {
    const s = snap.val();
    if (!s) return;
    if (s.state !== "recruiting" || s.mode !== "multi") return;

    const isAlreadyPlayer = (s.p1Uid === uid || s.p2Uid === uid);
    if (isAlreadyPlayer) return;
    if (s.recruiting?.joinerUid) return;

    const ok = window.confirm("マルチに参加しますか？（早押し）");
    if (!ok) return;

    const joinerRef = ref(db, PATHS.sessionRecruitingJoiner);
    const tx = await runTransaction(joinerRef, (cur) => (cur ? undefined : uid));
    if (!tx.committed) {
      alert("間に合いませんでした");
      return;
    }

    const sessionNow = (await get(sessionRef)).val();
    if (!sessionNow || sessionNow.state !== "recruiting") return;

    await update(sessionRef, {
      state: "preparing",
      p2Uid: uid,
      ready: { ...(sessionNow.ready || {}), [uid]: false },
      clientState: { ...(sessionNow.clientState || {}), [uid]: "preparing" },
      updatedAt: serverTimestamp(),
    });
  });
}
