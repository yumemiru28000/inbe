import { db } from "./firebase.js";
import { ref, onValue } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-database.js";
import { PATHS } from "./paths.js";
import { startHostLoopIfNeeded } from "./hostSync.js";
import { createRenderer } from "./game.js";

const canvas = document.querySelector("#game");
const renderer = createRenderer(canvas);

export function bindWatchAndGameCanvas({ uid }) {
  // セッション監視 → ホストなら同期ループ開始
  onValue(ref(db, PATHS.sessionCurrent), (snap) => {
    const s = snap.val();
    startHostLoopIfNeeded({ uid, session: s });
  });

  // game状態監視 → 描画
  onValue(ref(db, PATHS.sessionGame), (snap) => {
    const g = snap.val();
    if (!g) {
      renderer.drawIdle("ロビー / 観戦待機中");
      return;
    }
    renderer.drawState(g);
  });

  // 初期表示
  renderer.drawIdle("ロビー");
}
