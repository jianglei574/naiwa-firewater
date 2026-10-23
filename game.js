/* ============================================================
   奶娃森林冰火人 —— 游戏主逻辑
   技术：原生 Canvas + 固定时间步物理 + AABB 瓦片碰撞
   ============================================================ */
(() => {
  'use strict';

  /* ---------- 常量 ---------- */
  const TILE = 48;                 // 每格像素
  const COLS = 20, ROWS = 12;      // 关卡尺寸
  const W = COLS * TILE;           // 画布逻辑宽 960
  const H = ROWS * TILE;           // 画布逻辑高 576

  // 物理（调过手感：更跟手、更宽容）
  const GRAVITY = 2000;            // 重力 px/s²
  const MOVE_SPEED = 280;          // 最大水平速度
  const ACCEL = 3200;              // 地面加速
  const DECEL = 3200;              // 地面减速
  const DECEL_AIR = 1800;          // 空中减速
  const JUMP_VELOCITY = -680;      // 起跳速度
  const MAX_FALL = 1000;           // 最大下落速度
  const COYOTE = 0.12;             // 离台宽限（秒）
  const JUMP_BUFFER = 0.14;        // 跳跃缓冲（秒）
  const JUMP_CUT = 0.45;           // 松开跳跃时的减速系数

  const FIXED_DT = 1 / 60;         // 固定物理步长

  /* ---------- DOM ---------- */
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  canvas.width = W;
  canvas.height = H;

  // 通用障碍视觉系统（主题 → 材质，见 themes.js）
  const Themes = window.NaiwaThemes;
  // 新机关教学演示（见 tutorials.js）
  const NaiwaTutorials = window.NaiwaTutorials || {};

  /* ---------- 资源（两位身份互换：火用原水娃图，水用原火娃图） ---------- */
  const ASSETS = {
    fire: 'assets/water_baby.png',
    water: 'assets/fire_baby.png',
  };
  // 真实景点照片背景（Unsplash License，来源与授权见 assets/bg/LICENSES.md）
  const BG = {
    paris: 'assets/bg/paris.jpg',
    greatwall: 'assets/bg/greatwall.jpg',
    egypt: 'assets/bg/egypt.jpg',
    santorini: 'assets/bg/santorini.jpg',
    fuji: 'assets/bg/fuji.jpg',
    iguazu: 'assets/bg/iguazu.jpg',
    nyc: 'assets/bg/nyc.jpg',
    machupicchu: 'assets/bg/machupicchu.jpg',
  };
  const imgs = {};
  const bgs = {};
  let menuImg = null;            // 开始/关卡选择界面的森林背景（加载失败走程序化兜底）

  function loadImage(src) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = src;
    });
  }

  function loadAssets() {
    // 角色图：加载失败则走 .catch（占位色块兜底）
    const charJobs = Object.entries(ASSETS).map(([k, src]) =>
      loadImage(src).then(img => { imgs[k] = img; })
    );
    // 背景图：单个失败不阻断游戏，回退到程序化背景
    const bgJobs = Object.entries(BG).map(([k, src]) =>
      loadImage(src).then(img => { bgs[k] = img; }).catch(() => {})
    );
    // 菜单森林背景：失败不阻断（drawMenuBackground 走程序化兜底）
    const menuJob = loadImage('assets/bg/forest.jpg').then(img => { menuImg = img; }).catch(() => {});
    return Promise.all([...charJobs, ...bgJobs, menuJob]);
  }

  /* ---------- 输入（动作抽象，不直接读按键） ---------- */
  const BINDINGS = {
    fire:   { left: 'KeyA', right: 'KeyD', jump: 'KeyW' },
    water:  { left: 'ArrowLeft', right: 'ArrowRight', jump: 'ArrowUp' },
  };
  const keys = new Set();          // 当前按住的 code（用于移动）
  let enterQueued = false;         // 标题/结束界面回车

  window.addEventListener('keydown', (e) => {
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault();
    if (e.repeat) return;          // 忽略长按自动重复
    keys.add(e.code);
    if (e.code === 'Enter') enterQueued = true;
    // 跳跃直接压入缓冲，不再依赖「本帧刚按下」的集合，
    // 避免高刷新率下某些帧不跑物理、把按键丢掉的卡顿。
    if (e.code === BINDINGS.fire.jump && fire) fire.jumpBuffer = JUMP_BUFFER;
    if (e.code === BINDINGS.water.jump && water) water.jumpBuffer = JUMP_BUFFER;
  });
  window.addEventListener('keyup', (e) => {
    keys.delete(e.code);
    if (e.code === BINDINGS.fire.jump && fire) fire.jumpCut = true;
    if (e.code === BINDINGS.water.jump && water) water.jumpCut = true;
  });
  window.addEventListener('blur', () => { keys.clear(); });  // 失焦清空，避免卡键

  /* ---------- 菜单鼠标交互（开始/关卡选择界面） ---------- */
  function menuPos(e) {
    const rect = canvas.getBoundingClientRect();
    // CSS 等比缩放（style.css），把 client 像素映射回 960×576 逻辑坐标
    const sx = rect.width ? (W / rect.width) : 1;
    const sy = rect.height ? (H / rect.height) : 1;
    return { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sy };
  }
  function hitMenu(x, y) {
    for (const b of menuButtons()) {
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b;
    }
    return null;
  }
  function menuAction(id) {
    if (id === 'start') { beginLevel(0); }
    else if (id === 'levels') { state = 'levelselect'; }
    else if (id === 'back') { state = 'title'; }
    else if (typeof id === 'string' && id.indexOf('level:') === 0) { beginLevel(parseInt(id.slice(6), 10)); }
  }
  canvas.addEventListener('mousemove', (e) => {
    const p = menuPos(e);
    const b = hitMenu(p.x, p.y);
    hoverId = b ? b.id : null;
    canvas.style.cursor = (b && (state === 'title' || state === 'levelselect')) ? 'pointer' : 'default';
  });
  canvas.addEventListener('mousedown', (e) => {
    if (state !== 'title' && state !== 'levelselect') return;
    const p = menuPos(e);
    const b = hitMenu(p.x, p.y);
    pressId = b ? b.id : null;
  });
  canvas.addEventListener('mouseup', (e) => {
    if (state !== 'title' && state !== 'levelselect') return;
    const p = menuPos(e);
    const b = hitMenu(p.x, p.y);
    if (pressId && b && b.id === pressId) menuAction(b.id);
    pressId = null;
  });

  function actionActive(code) {
    // 教学演示态：由脚本时间轴提供虚拟输入；否则读真实按键
    if (state === 'tutorial') return demoAction(code);
    return keys.has(code);
  }

  /* ---------- 关卡解析 ---------- */
  function parseLevel(def) {
    const grid = def.grid.map(r => r.split(''));
    const spawn = { fire: null, water: null };
    const exits = [];
    const items = [];
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const t = grid[y][x];
        if (t === 'F') spawn.fire = { x, y };
        if (t === 'W') spawn.water = { x, y };
        if (t === 'E') exits.push({ x, y });
        if (t === 'T' || t === 'B') items.push({ x, y, kind: t, taken: false });
      }
    }
    // 机关：转为运行时对象（碰撞与视觉都基于同一份坐标，保证一致）
    const mechanisms = (def.mechanisms || []).map(m => {
      if (m.type === 'platform') {
        return {
          type: 'platform', x: m.x, y: m.y, w: m.w || 2,
          dir: m.dir || 'v', range: m.range || 3, speed: m.speed || 70,
          ox: 0, oy: 0, dx: 0, dy: 0, moving: 1,
          px: m.x * TILE, py: m.y * TILE, pw: (m.w || 2) * TILE,
        };
      }
      if (m.type === 'plate') return { type: 'plate', id: m.id, x: m.x, y: m.y, only: m.only || null, active: false };
      if (m.type === 'gate') return { type: 'gate', x: m.x, y: m.y, w: m.w || 1, h: m.h || 3, plates: m.plates || [], hold: !!m.hold, open: false, openAmount: 0 };
      // 顺序石板：必须按 order 1→2→3… 依次踩下才锁存（踩错只闪红提示，不锁存）
      if (m.type === 'seq') return { type: 'seq', id: m.id, x: m.x, y: m.y, order: m.order || 1, active: false, flash: 0 };
      // 临时道路：周期出现/消失（on/off 循环），或由关联板触发（hold>0 时持续 hold 秒，否则板激活即显形）
      if (m.type === 'temp') return { type: 'temp', x: m.x, y: m.y, w: m.w || 2, on: m.on || 2, off: m.off || 1.5, plates: m.plates || [], hold: m.hold || 0, armed: false, t: 0, solid: false, warn: false };
      // 能量传递：源（role 角色踩住）→ 中继 → 目标，逐级点亮；prev 可为 id 或 id 数组（多源）
      if (m.type === 'beam') return { type: 'beam', id: m.id, x: m.x, y: m.y, role: m.role || null, prev: m.prev || null, powered: false };
      // 潮汐：海面周期性涨落，灌满竖井空白格（涨潮海水只杀火娃，不阻挡任何人）
      if (m.type === 'tide') return { type: 'tide', x: m.x, w: m.w || 1, floorY: m.floorY, minY: m.minY, maxY: m.maxY, low: m.low || 3, high: m.high || 2, phase: m.phase || 0, surf: m.maxY, flooded: false };
      return null;
    }).filter(Boolean);
    return { grid, spawn, exits, items, theme: def.theme || 'default', name: def.name || '', mechanisms };
  }

  function tileAt(level, tx, ty) {
    if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) return null;
    return level.grid[ty][tx];
  }
  // 按角色区分可站立地形：水娃能走水，火娃能走火
  function isSolidFor(t, type) {
    if (t === '#' || t === 'E') return true;
    if (t === '~') return type === 'water';
    if (t === '%') return type === 'fire';
    return false;
  }
  // 关闭中的闸门当实心墙（打开到 90% 才放行，与滑出门板的视觉一致）
  function gateSolidAt(tx, ty) {
    if (!level || !level.mechanisms) return false;
    for (const m of level.mechanisms) {
      if (m.type === 'gate' && m.openAmount < 0.9) {
        if (tx >= m.x && tx < m.x + m.w && ty >= m.y && ty < m.y + m.h) return true;
      }
    }
    return false;
  }
  // 临时道路：solid 时当作实心（可站立），非 solid 时放行
  function tempSolidAt(tx, ty) {
    if (!level || !level.mechanisms) return false;
    for (const m of level.mechanisms) {
      if (m.type === 'temp' && m.solid && tx >= m.x && tx < m.x + m.w && ty === m.y) return true;
    }
    return false;
  }
  // 潮汐海水：某格是否被涨潮覆盖（只灌空白格，不压过墙，不阻挡角色）
  function tideWaterAt(tx, ty) {
    if (!level || !level.mechanisms) return false;
    for (const m of level.mechanisms) {
      if (m.type !== 'tide' || !m.flooded) continue;
      if (tx >= m.x && tx < m.x + m.w && ty >= m.minY && ty <= m.floorY) {
        if (tileAt(level, tx, ty) === '.') return true;
      }
    }
    return false;
  }
  function solidAt(tx, ty, type) {
    if (tx < 0 || tx >= COLS) return true;   // 左右边界墙：走到头不会掉下去
    if (ty < 0 || ty >= ROWS) return false;
    if (gateSolidAt(tx, ty)) return true;    // 关闭的闸门
    if (tempSolidAt(tx, ty)) return true;    // 显现中的临时道路
    return isSolidFor(tileAt(level, tx, ty), type);
  }

  /* ---------- 角色 ---------- */
  function makePlayer(type) {
    return {
      type,                    // 'fire' | 'water'
      x: 0, y: 0,
      w: 30, h: 46,            // 碰撞盒
      vx: 0, vy: 0,
      onGround: false,
      onPlat: null,            // 当前站立的移动平台（用于带动）
      coyote: 0,
      jumpBuffer: 0,
      jumpCut: false,
      facing: type === 'fire' ? 1 : -1,
      dead: false,
      onExit: false,
      landedT: 0,              // 落地挤压动画计时
    };
  }

  function respawn(p, cell) {
    p.x = cell.x * TILE + (TILE - p.w) / 2;
    p.y = cell.y * TILE - p.h;         // 脚踩在出生格顶部
    p.vx = 0; p.vy = 0;
    p.onGround = false; p.onPlat = null; p.coyote = 0; p.jumpBuffer = 0; p.jumpCut = false;
    p.dead = false; p.onExit = false;
  }

  /* ---------- 物理 + 瓦片碰撞 ---------- */
  // 碰撞时在「非移动轴」上留一个微小偏移，避免把脚底恰好贴边的那一行地砖
  // 误判成侧面障碍（否则角色会卡在地面上无法左右移动）。
  const EPS = 0.001;

  function collide(p) {
    // 水平：y 方向用 EPS 排除「踩着地面/头顶平台」的贴边误判
    p.x += p.vx * FIXED_DT;
    const x0 = Math.floor(p.x / TILE), x1 = Math.floor((p.x + p.w) / TILE);
    const y0 = Math.floor((p.y + EPS) / TILE), y1 = Math.floor((p.y + p.h - EPS) / TILE);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (!solidAt(tx, ty, p.type)) continue;
        if (p.vx > 0) p.x = tx * TILE - p.w - EPS;
        else if (p.vx < 0) p.x = (tx + 1) * TILE + EPS;
        p.vx = 0;
      }
    }
    // 垂直：x 方向用 EPS 排除「贴着侧墙」的贴边误判
    p.y += p.vy * FIXED_DT;
    p.onGround = false;
    p.onPlat = null;
    const x2 = Math.floor((p.x + EPS) / TILE), x3 = Math.floor((p.x + p.w - EPS) / TILE);
    const y2 = Math.floor(p.y / TILE), y3 = Math.floor((p.y + p.h) / TILE);
    for (let ty = y2; ty <= y3; ty++) {
      for (let tx = x2; tx <= x3; tx++) {
        if (!solidAt(tx, ty, p.type)) continue;
        if (p.vy > 0) { p.y = ty * TILE - p.h; p.onGround = true; }
        else if (p.vy < 0) { p.y = (ty + 1) * TILE; }
        p.vy = 0;
      }
    }
    // 移动平台（竖直）：swept 判定站顶面 / 撞底面，落到顶面则标记 onPlat 以便带动
    for (const m of level.mechanisms) {
      if (m.type !== 'platform' || m.dir !== 'v') continue;
      const px = m.px, py = m.py, pw = m.pw, ph = TILE;
      if (p.x + p.w <= px || p.x >= px + pw) continue;   // 水平方向不重叠
      const feet = p.y + p.h;
      const prevFeet = feet - p.vy * FIXED_DT;
      if (p.vy >= 0 && prevFeet <= py + 0.5 && feet >= py) {
        p.y = py - p.h; p.vy = 0; p.onGround = true; p.onPlat = m;
      } else if (p.vy < 0 && p.y - p.vy * FIXED_DT >= py + ph - 0.5 && p.y <= py + ph) {
        p.y = py + ph; p.vy = 0;
      }
    }
  }

  function updatePlayer(p, binding, dt) {
    // 读输入（动作）
    const left = actionActive(binding.left);
    const right = actionActive(binding.right);
    const moveDir = (right ? 1 : 0) - (left ? 1 : 0);
    if (moveDir !== 0) p.facing = moveDir;

    // 跳跃缓冲（keydown 直接写入）+ 离台宽限计时
    if (p.onGround) p.coyote = COYOTE; else p.coyote -= dt;
    if (p.jumpBuffer > 0 && (p.onGround || p.coyote > 0)) {
      p.vy = JUMP_VELOCITY;
      p.jumpBuffer = 0;
      p.coyote = 0;
      p.onGround = false;
      p.onPlat = null;
    }
    p.jumpBuffer -= dt;
    // 可变跳跃高度：上升中松开跳，快速收力
    if (p.jumpCut) { if (p.vy < 0) p.vy *= JUMP_CUT; p.jumpCut = false; }

    // 水平速度（平滑加减速）
    const target = moveDir * MOVE_SPEED;
    const accel = moveDir !== 0 ? ACCEL : (p.onGround ? DECEL : DECEL_AIR);
    if (p.vx < target) p.vx = Math.min(target, p.vx + accel * dt);
    else if (p.vx > target) p.vx = Math.max(target, p.vx - accel * dt);

    // 重力
    p.vy = Math.min(p.vy + GRAVITY * dt, MAX_FALL);

    const wasGround = p.onGround;
    collide(p);
    if (!wasGround && p.onGround) p.landedT = 0.3;   // 落地挤压
  }

  /* ---------- 陷阱 / 物品 / 出口 ---------- */
  function checkHazards(p) {
    const inset = 3;
    const x0 = Math.floor((p.x + inset) / TILE), x1 = Math.floor((p.x + p.w - inset) / TILE);
    const y0 = Math.floor((p.y + inset) / TILE), y1 = Math.floor((p.y + p.h) / TILE);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const t = tileAt(level, tx, ty);
        if (t === '~' && p.type === 'fire') return '水';
        if (tideWaterAt(tx, ty) && p.type === 'fire') return '水';   // 涨潮海水同样只杀火娃
        if (t === '%' && p.type === 'water') return '火';
        if (t === 'A') return '酸';
        if (t === '^') {
          // 尖刺只判定下半部分，站旁边不会误伤
          const sx = tx * TILE + 8, sy = ty * TILE + TILE * 0.5;
          const sw = TILE - 16, sh = TILE * 0.5;
          if (p.x + p.w > sx && p.x < sx + sw && p.y + p.h > sy && p.y < sy + sh) return '刺';
        }
      }
    }
    return null;
  }

  function checkItems(p) {
    const x0 = Math.floor(p.x / TILE), x1 = Math.floor((p.x + p.w) / TILE);
    const y0 = Math.floor(p.y / TILE), y1 = Math.floor((p.y + p.h) / TILE);
    for (const it of level.items) {
      if (it.taken) continue;
      if (it.x < x0 || it.x > x1 || it.y < y0 || it.y > y1) continue;
      // 水娃喝奶茶 T，火娃吃汉堡 B；拿错类型则拿不到（无害）
      if ((it.kind === 'T' && p.type === 'water') || (it.kind === 'B' && p.type === 'fire')) {
        it.taken = true;
        effects.push({ x: it.x * TILE + TILE / 2, y: it.y * TILE + TILE / 2, age: 0 });
      }
    }
  }

  function checkExit(p) {
    const x0 = Math.floor(p.x / TILE), x1 = Math.floor((p.x + p.w) / TILE);
    const y0 = Math.floor(p.y / TILE), y1 = Math.floor((p.y + p.h) / TILE);
    p.onExit = false;
    for (const e of level.exits) {
      if (e.x >= x0 && e.x <= x1 && e.y >= y0 && e.y <= y1) p.onExit = true;
    }
  }

  /* ---------- 机关系统 ---------- */
  function updateMechanisms(dt) {
    if (!level || !level.mechanisms) return;
    // 移动平台：往返移动并记录本帧位移（用于带动角色）
    for (const m of level.mechanisms) {
      if (m.type !== 'platform') continue;
      const max = m.range * TILE;
      const step = m.speed * dt * m.moving;
      if (m.dir === 'v') {
        const old = m.oy;
        let next = m.oy + step;
        if (next >= max) { next = max; m.moving = -1; }
        else if (next <= 0) { next = 0; m.moving = 1; }
        m.oy = next;
        m.dy = old - m.oy; m.dx = 0;   // oy 增大时平台向上，位移为负
      } else {
        const old = m.ox;
        let next = m.ox + step;
        if (next >= max) { next = max; m.moving = -1; }
        else if (next <= 0) { next = 0; m.moving = 1; }
        m.ox = next;
        m.dx = m.ox - old; m.dy = 0;
      }
      m.px = m.x * TILE + m.ox;
      m.py = m.dir === 'v' ? m.y * TILE - m.oy : m.y * TILE + m.oy;   // 竖直平台向上移动（y 减小）
    }
    // 压力板：有角色踩上即激活（only 指定时只有对应角色能踩）
    for (const m of level.mechanisms) {
      if (m.type !== 'plate') continue;
      const candidates = [fire, water].filter(p => !m.only || p.type === m.only);
      m.active = candidates.some(p =>
        p.x + p.w > m.x * TILE + 5 && p.x < (m.x + 1) * TILE - 5 &&
        Math.abs((p.y + p.h) - (m.y * TILE)) < 12);
    }
    // 顺序石板：必须按 order 1→2→3… 依次踩下才锁存（踩错只闪红，不锁存）
    for (const m of level.mechanisms) {
      if (m.type !== 'seq') continue;
      if (m.flash > 0) m.flash -= dt;
      if (m.active) continue;
      const pressed = [fire, water].some(p =>
        p.x + p.w > m.x * TILE + 5 && p.x < (m.x + 1) * TILE - 5 &&
        Math.abs((p.y + p.h) - (m.y * TILE)) < 12);
      if (!pressed) continue;
      const latched = level.mechanisms.filter(s => s.type === 'seq' && s.active).length;
      if (m.order === latched + 1) m.active = true;
      else m.flash = 0.5;
    }
    // 能量传递：源（角色踩住）→ 中继 → 目标，逐级点亮（幂等迭代到稳定）
    const beamById = {};
    for (const m of level.mechanisms) if (m.type === 'beam') beamById[m.id] = m;
    for (let pass = 0; pass < level.mechanisms.length; pass++) {
      for (const m of level.mechanisms) {
        if (m.type !== 'beam') continue;
        if (m.role) {
          m.powered = [fire, water].some(p => p.type === m.role &&
            p.x + p.w > m.x * TILE + 5 && p.x < (m.x + 1) * TILE - 5 &&
            Math.abs((p.y + p.h) - (m.y * TILE)) < 12);
        } else {
          const prevs = Array.isArray(m.prev) ? m.prev : (m.prev ? [m.prev] : []);
          m.powered = prevs.length > 0 && prevs.every(id => beamById[id] && beamById[id].powered);
        }
      }
    }
    // 统一按 id 索引（plate/seq/beam 都可作触发源），active 或 powered 都算“已激活”
    const byId = {};
    for (const m of level.mechanisms) if (m.id) byId[m.id] = m;
    const nodeActive = m => !!(m && (m.active || m.powered));
    // 临时道路：周期模式（on/off 循环）或触发模式（关联板激活 → 蓄能）
    for (const m of level.mechanisms) {
      if (m.type !== 'temp') continue;
      if (m.plates && m.plates.length) {
        const allActive = m.plates.every(id => nodeActive(byId[id]));
        if (m.hold > 0) {
          // 上升沿触发：从“未全激活”到“全激活”的瞬间充满 hold 秒；倒计时独立进行
          // （松脚不冻结），到 0 即消失，需再次“全激活”才重新触发。
          if (allActive && !m.armed) { m.armed = true; m.t = m.hold; }
          if (m.armed) { m.t -= dt; if (m.t <= 0) { m.t = 0; m.armed = false; } }
          m.solid = m.t > 0;
          m.warn = m.solid && m.t < 0.6;
        } else {
          // 连续模式：关联板激活即显形（seq 锁存后即永久）
          m.solid = allActive;
          m.warn = false;
        }
      } else {
        m.t += dt;
        const period = m.on + m.off;
        const cyc = m.t % period;
        m.solid = cyc < m.on;
        m.warn = m.solid && cyc > m.on - 0.6;
      }
    }
    // 潮汐：低潮（安全）与涨潮（灌水）周期切换，海面平滑过渡
    for (const m of level.mechanisms) {
      if (m.type !== 'tide') continue;
      const cyc = (t + m.phase) % (m.low + m.high);
      m.flooded = cyc >= m.low;
      const targetSurf = m.flooded ? m.minY : m.maxY;
      m.surf += (targetSurf - m.surf) * Math.min(1, dt * 5);
    }
    // 闸门：hold 模式下需持续踩住（松脚即回落），否则全部激活后锁存
    for (const m of level.mechanisms) {
      if (m.type !== 'gate') continue;
      if (m.hold) {
        m.open = m.plates.length > 0 && m.plates.every(id => nodeActive(byId[id]));
      } else if (!m.open && m.plates.length > 0 && m.plates.every(id => nodeActive(byId[id]))) {
        m.open = true;
      }
      const target = m.open ? 1 : 0;
      m.openAmount += (target - m.openAmount) * Math.min(1, dt * 8);
    }
  }

  // 站在移动平台上的角色随平台一起移动（ride-along）
  function carryPlayers() {
    for (const p of [fire, water]) {
      const m = p.onPlat;
      if (!m) continue;
      if (p.x + p.w > m.px + 2 && p.x < m.px + m.pw - 2 &&
          Math.abs((p.y + p.h) - m.py) < 8) {
        p.x += m.dx;
        p.y += m.dy;
      } else {
        p.onPlat = null;
      }
    }
  }

  function resetMechanisms() {
    if (!level || !level.mechanisms) return;
    for (const m of level.mechanisms) {
      if (m.type === 'platform') {
        m.ox = 0; m.oy = 0; m.dx = 0; m.dy = 0; m.moving = 1;
        m.px = m.x * TILE; m.py = m.y * TILE;
      } else if (m.type === 'plate') {
        m.active = false;
      } else if (m.type === 'gate') {
        m.open = false; m.openAmount = 0;
      } else if (m.type === 'seq') {
        m.active = false; m.flash = 0;
      } else if (m.type === 'temp') {
        m.t = 0; m.armed = false; m.solid = false; m.warn = false;
      } else if (m.type === 'beam') {
        m.powered = false;
      } else if (m.type === 'tide') {
        m.surf = m.maxY; m.flooded = false;
      }
    }
  }

  /* ---------- 状态 ---------- */
  let levelIndex = 0;
  let level = null;
  let fire, water;
  let state = 'title';           // title | levelselect | playing | clear | done | tutorial
  let stateT = 0;                // 状态计时
  let deathFlash = 0;            // 死亡红闪
  let deathMsg = '';             // 死亡原因提示
  let t = 0;                     // 全局时间（动画用）
  let effects = [];              // 收集物品的扩散动画
  let tutorial = null;           // { id, def, time, ptr, held, looped } 教学演示状态

  // 是否已全部通关（解锁「关卡选择」按钮）；localStorage 持久化，file:// / Node 桩下安全降级
  let allCleared = (() => {
    try { return !!(window.localStorage && window.localStorage.getItem('naiwa_all_cleared') === '1'); }
    catch (e) { return false; }
  })();
  let hoverId = null;            // 菜单当前悬停按钮 id
  let pressId = null;            // 菜单当前按下按钮 id

  function markAllCleared() {
    allCleared = true;
    try { if (window.localStorage) window.localStorage.setItem('naiwa_all_cleared', '1'); } catch (e) {}
  }

  function loadLevel(i) {
    levelIndex = i;
    level = parseLevel(LEVELS[i]);
    fire = makePlayer('fire');
    water = makePlayer('water');
    respawn(fire, level.spawn.fire);
    respawn(water, level.spawn.water);
    terrainCache = null;   // 主题/关卡变化，重新烘焙地形
  }

  function restartLevel() {
    respawn(fire, level.spawn.fire);
    respawn(water, level.spawn.water);
    for (const it of level.items) it.taken = false;   // 物品机关全部重来
    resetMechanisms();
  }

  /* ---------- 新机关教学演示（关卡内弹窗 + 自动示范） ---------- */
  // 进入关卡：若该关定义了 intro，则先播放对应教学演示，回车后进入本关
  function beginLevel(i) {
    loadLevel(i);
    const intro = LEVELS[i] && LEVELS[i].intro;
    if (intro && NaiwaTutorials[intro]) {
      startTutorial(intro);
    } else {
      state = 'playing';
    }
  }

  function startTutorial(id) {
    const def = NaiwaTutorials[id];
    if (!def) return;
    tutorial = {
      id, def, time: 0, ptr: 0, looped: false,
      held: { fire: { left: false, right: false }, water: { left: false, right: false } },
    };
    level = parseLevel(def);
    fire = makePlayer('fire');
    water = makePlayer('water');
    respawn(fire, level.spawn.fire);
    respawn(water, level.spawn.water);
    terrainCache = null;
    resetMechanisms();
    t = 0;
    enterQueued = false;
    state = 'tutorial';
    window.__naiwaTutorial = {
      id, time: 0, looped: false, maxFireX: 0, maxWaterX: 0,
      everGateOpen: false, everSeqActive: false, everBeamPowered: false,
    };
  }

  function endTutorial() {
    // 直接进入本关本体：不能再走 beginLevel（否则 intro 会再次触发教学，陷入死循环）
    loadLevel(levelIndex);
    resetMechanisms();
    t = 0;
    enterQueued = false;
    tutorial = null;
    state = 'playing';
    window.__naiwaTutorial = null;   // 教学结束，清掉快照（run_check 据此断言已退出教学态）
  }

  function demoAction(code) {
    if (!tutorial) return false;
    for (const who of ['fire', 'water']) {
      const b = BINDINGS[who];
      if (code === b.left) return tutorial.held[who].left;
      if (code === b.right) return tutorial.held[who].right;
    }
    return false;
  }

  function applyDemoEvent(ev) {
    if (!ev || !ev.who || !tutorial) return;
    const h = tutorial.held[ev.who];
    if (!h) return;
    if (ev.do === 'left') { h.left = true; h.right = false; }
    else if (ev.do === 'right') { h.right = true; h.left = false; }
    else if (ev.do === 'stop') { h.left = false; h.right = false; }
    else if (ev.do === 'jump') {
      const p = ev.who === 'fire' ? fire : water;
      if (p) p.jumpBuffer = JUMP_BUFFER;
    }
  }

  function updateTutorial(dt) {
    if (!tutorial) return;
    tutorial.time += dt;
    const script = tutorial.def.script || [];
    while (tutorial.ptr < script.length && script[tutorial.ptr].at <= tutorial.time) {
      applyDemoEvent(script[tutorial.ptr++]);
    }
    updateMechanisms(dt);
    carryPlayers();
    updatePlayer(fire, BINDINGS.fire, dt);
    updatePlayer(water, BINDINGS.water, dt);
    [fire, water].forEach(p => { if (p.onGround) p.landedT = Math.max(0, p.landedT - dt); });

    // 脚本跑完后停顿片刻，循环重播（潮汐等周期机关依赖全局 t，重播时归零保证时序一致）
    if (tutorial.ptr >= script.length) {
      tutorial.looped = true;
      const lastAt = script.length ? script[script.length - 1].at : 0;
      if (tutorial.time > lastAt + 2.0) {
        tutorial.time = 0;
        tutorial.ptr = 0;
        tutorial.held = { fire: { left: false, right: false }, water: { left: false, right: false } };
        respawn(fire, level.spawn.fire);
        respawn(water, level.spawn.water);
        resetMechanisms();
        t = 0;
      }
    }

    // 状态快照（供 tools/run_check.js 断言演示能否通关 + 便于调试）
    if (window.__naiwaTutorial) {
      const s = window.__naiwaTutorial;
      s.id = tutorial.id;
      s.time = tutorial.time;
      s.looped = tutorial.looped;
      s.maxFireX = Math.max(s.maxFireX || 0, fire.x);
      s.maxWaterX = Math.max(s.maxWaterX || 0, water.x);
      const gates = (level.mechanisms || []).filter(m => m.type === 'gate');
      s.everGateOpen = s.everGateOpen || (gates.length > 0 && gates.every(m => m.open));
      const seqs = (level.mechanisms || []).filter(m => m.type === 'seq');
      s.everSeqActive = s.everSeqActive || (seqs.length > 0 && seqs.every(m => m.active));
      const beams = (level.mechanisms || []).filter(m => m.type === 'beam' && !m.role);
      s.everBeamPowered = s.everBeamPowered || (beams.length > 0 && beams.every(m => m.powered));
    }
  }

  /* ---------- 更新 ---------- */
  function update() {
    const dt = FIXED_DT;
    t += dt;
    if (deathFlash > 0) deathFlash -= dt;
    for (const e of effects) e.age += dt;
    effects = effects.filter(e => e.age < 0.4);

    if (state === 'playing') {
      updateMechanisms(dt);
      carryPlayers();
      updatePlayer(fire, BINDINGS.fire, dt);
      updatePlayer(water, BINDINGS.water, dt);

      // 落地挤压动画计时
      [fire, water].forEach(p => {
        if (p.onGround) p.landedT = Math.max(0, p.landedT - dt);
      });

      // 陷阱
      const d1 = checkHazards(fire);
      const d2 = checkHazards(water);
      if (d1 || d2) {
        const cause = d1 || d2;
        const who = d1 ? '火娃' : '水娃';
        const name = { '水': '水', '火': '岩浆', '酸': '酸液', '刺': '尖刺' }[cause];
        deathMsg = `${who}碰到了${name}，重新开始！`;
        deathFlash = 0.6;
        restartLevel();
        return;   // 已重开，本帧不再继续
      }

      // 掉落世界外
      [fire, water].forEach(p => {
        if (p.y > ROWS * TILE + 100) {
          deathMsg = '掉出地图了，重新开始！';
          deathFlash = 0.6;
          restartLevel();
        }
      });

      checkItems(fire); checkItems(water);
      checkExit(fire); checkExit(water);

      // 过关：两人同时站上木门，且收齐全部物品
      const allItems = level.items.every(it => it.taken);
      if (fire.onExit && water.onExit && allItems) {
        state = 'clear';
        stateT = 1.4;
      }
    } else if (state === 'clear') {
      stateT -= dt;
      if (stateT <= 0) {
        if (levelIndex + 1 < LEVELS.length) { beginLevel(levelIndex + 1); }
        else { state = 'done'; markAllCleared(); }
      }
    } else if (state === 'tutorial') {
      updateTutorial(dt);
    }
  }

  /* ---------- 渲染 ---------- */
  // 主题化地形层：把静态瓦片（# 实心、^ 尖刺）预烘焙到离屏画布，
  // 每帧只 drawImage 一次；切换关卡/主题时重新烘焙。
  let terrainCache = null;

  function isBlock(ch) { return ch === '#' || ch === 'E'; }

  function bakeTerrain() {
    const key = levelIndex + ':' + level.theme;
    if (terrainCache && terrainCache.key === key) return terrainCache.canvas;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const c = cv.getContext('2d');
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const t = level.grid[y][x];
        if (t === '#' || t === 'E') {
          const above = y > 0 ? level.grid[y - 1][x] : '.';
          const below = y < ROWS - 1 ? level.grid[y + 1][x] : '.';
          // 上方空 → 可站立顶面（亮盖板 + 高光）；下方空 → 悬浮底面投影
          Themes.paintSolid(c, x * TILE, y * TILE, TILE, TILE, level.theme, {
            cap: !isBlock(above),
            floor: !isBlock(below),
          });
        } else if (t === '^') {
          Themes.paintSpikes(c, x * TILE, y * TILE, TILE, TILE, level.theme);
        }
      }
    }
    terrainCache = { key, canvas: cv };
    return cv;
  }

  /* ---------- 字体与通用绘制工具 ---------- */
  const FONT = '"PingFang SC", "Microsoft YaHei", "Segoe UI", system-ui, sans-serif';

  // 圆角矩形路径（兼容旧浏览器，不用 ctx.roundRect）
  function rr(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // 珍珠奶茶图标（s 为缩放：1 = 关卡内正常大小，0.5 = HUD 迷你）
  function drawTeaIcon(cx, cy, s) {
    ctx.save();
    ctx.strokeStyle = '#e74c3c';
    ctx.lineWidth = 2.5 * s;
    ctx.beginPath();
    ctx.moveTo(cx + 5 * s, cy - 3 * s); ctx.lineTo(cx + 9 * s, cy - 13 * s);
    ctx.stroke();
    ctx.fillStyle = '#f6e6d0';
    ctx.beginPath();
    ctx.moveTo(cx - 10 * s, cy - 7 * s);
    ctx.lineTo(cx + 10 * s, cy - 7 * s);
    ctx.lineTo(cx + 7 * s, cy + 13 * s);
    ctx.lineTo(cx - 7 * s, cy + 13 * s);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#c98a4b';
    ctx.fillRect(cx - 9 * s, cy - 4 * s, 18 * s, 15 * s);
    ctx.fillStyle = '#3a2a1a';
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.arc(cx - 5 * s + i * 3.5 * s, cy + 9 * s, 1.9 * s, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // 汉堡图标
  function drawBurgerIcon(cx, cy, s) {
    ctx.save();
    ctx.fillStyle = '#e8a33d';
    ctx.beginPath();
    ctx.arc(cx, cy - 5 * s, 11 * s, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#fff';
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.arc(cx + i * 4 * s, cy - 9 * s, 1 * s, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#7ac74f';
    ctx.beginPath();
    ctx.moveTo(cx - 10 * s, cy - 1 * s);
    ctx.lineTo(cx - 4 * s, cy + 3 * s); ctx.lineTo(cx, cy - 2 * s); ctx.lineTo(cx + 4 * s, cy + 3 * s); ctx.lineTo(cx + 10 * s, cy - 1 * s);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#8a4b2a';
    ctx.fillRect(cx - 10 * s, cy + 1 * s, 20 * s, 5 * s);
    ctx.fillStyle = '#d98b2b';
    ctx.beginPath();
    ctx.arc(cx, cy + 10 * s, 11 * s, 0, Math.PI);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawBackground() {
    const photo = (level && level.theme) ? bgs[level.theme] : null;
    if (photo) { drawPhotoBackground(photo); return; }
    // 无真实照片时回退到程序化背景，保证永不白屏
    if (level && level.theme === 'paris') drawParisBackground();
    else if (level && level.theme === 'greatwall') drawGreatWallBackground();
    else drawDefaultBackground();
  }

  // 真实照片背景：cover 等比铺满 + 居中裁切，再叠轻微压暗保证前景辨识度
  function drawPhotoBackground(img) {
    const scale = Math.max(W / img.width, H / img.height);
    const dw = img.width * scale, dh = img.height * scale;
    const dx = (W - dw) / 2, dy = (H - dh) / 2;
    ctx.drawImage(img, dx, dy, dw, dh);
    // 轻微调色：整体略压暗，底部再渐变加深（前景平台/角色更清晰，照片仍可辨）
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(0, 0, W, H);
    const g = ctx.createLinearGradient(0, H * 0.55, 0, H);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.30)');
    ctx.fillStyle = g;
    ctx.fillRect(0, H * 0.55, W, H * 0.45);
  }

  function drawDefaultBackground() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0e1a2f');
    g.addColorStop(0.6, '#1c3350');
    g.addColorStop(1, '#2a4a63');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // 星星
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    for (let i = 0; i < 40; i++) {
      const sx = (i * 97 + 31) % W;
      const sy = (i * 53 + 17) % (H * 0.6);
      const tw = 0.4 + 0.6 * Math.abs(Math.sin(t * 1.5 + i));
      ctx.globalAlpha = tw;
      ctx.fillRect(sx, sy, 2, 2);
    }
    ctx.globalAlpha = 1;
  }

  /* —— 巴黎：暮色 + 埃菲尔铁塔剪影 —— */
  function drawParisBackground() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#1b2440');
    g.addColorStop(0.5, '#4a3b5c');
    g.addColorStop(0.82, '#c97a5a');
    g.addColorStop(1, '#e8a36a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // 月亮
    ctx.fillStyle = 'rgba(255,240,210,0.9)';
    ctx.beginPath(); ctx.arc(W * 0.18, H * 0.2, 24, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,240,210,0.14)';
    ctx.beginPath(); ctx.arc(W * 0.18, H * 0.2, 36, 0, Math.PI * 2); ctx.fill();
    // 远处城市剪影
    ctx.fillStyle = 'rgba(44,42,66,0.55)';
    for (let i = 0; i < 13; i++) {
      const bx = i * 80 - 20;
      const bh = 34 + ((i * 53) % 58);
      ctx.fillRect(bx, H - 44 - bh, 56, bh);
    }
    drawEiffelTower(W * 0.66, H, 66, 88);
  }

  function drawEiffelTower(cx, baseY, topY, halfW) {
    const h = baseY - topY;
    ctx.save();
    ctx.fillStyle = 'rgba(30,32,52,0.72)';
    ctx.beginPath();
    ctx.moveTo(cx, topY);
    ctx.lineTo(cx - halfW * 0.20, topY + h * 0.16);
    ctx.lineTo(cx - halfW * 0.30, topY + h * 0.38);
    ctx.lineTo(cx - halfW * 0.27, topY + h * 0.55);
    ctx.lineTo(cx - halfW, baseY);
    ctx.lineTo(cx - halfW + 14, baseY);
    ctx.lineTo(cx - halfW * 0.32, topY + h * 0.62);
    ctx.lineTo(cx - halfW * 0.10, topY + h * 0.96);
    ctx.lineTo(cx, baseY);
    ctx.lineTo(cx + halfW * 0.10, topY + h * 0.96);
    ctx.lineTo(cx + halfW * 0.32, topY + h * 0.62);
    ctx.lineTo(cx + halfW - 14, baseY);
    ctx.lineTo(cx + halfW, baseY);
    ctx.lineTo(cx + halfW * 0.27, topY + h * 0.55);
    ctx.lineTo(cx + halfW * 0.30, topY + h * 0.38);
    ctx.lineTo(cx + halfW * 0.20, topY + h * 0.16);
    ctx.closePath();
    ctx.fill();
    // 塔尖天线
    ctx.strokeStyle = 'rgba(30,32,52,0.72)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(cx, topY); ctx.lineTo(cx, topY - 14); ctx.stroke();
    // 横向层板
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 2;
    for (let i = 1; i <= 3; i++) {
      const yy = topY + h * (0.16 + i * 0.2);
      const ww = halfW * (0.2 + i * 0.09);
      ctx.beginPath(); ctx.moveTo(cx - ww, yy); ctx.lineTo(cx + ww, yy); ctx.stroke();
    }
    ctx.restore();
  }

  /* —— 长城：蓝天 + 远山 + 城墙 —— */
  function drawGreatWallBackground() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#7fb6e0');
    g.addColorStop(0.7, '#cfe8f5');
    g.addColorStop(1, '#e8f2e8');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // 太阳
    ctx.fillStyle = 'rgba(255,244,200,0.9)';
    ctx.beginPath(); ctx.arc(W * 0.84, H * 0.18, 30, 0, Math.PI * 2); ctx.fill();
    // 远山两层
    drawMountainLayer('rgba(120,150,140,0.35)', H * 0.62);
    drawMountainLayer('rgba(90,120,110,0.5)', H * 0.8);
    // 长城
    drawGreatWall(W * 0.02, H * 0.66, W * 0.96);
  }

  function drawMountainLayer(color, baseY) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, H);
    ctx.lineTo(0, baseY);
    for (let x = 0; x <= W; x += 48) {
      const y = baseY - Math.abs(Math.sin(x * 0.013 + baseY)) * 88 - 10;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fill();
  }

  function drawGreatWall(x0, y0, w) {
    const wallH = 26;
    ctx.save();
    const g = ctx.createLinearGradient(0, y0, 0, y0 + wallH);
    g.addColorStop(0, '#c8b28a');
    g.addColorStop(1, '#9c8a6a');
    ctx.fillStyle = g;
    ctx.fillRect(x0, y0, w, wallH);
    // 垛口（城齿）
    ctx.fillStyle = '#b39a74';
    const tooth = 16, gap = 14;
    for (let x = x0; x < x0 + w; x += tooth + gap) {
      ctx.fillRect(x, y0 - 9, tooth, 9);
    }
    // 城砖纹
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 1;
    for (let y = y0 + 7; y < y0 + wallH; y += 9) {
      ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 + w, y); ctx.stroke();
    }
    // 敌楼两座
    drawWatchtower(x0 + w * 0.28, y0 - 12);
    drawWatchtower(x0 + w * 0.68, y0 - 12);
    ctx.restore();
  }

  function drawWatchtower(cx, baseY) {
    const tw = 44, th = 34;
    ctx.fillStyle = '#b39a74';
    ctx.fillRect(cx - tw / 2, baseY - th, tw, th);
    ctx.fillStyle = '#c8b28a';
    ctx.fillRect(cx - tw / 2, baseY - th, tw, 6);
    // 屋顶
    ctx.fillStyle = '#7a5a3a';
    ctx.beginPath();
    ctx.moveTo(cx - tw / 2 - 6, baseY - th);
    ctx.lineTo(cx, baseY - th - 16);
    ctx.lineTo(cx + tw / 2 + 6, baseY - th);
    ctx.closePath();
    ctx.fill();
  }

  function drawDoor(px, py) {
    // 出口门：立在地板上，向上耸立约 1.7 格（主题化材质：巴黎金属门 / 长城木门）
    const m = Themes.matFor(level.theme, 'door');
    const doorW = 34, doorH = 82;
    const dx = px + (TILE - doorW) / 2;
    const dy = py - doorH;             // 门底立于地板表面，整扇向上耸立约 1.7 格
    // 门框
    ctx.fillStyle = m.frame;
    ctx.fillRect(dx - 4, dy - 4, doorW + 8, doorH + 4);
    // 门板（中间亮、两侧暗的立体渐变）
    const g = ctx.createLinearGradient(dx, 0, dx + doorW, 0);
    g.addColorStop(0, Themes.shade(m.panel, 0.8));
    g.addColorStop(0.5, Themes.shade(m.panel, 1.15));
    g.addColorStop(1, Themes.shade(m.panel, 0.8));
    ctx.fillStyle = g;
    ctx.fillRect(dx, dy, doorW, doorH);
    if (m.style === 'metal') {
      // 金属门：横向板缝 + X 形斜撑钢架 + 铆钉（呼应埃菲尔钢架）
      ctx.strokeStyle = 'rgba(0,0,0,0.30)';
      ctx.lineWidth = 1;
      for (let i = 1; i < 4; i++) {
        const yy = dy + (doorH / 4) * i;
        ctx.beginPath(); ctx.moveTo(dx + 3, yy); ctx.lineTo(dx + doorW - 3, yy); ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(0,0,0,0.22)';
      ctx.beginPath();
      ctx.moveTo(dx + 4, dy + 6); ctx.lineTo(dx + doorW - 4, dy + doorH - 6);
      ctx.moveTo(dx + doorW - 4, dy + 6); ctx.lineTo(dx + 4, dy + doorH - 6);
      ctx.stroke();
      ctx.fillStyle = 'rgba(20,24,30,0.8)';
      [[dx + 5, dy + 5], [dx + doorW - 5, dy + 5], [dx + 5, dy + doorH - 5], [dx + doorW - 5, dy + doorH - 5]]
        .forEach(([bx, by]) => { ctx.beginPath(); ctx.arc(bx, by, 2, 0, Math.PI * 2); ctx.fill(); });
    } else if (m.style === 'stone') {
      // 石门：巨石门板 + 横向刻线 + 内嵌面板（金字塔 / 白墙 / 山石）
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.lineWidth = 1;
      for (let i = 1; i < 3; i++) {
        const yy = dy + (doorH / 3) * i;
        ctx.beginPath(); ctx.moveTo(dx + 4, yy); ctx.lineTo(dx + doorW - 4, yy); ctx.stroke();
      }
      ctx.fillStyle = 'rgba(0,0,0,0.16)';
      ctx.fillRect(dx + 6, dy + 8, doorW - 12, doorH * 0.30);
    } else {
      // 木门：木纹 + 两个内嵌面板（城门木门风格）
      ctx.strokeStyle = 'rgba(60,36,18,0.30)';
      ctx.lineWidth = 1;
      for (let i = 1; i < 4; i++) {
        const yy = dy + (doorH / 4) * i;
        ctx.beginPath(); ctx.moveTo(dx + 3, yy); ctx.lineTo(dx + doorW - 3, yy); ctx.stroke();
      }
      ctx.fillStyle = 'rgba(60,36,18,0.28)';
      ctx.fillRect(dx + 5, dy + 8, doorW - 10, doorH * 0.34);
      ctx.fillRect(dx + 5, dy + doorH * 0.56, doorW - 10, doorH * 0.32);
    }
    // 门把手
    ctx.fillStyle = m.accent;
    ctx.beginPath(); ctx.arc(dx + doorW - 10, dy + doorH * 0.52, 3, 0, Math.PI * 2); ctx.fill();
    // 门顶指示灯（提示这是出口）
    const pulse = 0.5 + 0.5 * Math.sin(t * 4);
    ctx.fillStyle = `rgba(255,224,130,${0.5 + 0.4 * pulse})`;
    ctx.beginPath(); ctx.arc(dx + doorW / 2, dy - 7, 4, 0, Math.PI * 2); ctx.fill();
  }

  function drawTileAt(t, px, py) {
    switch (t) {
      case 'E':
        drawDoor(px, py);
        break;
      case '~': { // 水（只杀火娃）：深水渐变 + 双层表面波浪 + 波光
        const g = ctx.createLinearGradient(0, py, 0, py + TILE);
        g.addColorStop(0, '#3aa0e0');
        g.addColorStop(0.4, '#1f6fb2');
        g.addColorStop(1, '#10446f');
        ctx.fillStyle = g;
        ctx.fillRect(px, py, TILE, TILE);
        // 表面波浪（两层正弦叠加，半透明）
        for (let i = 0; i < 2; i++) {
          ctx.fillStyle = i === 0 ? 'rgba(140,210,255,0.55)' : 'rgba(60,150,220,0.35)';
          ctx.beginPath();
          ctx.moveTo(px, py + 8 + i * 4);
          for (let x = 0; x <= TILE; x += 6) {
            const y = py + 8 + i * 4 + Math.sin(t * 3 + x * 0.35 + i * 2) * 2.5;
            ctx.lineTo(px + x, y);
          }
          ctx.lineTo(px + TILE, py + 14 + i * 4);
          ctx.lineTo(px, py + 14 + i * 4);
          ctx.closePath();
          ctx.fill();
        }
        // 顶部高光
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fillRect(px, py, TILE, 2);
        // 波光（确定性闪点）
        ctx.fillStyle = 'rgba(220,245,255,0.7)';
        for (let i = 0; i < 3; i++) {
          const sx = px + ((i * 17 + Math.floor(t * 2)) % TILE);
          const sy = py + 8 + ((i * 9) % 14);
          ctx.fillRect(sx, sy, 3, 1);
        }
        break;
      }
      case '%': { // 岩浆（只杀水娃）：熔岩渐变 + 亮纹 + 上冒火星
        const g = ctx.createLinearGradient(0, py, 0, py + TILE);
        g.addColorStop(0, '#ff8c2a');
        g.addColorStop(0.4, '#e2471c');
        g.addColorStop(1, '#7e1208');
        ctx.fillStyle = g;
        ctx.fillRect(px, py, TILE, TILE);
        // 表面亮线
        ctx.fillStyle = '#ffd23e';
        ctx.fillRect(px, py + 3 + Math.sin(t * 4 + px) * 2, TILE, 3);
        // 内部暗红亮纹
        ctx.fillStyle = 'rgba(255,150,50,0.55)';
        for (let i = 0; i < 3; i++) {
          ctx.fillRect(px, py + 14 + i * 10, TILE, 2);
        }
        // 上冒火星（确定性，越往上越淡）
        for (let i = 0; i < 3; i++) {
          const ph = (t * 26 + i * 17) % TILE;
          const sy = py + TILE - ph;
          const sx = px + ((i * 13 + Math.sin(t * 2 + i) * 4 + TILE) % TILE);
          ctx.globalAlpha = 0.2 + 0.5 * (ph / TILE);
          ctx.fillStyle = '#ffd9a0';
          ctx.fillRect(sx, sy, 2, 2);
          ctx.globalAlpha = 1;
        }
        break;
      }
      case 'A': { // 酸液（杀两人）：酸性渐变 + 表面 + 气泡
        const g = ctx.createLinearGradient(0, py, 0, py + TILE);
        g.addColorStop(0, '#7ad24a');
        g.addColorStop(0.5, '#3f9c2f');
        g.addColorStop(1, '#1f5e1a');
        ctx.fillStyle = g;
        ctx.fillRect(px, py, TILE, TILE);
        ctx.fillStyle = '#b6f08a';
        ctx.fillRect(px, py + 3 + Math.sin(t * 5 + px) * 2, TILE, 4);
        // 上升气泡
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        for (let i = 0; i < 2; i++) {
          const b = (t * 20 + i * 23) % TILE;
          ctx.beginPath();
          ctx.arc(px + ((i * 19 + b) % TILE), py + TILE - b * 0.6, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      case 'T': { // 珍珠奶茶（水娃收集）
        const cx = px + TILE / 2, cy = py + TILE / 2 + 3;
        ctx.save();
        ctx.translate(0, Math.sin(t * 3 + px) * 3);
        drawTeaIcon(cx, cy, 1);
        ctx.restore();
        break;
      }
      case 'B': { // 汉堡（火娃收集）
        const cx = px + TILE / 2, cy = py + TILE / 2 + 3;
        ctx.save();
        ctx.translate(0, Math.sin(t * 3 + px + 1) * 3);
        drawBurgerIcon(cx, cy, 1);
        ctx.restore();
        break;
      }
    }
  }

  function drawLevel() {
    // 静态地形（# / ^）一次性烘焙整层绘制
    ctx.drawImage(bakeTerrain(), 0, 0);
    // 动态瓦片（门 / 水 / 岩浆 / 酸液 / 物品）逐帧绘制
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const t = level.grid[y][x];
        if (t === '.' || t === 'F' || t === 'W' || t === '#' || t === '^') continue;
        if (t === 'T' || t === 'B') {
          const it = level.items.find(i => i.x === x && i.y === y);
          if (it && it.taken) continue;
        }
        drawTileAt(t, x * TILE, y * TILE);
      }
    }
  }

  /* ---------- 机关渲染 ---------- */
  function drawMechanisms() {
    if (!level || !level.mechanisms) return;
    for (const m of level.mechanisms) {
      if (m.type === 'platform') drawPlatform(m);
      else if (m.type === 'plate') drawPlate(m);
      else if (m.type === 'gate') drawGate(m);
      else if (m.type === 'seq') drawSeq(m);
      else if (m.type === 'temp') drawTemp(m);
      else if (m.type === 'beam') drawBeam(m);
      else if (m.type === 'tide') drawTide(m);
    }
  }

  function drawPlatform(m) {
    const px = m.px, py = m.py, pw = m.pw, ph = TILE;
    const mat = Themes.matFor(level.theme, 'platform');
    ctx.save();
    // 顶面受光 → 侧面 渐变
    const g = ctx.createLinearGradient(px, py, px, py + ph);
    g.addColorStop(0, mat.top);
    g.addColorStop(1, mat.side);
    ctx.fillStyle = g;
    ctx.fillRect(px, py, pw, ph);
    // 顶面高光唇线 + 底面阴影唇线
    ctx.fillStyle = mat.rivetHi;
    ctx.fillRect(px, py, pw, 3);
    ctx.fillStyle = mat.lip;
    ctx.fillRect(px, py + ph - 5, pw, 5);
    // 纵向板缝（木板 / 金属板）
    ctx.strokeStyle = mat.seam;
    ctx.lineWidth = 1;
    for (let xx = px + 16; xx < px + pw - 1; xx += 16) {
      ctx.beginPath(); ctx.moveTo(xx + 0.5, py + 3); ctx.lineTo(xx + 0.5, py + ph - 5); ctx.stroke();
    }
    // 两端铆钉
    const riv = [[px + 8, py + ph / 2], [px + pw - 8, py + ph / 2]];
    ctx.fillStyle = mat.rivet;
    riv.forEach(([bx, by]) => { ctx.beginPath(); ctx.arc(bx, by, 2.2, 0, Math.PI * 2); ctx.fill(); });
    ctx.fillStyle = mat.rivetHi;
    riv.forEach(([bx, by]) => { ctx.beginPath(); ctx.arc(bx - 0.4, by - 0.5, 1, 0, Math.PI * 2); ctx.fill(); });
    // 柔和描边
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.strokeRect(px + 0.5, py + 0.5, pw - 1, ph - 1);
    ctx.restore();
  }

  function drawPlate(m) {
    const px = m.x * TILE, py = m.y * TILE;
    const d = m.active ? 4 : 0;
    const mat = Themes.matFor(level.theme, 'plate');
    ctx.save();
    // 凹槽阴影
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(px + 3, py + TILE - 9, TILE - 6, 9);
    // 外框 + 板体（激活时下沉并变绿）
    ctx.fillStyle = mat.base;
    ctx.fillRect(px + 6, py + TILE - 15 + d, TILE - 12, 11);
    ctx.fillStyle = m.active ? mat.active : mat.face;
    ctx.fillRect(px + 8, py + TILE - 14 + d, TILE - 16, 10);
    ctx.fillStyle = m.active ? 'rgba(140,255,170,0.95)' : mat.faceHi;
    ctx.fillRect(px + 8, py + TILE - 14 + d, TILE - 16, 3);
    if (m.active) {
      ctx.strokeStyle = 'rgba(120,255,150,0.6)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(px + TILE / 2, py + TILE - 9, 14, 0, Math.PI * 2); ctx.stroke();
    }
    // 角色专属板：板面上标出 火/水，提示只有对应角色能踩
    if (m.only) {
      ctx.fillStyle = m.only === 'fire' ? '#ff5a2a' : '#2f7fe0';
      ctx.beginPath(); ctx.arc(px + TILE / 2, py + TILE - 9, 8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(m.only === 'fire' ? '火' : '水', px + TILE / 2, py + TILE - 8);
    }
    ctx.restore();
  }

  function drawGate(m) {
    const px = m.x * TILE, py = m.y * TILE;
    const w = m.w * TILE, h = m.h * TILE;
    const off = -m.openAmount * h;   // 打开时向上滑出
    const mat = Themes.matFor(level.theme, 'gate');
    ctx.save();
    // 门洞底阴影
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(px, py + h - 6, w, 6);
    // 门体（中间亮、两侧暗）
    const g = ctx.createLinearGradient(px, 0, px + w, 0);
    g.addColorStop(0, Themes.shade(mat.side, 0.85));
    g.addColorStop(0.5, mat.top);
    g.addColorStop(1, mat.side);
    ctx.fillStyle = g;
    ctx.fillRect(px, py + off, w, h);
    // 横向横梁缝
    ctx.strokeStyle = mat.seam;
    ctx.lineWidth = 1;
    for (let i = 1; i < m.h; i++) {
      const yy = py + off + i * TILE;
      ctx.beginPath(); ctx.moveTo(px + 2, yy); ctx.lineTo(px + w - 2, yy); ctx.stroke();
    }
    // 底部栅栏尖齿（金属栅栏 / 石门榫头）
    ctx.fillStyle = mat.rail;
    for (let xx = px + 4; xx < px + w - 2; xx += 12) {
      ctx.beginPath();
      ctx.moveTo(xx, py + off + h);
      ctx.lineTo(xx + 6, py + off + h);
      ctx.lineTo(xx + 3, py + off + h - 8);
      ctx.closePath();
      ctx.fill();
    }
    // 描边
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.strokeRect(px + 0.5, py + off + 0.5, w - 1, h - 1);
    // 状态灯
    ctx.fillStyle = m.open ? '#5fd06a' : '#e0553c';
    ctx.beginPath(); ctx.arc(px + w / 2, py + off + 14, 5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // 顺序石板：圆形石盘 + 顺序数字（未激活=暗 / 踩中=亮 / 已锁存=绿 / 踩错=红闪）
  function drawSeq(m) {
    const px = m.x * TILE, py = m.y * TILE;
    const cx = px + TILE / 2, cy = py + TILE - 12;
    const mat = Themes.matFor(level.theme, 'plate');
    const pressed = [fire, water].some(p =>
      p.x + p.w > px + 5 && p.x < px + TILE - 5 && Math.abs((p.y + p.h) - py) < 12);
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(px + 3, py + TILE - 9, TILE - 6, 9);
    ctx.fillStyle = m.active ? mat.active : mat.base;
    ctx.beginPath(); ctx.arc(cx, cy, 14, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = m.active ? 'rgba(140,255,170,0.9)' : (pressed ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.4)');
    ctx.lineWidth = m.active ? 2.5 : 1.5;
    ctx.beginPath(); ctx.arc(cx, cy, 14, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = m.active ? '#0b3a17' : (pressed ? '#fff' : 'rgba(255,255,255,0.85)');
    ctx.font = 'bold 15px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(m.order), cx, cy + 1);
    if (m.flash > 0) {
      ctx.strokeStyle = `rgba(255,80,60,${Math.min(1, m.flash * 2)})`;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(cx, cy, 17, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }

  // 临时道路：主题化平台（显现=实 / 即将关闭=急闪 / 消失=幽灵虚线轮廓）
  function drawTemp(m) {
    const px = m.x * TILE, py = m.y * TILE, pw = m.w * TILE, ph = TILE;
    const mat = Themes.matFor(level.theme, 'platform');
    let alpha = 1;
    if (!m.solid) alpha = 0.22;
    if (m.warn) alpha = 0.35 + 0.5 * Math.abs(Math.sin(t * 14));
    ctx.save();
    ctx.globalAlpha = alpha;
    const g = ctx.createLinearGradient(px, py, px, py + ph);
    g.addColorStop(0, mat.top);
    g.addColorStop(1, mat.side);
    ctx.fillStyle = g;
    ctx.fillRect(px, py, pw, ph);
    ctx.fillStyle = mat.rivetHi;
    ctx.fillRect(px, py, pw, 3);
    ctx.fillStyle = mat.lip;
    ctx.fillRect(px, py + ph - 5, pw, 5);
    ctx.strokeStyle = mat.seam;
    ctx.lineWidth = 1;
    for (let xx = px + 16; xx < px + pw - 1; xx += 16) {
      ctx.beginPath(); ctx.moveTo(xx + 0.5, py + 3); ctx.lineTo(xx + 0.5, py + ph - 5); ctx.stroke();
    }
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = m.solid ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.35)';
    ctx.strokeRect(px + 0.5, py + 0.5, pw - 1, ph - 1);
    ctx.setLineDash([]);
    ctx.restore();
  }

  // 能量传递：节点光珠 + 上游连线（点亮=绿光，未点亮=虚线灰）
  function drawBeam(m) {
    const px = m.x * TILE + TILE / 2, py = m.y * TILE + TILE / 2;
    const beamById = {};
    for (const n of level.mechanisms) if (n.type === 'beam') beamById[n.id] = n;
    ctx.save();
    const prevs = Array.isArray(m.prev) ? m.prev : (m.prev ? [m.prev] : []);
    for (const id of prevs) {
      const up = beamById[id];
      if (!up) continue;
      const ux = up.x * TILE + TILE / 2, uy = up.y * TILE + TILE / 2;
      const on = up.powered && m.powered;
      ctx.strokeStyle = on ? 'rgba(120,255,170,0.9)' : 'rgba(255,255,255,0.18)';
      ctx.lineWidth = on ? 3 : 1.5;
      ctx.setLineDash(on ? [] : [6, 5]);
      ctx.beginPath(); ctx.moveTo(ux, uy); ctx.lineTo(px, py); ctx.stroke();
      ctx.setLineDash([]);
    }
    const r = 7 + (m.powered ? Math.sin(t * 5 + m.x) * 1.5 : 0);
    ctx.fillStyle = m.powered ? 'rgba(120,255,170,0.5)' : 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.arc(px, py, r + 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = m.powered ? '#7cffa0' : '#6b7480';
    ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill();
    if (m.role) {
      ctx.fillStyle = m.role === 'fire' ? '#ff5a2a' : '#2f7fe0';
      ctx.beginPath(); ctx.arc(px, py, 6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(m.role === 'fire' ? '火' : '水', px, py + 1);
    }
    ctx.restore();
  }

  // 潮汐：涨潮时从海面（surf）灌到 floorY，画起伏海面（纯视觉，不阻挡）
  function drawTide(m) {
    const topPx = m.surf * TILE;
    const botPx = (m.floorY + 1) * TILE;
    if (topPx >= botPx) return;
    const x0 = m.x * TILE, x1 = (m.x + m.w) * TILE;
    ctx.save();
    const g = ctx.createLinearGradient(0, topPx, 0, botPx);
    g.addColorStop(0, 'rgba(58,160,224,0.82)');
    g.addColorStop(1, 'rgba(16,68,111,0.82)');
    ctx.fillStyle = g;
    ctx.fillRect(x0, topPx, x1 - x0, botPx - topPx);
    ctx.fillStyle = 'rgba(150,215,255,0.85)';
    ctx.beginPath();
    ctx.moveTo(x0, botPx);
    ctx.lineTo(x0, topPx);
    for (let x = 0; x <= x1 - x0; x += 6) {
      const yy = topPx + Math.sin(t * 3 + (x0 + x) * 0.35) * 2.5;
      ctx.lineTo(x0 + x, yy);
    }
    ctx.lineTo(x1, botPx);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x0 + 0.5, topPx + 0.5, x1 - x0 - 1, botPx - topPx - 1);
    ctx.restore();
  }

  /* ---------- 标题界面 ---------- */
  function drawKey(label, x, cy, w) {
    const h = 26, r = 6;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    rr(x, cy - h / 2 + 2, w, h, r); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    rr(x, cy - h / 2, w, h, r); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.26)';
    ctx.lineWidth = 1;
    rr(x, cy - h / 2, w, h, r); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.font = `600 13px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + w / 2, cy + 1);
    ctx.restore();
  }

  function drawBadge(label, cx, cy, color) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = `700 13px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, cx, cy + 1);
    ctx.restore();
  }

  const ROLES = [
    { badge: '火', color: '#ff5a2a', name: '火娃', move: ['A', 'D'], jump: 'W', item: '· 吃汉堡' },
    { badge: '水', color: '#2f7fe0', name: '水娃', move: ['←', '→'], jump: '↑', item: '· 喝奶茶' },
  ];

  function drawRoleRow(cx, y, role) {
    const KEY_W = 30, KEY_GAP = 8, SEP = 18;
    const nameFont = `600 17px ${FONT}`;
    const descFont = `400 14px ${FONT}`;

    ctx.font = nameFont; const nameW = ctx.measureText(role.name).width;
    ctx.font = descFont; const moveW = ctx.measureText('移动').width;
    ctx.font = descFont; const jumpW = ctx.measureText('跳').width;
    ctx.font = descFont; const itemW = ctx.measureText(role.item).width;

    const total =
      22 + 10 + nameW + SEP +
      (role.move.length * (KEY_W + KEY_GAP)) + moveW + SEP +
      (KEY_W + KEY_GAP) + jumpW + SEP + itemW;

    let x = cx - total / 2;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';

    drawBadge(role.badge, x + 11, y, role.color); x += 22 + 10;
    ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.font = nameFont;
    ctx.fillText(role.name, x, y + 1); x += nameW + SEP;

    for (const k of role.move) { drawKey(k, x, y, KEY_W); x += KEY_W + KEY_GAP; }
    ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.font = descFont;
    ctx.fillText('移动', x, y + 1); x += moveW + SEP;

    drawKey(role.jump, x, y, KEY_W); x += KEY_W + KEY_GAP;
    ctx.fillText('跳', x, y + 1); x += jumpW + SEP;

    ctx.fillStyle = 'rgba(255,215,106,0.9)';
    ctx.fillText(role.item, x, y + 1);
  }

  /* ---------- 菜单：森林月夜背景 / 藤蔓 / 按钮 / 关卡卡片 ---------- */

  function drawForestFallback() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0a1626');
    g.addColorStop(0.55, '#12231f');
    g.addColorStop(1, '#07110d');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    // 发光月亮
    const mx = W * 0.72, my = H * 0.2, mr = 42;
    const mg = ctx.createRadialGradient(mx, my, 0, mx, my, mr * 3);
    mg.addColorStop(0, 'rgba(240,246,255,0.95)');
    mg.addColorStop(0.18, 'rgba(210,226,255,0.5)');
    mg.addColorStop(1, 'rgba(180,205,255,0)');
    ctx.fillStyle = mg; ctx.beginPath(); ctx.arc(mx, my, mr * 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(236,242,255,0.95)';
    ctx.beginPath(); ctx.arc(mx, my, mr, 0, Math.PI * 2); ctx.fill();

    // 近处深色针叶树剪影
    for (let i = 0; i < 14; i++) {
      const tx = (i * 73 + 20) % W;
      const base = H - ((i * 37) % 80);
      const hh = 120 + ((i * 53) % 160);
      ctx.fillStyle = 'rgba(6,12,10,0.85)';
      ctx.beginPath();
      ctx.moveTo(tx - 26, base);
      ctx.lineTo(tx, base - hh);
      ctx.lineTo(tx + 26, base);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(tx - 3, base - 8, 6, 8);
    }

    // 漂浮的萤火虫（全局时间 t 驱动轻微明灭）
    for (let i = 0; i < 18; i++) {
      const fx = (i * 149 + 37) % W;
      const fy = 60 + ((i * 97 + 23) % (H - 160));
      const tw = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(t * 2 + i * 1.7));
      ctx.fillStyle = `rgba(190,235,160,${(0.25 + 0.55 * tw).toFixed(3)})`;
      ctx.beginPath(); ctx.arc(fx, fy, 1.4 + tw * 1.4, 0, Math.PI * 2); ctx.fill();
    }
  }

  function drawMenuBackground() {
    if (menuImg) {
      const scale = Math.max(W / menuImg.width, H / menuImg.height);
      const dw = menuImg.width * scale, dh = menuImg.height * scale;
      ctx.drawImage(menuImg, (W - dw) / 2, (H - dh) / 2, dw, dh);
    } else {
      drawForestFallback();
    }
    // 月光柔光（右上冷光铺下，营造「黑暗森林有月光」）
    const moon = ctx.createRadialGradient(W * 0.72, H * 0.16, 0, W * 0.72, H * 0.16, H * 0.9);
    moon.addColorStop(0, 'rgba(190,215,255,0.30)');
    moon.addColorStop(0.35, 'rgba(150,190,255,0.12)');
    moon.addColorStop(1, 'rgba(10,20,40,0)');
    ctx.fillStyle = moon;
    ctx.fillRect(0, 0, W, H);
    // 冷蓝夜色罩
    ctx.fillStyle = 'rgba(26,42,74,0.18)';
    ctx.fillRect(0, 0, W, H);
    // 四周暗角（聚焦中央，避免过于阴森）
    const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.32, W / 2, H / 2, H * 0.95);
    vg.addColorStop(0, 'rgba(6,12,20,0)');
    vg.addColorStop(1, 'rgba(6,12,20,0.70)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
  }

  function drawLeaf(x, y, ang, s, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(0, 0, 7 * s, 3.2 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawVine(x1, y1, cx, cy, x2, y2, step, color, leafColor) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.quadraticCurveTo(cx, cy, x2, y2);
    ctx.stroke();
    const len = Math.hypot(x2 - x1, y2 - y1);
    const n = Math.max(1, Math.floor(len / step));
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const ix = (1 - u) * (1 - u) * x1 + 2 * (1 - u) * u * cx + u * u * x2;
      const iy = (1 - u) * (1 - u) * y1 + 2 * (1 - u) * u * cy + u * u * y2;
      const dx = 2 * (1 - u) * (cx - x1) + 2 * u * (x2 - cx);
      const dy = 2 * (1 - u) * (cy - y1) + 2 * u * (y2 - cy);
      const ang = Math.atan2(dy, dx) + (i % 2 === 0 ? Math.PI / 2 : -Math.PI / 2);
      drawLeaf(ix, iy, ang, 1, leafColor);
    }
  }

  function drawButton(label, r, hovered, pressed) {
    const off = pressed ? 2 : 0;
    const x = r.x, y = r.y + off, w = r.w, h = r.h;
    // 投影
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    rr(x, y + 5, w, h, 14); ctx.fill();
    // 主体渐变（悬停提亮 / 按下变暗）
    const g = ctx.createLinearGradient(x, y, x, y + h);
    if (pressed) { g.addColorStop(0, '#3a6b30'); g.addColorStop(1, '#2c4f26'); }
    else if (hovered) { g.addColorStop(0, '#79bd63'); g.addColorStop(1, '#4d8240'); }
    else { g.addColorStop(0, '#5a9648'); g.addColorStop(1, '#35642c'); }
    ctx.fillStyle = g;
    rr(x, y, w, h, 14); ctx.fill();
    // 描边 + 内高光
    ctx.strokeStyle = hovered ? 'rgba(230,255,210,0.7)' : 'rgba(210,240,190,0.35)';
    ctx.lineWidth = 1.5;
    rr(x, y, w, h, 14); ctx.stroke();
    // 加粗文字
    ctx.fillStyle = '#f6fff1';
    ctx.font = `700 24px ${FONT}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.4)'; ctx.shadowBlur = 4;
    ctx.fillText(label, x + w / 2, y + h / 2 + 1);
    ctx.shadowBlur = 0;
  }

  function levelCardLayout() {
    const cols = 4, cw = 200, ch = 128, gapX = 18, rowGap = 168;
    const startX = (W - (cols * cw + (cols - 1) * gapX)) / 2;
    const cardTop = 128;
    const cards = [];
    for (let i = 0; i < LEVELS.length; i++) {
      const r = Math.floor(i / cols), c = i % cols;
      cards.push({ i, x: startX + c * (cw + gapX), y: cardTop + r * rowGap, w: cw, h: ch });
    }
    return { cards, cw, ch };
  }

  function menuButtons() {
    if (state === 'title') {
      const cx = W / 2;
      const btns = [{ id: 'start', x: cx - 130, y: 372, w: 260, h: 58 }];
      if (allCleared) btns.push({ id: 'levels', x: cx - 130, y: 448, w: 260, h: 58 });
      return btns;
    }
    if (state === 'levelselect') {
      const { cards } = levelCardLayout();
      const out = cards.map(c => ({ id: 'level:' + c.i, x: c.x, y: c.y, w: c.w, h: c.h }));
      out.push({ id: 'back', x: 24, y: 22, w: 96, h: 40 });
      return out;
    }
    return [];
  }

  function drawTitle() {
    drawMenuBackground();
    const cx = W / 2;
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';

    const title = '奶蛙冰火人';
    const titleY = 122;
    ctx.fillStyle = '#f6f1e6';
    ctx.font = `700 64px ${FONT}`;
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 18;
    ctx.fillText(title, cx, titleY);
    ctx.shadowBlur = 0;
    const tw = ctx.measureText(title).width;
    const tx0 = cx - tw / 2, tx1 = cx + tw / 2;

    // 藤蔓缠绕标题（顶部两根交叉 + 两侧垂下藤蔓尖）
    drawVine(tx0 - 24, titleY - 56, cx - 30, titleY - 46, cx + 40, titleY - 62, 26, 'rgba(47,94,54,0.92)', 'rgba(63,122,69,0.92)');
    drawVine(tx0 - 6, titleY - 66, cx + 60, titleY - 72, tx1 + 22, titleY - 50, 30, 'rgba(38,78,46,0.85)', 'rgba(47,94,54,0.9)');
    drawVine(tx0 - 8, titleY - 56, tx0 - 22, titleY - 20, tx0 - 4, titleY + 6, 22, 'rgba(38,78,46,0.8)', 'rgba(47,94,54,0.85)');
    drawVine(tx1 + 8, titleY - 56, tx1 + 22, titleY - 20, tx1 + 4, titleY + 6, 22, 'rgba(38,78,46,0.8)', 'rgba(47,94,54,0.85)');

    // 地板：标题下方一条暗色土/木横带，两角色脚踩其上（写实、无光晕、无「火/水」标签）
    // 两角色放大占满两侧（红圈标注位），脚踩地板、头顶略低于标题藤蔓
    const floorY = 530;
    const fg = ctx.createLinearGradient(0, floorY, 0, floorY + 18);
    fg.addColorStop(0, 'rgba(58,72,50,0.45)');
    fg.addColorStop(1, 'rgba(18,22,14,0)');
    ctx.fillStyle = fg;
    ctx.fillRect(0, floorY, W, 18);
    ctx.fillStyle = 'rgba(200,220,180,0.22)';
    ctx.fillRect(0, floorY, W, 2);

    const fx = W * 0.14, wx = W * 0.86;
    const mo = { spriteH: 390, showBadge: false, glow: false };
    drawPlayer({ type: 'fire', x: fx, y: floorY, w: 0, h: 0, onGround: true, landedT: 0 }, mo);
    drawPlayer({ type: 'water', x: wx, y: floorY, w: 0, h: 0, onGround: true, landedT: 0 }, mo);

    // 按钮
    drawButton('开始游戏', { x: cx - 130, y: 372, w: 260, h: 58 }, hoverId === 'start', pressId === 'start');
    if (allCleared) {
      drawButton('关卡选择', { x: cx - 130, y: 448, w: 260, h: 58 }, hoverId === 'levels', pressId === 'levels');
    }

    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = `500 13px ${FONT}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillText('火娃 A/D 移动 · W 跳　　水娃 方向键移动 · ↑ 跳', cx, H - 22);
  }

  function drawLevelSelect() {
    drawMenuBackground();
    const cx = W / 2;
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#f6f1e6';
    ctx.font = `700 36px ${FONT}`;
    ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 14;
    ctx.fillText('选择关卡', cx, 64);
    ctx.shadowBlur = 0;

    const { cards } = levelCardLayout();
    for (const c of cards) {
      const lv = LEVELS[c.i];
      const photo = bgs[lv.theme];
      const hovered = hoverId === 'level:' + c.i;
      const pressed = pressId === 'level:' + c.i;

      // 照片 cover 裁切进圆角框
      ctx.save();
      rr(c.x, c.y, c.w, c.h, 12);
      ctx.clip();
      if (photo) {
        const scale = Math.max(c.w / photo.width, c.h / photo.height);
        const dw = photo.width * scale, dh = photo.height * scale;
        ctx.drawImage(photo, c.x + (c.w - dw) / 2, c.y + (c.h - dh) / 2, dw, dh);
        ctx.fillStyle = pressed ? 'rgba(6,12,20,0.40)' : 'rgba(6,12,20,0.20)';
        ctx.fillRect(c.x, c.y, c.w, c.h);
      } else {
        ctx.fillStyle = '#14231e';
        ctx.fillRect(c.x, c.y, c.w, c.h);
      }
      ctx.restore();

      // 藤蔓缠绕的图片框
      ctx.strokeStyle = hovered ? 'rgba(220,255,200,0.75)' : 'rgba(200,230,180,0.35)';
      ctx.lineWidth = hovered ? 2.5 : 1.5;
      rr(c.x, c.y, c.w, c.h, 12); ctx.stroke();
      drawVine(c.x + 6, c.y + 4, c.x + c.w / 2, c.y - 6, c.x + c.w - 6, c.y + 4, 30, 'rgba(47,94,54,0.92)', 'rgba(63,122,69,0.92)');
      drawLeaf(c.x + 10, c.y + 6, -0.7, 1.1, 'rgba(63,122,69,0.92)');
      drawLeaf(c.x + c.w - 10, c.y + 6, 0.7, 1.1, 'rgba(63,122,69,0.92)');

      // 小标题
      const short = (lv.name.split(' · ')[1]) || lv.name;
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.font = `600 15px ${FONT}`;
      ctx.fillText(`第${c.i + 1}关 ${short}`, c.x + c.w / 2, c.y + c.h + 24);
    }

    drawButton('返回', { x: 24, y: 22, w: 96, h: 40 }, hoverId === 'back', pressId === 'back');
  }

  function drawPlayer(p, o) {
    const img = imgs[p.type];
    const feetX = p.x + p.w / 2;
    const feetY = p.y + p.h;
    const spriteH = (o && o.spriteH) || 84;
    const spriteW = img ? spriteH * img.width / img.height : 40;
    const showBadge = !o || o.showBadge !== false;

    // 脚下软阴影（立体感）
    const airborne = !p.onGround;
    const shW = spriteW * 0.5 * (airborne ? 0.6 : 1);
    const shA = airborne ? 0.18 : 0.32;
    const sg = ctx.createRadialGradient(feetX, feetY, 0, feetX, feetY, shW);
    sg.addColorStop(0, `rgba(0,0,0,${shA})`);
    sg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.ellipse(feetX, feetY + 2, shW, shW * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();

    // 挤压/拉伸 + 待机浮动
    let sx = 1, sy = 1, bob = 0;
    if (!p.onGround) { sy = 1.08; sx = 0.94; }          // 跳跃拉伸
    else if (p.landedT > 0.15) { sy = 0.9; sx = 1.08; }  // 落地挤压
    else bob = Math.sin(t * 3 + p.x) * 1.5;

    // 暖/冷色光晕（开始界面可关闭，改为写实的清晰轮廓 + 脚下软影）
    const glowOn = !o || o.glow !== false;
    const glow = p.type === 'fire' ? 'rgba(255,120,40,0.85)' : 'rgba(70,160,255,0.85)';

    ctx.save();
    ctx.translate(feetX, feetY + bob);
    ctx.scale(sx, sy);
    if (o && o.blur) ctx.filter = `blur(${o.blur}px)`;
    if (o && o.opacity != null) ctx.globalAlpha = o.opacity;
    if (img) {
      if (glowOn) { ctx.shadowColor = glow; ctx.shadowBlur = 14; }
      ctx.drawImage(img, -spriteW / 2, -spriteH, spriteW, spriteH);
    } else {
      // 未加载时的占位
      ctx.fillStyle = p.type === 'fire' ? '#ff6b3d' : '#4aa3ff';
      ctx.fillRect(-spriteW / 2, -spriteH, spriteW, spriteH);
    }
    ctx.restore();

    // 头顶「火 / 水」标记（开始界面可关闭）
    if (showBadge) {
      const label = p.type === 'fire' ? '火' : '水';
      const badgeColor = p.type === 'fire' ? '#ff5a2a' : '#2f7fe0';
      ctx.save();
      ctx.fillStyle = badgeColor;
      ctx.beginPath();
      ctx.arc(feetX, feetY - spriteH - 12 + bob, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, feetX, feetY - spriteH - 12 + bob + 1);
      ctx.restore();
    }
  }

  function drawHUD() {
    if (state === 'tutorial') return;   // 教学态不显示关卡 HUD（由弹窗取代）
    const tLeft = level.items.filter(i => i.kind === 'T' && !i.taken).length;
    const bLeft = level.items.filter(i => i.kind === 'B' && !i.taken).length;

    ctx.save();
    // 顶部轻透渐变 + 细分隔线
    const hg = ctx.createLinearGradient(0, 0, 0, 40);
    hg.addColorStop(0, 'rgba(4,9,16,0.55)');
    hg.addColorStop(1, 'rgba(4,9,16,0)');
    ctx.fillStyle = hg;
    ctx.fillRect(0, 0, W, 40);
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, 40.5); ctx.lineTo(W, 40.5); ctx.stroke();

    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = `600 16px ${FONT}`;
    const lvName = (level && level.name) ? level.name : '';
    ctx.fillText(`第 ${levelIndex + 1} / ${LEVELS.length} 关 · ${lvName}`, 16, 20);

    // 右侧剩余物品（迷你图标 + 数量）
    ctx.textAlign = 'right';
    ctx.font = `600 15px ${FONT}`;
    const bt = `×${bLeft}`;
    const bw = ctx.measureText(bt).width;
    ctx.fillStyle = '#e8a33d';
    ctx.fillText(bt, W - 16, 20);
    drawBurgerIcon(W - 16 - bw - 9, 20, 0.5);

    const tt = `×${tLeft}`;
    const tw = ctx.measureText(tt).width;
    const teaRight = W - 16 - bw - 9 - 14 - 6;
    ctx.fillStyle = '#e8b06a';
    ctx.fillText(tt, teaRight, 20);
    drawTeaIcon(teaRight - tw - 9, 20, 0.5);

    // 都到门口但物品没拿齐时提示
    if (state === 'playing' && fire.onExit && water.onExit && (tLeft + bLeft > 0)) {
      ctx.fillStyle = '#ffd76a';
      ctx.textAlign = 'center';
      ctx.font = `500 15px ${FONT}`;
      ctx.fillText('还差奶茶 / 汉堡没拿齐！', W / 2, 60);
    }
    ctx.restore();
  }

  // 教学弹窗：顶部标题 + 提示，底部「按回车进入本关」（自动演示在弹窗下方循环播放）
  function drawTutorial() {
    if (!tutorial || !tutorial.def) return;
    const cx = W / 2;
    ctx.save();
    ctx.fillStyle = 'rgba(4,9,16,0.82)';
    ctx.fillRect(0, 0, W, 100);
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, 100.5); ctx.lineTo(W, 100.5); ctx.stroke();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffd76a';
    ctx.font = `700 24px ${FONT}`;
    ctx.fillText(tutorial.def.title || '新机关教学', cx, 40);
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.font = `500 16px ${FONT}`;
    ctx.fillText(tutorial.def.hint || '', cx, 72);
    const a = 0.55 + 0.45 * Math.sin(t * 3);
    ctx.fillStyle = `rgba(255,255,255,${a})`;
    ctx.font = `500 15px ${FONT}`;
    ctx.fillText('自动演示中 · 按 回车 进入本关', cx, H - 22);
    ctx.restore();
  }

  function drawOverlay(msg, sub, color) {
    const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, H * 0.78);
    vg.addColorStop(0, 'rgba(4,9,16,0.30)');
    vg.addColorStop(1, 'rgba(4,9,16,0.84)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = color || '#fff';
    ctx.font = `700 52px ${FONT}`;
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 16;
    ctx.fillText(msg, W / 2, H / 2 - 8);
    ctx.shadowBlur = 0;
    if (sub) {
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.font = `500 18px ${FONT}`;
      ctx.fillText(sub, W / 2, H / 2 + 42);
    }
  }

  function drawEffects() {
    for (const e of effects) {
      const p = Math.min(1, e.age / 0.4);
      const r = 6 + p * 18;
      const alpha = 1 - p;
      ctx.strokeStyle = `rgba(255,220,120,${alpha})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
      ctx.stroke();
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + p * 1.5;
        const px = e.x + Math.cos(a) * r, py = e.y + Math.sin(a) * r * 0.5;
        ctx.fillStyle = `rgba(255,220,120,${alpha * 0.9})`;
        ctx.fillRect(px - 1, py - 1, 2, 2);
      }
    }
  }

  function render() {
    // 测试钩子：暴露当前状态/关卡/可点击区（与 __naiwaTutorial 同风格，供 Node 桩断言）
    window.__naiwaState = state;
    window.__naiwaLevel = levelIndex;
    window.__naiwaMenu = menuButtons();

    // 开始/关卡选择界面：直接画自己的整屏场景，跳过下方的关卡渲染
    if (state === 'title' || state === 'levelselect') {
      if (state === 'title') drawTitle(); else drawLevelSelect();
      return;
    }

    drawBackground();
    drawLevel();
    drawMechanisms();
    drawPlayer(fire);
    drawPlayer(water);
    drawEffects();
    drawHUD();
    if (state === 'tutorial') drawTutorial();

    // 死亡柔闪 + 原因胶囊提示
    if (deathFlash > 0) {
      const a = Math.min(1, deathFlash * 2.5);
      ctx.fillStyle = `rgba(200,40,40,${a * 0.28})`;
      ctx.fillRect(0, 0, W, H);
      if (deathMsg) {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `600 20px ${FONT}`;
        const w = ctx.measureText(deathMsg).width + 48;
        ctx.fillStyle = 'rgba(20,10,12,0.72)';
        rr(W / 2 - w / 2, H / 2 - 26, w, 52, 26); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.lineWidth = 1;
        rr(W / 2 - w / 2, H / 2 - 26, w, 52, 26); ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.fillText(deathMsg, W / 2, H / 2 + 1);
      }
    }

    if (state === 'clear') {
      drawOverlay('过关！', levelIndex + 1 < LEVELS.length ? '下一关…' : '太棒了！', '#7CFC9E');
    } else if (state === 'done') {
      drawOverlay('全部通关！', '按 回车 回到开始界面', '#ffd76a');
    }
  }

  /* ---------- 主循环（固定时间步） ---------- */
  let last = performance.now();
  let acc = 0;
  function loop(now) {
    const frame = Math.min((now - last) / 1000, 0.25);
    last = now;
    acc += frame;
    // 标题：回车开始游戏；关卡选择：回车返回；全通关：回车回开始界面；教学演示：回车进入本关
    if (enterQueued) {
      enterQueued = false;
      if (state === 'title') {
        beginLevel(0);
      } else if (state === 'levelselect') {
        state = 'title';
      } else if (state === 'done') {
        state = 'title';
      } else if (state === 'tutorial') {
        endTutorial();
      }
    }
    while (acc >= FIXED_DT) {
      update();
      acc -= FIXED_DT;
    }
    render();
    requestAnimationFrame(loop);
  }

  /* ---------- 启动 ---------- */
  // 支持 ?autostart=1 跳过标题直接开始（便于测试/分享），?level=N 指定起始关，?tutorial=<id> 直接进教学演示（测试用）
  const params = new URLSearchParams(location.search);
  const autoStart = params.has('autostart');
  const startLevel = Math.max(0, Math.min(LEVELS.length - 1, parseInt(params.get('level') || '0', 10) || 0));
  const tutorialParam = params.get('tutorial');
  loadAssets().then(() => {
    if (tutorialParam && NaiwaTutorials[tutorialParam]) {
      startTutorial(tutorialParam);
    } else if (autoStart) {
      beginLevel(startLevel);
    } else {
      loadLevel(startLevel);
    }
    requestAnimationFrame((n) => { last = n; requestAnimationFrame(loop); });
  }).catch((e) => {
    console.error('资源加载失败', e);
    loadLevel(startLevel);
    requestAnimationFrame(loop);
  });
})();
