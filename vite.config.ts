import { defineConfig } from 'vite';

// base を相対にして、GitHub Pages のどのパス配下でも動くようにする
export default defineConfig({
  base: './',
  build: { target: 'es2020' },
});
