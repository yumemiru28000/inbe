export function createRenderer(canvas) {
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

  function clear() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  function toScreen(xNorm, yNorm) {
    const w = canvas.getBoundingClientRect().width;
    const h = canvas.getBoundingClientRect().height;
    return { x: xNorm * w, y: yNorm * h };
  }

  function drawIdle(text) {
    resize();
    clear();
    const w = canvas.getBoundingClientRect().width;
    const h = canvas.getBoundingClientRect().height;
    ctx.fillStyle = "#9fb0cc";
    ctx.font = "16px system-ui";
    ctx.fillText(text, 16, 28);
    ctx.fillText("プレイ中ならここに状況（位置/敵/弾/スコア）が表示されます", 16, 52);
  }

  function drawState(g) {
    resize();
    clear();
    const w = canvas.getBoundingClientRect().width;
    const h = canvas.getBoundingClientRect().height;

    // UI
    ctx.fillStyle = "#a8b3c7";
    ctx.font = "14px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
    ctx.fillText(`tick:${g.tick} wave:${g.wave} mode:${g.mode}`, 12, 20);

    // スコア表示
    let y = 40;
    for (const p of (g.players || [])) {
      ctx.fillStyle = p.color === "magenta" ? "#ff4fd8" : "#44d7ff";
      ctx.fillText(`${p.uid.slice(0,6)} score:${p.score} ${p.alive ? "" : "(DEAD)"}`, 12, y);
      y += 18;
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
      ctx.fillStyle = p.color === "magenta" ? "#ff4fd8" : "#44d7ff";
      ctx.fillRect(s.x - 10, s.y - 6, 20, 12);
    }

    // プレイヤー弾
    ctx.fillStyle = "#e8eefc";
    for (const b of (g.playerBullets || [])) {
      const s = toScreen(b.x, b.y);
      ctx.fillRect(s.x - 2, s.y - 6, 4, 12);
    }
  }

  return { drawIdle, drawState };
}
