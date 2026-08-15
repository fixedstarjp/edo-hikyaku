import { defineConfig } from 'vite';
import { capturePlugin } from './tools/capture-plugin.mjs';

export default defineConfig({
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
