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
    ctx.fillStyle = "#9fb0cc";
    ctx.font = "16px system-ui";
    ctx.fillText(text, 16, 28);
    ctx.fillText("プレイ中ならここに位置/敵/弾/スコアが表示されます", 16, 52);
    if (hud) hud.style.display = "none";
  }

  function drawBossBar(boss) {
    if (!boss || !boss.alive) return;
    const w = canvas.getBoundingClientRect().width;
    const barW = Math.min(520, w - 24);
    const x = (w - barW) / 2;
    const y = 12;
    const h = 14;

    const ratio = boss.hpMax > 0 ? Math.max(0, boss.hp / boss.hpMax) : 0;

    // 枠
    ctx.fillStyle = "rgba(10,14,22,.72)";
    ctx.fillRect(x - 6, y - 6, barW + 12, h + 12);

    ctx.strokeStyle = "#1f2a3a";
    ctx.strokeRect(x - 6, y - 6, barW + 12, h + 12);

    // 本体
    ctx.fillStyle = "#3a0b0b";
    ctx.fillRect(x, y, barW, h);

    // 残量
    ctx.fillStyle = boss.shieldLeft > 0 ? "#7bdff2" : "#ff3b3b";
    ctx.fillRect(x, y, barW * ratio, h);

    ctx.fillStyle = "#e8eefc";
    ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
    const shield = boss.shieldLeft > 0 ? ` SHIELD:${boss.shieldLeft.toFixed(1)}s` : "";
    ctx.fillText(`BOSS HP ${boss.hp}/${boss.hpMax}  PHASE:${boss.phase}${shield}`, x + 6, y + 11);
  }

  function drawState(g, myUid) {
    resize(); clear();
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

    // ボスバー
    drawBossBar(g.boss);

    // 敵（Wave1-3）
    for (const e of (g.enemies || [])) {
      const s = toScreen(e.x, e.y);
      ctx.fillStyle =
        e.type === "A" ? "#ffd166" :
        e.type === "B" ? "#ff9f1c" :
        e.type === "C" ? "#7bdff2" :
        e.type === "E" ? "#b8f2a6" : "#ffd166";
      ctx.fillRect(s.x - 8, s.y - 8, 16, 16);
    }

    // Dハザード
    for (const h of (g.hazards || [])) {
      const s = toScreen(h.x, h.y);
      ctx.fillStyle = "#ff4d6d";
      ctx.beginPath();
      ctx.arc(s.x, s.y, 10, 0, Math.PI * 2);
      ctx.fill();
    }

    // ボス本体
    if (g.boss && g.boss.alive) {
      const s = toScreen(g.boss.x, g.boss.y);
      ctx.fillStyle = g.boss.shieldLeft > 0 ? "#7bdff2" : "#ff3b3b";
      ctx.fillRect(s.x - 26, s.y - 14, 52, 28);
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.strokeRect(s.x - 26, s.y - 14, 52, 28);
    }

    // プレイヤー
    for (const p of (g.players || [])) {
      const s = toScreen(p.x, p.y);
      const col = p.color === "red" ? "#ff3b3b" : "#2b78ff";
      ctx.fillStyle = col;
      ctx.fillRect(s.x - 12, s.y - 7, 24, 14);

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

    // 敵弾（種類で色）
    for (const b of (g.enemyBullets || [])) {
      const s = toScreen(b.x, b.y);
      const col =
        b.type === "C_HOMING" ? "#7bdff2" :
        b.type.includes("SNIPE") ? "#ffffff" :
        b.type.includes("RING") ? "#ffccff" :
        b.type.includes("WAVE") ? "#b4f8c8" :
        "#ffccff";
      ctx.fillStyle = col;
      ctx.fillRect(s.x - 3, s.y - 3, 6, 6);
    }
  }

  return { drawIdle, drawState };
}
