// Generate a run of levels and print what the solver made of each one.
//   node tools/levels.mjs [seed] [count]
// It bundles the game core on the fly, so it always reports on the current source.
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'node_modules', '.cache', 'mindpuck-core.mjs');
await build({
  entryPoints: [path.join(root, 'src/core/index.ts')],
  outfile: out,
  bundle: true,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
});
const core = await import(pathToFileURL(out).href + `?t=${Date.now()}`);

const seed = Number(process.argv[2] ?? 1);
const count = Number(process.argv[3] ?? 12);
let worst = 0;
const began = performance.now();
for (let index = 0; index < count; index++) {
  const t0 = performance.now();
  const level = core.generateLevel(seed, index);
  const ms = performance.now() - t0;
  worst = Math.max(worst, ms);
  // Play it again with other gaze-noise seeds: a level that only one lucky run can win is a bad level.
  let wins = 0;
  const reruns = 5;
  for (let k = 0; k < reruns; k++) {
    if (core.solveLevel(level, core.DEFAULT_PARAMS, { ...core.DEFAULT_BOT, seed: 9000 + k }).solved) wins++;
  }
  console.log(
    `level ${String(index).padStart(2)}  ${level.kind.padEnd(4)}  obstacles ${String(level.obstacles.length).padStart(2)}` +
      `  par ${level.par.toFixed(1).padStart(5)}s  magnetic ${level.parAttract.toFixed(1).padStart(5)}s  candidates ${String(level.attempts).padStart(2)}` +
      `  reruns won ${wins}/${reruns}  ${ms.toFixed(0)} ms`,
  );
}
console.log(`total ${(performance.now() - began).toFixed(0)} ms, slowest level ${worst.toFixed(0)} ms`);
