const WAVE_DUR = [30, 40, 90, 140]; // 秒
const SHOOT_CD = 3.0;

// スコア
const SCORE = { A: 60, B: 120, C: 200, D: 0, E: 300, BOSS_HIT: 10, BOSS_KILL: 5000 };

// 敵パラメータ（Wave1-3）
const ENEMY = {
  A: { firePerSec: 0.12, bulletSpeed: 0.28, moveSpeed: 0.06 },
  B: { firePerSec: 0.18, bulletSpeed: 0.32, moveSpeed: 0.09 },
  C: { firePerSec: 0.14, bulletSpeed: 0.26, moveSpeed: 0.06, homingTime: 0.7, turnRate: 2.2 },
  E: { firePerSec: 0.45, bulletSpeed: 0.36 },
  D: { fallSpeed: 0.10 }
};

// ボスパラメータ
const BOSS = {
  hpMax: 40,
  x: 0.5,
  y: 0.16,
  baseBulletSpeed: 0.33,
  shieldEvery: 9.0,     // これくらいの頻度でシールド
  shieldDuration: 1.8,  // シールド時間
  moveSpeed: 0.18
};

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function randChoice(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }

export function createHostGameSim(session) {
  const p1Uid = session.p1Uid; // 青
  const p2Uid = session.p2Uid; // 赤

  const state = {
    tick: 0,
    mode: session.mode,
    elapsed: 0,
    wave: 1,

    // 隊列（Wave1-3）
    formation: { dir: 1, xOffset: 0, yOffset: 0, speedBase: 0.10, stepDown: 0.03 },

    players: {},
    enemies: [],
    hazards: [],
    playerBullets: [],
    enemyBullets: [],

    // ボス
    boss: null,

    // RNG
    rng: mulberry32((Date.now() ^ 0x9e3779b9) >>> 0),
    nextEnemyId: 1,
    nextHazardId: 1,
  };

  const mkPlayer = (uid, color, x) => ({
    uid, color, x, y: 0.9,
    alive: true,
    score: 0,
    shootCooldown: 0,
  });

  state.players[p1Uid] = mkPlayer(p1Uid, "blue", 0.45);
  if (p2Uid) state.players[p2Uid] = mkPlayer(p2Uid, "red", 0.55);

  // 最初のWaveを作る
  spawnWave(1);

  let lastInputs = {};
  function applyInputs(inputs) { lastInputs = inputs || {}; }

  function step(dt) {
    state.tick++;
    state.elapsed += dt;

    // wave進行
    const t = state.elapsed;
    const tW1 = WAVE_DUR[0];
    const tW2 = tW1 + WAVE_DUR[1];
    const tW3 = tW2 + WAVE_DUR[2];
    const tW4 = tW3 + WAVE_DUR[3];

    let newWave = state.wave;
    if (t < tW1) newWave = 1;
    else if (t < tW2) newWave = 2;
    else if (t < tW3) newWave = 3;
    else newWave = 4;

    if (newWave !== state.wave) {
      state.wave = newWave;
      spawnWave(newWave);
    }

    // プレイヤー移動 & 発射
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

    // Wave1-3敵処理
    if (state.wave <= 3) {
      updateFormation(dt);
      updateE(dt);
      updateHazards(dt);

      enemyFire(dt);
      spawnHazards(dt);
      spawnEIfNeeded(dt);

      moveBullets(dt);
      collidePlayerBulletsToEnemies();
      collideEnemyBulletsToPlayers();
      collideHazardsToPlayers();
      cleanupWaveEnemies();
    }

    // Wave4：ボス
    if (state.wave === 4) {
      // Wave4開始からの経過（激化用）
      const wave4Start = tW3;
      const wave4Elapsed = Math.max(0, state.elapsed - wave4Start);

      updateBoss(dt, wave4Elapsed);

      moveBullets(dt);
      collidePlayerBulletsToBoss();
      collideEnemyBulletsToPlayers(); // ボス弾もここで即死
      collideBossToPlayers();         // 突撃などで接触死

      // ボス撃破
      if (state.boss && state.boss.hp <= 0) {
        // 撃破後は敵弾を止める（その後の終了処理はhostSync側の全滅/リタイア以外に追加しても良い）
        state.boss.alive = false;
        state.enemyBullets = [];
      }
    }

    // プレイヤー弾（共通）
    movePlayerBullets(dt);
  }

  function isAllDead() {
    return Object.values(state.players).every(p => !p.alive);
  }

  function getSnapshot() {
    const playersArr = Object.values(state.players).map(p => ({
      uid: p.uid, x: p.x, y: p.y, alive: p.alive, score: p.score,
      color: p.color, shootCooldown: p.shootCooldown
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

      boss: state.boss ? {
        x: state.boss.x, y: state.boss.y,
        hp: state.boss.hp, hpMax: state.boss.hpMax,
        shieldLeft: state.boss.shieldLeft,
        phase: bossPhase(state.boss),
        alive: state.boss.alive
      } : null,

      sentAt: Date.now(),
    };
  }

  return { step, getSnapshot, applyInputs, isAllDead };

  // ----------------- wave spawn -----------------

  function spawnWave(wave) {
    // リセット（必要最低限）
    state.enemies = [];
    state.hazards = [];
    state.enemyBullets = [];
    state.playerBullets = [];
    state._hazAcc = 0;
    state._eAcc = 0;

    state.formation.dir = 1;
    state.formation.xOffset = 0;
    state.formation.yOffset = 0;

    state.boss = null;

    if (wave === 1) spawnFormation(["A"]);
    if (wave === 2) spawnFormation(["A", "B", "C"]);
    if (wave === 3) spawnFormation(["B", "C"]);
    if (wave === 4) spawnBoss();
  }

  function spawnFormation(types) {
    const rows = 3, cols = 6;
    const x0 = 0.18, y0 = 0.14;
    const dx = 0.11, dy = 0.085;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const type = randChoice(state.rng, types);
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

  function spawnBoss() {
    state.boss = {
      alive: true,
      x: BOSS.x,
      y: BOSS.y,
      vx: 0,
      hp: BOSS.hpMax,
      hpMax: BOSS.hpMax,

      // 行動管理
      time: 0,
      attackAcc: 0,          // 技の頻度（難易度で変える）
      shieldAcc: 0,          // シールド発動タイミング
      shieldLeft: 0,
      feintQueue: [],        // フェイントで遅延発射するキュー
      dashLeft: 0,           // 突撃中の残り時間
      dashDir: 1,
    };
  }

  // ----------------- movement / bullets -----------------

  function updateFormation(dt) {
    const formationEnemies = state.enemies.filter(e => e.alive && (e.type === "A" || e.type === "B" || e.type === "C"));
    if (formationEnemies.length === 0) return;

    let minX = Infinity, maxX = -Infinity;
    for (const e of formationEnemies) {
      const x = e.baseX + state.formation.xOffset;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
    }

    state.formation.xOffset += state.formation.dir * state.formation.speedBase * dt;

    if (maxX > 0.92) { state.formation.dir = -1; state.formation.yOffset += state.formation.stepDown; }
    if (minX < 0.08) { state.formation.dir =  1; state.formation.yOffset += state.formation.stepDown; }

    for (const e of formationEnemies) {
      const extra = (e.type === "B") ? (ENEMY.B.moveSpeed - ENEMY.A.moveSpeed) : 0;
      e.x = e.baseX + state.formation.xOffset * (1 + extra);
      e.y = e.baseY + state.formation.yOffset;
    }
  }

  function updateE(dt) {
    for (const e of state.enemies) {
      if (!e.alive || e.type !== "E") continue;
      e.t = (e.t ?? 0) + dt;
      e.x = e.x0 + Math.sin(e.t * 2.2) * 0.10;
      e.y += 0.12 * dt;
      if (e.y > 1.1) e.alive = false;
    }
  }

  function updateHazards(dt) {
    for (const h of state.hazards) {
      if (!h.alive) continue;
      h.y += ENEMY.D.fallSpeed * dt;
      if (h.y > 1.1) h.alive = false;
    }
  }

  function movePlayerBullets(dt) {
    for (const b of state.playerBullets) b.y -= 0.85 * dt;
    state.playerBullets = state.playerBullets.filter(b => b.y > -0.1 && !b.dead);
  }

  function moveBullets(dt) {
    // 敵弾（直線＋追尾＋ウェーブ等）
    for (const b of state.enemyBullets) {
      if (b.dead) continue;

      // ウェーブ軌道
      if (b.waveAmp) {
        b.waveT = (b.waveT ?? 0) + dt;
        // 横に揺れる速度（vxは基本0にして、waveで横移動）
        b.x += Math.sin(b.waveT * b.waveFreq) * b.waveAmp * dt;
      }

      // 分裂弾の分裂
      if (b.splitAt != null) {
        b.life = (b.life ?? 0) + dt;
        if (!b.splitDone && b.life >= b.splitAt) {
          b.splitDone = true;
          const spd = Math.hypot(b.vx, b.vy);
          // 左右に分裂
          state.enemyBullets.push({ x: b.x, y: b.y, vx: -0.18, vy: spd, type: "SPLIT_CHILD", dead: false });
          state.enemyBullets.push({ x: b.x, y: b.y, vx:  0.18, vy: spd, type: "SPLIT_CHILD", dead: false });
          b.dead = true;
          continue;
        }
      }

      // 追尾（弱い）
      if (b.type === "C_HOMING" && b.homingLeft > 0) {
        b.homingLeft -= dt;
        const target = pickAlivePlayer();
        if (target) {
          const dx = target.x - b.x;
          const dy = target.y - b.y;
          const desired = Math.atan2(dy, dx);
          const cur = Math.atan2(b.vy, b.vx);
          const diff = normalizeAngle(desired - cur);
          const maxTurn = 2.2 * dt;
          const turned = cur + clamp(diff, -maxTurn, maxTurn);
          const spd = Math.hypot(b.vx, b.vy);
          b.vx = Math.cos(turned) * spd;
          b.vy = Math.sin(turned) * spd;
        }
      }

      // 通常移動
      b.x += b.vx * dt;
      b.y += b.vy * dt;

      if (b.y > 1.2 || b.x < -0.2 || b.x > 1.2) b.dead = true;
    }
    state.enemyBullets = state.enemyBullets.filter(b => !b.dead);
  }

  // ----------------- enemy fire / spawn (Wave1-3) -----------------

  function enemyFire(dt) {
    const alivePlayers = Object.values(state.players).filter(p => p.alive);
    if (alivePlayers.length === 0) return;

    for (const e of state.enemies) {
      if (!e.alive) continue;
      if (!(e.type === "A" || e.type === "B" || e.type === "C" || e.type === "E")) continue;

      const cfg = ENEMY[e.type];
      e.fireAcc = (e.fireAcc ?? 0) + cfg.firePerSec * dt;

      while (e.fireAcc >= 1) {
        e.fireAcc -= 1;

        if (e.type === "C") {
          const target = pickAlivePlayer();
          if (!target) break;
          const dx = target.x - e.x;
          const dy = target.y - e.y;
          const ang = Math.atan2(dy, dx);
          const spd = cfg.bulletSpeed;
          state.enemyBullets.push({
            x: e.x, y: e.y,
            vx: Math.cos(ang) * spd,
            vy: Math.sin(ang) * spd,
            type: "C_HOMING",
            homingLeft: cfg.homingTime,
            dead: false
          });
        } else {
          const target = pickAlivePlayer();
          const aim = target ? clamp((target.x - e.x) * 1.2, -0.25, 0.25) : 0;
          state.enemyBullets.push({ x: e.x, y: e.y, vx: aim, vy: cfg.bulletSpeed, type: `${e.type}_SHOT`, dead: false });
        }
      }
    }
  }

  function spawnHazards(dt) {
    if (state.wave !== 3) return;
    state._hazAcc = (state._hazAcc ?? 0) + dt / 8; // 平均8秒に1回
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
    state._eAcc = (state._eAcc ?? 0) + dt / 5; // 平均5秒に1体
    if (state._eAcc < 1) return;
    state._eAcc -= 1;

    const x0 = 0.15 + state.rng() * 0.70;
    state.enemies.push({
      id: `en_${state.nextEnemyId++}`,
      type: "E",
      x0, x: x0, y: -0.06, t: 0,
      alive: true, fireAcc: 0
    });
  }

  function cleanupWaveEnemies() {
    state.enemies = state.enemies.filter(e => e.alive);
    state.hazards = state.hazards.filter(h => h.alive);
  }

  // ----------------- collisions -----------------

  function collidePlayerBulletsToEnemies() {
    for (const b of state.playerBullets) {
      if (b.dead) continue;

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
          p.alive = false;
          h.alive = false;
          break;
        }
      }
    }
  }

  // ----------------- boss -----------------

  function bossPhase(boss) {
    const hp = boss.hp;
    if (hp > 30) return 1;
    if (hp > 20) return 2;
    if (hp > 10) return 3;
    return 4;
  }

  function updateBoss(dt, wave4Elapsed) {
    const boss = state.boss;
    if (!boss || !boss.alive) return;

    boss.time += dt;

    // 140秒以降は激化（A案）
    // wave4Elapsedが140を超えるとどんどん攻撃頻度が上がる
    const over = Math.max(0, wave4Elapsed - WAVE_DUR[3]);
    const enrage = 1 + over * 0.012; // 1秒ごとに少しずつ
    const phase = bossPhase(boss);

    // ボス移動（通常は左右にゆっくり。突撃中は高速）
    if (boss.dashLeft > 0) {
      boss.dashLeft -= dt;
      boss.x += boss.dashDir * (BOSS.moveSpeed * 3.2) * dt;
      if (boss.x < 0.12) { boss.x = 0.12; boss.dashDir = 1; }
      if (boss.x > 0.88) { boss.x = 0.88; boss.dashDir = -1; }
    } else {
      boss.x += Math.sin(boss.time * 0.9) * 0.06 * dt;
      boss.x = clamp(boss.x, 0.12, 0.88);
    }

    // シールド
    boss.shieldAcc += dt;
    if (boss.shieldLeft > 0) boss.shieldLeft -= dt;
    if (boss.shieldAcc >= BOSS.shieldEvery) {
      boss.shieldAcc = 0;
      boss.shieldLeft = BOSS.shieldDuration;
    }

    // フェイント遅延発射キュー処理
    for (const f of boss.feintQueue) f.t -= dt;
    while (boss.feintQueue.length && boss.feintQueue[0].t <= 0) {
      const fire = boss.feintQueue.shift();
      if (fire) fire.pattern();
    }

    // 技の頻度（HP減るほど増える + 激化）
    const baseAttacksPerSec =
      phase === 1 ? 0.55 :
      phase === 2 ? 0.75 :
      phase === 3 ? 0.95 : 1.20;

    boss.attackAcc += baseAttacksPerSec * enrage * dt;

    while (boss.attackAcc >= 1) {
      boss.attackAcc -= 1;
      doBossAttack(phase, enrage);
    }
  }

  function doBossAttack(phase, enrage) {
    const boss = state.boss;
    if (!boss || !boss.alive) return;

    // HP減るほど使える技が増える
    const patterns = [];
    patterns.push(pRing);
    patterns.push(pRightSide);

    if (phase >= 2) { patterns.push(pSnipe); patterns.push(pSplit); }
    if (phase >= 3) { patterns.push(pWave); patterns.push(pHomingWeak); patterns.push(pFeint); }
    if (phase >= 4) { patterns.push(pDash); patterns.push(pSnake); }

    const pattern = randChoice(state.rng, patterns);
    pattern(enrage);
  }

  // ---- ボス技実装 ----

  function pRing(enrage) {
    const boss = state.boss;
    const phase = bossPhase(boss);
    const n =
      phase === 1 ? 10 :
      phase === 2 ? 12 :
      phase === 3 ? 14 : 16;

    const spd = BOSS.baseBulletSpeed * (1 + 0.08 * (phase - 1)) * Math.min(1.6, enrage);
    for (let i = 0; i < n; i++) {
      const a = (Math.PI * 2) * (i / n);
      state.enemyBullets.push({
        x: boss.x, y: boss.y,
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd,
        type: "BOSS_RING",
        dead: false
      });
    }
  }

  function pRightSide(enrage) {
    const boss = state.boss;
    // 右側に偏った扇状
    const spd = BOSS.baseBulletSpeed * 1.05 * Math.min(1.7, enrage);
    const n = 8;
    for (let i = 0; i < n; i++) {
      const a = (-Math.PI / 2) + (i / (n - 1)) * (Math.PI / 2); // 下方向中心で右寄り
      const vx = Math.cos(a) * spd + 0.18;
      const vy = Math.sin(a) * spd + 0.45;
      state.enemyBullets.push({ x: boss.x, y: boss.y, vx, vy, type: "BOSS_RIGHT", dead: false });
    }
  }

  function pWave(enrage) {
    const boss = state.boss;
    const spd = (BOSS.baseBulletSpeed * 1.0) * Math.min(1.6, enrage);
    const n = 6;
    for (let i = 0; i < n; i++) {
      const xoff = (i - (n - 1) / 2) * 0.03;
      state.enemyBullets.push({
        x: boss.x + xoff,
        y: boss.y,
        vx: 0,
        vy: spd,
        waveAmp: 0.22,
        waveFreq: 7.0,
        type: "BOSS_WAVE",
        dead: false
      });
    }
  }

  function pFeint(enrage) {
    const boss = state.boss;
    // 予備動作だけで、少し遅れてリング小を撃つ
    const delay = 0.55 + (state.rng() * 0.45);
    boss.feintQueue.push({
      t: delay,
      pattern: () => {
        const spd = BOSS.baseBulletSpeed * 0.95 * Math.min(1.6, enrage);
        const n = 8;
        for (let i = 0; i < n; i++) {
          const a = (Math.PI * 2) * (i / n);
          state.enemyBullets.push({ x: boss.x, y: boss.y, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd, type: "BOSS_FEINT", dead: false });
        }
      }
    });
  }

  function pSnipe(enrage) {
    const boss = state.boss;
    // 高速狙撃（予備動作は“feintQueue”で遅延させる）
    const target = pickAlivePlayer();
    if (!target) return;

    const delay = 0.65;
    boss.feintQueue.push({
      t: delay,
      pattern: () => {
        const dx = target.x - boss.x;
        const dy = target.y - boss.y;
        const a = Math.atan2(dy, dx);
        const spd = (BOSS.baseBulletSpeed * 1.9) * Math.min(1.6, enrage);
        state.enemyBullets.push({ x: boss.x, y: boss.y, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd, type: "BOSS_SNIPE", dead: false });
      }
    });
  }

  function pSplit(enrage) {
    const boss = state.boss;
    const spd = BOSS.baseBulletSpeed * 1.1 * Math.min(1.6, enrage);
    state.enemyBullets.push({
      x: boss.x,
      y: boss.y,
      vx: 0,
      vy: spd,
      splitAt: 0.55,
      splitDone: false,
      type: "BOSS_SPLIT",
      dead: false
    });
  }

  function pHomingWeak(enrage) {
    const boss = state.boss;
    const target = pickAlivePlayer();
    if (!target) return;
    const dx = target.x - boss.x;
    const dy = target.y - boss.y;
    const a = Math.atan2(dy, dx);
    const spd = BOSS.baseBulletSpeed * 1.05 * Math.min(1.6, enrage);
    state.enemyBullets.push({
      x: boss.x, y: boss.y,
      vx: Math.cos(a) * spd,
      vy: Math.sin(a) * spd,
      type: "C_HOMING",
      homingLeft: 0.75,
      dead: false
    });
  }

  function pDash(enrage) {
    const boss = state.boss;
    // 突撃：短時間だけ横に高速移動
    boss.dashLeft = 0.8 * Math.min(1.2, enrage);
    boss.dashDir = (state.rng() < 0.5) ? -1 : 1;
  }

  function pSnake(enrage) {
    // 蛇行っぽい弾（wave弾を強めに）
    const boss = state.boss;
    const spd = BOSS.baseBulletSpeed * 0.95 * Math.min(1.6, enrage);
    const n = 4;
    for (let i = 0; i < n; i++) {
      const xoff = (i - (n - 1) / 2) * 0.05;
      state.enemyBullets.push({
        x: boss.x + xoff,
        y: boss.y,
        vx: 0,
        vy: spd,
        waveAmp: 0.30,
        waveFreq: 9.5,
        type: "BOSS_SNAKE",
        dead: false
      });
    }
  }

  function collidePlayerBulletsToBoss() {
    const boss = state.boss;
    if (!boss || !boss.alive) return;

    for (const b of state.playerBullets) {
      if (b.dead) continue;
      const dx = boss.x - b.x, dy = boss.y - b.y;

      // ボス当たり判定を少し大きめ
      if (dx * dx + dy * dy < 0.0032) {
        b.dead = true;
        if (boss.shieldLeft > 0) {
          // シールド中はノーダメ
          continue;
        }
        boss.hp -= 1;
        const p = state.players[b.ownerUid];
        if (p) p.score += SCORE.BOSS_HIT;
        if (boss.hp <= 0) {
          const p2 = state.players[b.ownerUid];
          if (p2) p2.score += SCORE.BOSS_KILL;
        }
      }
    }
  }

  function collideBossToPlayers() {
    const boss = state.boss;
    if (!boss || !boss.alive) return;
    // 本体接触は即死（突撃で近づくことがある）
    for (const uid in state.players) {
      const p = state.players[uid];
      if (!p.alive) continue;
      const dx = p.x - boss.x, dy = p.y - boss.y;
      if (dx * dx + dy * dy < 0.0040) {
        p.alive = false;
      }
    }
  }

  function pickAlivePlayer() {
    const arr = Object.values(state.players).filter(p => p.alive);
    if (arr.length === 0) return null;
    return arr[Math.floor(state.rng() * arr.length)];
  }
}

// 乱数
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
