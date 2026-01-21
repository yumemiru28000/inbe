const WAVE_DUR = [30, 40, 90, 140]; // 秒
const SHOOT_CD = 3.0;

// スコア
const SCORE = { A: 60, B: 120, C: 200, D: 0, E: 300 };

// 敵パラメータ（調整用）
const ENEMY = {
  A: { firePerSec: 0.12, bulletSpeed: 0.28, moveSpeed: 0.06 },
  B: { firePerSec: 0.18, bulletSpeed: 0.32, moveSpeed: 0.09 },
  C: { firePerSec: 0.14, bulletSpeed: 0.26, moveSpeed: 0.06, homingTime: 0.7, turnRate: 2.2 },
  E: { firePerSec: 0.45, bulletSpeed: 0.36, moveSpeed: 0.0 },
  D: { fallSpeed: 0.10 }
};

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function randChoice(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

export function createHostGameSim(session) {
  const p1Uid = session.p1Uid; // 青
  const p2Uid = session.p2Uid; // 赤

  const state = {
    tick: 0,
    mode: session.mode,
    startedAt: Date.now(),
    elapsed: 0,
    wave: 1,

    // インベーダ隊列の“全体”オフセット
    formation: {
      dir: 1,                 // 1 or -1
      xOffset: 0,
      yOffset: 0,
      speedBase: 0.10,
      stepDown: 0.03
    },

    players: {},
    enemies: [],        // {id,type,x,y,alive,...}
    playerBullets: [],  // {x,y,ownerUid,dead}
    enemyBullets: [],   // {x,y,vx,vy,type,dead,homingLeft?}
    hazards: [],        // Dなど(接触即死): {id,type,x,y,alive}
    rng: mulberry32(Date.now() & 0xffffffff),
    nextEnemyId: 1,
    nextHazardId: 1,
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

  // wave開始時に敵を作る
  let currentWaveSpawned = 0;
  spawnWave(1);

  let lastInputs = {};

  function applyInputs(inputs) {
    lastInputs = inputs || {};
  }

  function step(dt) {
    state.tick++;
    state.elapsed += dt;

    // wave進行
    const t = state.elapsed;
    const w1 = WAVE_DUR[0];
    const w2 = w1 + WAVE_DUR[1];
    const w3 = w2 + WAVE_DUR[2];
    const w4 = w3 + WAVE_DUR[3];

    let newWave = state.wave;
    if (t < w1) newWave = 1;
    else if (t < w2) newWave = 2;
    else if (t < w3) newWave = 3;
    else newWave = 4;

    if (newWave !== state.wave) {
      state.wave = newWave;
      spawnWave(newWave);
    }

    // ---- プレイヤー移動 & 発射
    for (const uid in state.players) {
      const p = state.players[uid];
      if (!p.alive) continue;

      const inp = lastInputs?.[uid] || {};
      const speed = 0.45;
      if (inp.left) p.x -= speed * dt;
      if (inp.right) p.x += speed * dt;
      p.x = clamp(p.x, 0.05, 0.95);

      p.shootCooldown = Math.max(0, p.shootCooldown - dt);

      if (inp.shoot && p.shootCooldown === 0) {
        state.playerBullets.push({ x: p.x, y: p.y - 0.03, ownerUid: uid });
        p.shootCooldown = SHOOT_CD;
      }
    }

    // ---- 敵移動（隊列：A/B/C）
    updateFormation(dt);

    // ---- E移動（遊撃）
    for (const e of state.enemies) {
      if (!e.alive) continue;
      if (e.type !== "E") continue;
      e.t = (e.t ?? 0) + dt;
      e.x = e.x0 + Math.sin(e.t * 2.2) * 0.10;
      e.y += 0.12 * dt;
      if (e.y > 1.1) e.alive = false; // 画面外で消える
    }

    // ---- D移動（hazard）
    for (const h of state.hazards) {
      if (!h.alive) continue;
      h.y += ENEMY.D.fallSpeed * dt;
      if (h.y > 1.1) h.alive = false;
    }

    // ---- 弾移動
    for (const b of state.playerBullets) b.y -= 0.85 * dt;
    state.playerBullets = state.playerBullets.filter(b => b.y > -0.1 && !b.dead);

    // 敵弾（直線＋追尾）
    for (const b of state.enemyBullets) {
      if (b.dead) continue;

      if (b.type === "C_HOMING" && b.homingLeft > 0) {
        // 弱追尾：一定時間だけゆっくり曲げる
        b.homingLeft -= dt;
        const target = pickAlivePlayer();
        if (target) {
          const dx = target.x - b.x;
          const dy = target.y - b.y;
          const desired = Math.atan2(dy, dx);
          const cur = Math.atan2(b.vy, b.vx);
          const diff = normalizeAngle(desired - cur);
          const maxTurn = ENEMY.C.turnRate * dt; // rad/s
          const turned = cur + clamp(diff, -maxTurn, maxTurn);
          const spd = Math.hypot(b.vx, b.vy);
          b.vx = Math.cos(turned) * spd;
          b.vy = Math.sin(turned) * spd;
        }
      }

      b.x += b.vx * dt;
      b.y += b.vy * dt;

      if (b.y > 1.2 || b.x < -0.2 || b.x > 1.2) b.dead = true;
    }
    state.enemyBullets = state.enemyBullets.filter(b => !b.dead);

    // ---- 敵の発射（wave4は今回はボス未実装なので、敵の発射を止めてもOK）
    if (state.wave <= 3) {
      enemyFire(dt);
      spawnHazards(dt);
      spawnEIfNeeded(dt);
    }

    // ---- 当たり判定
    collidePlayerBulletsToEnemies();
    collideEnemyBulletsToPlayers();
    collideHazardsToPlayers();

    // 生存してない敵/ハザードを掃除
    state.enemies = state.enemies.filter(e => e.alive);
    state.hazards = state.hazards.filter(h => h.alive);
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

      enemies: state.enemies.map(e => ({ x: e.x, y: e.y, type: e.type })),
      hazards: state.hazards.map(h => ({ x: h.x, y: h.y, type: h.type })),

      playerBullets: state.playerBullets.map(b => ({ x: b.x, y: b.y, ownerUid: b.ownerUid })),
      enemyBullets: state.enemyBullets.map(b => ({ x: b.x, y: b.y, type: b.type })),

      boss: null,
      sentAt: Date.now(),
    };
  }

  return { step, getSnapshot, applyInputs, isAllDead };

  // ----------------- wave spawn -----------------

  function spawnWave(wave) {
    currentWaveSpawned = wave;
    state.enemies = state.enemies.filter(e => e.type === "E" && e.alive); // Eは残してもいいが、今回は切替で整理
    state.enemyBullets = [];
    state.playerBullets = [];
    state.hazards = [];

    if (wave === 1) {
      spawnFormation(["A"]);
    } else if (wave === 2) {
      spawnFormation(["A", "B", "C"]);
    } else if (wave === 3) {
      spawnFormation(["B", "C"]);
      // DとEは時間湧きで出す
    } else if (wave === 4) {
      // ボス未実装：とりあえず敵を全消し（次でボス実装）
      state.enemies = [];
      state.enemyBullets = [];
      state.hazards = [];
    }

    // 隊列を初期化
    state.formation.dir = 1;
    state.formation.xOffset = 0;
    state.formation.yOffset = 0;
  }

  function spawnFormation(types) {
    // 6x3 = 18体
    const rows = 3, cols = 6;
    const x0 = 0.18, y0 = 0.14;
    const dx = 0.11, dy = 0.085;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const type = randChoice(types);
        state.enemies.push({
          id: `en_${state.nextEnemyId++}`,
          type,
          baseX: x0 + c * dx,
          baseY: y0 + r * dy,
          x: x0 + c * dx,
          y: y0 + r * dy,
          alive: true,
          fireAcc: 0
        });
      }
    }
  }

  function updateFormation(dt) {
    // 生きてる隊列敵だけ
    const formationEnemies = state.enemies.filter(e => e.alive && (e.type === "A" || e.type === "B" || e.type === "C"));
    if (formationEnemies.length === 0) return;

    // 端判定（base座標+offset で判定）
    let minX = Infinity, maxX = -Infinity;
    for (const e of formationEnemies) {
      const x = e.baseX + state.formation.xOffset;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
    }

    const speed = state.formation.speedBase; // 全体速度
    state.formation.xOffset += state.formation.dir * speed * dt;

    // 端に到達したら反転＆少し下がる
    if (maxX > 0.92) {
      state.formation.dir = -1;
      state.formation.yOffset += state.formation.stepDown;
    } else if (minX < 0.08) {
      state.formation.dir = 1;
      state.formation.yOffset += state.formation.stepDown;
    }

    // 個体タイプで微調整（Bは少し速い雰囲気）
    for (const e of formationEnemies) {
      const extra = (e.type === "B") ? (ENEMY.B.moveSpeed - ENEMY.A.moveSpeed) : 0;
      e.x = e.baseX + state.formation.xOffset * (1 + extra);
      e.y = e.baseY + state.formation.yOffset;
    }
  }

  // ----------------- enemy fire / spawn -----------------

  function enemyFire(dt) {
    const alivePlayers = Object.values(state.players).filter(p => p.alive);
    if (alivePlayers.length === 0) return;

    for (const e of state.enemies) {
      if (!e.alive) continue;
      if (!(e.type === "A" || e.type === "B" || e.type === "C" || e.type === "E")) continue;

      const cfg = ENEMY[e.type];
      e.fireAcc = (e.fireAcc ?? 0) + cfg.firePerSec * dt;

      // たまに撃つ（accが1以上で発射）
      while (e.fireAcc >= 1) {
        e.fireAcc -= 1;

        // 発射
        if (e.type === "C") {
          // 弱追尾弾
          const target = pickAlivePlayer();
          if (!target) break;
          const dx = target.x - e.x;
          const dy = target.y - e.y;
          const ang = Math.atan2(dy, dx);
          const spd = cfg.bulletSpeed;
          state.enemyBullets.push({
            x: e.x,
            y: e.y,
            vx: Math.cos(ang) * spd,
            vy: Math.sin(ang) * spd,
            type: "C_HOMING",
            homingLeft: cfg.homingTime,
            dead: false
          });
        } else {
          // 直線弾（少し狙う）
          const target = pickAlivePlayer();
          const aim = target ? clamp((target.x - e.x) * 1.2, -0.25, 0.25) : 0;
          state.enemyBullets.push({
            x: e.x,
            y: e.y,
            vx: aim,
            vy: cfg.bulletSpeed,
            type: `${e.type}_SHOT`,
            dead: false
          });
        }
      }
    }
  }

  function spawnHazards(dt) {
    if (state.wave !== 3) return;
    // Dはゆっくり流れてくる：平均8秒に1回くらい
    state._hazAcc = (state._hazAcc ?? 0) + dt / 8;
    if (state._hazAcc < 1) return;
    state._hazAcc -= 1;

    state.hazards.push({
      id: `hz_${state.nextHazardId++}`,
      type: "D",
      x: 0.10 + state.rng() * 0.80,
      y: -0.05,
      alive: true
    });
  }

  function spawnEIfNeeded(dt) {
    if (state.wave !== 3) return;
    // Eは平均5秒に1体
    state._eAcc = (state._eAcc ?? 0) + dt / 5;
    if (state._eAcc < 1) return;
    state._eAcc -= 1;

    const x0 = 0.15 + state.rng() * 0.70;
    state.enemies.push({
      id: `en_${state.nextEnemyId++}`,
      type: "E",
      x0,
      x: x0,
      y: -0.06,
      t: 0,
      alive: true,
      fireAcc: 0
    });
  }

  // ----------------- collisions -----------------

  function collidePlayerBulletsToEnemies() {
    for (const b of state.playerBullets) {
      if (b.dead) continue;

      // 敵
      for (const e of state.enemies) {
        if (!e.alive) continue;
        const dx = e.x - b.x, dy = e.y - b.y;
        if (dx * dx + dy * dy < 0.00085) {
          e.alive = false;
          b.dead = true;
          const p = state.players[b.ownerUid];
          if (p) p.score += SCORE[e.type] ?? 0;
          break;
        }
      }
    }
  }

  function collideEnemyBulletsToPlayers() {
    for (const b of state.enemyBullets) {
      if (b.dead) continue;
      for (const uid in state.players) {
        const p = state.players[uid];
        if (!p.alive) continue;
        const dx = p.x - b.x, dy = p.y - b.y;
        if (dx * dx + dy * dy < 0.0010) {
          p.alive = false;  // 即死
          b.dead = true;
          break;
        }
      }
    }
  }

  function collideHazardsToPlayers() {
    for (const h of state.hazards) {
      if (!h.alive) continue;
      for (const uid in state.players) {
        const p = state.players[uid];
        if (!p.alive) continue;
        const dx = p.x - h.x, dy = p.y - h.y;
        if (dx * dx + dy * dy < 0.0016) {
          p.alive = false; // 即死
          // Dは爆発して消えるイメージ
          h.alive = false;
          break;
        }
      }
    }
  }

  function pickAlivePlayer() {
    const arr = Object.values(state.players).filter(p => p.alive);
    if (arr.length === 0) return null;
    // ランダムに狙う（偏りが出にくい）
    return arr[Math.floor(state.rng() * arr.length)];
  }
}

// 乱数（観戦同期のため本当はseed固定にしたいが、身内用なら簡易でOK）
function mulberry32(a) {
  return function() {
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normalizeAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
