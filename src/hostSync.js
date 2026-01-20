import { db } from "./firebase.js";
import { ref, set, update, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-database.js";
import { PATHS } from "./paths.js";
import { createHostGameSim } from "./sim.js";

let running = false;
let stopFn = null;

export function startHostLoopIfNeeded({ uid, session }) {
  const isHost = session?.hostUid === uid;
  const isPlaying = session?.state === "playing";

  if (running) {
    // playingじゃなくなったら止める
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

  // 初期game状態をセット
  set(ref(db, PATHS.sessionGame), sim.getSnapshot());

  const hz = 10; // 重くならない程度
  const intervalMs = Math.floor(1000 / hz);

  const timer = setInterval(async () => {
    sim.step(intervalMs / 1000);
    const snap = sim.getSnapshot();
    await set(ref(db, PATHS.sessionGame), snap);
  }, intervalMs);

  stopFn = () => clearInterval(timer);

  // playingになったことをupdatedAtに反映
  update(ref(db, PATHS.sessionCurrent), { updatedAt: serverTimestamp() });
}
