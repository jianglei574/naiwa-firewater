// 关卡可达性静态检查：验证每一关火娃/水娃能否收集到各自物品、双人踩板开闸、并都到达终点门。
// 模型（与 game.js 一致，偏宽松以避免误报「不可过」）：
//   - 实心：# / E；水 '~' 对水娃实心、火娃致命；岩浆 '%' 对火娃实心、水娃致命；酸液 A / 尖刺 ^ 对两人致命。
//   - 移动：左右走、直线下落、跳跃（最多上 2 格、横 4 格）、竖直平台升降（range 内任意高度）。
//   - 闸门：关闭时实心；检查「物品/终点」时视作已打开（因为压力板可达即可打开）。
const fs = require('fs');
const path = require('path');
const COLS = 20, ROWS = 12;

const code = fs.readFileSync(path.join(__dirname, '..', 'levels.js'), 'utf8');
const LEVELS = new Function(code + '\nreturn LEVELS;')();

function solidFor(t, type) {
  if (t === '#' || t === 'E') return true;
  if (t === '~') return type === 'water';
  if (t === '%') return type === 'fire';
  return false;
}
function deadlyFor(t, type) {
  if (t === 'A' || t === '^') return true;
  if (t === '~') return type === 'fire';
  if (t === '%') return type === 'water';
  return false;
}
function tile(g, x, y) { return (y >= 0 && y < ROWS && x >= 0 && x < COLS) ? g[y][x] : null; }

function reachable(level, type, gatesOpen) {
  const g = level.grid;
  const mechs = level.mechanisms || [];

  // 闸门实心格子集合
  const gateCells = new Set();
  for (const m of mechs) {
    if (m.type === 'gate') {
      for (let yy = m.y; yy < m.y + m.h; yy++)
        for (let xx = m.x; xx < m.x + m.w; xx++)
          gateCells.add(xx + ',' + yy);
    }
  }
  // 临时道路：视作已显现（可达性检查偏乐观，与「闸门视作已开」一致）
  const tempCells = new Set();
  for (const m of mechs) {
    if (m.type === 'temp') {
      for (let xx = m.x; xx < m.x + m.w; xx++) tempCells.add(xx + ',' + m.y);
    }
  }
  function isSolid(x, y) {
    if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return true; // 屏幕外 = 墙
    const t = g[y][x];
    if (solidFor(t, type)) return true;
    if (!gatesOpen && gateCells.has(x + ',' + y)) return true;
    if (tempCells.has(x + ',' + y)) return true;   // 临时道路显形时实心
    return false;
  }
  function standable(x, y) {
    if (y < 1 || y >= ROWS) return false;
    if (!isSolid(x, y)) return false;          // 脚下要实心
    if (isSolid(x, y - 1)) return false;       // 头顶要有空间
    const above = tile(g, x, y - 1);
    if (above && deadlyFor(above, type)) return false; // 身体触到致命格
    return true;
  }

  // 竖直平台
  const plats = mechs.filter(m => m.type === 'platform' && m.dir === 'v').map(m => {
    const xs = []; for (let c = m.x; c < m.x + m.w; c++) xs.push(c);
    const rows = []; for (let r = m.y - m.range; r <= m.y; r++) rows.push(r);
    return { xs, rows, y: m.y };
  });
  function onPlat(x, y) { return plats.some(p => p.xs.includes(x) && p.rows.includes(y)); }

  // 出生点
  const want = type === 'fire' ? 'F' : 'W';
  let sx = -1, sy = -1;
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (g[y][x] === want) { sx = x; sy = y; }
  if (sx < 0) return { R: new Set(), plats, spawn: null };

  const R = new Set();
  const key = (x, y) => x * 100 + y;
  const q = [];

  // 从出生点下落，落到同列最近的可站立格
  for (let y = sy; y < ROWS; y++) {
    if (standable(sx, y)) { if (!R.has(key(sx, y))) { R.add(key(sx, y)); q.push([sx, y]); } }
    if (isSolid(sx, y)) break; // 撞到实心就不再往下
  }

  while (q.length) {
    const [x, y] = q.shift();
    // 左右走
    for (const dx of [-1, 1]) {
      const nx = x + dx;
      if (standable(nx, y) && !R.has(key(nx, y))) { R.add(key(nx, y)); q.push([nx, y]); }
    }
    // 直线下落
    for (let yy = y + 1; yy < ROWS; yy++) {
      if (isSolid(x, yy)) {
        if (standable(x, yy) && !R.has(key(x, yy))) { R.add(key(x, yy)); q.push([x, yy]); }
        break;
      }
    }
    // 走出悬空台/高架桥边缘后斜向下落：同层邻居格为空时，沿该列下落到最近实心
    for (const dx of [-1, 1]) {
      const nx = x + dx;
      if (nx < 0 || nx >= COLS) continue;
      if (!isSolid(nx, y)) {
        for (let yy = y + 1; yy < ROWS; yy++) {
          if (isSolid(nx, yy)) {
            if (standable(nx, yy) && !R.has(key(nx, yy))) { R.add(key(nx, yy)); q.push([nx, yy]); }
            break;
          }
        }
      }
    }
    // 跳跃：上 0~2、横 0~4
    for (let dx = -4; dx <= 4; dx++) for (let dy = 0; dy <= 2; dy++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx, ny = y - dy;
      if (standable(nx, ny) && !R.has(key(nx, ny))) { R.add(key(nx, ny)); q.push([nx, ny]); }
    }
    // 上竖直平台：平台最低行 my 在当前行下方 0~2 格、水平 4 格内即可蹬上，此后平台任意高度可达
    for (const p of plats) {
      if (y - p.y >= 0 && y - p.y <= 2) {
        for (const cx of p.xs) if (Math.abs(cx - x) <= 4) {
          for (const r of p.rows) if (!R.has(key(cx, r))) { R.add(key(cx, r)); q.push([cx, r]); }
          break;
        }
      }
    }
    // 平台格子：可向下落到实心地面、可向四周跳跃到实体可站格（上面 standable 只针对网格，平台格当临时站立点）
    if (onPlat(x, y)) {
      for (let dx = -4; dx <= 4; dx++) for (let dy = -2; dy <= 2; dy++) {
        const nx = x + dx, ny = y + dy;
        if (dx === 0 && dy === 0) continue;
        if (standable(nx, ny) && !R.has(key(nx, ny))) { R.add(key(nx, ny)); q.push([nx, ny]); }
      }
      for (let yy = y + 1; yy < ROWS; yy++) {
        if (isSolid(x, yy)) {
          if (standable(x, yy) && !R.has(key(x, yy))) { R.add(key(x, yy)); q.push([x, yy]); }
          break;
        }
      }
    }
  }

  return { R, plats, spawn: [sx, sy] };
}

