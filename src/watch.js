import { db } from "./firebase.js";
import { ref, onValue, set } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-database.js";
import { PATHS } from "./paths.js";
import { startHostLoopIfNeeded } from "./hostSync.js";
import { createRenderer } from "./game.js";

const canvas = document.querySelector("#game");
const hud = document.querySelector("#hud");
const renderer = createRenderer(canvas, hud);

export function bindWatchAndGameCanvas({ uid }) {
  onValue(ref(db, PATHS.sessionCurrent), async (snap) => {
    const s = snap.val();
    startHostLoopIfNeeded({ uid, session: s });

    // playing中にプレイヤー/観戦者はプレイ画面しか見ない想定なので状態を更新
    if (s?.state === "playing") {
      const isPlayer = s.p1Uid === uid || s.p2Uid === uid;
      await set(ref(db, PATHS.sessionClientState(uid)), isPlayer ? "playing" : "watching");
    } else if (!s || s.state === "idle") {
      await set(ref(db, PATHS.sessionClientState(uid)), "lobby");
    } else if (s.state === "resetting") {
      // いったんロビー扱い（リセット完了待ち）
      await set(ref(db, PATHS.sessionClientState(uid)), "lobby");
    }
  });

  onValue(ref(db, PATHS.sessionGame), (snap) => {
    const g = snap.val();
    if (!g) {
      renderer.drawIdle("ロビー / 観戦待機中");
      return;
    }
    renderer.drawState(g, uid);
  });

  renderer.drawIdle("ロビー");
}
