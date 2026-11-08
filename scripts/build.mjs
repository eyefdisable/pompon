// Сборка: сервер (Node ESM), клиентские бандлы, CSS, сервис-воркер, модели, иконки.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';

const root = process.cwd();
const out = path.join(root, 'dist/public');
fs.rmSync(path.join(root, 'dist'), { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'assets'), { recursive: true });

if (!fs.existsSync(path.join(root, 'models/sofa.glb'))) execSync('npx tsx scripts/build-models.ts', { stdio: 'inherit' });
const common = { bundle: true, minify: true, sourcemap: false, jsx: 'automatic', logLevel: 'warning', define: { 'process.env.NODE_ENV': '"production"' } };

await build({ ...common, minify: false, entryPoints: ['src/server/main.ts'], outfile: 'dist/server.js', platform: 'node', format: 'esm', target: 'node22',
  external: ['sharp'], banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" } });
await build({ ...common, entryPoints: { app: 'src/client/app.tsx', admin: 'src/client/admin.tsx' }, outdir: path.join(out, 'assets'), format: 'esm', target: 'es2020', platform: 'browser' });
await build({ ...common, entryPoints: { theme: 'src/client/theme.ts' }, outdir: path.join(out, 'assets'), format: 'iife', target: 'es2018' });
await build({ ...common, entryPoints: ['src/client/styles.css'], outfile: path.join(out, 'assets/app.css'), loader: { '.css': 'css' } });

// версия сборки = хэш содержимого ассетов и моделей
const h = crypto.createHash('sha256');
for (const f of ['assets/app.js', 'assets/admin.js', 'assets/app.css', 'assets/theme.js']) h.update(fs.readFileSync(path.join(out, f)));
fs.mkdirSync(path.join(out, 'models'), { recursive: true });
for (const f of fs.readdirSync('models').filter((f) => f.endsWith('.glb'))) { const b = fs.readFileSync(path.join('models', f)); h.update(b); fs.writeFileSync(path.join(out, 'models', f), b); }
const BUILD = h.digest('hex').slice(0, 10);
fs.writeFileSync(path.join(out, 'build.txt'), BUILD);

await build({ ...common, entryPoints: ['src/client/sw.ts'], outfile: path.join(out, 'sw.js'), format: 'iife', target: 'es2018', define: { ...common.define, __BUILD__: JSON.stringify(BUILD) } });
const sw = fs.readFileSync(path.join(out, 'sw.js'), 'utf8').replaceAll('__BUILD__', BUILD); fs.writeFileSync(path.join(out, 'sw.js'), sw);

if (!fs.existsSync('public/icons/icon-512.png')) execSync('node scripts/icons.mjs', { stdio: 'inherit' });
fs.cpSync('public/icons', path.join(out, 'icons'), { recursive: true });
const size = (f) => (fs.statSync(path.join(out, f)).size / 1024).toFixed(0) + ' КБ';
console.log(`build ${BUILD}: app.js ${size('assets/app.js')}, admin.js ${size('assets/admin.js')}, app.css ${size('assets/app.css')}`);
