// 一次性开发期脚本：把奶娃照片抠图去背景，并分析/分离照片里的两个人。
// 运行：node tools/extract.mjs
import { removeBackground } from '@imgly/background-removal-node';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const IN = path.join(ROOT, '微信图片_20261009181103_168_13.jpg');
const OUT_FULL = path.join(ROOT, 'assets', '_full_cutout.png');

async function main() {
  const jpg = fs.readFileSync(IN);
  console.log('运行背景去除（model: medium）…');
  const blob = await removeBackground(new Blob([jpg], { type: 'image/jpeg' }), {
    model: 'medium',
    output: { format: 'image/png' },
    progress: (key, cur, total) => {
      if (cur && total) process.stderr.write(`\r  ${key} ${cur}/${total}`);
    },
  });
  const buf = Buffer.from(await blob.arrayBuffer());
  fs.writeFileSync(OUT_FULL, buf);
  console.log('\n完整抠图已保存 ->', OUT_FULL, `(${(buf.length / 1024).toFixed(0)} KB)`);

  // 解码为原始 RGBA，分析 alpha 通道
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  console.log('抠图尺寸:', width, 'x', height);

  const alpha = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) alpha[i] = data[i * 4 + 3];
  const TH = 30;
  const fg = (x, y) => alpha[y * width + x] > TH;

  // 8-连通 BFS 找连通区域（人）
  const visited = new Uint8Array(width * height);
  const comps = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (fg(x, y) && !visited[idx]) {
        let minX = x, maxX = x, minY = y, maxY = y, area = 0;
        const stack = [[x, y]];
        visited[idx] = 1;
        while (stack.length) {
          const [cx, cy] = stack.pop();
          area++;
          if (cx < minX) minX = cx; if (cx > maxX) maxX = cx;
          if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (!dx && !dy) continue;
              const nx = cx + dx, ny = cy + dy;
              if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
              const nidx = ny * width + nx;
              if (fg(nx, ny) && !visited[nidx]) { visited[nidx] = 1; stack.push([nx, ny]); }
            }
          }
        }
        comps.push({ minX, maxX, minY, maxY, area, w: maxX - minX + 1, h: maxY - minY + 1 });
      }
    }
  }
  comps.sort((a, b) => b.area - a.area);
  console.log('连通区域数量:', comps.length);
  comps.slice(0, 10).forEach((c, i) =>
    console.log(`  #${i} 面积=${c.area} 包围盒=(${c.minX},${c.minY})-(${c.maxX},${c.maxY}) ${c.w}x${c.h}`)
  );
}

main().catch((e) => { console.error('ERROR', e); process.exit(1); });
