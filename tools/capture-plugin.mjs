import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 開発サーバに POST /__capture を生やす。
 * 画面が表示できない環境 (ヘッドレスや裏タブ) でも描画結果を確かめられるよう、
 * ページ側から canvas の dataURL を送りつけて .capture/ に書き出す。
 *
 *   fetch('/__capture?name=okido', { method: 'POST', body: canvas.toDataURL('image/png') })
 *
 * 開発時のみ。ビルド成果物には一切入らない。
 */
export function capturePlugin() {
  return {
    name: 'edo-hikyaku-capture',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__capture', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('POST only');
          return;
        }
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          const comma = body.indexOf(',');
          const meta = body.slice(0, comma);
          const ext = meta.includes('jpeg') ? 'jpg' : 'png';
          const url = new URL(req.url, 'http://x');
          const name = (url.searchParams.get('name') || 'shot').replace(/[^\w-]/g, '');
          const file = resolve(ROOT, '.capture', `${name}.${ext}`);
          mkdirSync(dirname(file), { recursive: true });
          writeFileSync(file, Buffer.from(body.slice(comma + 1), 'base64'));
          res.setHeader('content-type', 'text/plain');
          res.end(file);
        });
      });
    },
  };
}
