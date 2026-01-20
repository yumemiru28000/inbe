import { db } from "./firebase.js";
import { ref, set, update, get, serverTimestamp, remove } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-database.js";
import { PATHS } from "./paths.js";
import { createHostGameSim } from "./sim.js";

let running = false;
let stopFn = null;

export function startHostLoopIfNeeded({ uid, session }) {
  const isHost = session?.hostUid === uid;
  const isPlaying = session?.state === "playing";

  if (running) {
    if (!isHost || !isPlaying) {
      running = false;
      if (stopFn) stopFn();
      stopFn = null;
    }
    return;
  }

  if (!isHost || !isPlaying) return;

  running = true;
  const sim = createHostGameSim(session);

  set(ref(db, PATHS.sessionGame), sim.getSnapshot());

  const hz = 15; // 10より少し滑らか（重くなりにくい範囲）
  const intervalMs = Math.floor(1000 / hz);

  const timer = setInterval(async () => {
    // セッションの状態がfinishedになってないか確認（リタイア/全滅）
    const s = (await get(ref(db, PATHS.sessionCurrent))).val();
    if (!s || s.state !== "playing") return;

    // inputs反映して進める
    const inputsSnap = await get(ref(db, `session/current/inputs`));
    sim.applyInputs(inputsSnap.val() || {});
    sim.step(intervalMs / 1000);

    // 終了判定：全員死亡
    if (sim.isAllDead()) {
      await update(ref(db, PATHS.sessionCurrent), { state: "finished", finishedReason: "all_dead", updatedAt: serverTimestamp() });
      return;
    }

    await set(ref(db, PATHS.sessionGame), sim.getSnapshot());
  }, intervalMs);

  stopFn = () => clearInterval(timer);

  update(ref(db, PATHS.sessionCurrent), { updatedAt: serverTimestamp() });

  // finishedになったらresettingへ（ホストが担当）
  const finishWatch = setInterval(async () => {
    const s = (await get(ref(db, PATHS.sessionCurrent))).val();
    if (!s) return;
    if (s.hostUid !== uid) return;
    if (s.state !== "finished") return;

    clearInterval(finishWatch);
    // resettingへ
    await update(ref(db, PATHS.sessionCurrent), { state: "resetting", updatedAt: serverTimestamp() });

    // 全員ロビー復帰待ち（clientStateがlobbyになったら消す）
    const waitTimer = setInterval(async () => {
      const ss = (await get(ref(db, PATHS.sessionCurrent))).val();
      if (!ss || ss.state !== "resetting") return;

      const cs = ss.clientState || {};
      // 参加者と観戦者が lobby に戻ったかを見る（offlineは許容）
      const uids = new Set([ss.p1Uid, ss.p2Uid].filter(Boolean));
      // 観戦者を厳密に追うのは大変なので、今回は「プレイヤー2名がlobbyに戻ったら」リセットにします（身内用）
      // もし観戦者も必須なら後でpresenceと組み合わせます。
      let ok = true;
      for (const puid of uids) {
        if (cs[puid] !== "lobby") ok = false;
      }
      if (!ok) return;

      clearInterval(waitTimer);

      // データ全消去 → idle
      await remove(ref(db, PATHS.sessionCurrent));
      await remove(ref(db, PATHS.sessionGame));
    }, 500);
  }, 400);
}
