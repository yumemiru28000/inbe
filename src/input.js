import { db } from "./firebase.js";
import { ref, set, onValue } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-database.js";
import { PATHS } from "./paths.js";

export function bindInputSender({ uid }) {
  const keys = { left: false, right: false, shoot: false };
  let playing = false;

  // playing中だけ送る
  onValue(ref(db, PATHS.sessionCurrent), (snap) => {
    const s = snap.val();
    playing = s?.state === "playing" && (s?.p1Uid === uid || s?.p2Uid === uid);
  });

  window.addEventListener("keydown", (e) => {
    if (e.code === "KeyA") keys.left = true;
    if (e.code === "KeyD") keys.right = true;
    if (e.code === "Space") { keys.shoot = true; e.preventDefault(); }
  });
  window.addEventListener("keyup", (e) => {
    if (e.code === "KeyA") keys.left = false;
    if (e.code === "KeyD") keys.right = false;
    if (e.code === "Space") { keys.shoot = false; e.preventDefault(); }
  });

  // 20Hzでまとめて送信（軽量）
  setInterval(() => {
    if (!playing) return;
    set(ref(db, PATHS.sessionInputs(uid)), { ...keys, t: Date.now() });
  }, 50);
}
