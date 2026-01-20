export function createHostGameSim(session) {
  const p1 = session.p1Uid;
  const p2 = session.p2Uid;

  const state = {
    tick: 0,
    mode: session.mode,
    players: {},
    enemies: [],
    playerBullets: [],
    enemyBullets: [],
    wave: 1,
    boss: null,
    lastUpdateAt: Date.now(),
  };

  const mkPlayer = (uid, color) => ({
    uid,
    x: color === "cyan" ? 0.45 : 0.55,
    y: 0.9,
    alive: true,
    score: 0,
    shootCooldown: 0,
    color,
  });

  state.players[p1] = mkPlayer(p1, "cyan");
  if (p2) state.players[p2] = mkPlayer(p2, "magenta");

  // ダミー敵（観戦で見えるように）
  for (let i = 0; i < 18; i++) {
    state.enemies.push({
      id: "e" + i,
      x: 0.15 + (i % 6) * 0.12,
      y: 0.15 + Math.floor(i / 6) * 0.08,
      type: "A",
      alive: true,
    });
  }

  function step(dt) {
    state.tick++;

    // 簡易：敵左右移動
    const t = state.tick * dt;
    for (const e of state.enemies) {
      if (!e.alive) continue;
      e.x += Math.sin(t) * 0.0015;
    }

    // 弾移動
    for (const b of state.playerBullets) b.y -= 0.8 * dt;
    state.playerBullets = state.playerBullets.filter(b => b.y > -0.1);

    // 当たり判定（簡易）
    for (const b of state.playerBullets) {
      for (const e of state.enemies) {
        if (!e.alive) continue;
        const dx = e.x - b.x, dy = e.y - b.y;
        if (dx * dx + dy * dy < 0.0008) {
          e.alive = false;
          b.dead = true;
          // 発射主のスコア加算（A=60固定）
          const p = state.players[b.ownerUid];
          if (p) p.score += 60;
        }
      }
    }
    state.playerBullets = state.playerBullets.filter(b => !b.dead);

    // 自動発射（3秒に1回のデモ）: 実際は入力同期に置き換え
    for (const uid in state.players) {
      const p = state.players[uid];
      if (!p.alive) continue;
      p.shootCooldown = Math.max(0, p.shootCooldown - dt);
      if (p.shootCooldown === 0) {
        state.playerBullets.push({ x: p.x, y: p.y - 0.03, ownerUid: uid });
        p.shootCooldown = 3.0;
      }
    }
  }

  function getSnapshot() {
    // “軽い”スナップショットにする（必要最低限のみ）
    const playersArr = Object.values(state.players).map(p => ({
      uid: p.uid, x: p.x, y: p.y, alive: p.alive, score: p.score, color: p.color
    }));

    return {
      tick: state.tick,
      mode: state.mode,
      wave: state.wave,
      players: playersArr,
      enemies: state.enemies.filter(e => e.alive).map(e => ({ x: e.x, y: e.y, type: e.type })),
      playerBullets: state.playerBullets.map(b => ({ x: b.x, y: b.y, ownerUid: b.ownerUid })),
      enemyBullets: [],
      boss: state.boss,
      sentAt: Date.now(),
    };
  }

  return { step, getSnapshot };
}
