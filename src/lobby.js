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
  leaveBtn: document.querySelector("#leaveBtn"),
  playHint: document.querySelector("#playHint"),
  statusLine: document.querySelector("#statusLine"),
  screenTitle: document.querySelector("#screenTitle"),
  screenSub: document.querySelector("#screenSub"),
};

function uuidShort() {
  return Math.random().toString(16).slice(2, 10);
}

export function bindLobby({ uid }) {
  const sessionRef = ref(db, PATHS.sessionCurrent);

  // UI状態更新
  onValue(sessionRef, (snap) => {
    const s = snap.val() || { state: "idle" };
    const state = s.state ?? "idle";

    const busy = state !== "idle";
    ui.soloBtn.disabled = busy;
    ui.multiBtn.disabled = busy;

    if (!busy) {
      ui.playHint.textContent = "プレイ可能です（ソロ / マルチ）";
      ui.statusLine.textContent = "idle";
    } else {
      ui.playHint.textContent = "現在他の方がプレイ中です。観戦のみ可能です。";
      ui.statusLine.textContent = `${state}${s.mode ? ` (${s.mode})` : ""}`;
    }

    // 準備画面でのボタン表示制御（参加者だけ）
    const isPlayer = s.p1Uid === uid || s.p2Uid === uid;
    const isPreparing = state === "preparing" || state === "recruiting";
    ui.readyBtn.style.display = (isPlayer && state === "preparing") ? "" : "none";
    ui.leaveBtn.style.display = (isPlayer && (state === "recruiting" || state === "preparing")) ? "" : "none";

    if (state === "idle") {
      ui.screenTitle.textContent = "ロビー";
      ui.screenSub.textContent = "";
    } else if (state === "recruiting") {
      ui.screenTitle.textContent = "準備中";
      ui.screenSub.textContent = "マルチ参加者を募集しています";
    } else if (state === "preparing") {
      ui.screenTitle.textContent = "準備中";
      ui.screenSub.textContent = "準備完了を押すと開始します";
    } else if (state === "playing") {
      ui.screenTitle.textContent = "プレイ中";
      ui.screenSub.textContent = "観戦可能";
    } else if (state === "finished") {
      ui.screenTitle.textContent = "終了";
      ui.screenSub.textContent = "結果処理中";
    }
  });

  // 観戦ボタンは常に押せる（idleでも押せるが何も映らない）
  ui.watchBtn.onclick = () => {
    // watch.js側でsession/gameを購読してるので、ここはUI上の意味だけ。
    ui.screenTitle.textContent = "観戦";
    ui.screenSub.textContent = "プレイ中なら画面が表示されます";
  };

  // ソロ開始（排他：idleのときのみ）
  ui.soloBtn.onclick = async () => {
    const sSnap = await get(sessionRef);
    const s = sSnap.val();
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
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  };

  // マルチ募集
  ui.multiBtn.onclick = async () => {
    const sSnap = await get(sessionRef);
    const s = sSnap.val();
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
      recruiting: {
        promptId,
        joinerUid: null,
      },
      ready: { [uid]: false },
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    // 募集ポップアップは全員に出す必要があるが、
    // 今回は簡易に「状態監視して、プレイヤー以外に参加確認を出す」方式を watch.js側で実装している。
  };

  // 準備完了
  ui.readyBtn.onclick = async () => {
    await set(ref(db, PATHS.sessionReady(uid)), true);

    // hostだけが開始判定を行う
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
    }
  };

  // 離脱（recruiting/preparingのみ）
  ui.leaveBtn.onclick = async () => {
    const s = (await get(sessionRef)).val();
    if (!s) return;
    const isPlayer = s.p1Uid === uid || s.p2Uid === uid;
    if (!isPlayer) return;

    // ホストが抜けるならセッション終了してidleに戻す（簡易）
    if (s.hostUid === uid) {
      await remove(sessionRef);
    } else {
      // p2が抜けるだけならp2をnullにして募集し直し等も可能だが、今回は簡易にセッション破棄
      await remove(sessionRef);
    }
  };

  // -------- マルチ早押し参加（参加者じゃない人が recruiting を見たら OK/NG を出す）--------
  // 参加確認UIは簡易に window.confirm で実装（後であなたのUIに置き換え可）
  onValue(sessionRef, async (snap) => {
    const s = snap.val();
    if (!s) return;
    if (s.state !== "recruiting") return;
    if (s.mode !== "multi") return;

    const isAlreadyPlayer = (s.p1Uid === uid || s.p2Uid === uid);
    if (isAlreadyPlayer) return;

    // joinerが決まってるなら何もしない
    if (s.recruiting?.joinerUid) return;

    // 参加ポップアップ
    const ok = window.confirm("マルチに参加しますか？（早押し）");
    if (!ok) return;

    // transactionで最速参加を確定
    const joinerRef = ref(db, PATHS.sessionRecruitingJoiner);
    const tx = await runTransaction(joinerRef, (cur) => {
      if (cur) return; // 既に誰かが確定
      return uid;
    });

    if (!tx.committed) {
      alert("間に合いませんでした");
      return;
    }

    // 自分がjoinerになったので p2Uid をセッ���し preparingへ
    const sessionNow = (await get(sessionRef)).val();
    if (!sessionNow || sessionNow.state !== "recruiting") return;

    await update(sessionRef, {
      state: "preparing",
      p2Uid: uid,
      ready: { ...(sessionNow.ready || {}), [uid]: false },
      updatedAt: serverTimestamp(),
    });
  });
}
