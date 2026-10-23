/* ============================================================
   奶娃森林冰火人 —— 通用障碍视觉系统（主题 → 材质 → 绘制）

   设计原则：
   - 障碍的「游戏行为」与「外观」彻底分离：碰撞/机关/危险判定
     逻辑全部在 game.js，这里只提供「同一种障碍在不同主题下的外观」。
   - 每个关卡通过 level.theme 选择一套材质；新增景点只需在 THEMES 里
     增加一项，无需改动 game.js 的碰撞与机关代码。
   - 全部为纯 Canvas 绘制，无外部依赖；图案变化用确定性 hash，
     保证同一画面逐帧稳定、不闪烁。
   ============================================================ */
(() => {
  'use strict';

  /* ================= 主题材质配置 ================= */
  const THEMES = {
    // —— 巴黎 · 埃菲尔铁塔：深色铆接金属 + 钢架工业质感 ——
    paris: {
      name: '巴黎 · 金属钢架',
      solid: {
        pattern: 'metal',
        faceTop: '#5a626e', faceSide: '#3d434c', faceDark: '#2b3037',
        cap: '#717a87', capHi: 'rgba(255,255,255,0.34)',
        seam: 'rgba(10,13,17,0.55)', rivet: 'rgba(12,15,20,0.95)', rivetHi: 'rgba(255,255,255,0.30)',
        edge: 'rgba(0,0,0,0.38)',
      },
      spikes: { base: '#2f343b', tip: '#d3d9df', tipDark: '#8b939e', edge: 'rgba(0,0,0,0.40)' },
      platform: { top: '#7a828e', side: '#41474f', lip: '#24282e', seam: 'rgba(10,13,17,0.6)', rivet: 'rgba(12,15,20,0.95)', rivetHi: 'rgba(255,255,255,0.35)' },
      gate: { top: '#6f7680', side: '#454b55', seam: 'rgba(10,13,17,0.55)', rail: '#24282e' },
      plate: { base: '#545b64', face: '#7c848f', faceHi: 'rgba(255,255,255,0.3)', active: '#5fd06a' },
      door: { style: 'metal', frame: '#2c3138', panel: '#5d646e', accent: '#f2c14e' },
    },

    // —— 中国 · 长城：古代砖石 + 风化历史质感 ——
    greatwall: {
      name: '长城 · 风化砖石',
      solid: {
        pattern: 'brick', bw: 24, bh: 12,
        faceTop: '#d9c69c', faceSide: '#b59f76', faceDark: '#937d58',
        cap: '#e7d7b1', capHi: 'rgba(255,255,255,0.24)',
        seam: 'rgba(96,80,58,0.45)', speckle: 'rgba(70,58,40,0.30)', crack: 'rgba(80,66,46,0.55)',
        edge: 'rgba(44,34,22,0.42)',
      },
      spikes: { base: '#8f7a58', tip: '#c9c1b0', tipDark: '#938a76', edge: 'rgba(40,32,22,0.40)' },
      platform: { top: '#d2c3a2', side: '#a28c68', lip: '#5f523c', seam: 'rgba(70,58,40,0.5)', rivet: 'rgba(70,58,40,0.7)', rivetHi: 'rgba(255,255,255,0.25)' },
      gate: { top: '#cbb895', side: '#a28d6a', seam: 'rgba(70,58,40,0.5)', rail: '#5f523c' },
      plate: { base: '#6f6148', face: '#a8997c', faceHi: 'rgba(255,255,255,0.25)', active: '#5fd06a' },
      door: { style: 'wood', frame: '#5b3a1e', panel: '#8a5a30', accent: '#f2c14e' },
    },

    // —— 埃及 · 金字塔：风化砂岩 + 大石块砌筑 ——
    egypt: {
      name: '埃及 · 风化砂岩',
      solid: {
        pattern: 'brick', bw: 48, bh: 24,
        faceTop: '#e6c98f', faceSide: '#c9a15f', faceDark: '#a07c42',
        cap: '#f2d9a8', capHi: 'rgba(255,255,255,0.30)',
        seam: 'rgba(90,64,28,0.42)', speckle: 'rgba(90,64,28,0.30)', crack: 'rgba(70,48,20,0.5)',
        edge: 'rgba(50,34,12,0.42)',
      },
      spikes: { base: '#a07c42', tip: '#e8dcc0', tipDark: '#b8a37c', edge: 'rgba(50,34,12,0.4)' },
      platform: { top: '#e0c088', side: '#b08a52', lip: '#6a4f28', seam: 'rgba(80,56,22,0.45)', rivet: 'rgba(70,48,20,0.7)', rivetHi: 'rgba(255,255,255,0.3)' },
      gate: { top: '#d8b878', side: '#a8844c', seam: 'rgba(80,56,22,0.45)', rail: '#6a4f28' },
      plate: { base: '#8a6a3c', face: '#c0a070', faceHi: 'rgba(255,255,255,0.28)', active: '#5fd06a' },
      door: { style: 'stone', frame: '#7a5c30', panel: '#c9a15f', accent: '#f2c14e' },
    },

    // —— 希腊 · 圣托里尼：白墙蓝顶 ——
    santorini: {
      name: '圣托里尼 · 白墙蓝顶',
      solid: {
        pattern: 'brick', bw: 40, bh: 20,
        faceTop: '#f4f2ee', faceSide: '#e2dfd8', faceDark: '#bfbbb2',
        cap: '#fbfaf7', capHi: 'rgba(255,255,255,0.45)',
        seam: 'rgba(120,140,170,0.38)', speckle: 'rgba(160,170,190,0.25)', crack: 'rgba(130,130,140,0.4)',
        edge: 'rgba(70,80,100,0.35)',
      },
      spikes: { base: '#8a95a8', tip: '#e8ecf2', tipDark: '#aeb6c4', edge: 'rgba(60,70,90,0.4)' },
      platform: { top: '#f0eee9', side: '#d6d2ca', lip: '#8a857c', seam: 'rgba(120,130,150,0.4)', rivet: 'rgba(90,100,120,0.6)', rivetHi: 'rgba(255,255,255,0.45)' },
      gate: { top: '#e8e6e0', side: '#c8c4bc', seam: 'rgba(120,130,150,0.4)', rail: '#4a90d9' },
      plate: { base: '#7f8aa0', face: '#b8c2d2', faceHi: 'rgba(255,255,255,0.35)', active: '#5fd06a' },
      door: { style: 'stone', frame: '#d6d2ca', panel: '#4a90d9', accent: '#ffffff' },
    },

    // —— 日本 · 富士山：冰雪 + 霜冻 ——
    fuji: {
      name: '富士山 · 冰雪',
      solid: {
        pattern: 'ice',
        faceTop: '#eef5fb', faceSide: '#bcd7ea', faceDark: '#8fb2cd',
        cap: '#f6fbff', capHi: 'rgba(255,255,255,0.55)',
        seam: 'rgba(70,110,150,0.35)', glint: 'rgba(255,255,255,0.6)',
        edge: 'rgba(40,70,100,0.35)',
      },
      spikes: { base: '#9db8ce', tip: '#ffffff', tipDark: '#c3d4e2', edge: 'rgba(40,70,100,0.35)' },
      platform: { top: '#e6eef5', side: '#a9c4d8', lip: '#5d7f9c', seam: 'rgba(70,110,150,0.4)', rivet: 'rgba(60,90,120,0.6)', rivetHi: 'rgba(255,255,255,0.5)' },
      gate: { top: '#dbe7f0', side: '#a9c0d2', seam: 'rgba(70,110,150,0.4)', rail: '#5d7f9c' },
      plate: { base: '#7f98ad', face: '#c4d6e4', faceHi: 'rgba(255,255,255,0.4)', active: '#5fd06a' },
      door: { style: 'stone', frame: '#a9c0d2', panel: '#cfe0ee', accent: '#5d9fd9' },
    },

    // —— 巴西 · 伊瓜苏：雨林苔石 ——
    iguazu: {
      name: '伊瓜苏 · 雨林苔石',
      solid: {
        pattern: 'brick', bw: 36, bh: 18,
        faceTop: '#8a9c6a', faceSide: '#6a7a52', faceDark: '#4e5c3c',
        cap: '#a8b886', capHi: 'rgba(255,255,255,0.30)',
        seam: 'rgba(40,52,28,0.45)', speckle: 'rgba(40,52,28,0.30)', crack: 'rgba(40,52,28,0.5)',
        edge: 'rgba(24,32,16,0.4)',
      },
      spikes: { base: '#5c6c44', tip: '#c8d4a8', tipDark: '#94a878', edge: 'rgba(24,32,16,0.4)' },
      platform: { top: '#a4b684', side: '#74845a', lip: '#3c4828', seam: 'rgba(40,52,28,0.45)', rivet: 'rgba(40,52,28,0.7)', rivetHi: 'rgba(255,255,255,0.3)' },
      gate: { top: '#98a878', side: '#74845a', seam: 'rgba(40,52,28,0.45)', rail: '#3c4828' },
      plate: { base: '#5c6c44', face: '#94a878', faceHi: 'rgba(255,255,255,0.3)', active: '#5fd06a' },
      door: { style: 'wood', frame: '#4e3c24', panel: '#7a5a38', accent: '#f2c14e' },
    },

    // —— 美国 · 纽约自由女神：铜绿 + 铜金属 ——
    nyc: {
      name: '纽约 · 铜绿金属',
      solid: {
        pattern: 'metal',
        faceTop: '#7fb0a0', faceSide: '#5e8a7c', faceDark: '#40685c',
        cap: '#93c4b2', capHi: 'rgba(255,255,255,0.32)',
        seam: 'rgba(16,40,34,0.5)', rivet: 'rgba(16,40,34,0.9)', rivetHi: 'rgba(255,255,255,0.3)',
        edge: 'rgba(0,20,16,0.4)',
      },
      spikes: { base: '#40685c', tip: '#c8e0d6', tipDark: '#8fb0a4', edge: 'rgba(0,20,16,0.4)' },
      platform: { top: '#8fb8a8', side: '#5e8a7c', lip: '#2e4c42', seam: 'rgba(16,40,34,0.5)', rivet: 'rgba(16,40,34,0.9)', rivetHi: 'rgba(255,255,255,0.32)' },
      gate: { top: '#7fa898', side: '#56806f', seam: 'rgba(16,40,34,0.5)', rail: '#2e4c42' },
      plate: { base: '#4e705e', face: '#8fb0a0', faceHi: 'rgba(255,255,255,0.3)', active: '#5fd06a' },
      door: { style: 'metal', frame: '#2e4c42', panel: '#7fb0a0', accent: '#f2c14e' },
    },

    // —— 秘鲁 · 马丘比丘：灰绿山石 ——
    machupicchu: {
      name: '马丘比丘 · 山石',
      solid: {
        pattern: 'brick', bw: 44, bh: 22,
        faceTop: '#a8b0a0', faceSide: '#88907f', faceDark: '#67705f',
        cap: '#c0c8b6', capHi: 'rgba(255,255,255,0.28)',
        seam: 'rgba(48,56,44,0.45)', speckle: 'rgba(48,56,44,0.30)', crack: 'rgba(48,56,44,0.5)',
        edge: 'rgba(32,38,28,0.4)',
      },
      spikes: { base: '#6a7260', tip: '#d0d4c8', tipDark: '#9aa290', edge: 'rgba(32,38,28,0.4)' },
      platform: { top: '#b0b8a4', side: '#808876', lip: '#4c523e', seam: 'rgba(48,56,44,0.45)', rivet: 'rgba(48,56,44,0.7)', rivetHi: 'rgba(255,255,255,0.28)' },
      gate: { top: '#a4ac98', side: '#808876', seam: 'rgba(48,56,44,0.45)', rail: '#4c523e' },
      plate: { base: '#5c6450', face: '#98a08c', faceHi: 'rgba(255,255,255,0.28)', active: '#5fd06a' },
      door: { style: 'stone', frame: '#6a7260', panel: '#a8b0a0', accent: '#f2c14e' },
    },

    // —— 回退：中性石材（未知主题兜底，保证永不白屏） ——
    default: {
      name: '默认',
      solid: { pattern: 'stone', faceTop: '#5b6b7d', faceSide: '#485266', faceDark: '#39465a', cap: '#6b7a8e', capHi: 'rgba(255,255,255,0.2)', seam: 'rgba(0,0,0,0.25)', speckle: 'rgba(255,255,255,0.06)', edge: 'rgba(0,0,0,0.32)' },
      spikes: { base: '#39465a', tip: '#cfd6de', tipDark: '#98a2ad', edge: 'rgba(0,0,0,0.35)' },
      platform: { top: '#a8906a', side: '#7c6547', lip: '#4a3a26', seam: 'rgba(60,40,20,0.4)', rivet: 'rgba(60,40,20,0.55)', rivetHi: 'rgba(255,255,255,0.25)' },
      gate: { top: '#8a6a4a', side: '#6f4f33', seam: 'rgba(0,0,0,0.22)', rail: '#4a3620' },
      plate: { base: '#7b8794', face: '#a0aab4', faceHi: 'rgba(255,255,255,0.3)', active: '#5fd06a' },
      door: { style: 'wood', frame: '#5b3a1e', panel: '#8a5a30', accent: '#f2c14e' },
    },
  };

  /* ================= 工具 ================= */

  // 确定性伪随机（同一坐标永远同一结果，图案逐帧稳定）
  function hash2(x, y) {
    let n = (x * 374761393 + y * 668265263) | 0;
    n = (n ^ (n >> 13)) * 1274126177;
    return ((n ^ (n >> 16)) >>> 0) / 4294967296;
  }

  // 十六进制色 → 按系数调整明暗（v>1 变亮、v<1 变暗，自动 clamp）
  function shade(hex, v) {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.max(0, Math.min(255, ((n >> 16) & 255) * v));
    const g = Math.max(0, Math.min(255, ((n >> 8) & 255) * v));
    const b = Math.max(0, Math.min(255, (n & 255) * v));
    return `rgb(${r | 0},${g | 0},${b | 0})`;
  }

  function themeFor(name) { return THEMES[name] || THEMES.default; }

  // 取某障碍的材质：以 default 为底，主题覆盖同名字段（缺字段不报错）
  function matFor(name, part) {
    const d = THEMES.default[part] || {};
    const t = (THEMES[name] && THEMES[name][part]) || {};
    return Object.assign({}, d, t);
  }

  /* ================= 材质绘制原语 ================= */

  // 金属板 + 铆钉（埃菲尔钢架 / 自由女神铜绿）
  function paintMetal(ctx, x, y, w, h, m) {
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, m.faceTop);
    g.addColorStop(0.55, m.faceSide);
    g.addColorStop(1, m.faceDark);
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = m.seam;
    ctx.lineWidth = 1;
    for (let yy = y + 16; yy < y + h - 1; yy += 16) {
      ctx.beginPath(); ctx.moveTo(x + 2, yy + 0.5); ctx.lineTo(x + w - 2, yy + 0.5); ctx.stroke();
    }
    for (let row = 0; row * 16 < h; row++) {
      const yy = y + 8 + row * 16;
      const offset = (row % 2) * 12;
      for (let xx = x + 8 + offset; xx < x + w - 4; xx += 24) {
        ctx.fillStyle = m.rivet;
        ctx.beginPath(); ctx.arc(xx, yy, 1.7, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = m.rivetHi;
        ctx.beginPath(); ctx.arc(xx - 0.4, yy - 0.5, 0.8, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  // 石块砌筑 + 灰缝 + 风化（长城砖 / 金字塔巨石 / 圣托里尼白墙 / 山石），砖块尺寸由 m.bw/m.bh 决定
  function paintBrick(ctx, x, y, w, h, m) {
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, m.faceTop);
    g.addColorStop(0.55, m.faceSide);
    g.addColorStop(1, m.faceDark);
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    const bw = m.bw || 24, bh = m.bh || 12;
    for (let row = 0; row * bh < h; row++) {
      const yy = y + row * bh;
      const shift = (row % 2) * (bw / 2);
      for (let col = -1; col * bw - shift < w + bw; col++) {
        const xx = x + col * bw - shift;
        const v = 0.85 + hash2(col + 100, row + 100) * 0.3;
        ctx.fillStyle = shade(m.faceSide, v);
        ctx.fillRect(xx, yy, bw - 1, bh - 1);
      }
    }
    ctx.fillStyle = m.seam;
    for (let row = 0; row * bh <= h; row++) {
      ctx.fillRect(x, y + row * bh, w, 1);
    }
    ctx.fillStyle = m.speckle || 'rgba(0,0,0,0.15)';
    for (let i = 0; i < 8; i++) {
      const sx = x + hash2(i, 1) * w;
      const sy = y + hash2(i, 2) * h;
      ctx.fillRect(sx, sy, 2, 1);
    }
    if (m.crack) {
      ctx.strokeStyle = m.crack;
      ctx.lineWidth = 1;
      for (let i = 0; i < 2; i++) {
        let cx = x + hash2(i, 3) * w;
        let cy = y + hash2(i, 4) * h * 0.6;
        ctx.beginPath(); ctx.moveTo(cx, cy);
        for (let s = 0; s < 3; s++) {
          cx += (hash2(i, s + 5) - 0.5) * 12;
          cy += 4 + hash2(i, s + 9) * 8;
          ctx.lineTo(cx, cy);
        }
        ctx.stroke();
      }
    }
  }

  // 冰雪（富士山）：冷色渐变 + 冰层纹 + 高光斜纹 + 晶体亮点
  function paintIce(ctx, x, y, w, h, m) {
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, m.faceTop);
    g.addColorStop(0.6, m.faceSide);
    g.addColorStop(1, m.faceDark);
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = m.seam;
    ctx.lineWidth = 1;
    for (let yy = y + 12; yy < y + h; yy += 16) {
      ctx.beginPath(); ctx.moveTo(x + 2, yy + 0.5); ctx.lineTo(x + w - 2, yy + 0.5); ctx.stroke();
    }
    ctx.strokeStyle = m.glint || 'rgba(255,255,255,0.5)';
    for (let i = 0; i < 4; i++) {
      const gx = x + hash2(i, 20) * w;
      ctx.beginPath();
      ctx.moveTo(gx, y);
      ctx.lineTo(gx - 10, y + h);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    for (let i = 0; i < 5; i++) {
      ctx.fillRect(x + hash2(i, 30) * w, y + hash2(i, 31) * h, 2, 2);
    }
  }

  // 中性石材（默认回退）
  function paintStone(ctx, x, y, w, h, m) {
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, m.faceTop);
    g.addColorStop(1, m.faceDark);
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = m.speckle || 'rgba(255,255,255,0.06)';
    for (let i = 0; i < 6; i++) {
      ctx.fillRect(x + hash2(i, 1) * w, y + hash2(i, 2) * h, 2, 1);
    }
  }

  /* ================= 对外导出的障碍绘制接口 ================= */

  // 绘制一枚主题化实体瓦片（# / E 地底）：顶面 / 侧面 / 图案 / 描边 / 底面投影
  // opts.cap   —— 上方是空的，作为可站立顶面（亮色盖板 + 高光唇线）
  // opts.floor —— 下方是空的，底部加投影（悬浮平台的底面）
  function paintSolid(ctx, x, y, w, h, theme, opts) {
    opts = opts || {};
    const m = matFor(theme, 'solid');
    const pattern = m.pattern || 'stone';
    if (pattern === 'metal') paintMetal(ctx, x, y, w, h, m);
    else if (pattern === 'brick') paintBrick(ctx, x, y, w, h, m);
    else if (pattern === 'ice') paintIce(ctx, x, y, w, h, m);
    else paintStone(ctx, x, y, w, h, m);

    if (opts.cap) {
      const capH = Math.min(12, h * 0.26);
      ctx.fillStyle = m.cap;
      ctx.fillRect(x, y, w, capH);
      ctx.fillStyle = m.capHi;
      ctx.fillRect(x, y, w, 2);
      ctx.fillStyle = 'rgba(0,0,0,0.16)';
      ctx.fillRect(x, y + capH - 1, w, 1);
    }
    if (opts.floor) {
      const g = ctx.createLinearGradient(0, y + h - 8, 0, y + h);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.28)');
      ctx.fillStyle = g;
      ctx.fillRect(x, y + h - 8, w, 8);
    }
    ctx.strokeStyle = m.edge;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }

  // 绘制主题化尖刺瓦片（^）
  function paintSpikes(ctx, x, y, w, h, theme) {
    const m = matFor(theme, 'spikes');
    ctx.fillStyle = m.base;
    ctx.fillRect(x, y, w, h);
    const n = 3;
    for (let i = 0; i < n; i++) {
      const x0 = x + (w / n) * i, x1 = x0 + w / n;
      const g = ctx.createLinearGradient(x0, y, x0, y + h);
      g.addColorStop(0, m.tip);
      g.addColorStop(1, m.tipDark);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(x0 + 1, y + h);
      ctx.lineTo((x0 + x1) / 2, y + h * 0.42);
      ctx.lineTo(x1 - 1, y + h);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo((x0 + x1) / 2, y + h * 0.44); ctx.lineTo((x0 + x1) / 2, y + h * 0.8); ctx.stroke();
    }
    ctx.strokeStyle = m.edge;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }

  // 暴露给 game.js
  window.NaiwaThemes = { THEMES, themeFor, matFor, paintSolid, paintSpikes, shade, hash2 };
})();
