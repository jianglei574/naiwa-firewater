// 读取抠图结果，分析两人位置并分离成两张独立 PNG。
// 运行：node tools/split.mjs
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const IN = path.join(ROOT, 'assets', '_full_cutout.png');

const { data, info } = await sharp(IN).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: W, height: H } = info;
const alpha = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) alpha[i] = data[i * 4 + 3];
const fg = (x, y) => alpha[y * W + x] > 30;

// 整体前景包围盒
let minX = W, maxX = 0, minY = H, maxY = 0;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  if (fg(x, y)) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
}
const bw = maxX - minX + 1, bh = maxY - minY + 1;
console.log(`整体包围盒: (${minX},${minY})-(${maxX},${maxY})  ${bw}x${bh}`);

// 列/行投影
const col = new Array(W).fill(0);
const row = new Array(H).fill(0);
for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
  if (fg(x, y)) { col[x]++; row[y]++; }
}

// ASCII 剖面（列）
function ascii(arr, start, end, bins = 60, label) {
  const n = end - start + 1;
  const binSize = n / bins;
  const vals = new Array(bins).fill(0);
  let maxv = 0;
  for (let i = 0; i < bins; i++) {
    let s = 0, c = 0;
    for (let k = Math.round(start + i * binSize); k < Math.round(start + (i + 1) * binSize); k++) {
      s += arr[k]; c++;
    }
    vals[i] = c ? s / c : 0;
    if (vals[i] > maxv) maxv = vals[i];
  }
  console.log(`\n${label} (${start}..${end}, ${bins} bins):`);
  for (let i = 0; i < bins; i++) {
    const bar = '*'.repeat(Math.round((vals[i] / maxv) * 60));
    console.log(`${String(start + Math.round(i * binSize)).padStart(4)} ${bar.padEnd(60)} ${Math.round(vals[i])}`);
  }
}

ascii(col, minX, maxX, 50, '列投影(横向分布)');
ascii(row, minY, maxY, 50, '行投影(纵向分布)');

// 平滑列投影，找中间“谷”作为竖直分割线
function smooth(a, r) {
  const out = a.slice();
  for (let i = 0; i < a.length; i++) {
    let s = 0, c = 0;
    for (let k = i - r; k <= i + r; k++) if (k >= 0 && k < a.length) { s += a[k]; c++; }
    out[i] = s / c;
  }
  return out;
}
const scol = smooth(col, 12);
let bestX = -1, bestV = Infinity;
for (let x = minX + Math.floor(bw * 0.18); x <= minX + Math.floor(bw * 0.82); x++) {
  if (scol[x] < bestV) { bestV = scol[x]; bestX = x; }
}
console.log(`\n建议竖直分割线 x = ${bestX} (该处列密度=${Math.round(bestV)})`);
console.log(`左半: x ${minX}..${bestX}  (宽 ${bestX - minX + 1})`);
console.log(`右半: x ${bestX + 1}..${maxX}  (宽 ${maxX - bestX})`);

// 裁切两人（各自重新计算纵向范围，加 padding）
const PAD = 14;
async function cropPerson(x0, x1, name) {
  let ymin = H, ymax = 0;
  for (let y = minY; y <= maxY; y++) for (let x = x0; x <= x1; x++) {
    if (fg(x, y)) { if (y < ymin) ymin = y; if (y > ymax) ymax = y; }
  }
  const cx0 = Math.max(0, x0 - PAD), cx1 = Math.min(W - 1, x1 + PAD);
  const cy0 = Math.max(0, ymin - PAD), cy1 = Math.min(H - 1, ymax + PAD);
  const w = cx1 - cx0 + 1, h = cy1 - cy0 + 1;
  console.log(`\n${name}: 内容 x ${x0}..${x1} / y ${ymin}..${ymax} -> 裁切 (${cx0},${cy0}) ${w}x${h}`);
  await sharp(IN).extract({ left: cx0, top: cy0, width: w, height: h })
    .toFile(path.join(ROOT, 'assets', `${name}.png`));
  console.log(`已保存 assets/${name}.png`);
}
await cropPerson(minX, bestX, '_personA');
await cropPerson(bestX + 1, maxX, '_personB');
console.log('\n完成。');