function collectable(R, ix, iy) {
  // 物品格上方 1~3 格内有可站立点即可（站上去跳一下就能吃到）
  for (const k of R) {
    const x = Math.floor(k / 100), y = k % 100;
    if (Math.abs(x - ix) <= 1 && (y - iy) >= 1 && (y - iy) <= 3) return true;
  }
  return false;
}

let ok = true;
for (const lv of LEVELS) {
  const items = []; let exit = null;
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    const c = lv.grid[y][x];
    if (c === 'T' || c === 'B') items.push({ c, x, y });
    if (c === 'E') exit = { x, y };
  }
  const problems = [];
  for (const type of ['fire', 'water']) {
    const { R, spawn } = reachable(lv, type, true); // 闸门视作已开
    const itemChar = type === 'fire' ? 'B' : 'T';
    const it = items.find(i => i.c === itemChar);
    if (!it) { problems.push(`${type}: 找不到物品 ${itemChar}`); continue; }
    if (!collectable(R, it.x, it.y)) problems.push(`${type}: 吃不到 ${itemChar}(${it.x},${it.y})`);
    if (exit && !R.has(exit.x * 100 + exit.y)) problems.push(`${type}: 到不了终点门 E(${exit.x},${exit.y})`);
    // 压力板/顺序石板都要能被该角色踩到（站在板所在格）；only 指定时只要求对应角色
    for (const m of (lv.mechanisms || [])) {
      if (m.type !== 'plate' && m.type !== 'seq') continue;
      if (m.only && m.only !== type) continue;
      if (!R.has(m.x * 100 + m.y)) problems.push(`${type}: 踩不到机关 ${m.id || m.type}(${m.x},${m.y})`);
    }
  }
  const status = problems.length ? '✗ FAIL' : '✓ PASS';
  if (problems.length) ok = false;
  console.log(`${status}  L${lv.id.padEnd(12)} ${lv.name}`);
  for (const p of problems) console.log('        - ' + p);
}
console.log(ok ? '\n全部关卡可达性检查通过' : '\n存在不可通过的关卡');
