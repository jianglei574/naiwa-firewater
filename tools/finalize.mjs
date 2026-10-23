// 把裁切好的两人缩小到游戏用尺寸，生成最终角色图。
// 运行：node tools/finalize.mjs
import sharp from 'sharp';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const TARGET_H = 160; // 游戏内角色像素高度

const jobs = [
  { in: '_personA.png', out: 'fire_baby.png' },
  { in: '_personB.png', out: 'water_baby.png' },
];

for (const j of jobs) {
  const src = path.join(ROOT, 'assets', j.in);
  const dst = path.join(ROOT, 'assets', j.out);
  const meta = await sharp(src).metadata();
  const w = Math.round(meta.width * TARGET_H / meta.height);
  await sharp(src).resize({ width: w, height: TARGET_H, fit: 'fill' }).toFile(dst);
  console.log(`${j.in} -> ${j.out}  (${w}x${TARGET_H})`);
}
console.log('完成。');
