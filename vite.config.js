import { defineConfig } from 'vite';
import { capturePlugin } from './tools/capture-plugin.mjs';

export default defineConfig({
  plugins: [capturePlugin()],
  server: { port: 5181, strictPort: true },
  build: { target: 'es2022' },
});
