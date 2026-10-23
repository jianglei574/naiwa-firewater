// 无浏览器运行时检查：用 Node 桩掉 Canvas/DOM/Image/RAF，逐关真实执行 game.js 的
// loadLevel → parseLevel → resetMechanisms → update(updateMechanisms) → render(drawMechanisms)
// 主循环若干帧，捕获任何 uncaught / unhandledRejection。
// 用法：node tools/_runcheck.js [起始关] [结束关] [帧数]
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

const from = parseInt(process.argv[2] || '0', 10);
const to = parseInt(process.argv[3] || '7', 10);
const frames = parseInt(process.argv[4] || '600', 10);

/* ---------- 万能 2D 上下文桩 ---------- */
const chainable = new Proxy(function () {}, {
  get(t, p) {
    if (p === Symbol.toPrimitive) return () => 0;
    if (p === 'width' || p === 'height') return 100;
    return chainable;
  },
  apply() { return chainable; },
  construct() { return chainable; },
  set() { return true; },
});
function makeCtx() {
  return new Proxy({}, {
    get(t, p) {
      if (p === 'canvas') return { width: 960, height: 576, getContext: makeCtx, style: {} };
      if (p in t) return t[p];
      t[p] = chainable;
      return t[p];
    },
    set(t, p, v) { t[p] = v; return true; },
  });
}
let canvasListeners = {};
function makeCanvas() {
  const ctx = makeCtx();
  return {
    width: 960, height: 576,
    getContext: () => ctx,
    style: {},
    addEventListener: (type, fn) => { (canvasListeners[type] || (canvasListeners[type] = [])).push(fn); },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 576 }),
  };
}
const mainCanvas = makeCanvas();
const document = {
  getElementById: (id) => (id === 'game' ? mainCanvas : null),
  createElement: (tag) => (tag === 'canvas' ? makeCanvas() : {}),
  title: '',
};

class FakeImage {
  constructor() { this.width = 100; this.height = 100; }
  set src(v) { this._src = v; setImmediate(() => { if (this.onload) this.onload(); }); }
  get src() { return this._src; }
}

