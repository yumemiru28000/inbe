const WAVE_DUR = [30, 40, 90, 140]; // 秒
const SHOOT_CD = 3.0;

export function createHostGameSim(session) {
  const p1Uid = session.p1Uid; // 青
  const p2Uid = session.p2Uid; // 赤（マルチのみ）

  const state = {
    tick: 0,
    mode: session.mode,
    startedAt: Date.now(),
    elapsed: 0,
    wave: 1,
    players: {},
    enemies: [],
    playerBullets: [],
    enemyBullets: [],
    boss: null,
  };

  const mkPlayer = (uid, color, x) => ({
    uid,
    color, // "blue" | "red"
    x,
    y: 0.9,
    alive: true,
    score: 0,
    shootCooldown: 0,
  });

  state.players[p1Uid] = mkPlayer(p1Uid, "blue", 0.45);
  if (p2Uid) state.players[p2Uid] = mkPlayer(p2Uid, "red", 0.55);

  // 見える用の敵（ダミー）
  for (let i = 0; i < 18; i++) {
    state.enemies.push({
      id: "e" + i,
      x: 0.15 + (i % 6) * 0.12,
      y: 0.15 + Math.floor(i / 6) * 0.08,
      type: "A",
      alive: true,
    });
  }

  let lastInputs = {};

  function applyInputs(inputs) {
    lastInputs = inputs || {};
  }

  function step(dt) {
    state.tick++;
    state.elapsed += dt;

    // wave進行（wave4以降はボス継続：死ぬまで終わらない仕様なので）
    const t = state.elapsed;
    const w1 = WAVE_DUR[0];
    const w2 = WAVE_DUR[0] + WAVE_DUR[1];
    const w3 = w2 + WAVE_DUR[2];
    const w4 = w3 + WAVE_DUR[3];

    if (t < w1) state.wave = 1;
    else if (t < w2) state.wave = 2;
    else if (t < w3) state.wave = 3;
    else state.wave = 4; // ボス戦（以降継続）

    // プレイヤー移動 & 発射
    for (const uid in state.players) {
      const p = state.players[uid];
      if (!p.alive) continue;

      const inp = lastInputs?.[uid] || {};
      const speed = 0.45; // 画面正規化速度/秒
      if (inp.left) p.x -= speed * dt;
      if (inp.right) p.x += speed * dt;
      p.x = Math.max(0.05, Math.min(0.95, p.x));

      p.shootCooldown = Math.max(0, p.shootCooldown - dt);

      if (inp.shoot && p.shootCooldown === 0) {
        state.playerBullets.push({ x: p.x, y: p.y - 0.03, ownerUid: uid });
        p.shootCooldown = SHOOT_CD;
      }
    }

    // 敵左右移動（簡易）
    const phase = state.tick * dt;
    for (const e of state.enemies) {
      if (!e.alive) continue;
      e.x += Math.sin(phase) * 0.0015;
    }

    // 弾移動
    for (const b of state.playerBullets) b.y -= 0.85 * dt;
    state.playerBullets = state.playerBullets.filter(b => b.y > -0.1);

    // 当たり判定（簡易：敵ワンパン）
    for (const b of state.playerBullets) {
      for (const e of state.enemies) {
        if (!e.alive) continue;
        const dx = e.x - b.x, dy = e.y - b.y;
        if (dx * dx + dy * dy < 0.0008) {
          e.alive = false;
          b.dead = true;
          const p = state.players[b.ownerUid];
          if (p) p.score += 60;
        }
      }
    }
    state.playerBullets = state.playerBullets.filter(b => !b.dead);
  }

  function isAllDead() {
    return Object.values(state.players).every(p => !p.alive);
  }

  function getSnapshot() {
    const playersArr = Object.values(state.players).map(p => ({
      uid: p.uid, x: p.x, y: p.y, alive: p.alive, score: p.score,
      color: p.color,
      shootCooldown: p.shootCooldown
    }));

    return {
      tick: state.tick,
      mode: state.mode,
      wave: state.wave,
      elapsed: Math.floor(state.elapsed * 1000) / 1000,
      players: playersArr,
      enemies: state.enemies.filter(e => e.alive).map(e => ({ x: e.x, y: e.y, type: e.type })),
      playerBullets: state.playerBullets.map(b => ({ x: b.x, y: b.y, ownerUid: b.ownerUid })),
      enemyBullets: [],
      boss: state.boss,
      sentAt: Date.now(),
    };
  }

  return { step, getSnapshot, applyInputs, isAllDead };
}
