export function createRenderer(canvas, hud) {
  const ctx = canvas.getContext("2d");

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", resize);
  resize();

  function clear() { ctx.clearRect(0, 0, canvas.width, canvas.height); }

  function toScreen(xNorm, yNorm) {
    const w = canvas.getBoundingClientRect().width;
    const h = canvas.getBoundingClientRect().height;
    return { x: xNorm * w, y: yNorm * h };
  }

  function drawIdle(text) {
    resize(); clear();
    const w = canvas.getBoundingClientRect().width;
    ctx.fillStyle = "#9fb0cc";
    ctx.font = "16px system-ui";
    ctx.fillText(text, 16, 28);
    ctx.fillText("プレイ中ならここに位置/敵/弾/スコアが表示されます", 16, 52);
    if (hud) hud.style.display = "none";
  }

  function drawState(g, myUid) {
    resize(); clear();

    // HUD表示
    if (hud) hud.style.display = "";

    const my = (g.players || []).find(p => p.uid === myUid);
    const hud1 = document.querySelector("#hudLine1");
    const hud2 = document.querySelector("#hudLine2");

    if (my) {
      const cd = my.shootCooldown ?? 0;
      const can = cd <= 0.001;
      const colorLabel = my.color === "red" ? "RED" : "BLUE";
      hud1.textContent = `YOU: ${colorLabel} | SCORE: ${my.score} | WAVE: ${g.wave}`;
      hud2.textContent = can ? "発射可能" : `クールダウン: ${cd.toFixed(2)}s`;
    } else {
      hud1.textContent = `WAVE: ${g.wave} elapsed:${g.elapsed ?? "?"}`;
      hud2.textContent = "";
    }

    // 敵
    for (const e of (g.enemies || [])) {
      const s = toScreen(e.x, e.y);
      ctx.fillStyle = "#ffd166";
      ctx.fillRect(s.x - 8, s.y - 8, 16, 16);
    }

    // プレイヤー
    for (const p of (g.players || [])) {
      const s = toScreen(p.x, p.y);
      const col = p.color === "red" ? "#ff3b3b" : "#2b78ff";
      ctx.fillStyle = col;
      ctx.fillRect(s.x - 12, s.y - 7, 24, 14);

      // 自分マーク
      if (p.uid === myUid) {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.strokeRect(s.x - 14, s.y - 9, 28, 18);
      }
    }

    // プレイヤー弾
    ctx.fillStyle = "#e8eefc";
    for (const b of (g.playerBullets || [])) {
      const s = toScreen(b.x, b.y);
      ctx.fillRect(s.x - 2, s.y - 8, 4, 16);
    }
  }

  return { drawIdle, drawState };
}
