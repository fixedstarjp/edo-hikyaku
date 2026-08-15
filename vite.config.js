import { defineConfig } from 'vite';
import { capturePlugin } from './tools/capture-plugin.mjs';

/**
 * 公開先の基準パス。
 *
 * GitHub Pages のプロジェクトページは `https://<user>.github.io/<repo>/` に載るので、
 * 資産の参照を `/<repo>/` から始めないと 404 になる。
 * 値は公開の仕組み側（.github/workflows/pages.yml）がリポジトリ名から渡す。
 * 手元では未設定なので `/` のまま動く。
 *
 * 小地図の画像と索引は import.meta.env.BASE_URL 経由で読んでいるので、
 * ここを変えるだけで両方に追随する。
 */
const base = process.env.PAGES_BASE || '/';

export default defineConfig({
  base,
  plugins: [capturePlugin()],
  server: {
    port: 5181,
    strictPort: true,
    // 同じ LAN の携帯から開けるようにする
    host: true,
    // タイルのキャッシュと画面の書き出しで再読込を走らせない
    watch: { ignored: ['**/.cache/**', '**/.capture/**'] },
  },
  build: { target: 'es2022' },
});