let rafCb = null;
const requestAnimationFrame = (cb) => { rafCb = cb; return 1; };
let nowMs = 0;
const performance = { now: () => nowMs };
let listeners = {};
function makeStorage() {
  let store = {};
  return {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
}
const window = {
  addEventListener: (type, fn) => { (listeners[type] || (listeners[type] = [])).push(fn); },
  NaiwaThemes: null,
  localStorage: makeStorage(),
};

const errs = [];
process.on('uncaughtException', (e) => errs.push('uncaught: ' + ((e && e.stack) || e)));
process.on('unhandledRejection', (e) => errs.push('rejection: ' + ((e && e.stack) || e)));

const code = [
  fs.readFileSync(path.join(root, 'levels.js'), 'utf8'),
  fs.readFileSync(path.join(root, 'themes.js'), 'utf8'),
  fs.readFileSync(path.join(root, 'tutorials.js'), 'utf8'),
  fs.readFileSync(path.join(root, 'game.js'), 'utf8'),
].join('\n');
const run = new Function('window', 'document', 'Image', 'requestAnimationFrame', 'location', 'performance', code);

const results = [];

// 在 80ms 后启动 raf 并连续推进 loop 若干帧，返回捕获到的错误数组
function driveFrames(errs, frames) {
  const start = nowMs;
  if (typeof rafCb === 'function') { const cb = rafCb; rafCb = null; try { cb(start); } catch (e) { errs.push('raf0: ' + ((e && e.stack) || e)); } }
  let n = 0;
  while (n < frames && rafCb) {
    nowMs = start + (n + 1) * (1000 / 60);
    const cb = rafCb; rafCb = null;
    try { cb(nowMs); } catch (e) { errs.push('loop@' + n + ': ' + ((e && e.stack) || e)); break; }
    n++;
  }
  return n;
}

function runLevel(idx) {
  return new Promise((resolve) => {
    // 每个关卡用全新作用域跑一遍（隔离开 state / level 等闭包状态）
    nowMs = 0; rafCb = null; errs.length = 0; listeners = {}; canvasListeners = {}; window.localStorage = makeStorage();
    const loc = { search: '?autostart=1&level=' + idx };
    try {
      run(window, document, FakeImage, requestAnimationFrame, loc, performance);
    } catch (e) {
      errs.push('load: ' + ((e && e.stack) || e));
    }
    setTimeout(() => {
      const n = driveFrames(errs, frames);
      results.push({ kind: 'level', name: idx, n, errs: errs.slice() });
      resolve();
    }, 80);
  });
}

// 教学演示：用 ?autostart=1&tutorial=<id> 进入，驱动 frames 帧后读取 window.__naiwaTutorial 快照断言「脚本能通关」
const tutorialChecks = {
  seq:  s => s.everSeqActive && s.everGateOpen && s.looped,
  temp: s => s.maxFireX > 480 && s.looped,
  beam: s => s.everBeamPowered && s.everGateOpen && s.looped,
  tide: s => s.maxFireX > 432 && s.looped,
};
function runTutorial(id) {
  return new Promise((resolve) => {
    nowMs = 0; rafCb = null; errs.length = 0; listeners = {}; canvasListeners = {}; window.localStorage = makeStorage();
    const loc = { search: '?autostart=1&tutorial=' + id };
    try {
      run(window, document, FakeImage, requestAnimationFrame, loc, performance);
    } catch (e) {
      errs.push('load: ' + ((e && e.stack) || e));
    }
    setTimeout(() => {
      const n = driveFrames(errs, frames);
      const snap = window.__naiwaTutorial;
      const problems = [];
      if (errs.length === 0) {
        if (!snap) problems.push('未生成 __naiwaTutorial 快照');
        else if (!tutorialChecks[id]) problems.push('无该教学的断言');
        else if (!tutorialChecks[id](snap)) problems.push('演示脚本未通关：' + JSON.stringify(snap));
      }
      results.push({ kind: 'tutorial', name: id, n, errs: errs.slice(), problems });
      resolve();
    }, 80);
  });
}

// 带 intro 的关卡（L3/L4/L6/L7 首次引入新机关）：走真实流程 ?autostart=1&level=idx，
// 教学演示跑完循环后模拟按回车，断言「退出教学态、进入本关本体」不会卡死在教学里。
const introLevels = [2, 3, 5, 6];
function runLevelEnter(idx) {
  return new Promise((resolve) => {
    nowMs = 0; rafCb = null; errs.length = 0; listeners = {}; canvasListeners = {}; window.localStorage = makeStorage();
    const loc = { search: '?autostart=1&level=' + idx };
    try {
      run(window, document, FakeImage, requestAnimationFrame, loc, performance);
    } catch (e) {
      errs.push('load: ' + ((e && e.stack) || e));
    }
    setTimeout(() => {
      // 先让教学演示跑完并循环（确认确实处于 tutorial 态）
      const n1 = driveFrames(errs, 470);
      const wasInTutorial = !!window.__naiwaTutorial && window.__naiwaTutorial.looped === true;
      // 模拟按回车
      (listeners.keydown || []).forEach(fn => { try { fn({ code: 'Enter' }); } catch (e) { errs.push('enter: ' + ((e && e.stack) || e)); } });
      // 再推进几帧，让 loop 消费 enterQueued 并执行 endTutorial
      const n2 = driveFrames(errs, 10);
      const problems = [];
      if (errs.length === 0) {
        if (!wasInTutorial) problems.push('教学演示未先进入/循环（快照=' + JSON.stringify(window.__naiwaTutorial) + '）');
        else if (window.__naiwaTutorial !== null) problems.push('按回车后未退出教学态（快照=' + JSON.stringify(window.__naiwaTutorial) + '）');
      }
      results.push({ kind: 'enter', name: idx, n: n1 + n2, errs: errs.slice(), problems });
      resolve();
    }, 80);
  });
}

/* ---------- 菜单导航测试 ---------- */
function clickMenu(id) {
  const btn = (window.__naiwaMenu || []).find(b => b.id === id);
  if (!btn) return false;
  const cx = btn.x + btn.w / 2, cy = btn.y + btn.h / 2;
  (canvasListeners.mousedown || []).forEach(fn => { try { fn({ clientX: cx, clientY: cy }); } catch (e) { errs.push('mousedown: ' + ((e && e.stack) || e)); } });
  (canvasListeners.mouseup || []).forEach(fn => { try { fn({ clientX: cx, clientY: cy }); } catch (e) { errs.push('mouseup: ' + ((e && e.stack) || e)); } });
  return true;
}

// 无参加载 → 标题 → 点「开始游戏」进第 0 关（且未通关时不应出现「关卡选择」）
function runMenuStart() {
  return new Promise((resolve) => {
    nowMs = 0; rafCb = null; errs.length = 0; listeners = {}; canvasListeners = {}; window.localStorage = makeStorage();
    const loc = { search: '' };
    try { run(window, document, FakeImage, requestAnimationFrame, loc, performance); }
    catch (e) { errs.push('load: ' + ((e && e.stack) || e)); }
    setTimeout(() => {
      const n1 = driveFrames(errs, 10);
      const problems = [];
      const menu0 = window.__naiwaMenu || [];
      const hasStart = menu0.some(b => b.id === 'start');
      const hasLevels = menu0.some(b => b.id === 'levels');
      if (errs.length === 0) {
        if (window.__naiwaState !== 'title') problems.push('未进入标题态（state=' + window.__naiwaState + '）');
        else if (!hasStart) problems.push('标题态缺少「开始游戏」按钮');
        else if (hasLevels) problems.push('未通关却出现「关卡选择」按钮（门控错误）');
        else if (!clickMenu('start')) problems.push('点击「开始游戏」失败');
        else {
          driveFrames(errs, 8);
          if (window.__naiwaState !== 'playing' || window.__naiwaLevel !== 0) problems.push('点开始游戏后未进入第 0 关（state=' + window.__naiwaState + ' level=' + window.__naiwaLevel + '）');
        }
      }
      results.push({ kind: 'menu', name: 'start', n: n1, errs: errs.slice(), problems });
      resolve();
    }, 80);
  });
}

// 预置已通关 flag → 标题出现「关卡选择」→ 进入关卡选择 → 点第 2 张卡片（长城，无教学）进第 1 关
function runMenuLevels() {
  return new Promise((resolve) => {
    nowMs = 0; rafCb = null; errs.length = 0; listeners = {}; canvasListeners = {};
    window.localStorage = makeStorage();
    window.localStorage.setItem('naiwa_all_cleared', '1');
    const loc = { search: '' };
    try { run(window, document, FakeImage, requestAnimationFrame, loc, performance); }
    catch (e) { errs.push('load: ' + ((e && e.stack) || e)); }
    setTimeout(() => {
      const n1 = driveFrames(errs, 10);
      const problems = [];
      const hasLevels = (window.__naiwaMenu || []).some(b => b.id === 'levels');
      if (errs.length === 0) {
        if (window.__naiwaState !== 'title') problems.push('未进入标题态（state=' + window.__naiwaState + '）');
        else if (!hasLevels) problems.push('已通关却缺少「关卡选择」按钮');
        else if (!clickMenu('levels')) problems.push('点击「关卡选择」失败');
        else {
          driveFrames(errs, 5);
          if (window.__naiwaState !== 'levelselect') problems.push('点击后未进入关卡选择（state=' + window.__naiwaState + '）');
          else {
            const cardCount = (window.__naiwaMenu || []).filter(b => b.id.indexOf('level:') === 0).length;
            if (cardCount !== 8) problems.push('关卡选择卡片数=' + cardCount + '（应为 8）');
            else if (!clickMenu('level:1')) problems.push('点击第 2 张卡片失败');
            else {
              driveFrames(errs, 8);
              if (window.__naiwaState !== 'playing' || window.__naiwaLevel !== 1) problems.push('点卡片后未进入第 1 关（state=' + window.__naiwaState + ' level=' + window.__naiwaLevel + '）');
            }
          }
        }
      }
      results.push({ kind: 'menu', name: 'levels', n: n1, errs: errs.slice(), problems });
      resolve();
    }, 80);
  });
}

(async () => {
  for (let i = from; i <= to; i++) await runLevel(i);
  for (const id of Object.keys(tutorialChecks)) await runTutorial(id);
  for (const idx of introLevels) await runLevelEnter(idx);
  await runMenuStart();
  await runMenuLevels();
  let bad = 0;
  for (const r of results) {
    const label = r.kind === 'level' ? 'level=' : (r.kind === 'enter' ? 'enter ' : (r.kind === 'menu' ? 'menu  ' : 'demo  '));
    const issues = r.errs.concat(r.problems || []);
    if (issues.length) { bad++; console.log('FAIL  ' + label + r.name + '  frames=' + r.n); for (const e of issues) console.log('      ' + e); }
    else console.log('OK    ' + label + r.name + '  frames=' + r.n);
  }
  console.log(bad ? '\n' + bad + ' 项存在运行时错误或未通关' : '\n全部关卡 + 教学演示 + 回车进入本关 + 菜单导航 均无错误');
  process.exit(bad ? 1 : 0);
})();
