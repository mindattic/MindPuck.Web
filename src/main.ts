import {
  EyeTracker,
  MouseGazeSource,
  RemoteGazeSource,
  runCalibration,
  type GazeSample,
  type GazeSource,
} from '@mindattic/eyetracker';
import { DEFAULT_PARAMS, PuckSim, SolverBot, generateLevel, type Level, type Vec } from './core/index.js';
import { GameAudio } from './game/audio.js';
import { TableRenderer } from './game/renderer.js';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const query = new URLSearchParams(location.search);
const params = DEFAULT_PARAMS;

// ---------- run state: which seed and level, kept between visits ----------
const SAVE_KEY = 'mindpuck.run';
function loadRun(): { seed: number; index: number } {
  if (query.has('seed')) return { seed: Number(query.get('seed')) | 0, index: Math.max(0, Number(query.get('level') ?? 1) - 1) };
  try {
    const saved = JSON.parse(localStorage.getItem(SAVE_KEY) ?? 'null');
    if (saved && Number.isFinite(saved.seed) && Number.isFinite(saved.index)) return saved;
  } catch {
    // No saved run.
  }
  return { seed: (Math.random() * 0x7fffffff) | 0, index: 0 };
}
const run = loadRun();
function saveRun(): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(run));
  } catch {
    // Storage is optional.
  }
}

// ---------- world ----------
const canvas = $<HTMLCanvasElement>('table');
const renderer = new TableRenderer(canvas, params);
const audio = new GameAudio();
let level: Level;
let sim: PuckSim;
let bot: SolverBot | null = null;
let paused = true;
let winAt = 0;
/** The puck is held still until this time: a moment to find it before the gaze starts pushing. */
let holdUntil = 0;
const HOLD_MS = 900;

function loadLevel(): void {
  level = generateLevel(run.seed, run.index, params);
  sim = new PuckSim(level, params);
  bot = bot ? new SolverBot(level, params) : null;
  renderer.setLevel(level);
  renderer.setPath(null);
  winAt = 0;
  holdUntil = performance.now() + HOLD_MS;
  $('level').textContent = `Level ${run.index + 1}`;
  $('par').textContent = `${level.par.toFixed(1)} s`;
  $('banner').hidden = true;
  saveRun();
}

function restart(): void {
  sim.reset();
  if (bot) bot = new SolverBot(level, params);
  winAt = 0;
  holdUntil = performance.now() + HOLD_MS;
  $('banner').hidden = true;
}

function nextLevel(): void {
  run.index++;
  loadLevel();
}

function toggleBot(): void {
  bot = bot ? null : new SolverBot(level, params);
  renderer.setPath(null);
  document.querySelector('[data-act="bot"]')!.setAttribute('aria-pressed', String(!!bot));
  restart();
  refreshStatus();
}

// ---------- gaze sources ----------
type SourceKind = 'camera' | 'phone' | 'mouse';
let source: GazeSource | null = null;
let sourceKind: SourceKind | null = null;
let stopSource: () => void = () => {};
let offGaze: () => void = () => {};
let latest: GazeSample | null = null;
let latestAt = 0;
let remoteTrackers = 0;

interface BridgeConfig {
  wasmBaseUrl?: string;
  modelUrl?: string;
  tlsPort?: number | null;
  addresses?: string[];
}
/** When the game is served by the EyeTracker bridge it can load everything from it; otherwise it uses the CDN. */
const bridgeConfig: BridgeConfig = await fetch('/config.json')
  .then((r) => (r.ok ? r.json() : {}))
  .catch(() => ({}));
const onBridge = !!bridgeConfig.wasmBaseUrl;
const bridgeHost = onBridge ? location.host : 'localhost:8787';
const bridgeWs = query.get('bridge') ?? `${onBridge && location.protocol === 'https:' ? 'wss' : 'ws'}://${bridgeHost}/gaze`;

function adopt(next: GazeSource, kind: SourceKind, stop: () => void): void {
  offGaze();
  stopSource();
  source = next;
  sourceKind = kind;
  stopSource = stop;
  latest = null;
  offGaze = next.on('gaze', (g) => {
    latest = g;
    latestAt = performance.now();
  });
  refreshStatus();
}

async function choose(kind: SourceKind): Promise<void> {
  const note = $('menu-note');
  note.textContent = '';
  audio.unlock();
  if (kind === 'mouse') {
    const mouse = new MouseGazeSource();
    mouse.start();
    adopt(mouse, 'mouse', () => mouse.stop());
    closeMenu();
    return;
  }
  if (kind === 'phone') {
    const remote = new RemoteGazeSource(bridgeWs, { name: 'MindPuck' });
    remote.on('peers', (p) => {
      remoteTrackers = p.trackers;
      refreshStatus();
    });
    remote.on('connection', () => {
      remoteTrackers = remote.trackers;
      refreshStatus();
    });
    adopt(remote, 'phone', () => remote.close());
    closeMenu();
    return;
  }
  note.textContent = 'Starting the camera and loading the face model...';
  const tracker = new EyeTracker({
    storageKey: 'mindpuck',
    camera: onBridge ? { wasmBaseUrl: bridgeConfig.wasmBaseUrl, modelUrl: bridgeConfig.modelUrl } : {},
  });
  try {
    await tracker.start();
  } catch {
    note.textContent = tracker.status.error ?? 'The camera could not be started.';
    return;
  }
  adopt(tracker, 'camera', () => tracker.stop());
  closeMenu();
  if (!tracker.calibrated) await calibrate();
}

async function calibrate(): Promise<void> {
  if (!source || sourceKind === 'mouse') {
    flash('Calibration is for eye tracking. Choose a camera first.');
    return;
  }
  if (sourceKind === 'phone' && remoteTrackers === 0) {
    flash('No tracker is connected yet.');
    return;
  }
  const wasPaused = paused;
  paused = true;
  const result = await runCalibration(source, { points: 9, fullscreen: true });
  paused = wasPaused;
  if (result.ok) flash(`Calibrated: about ${Math.round(result.crossError * 100)}% of the screen off, typically.`);
  else if (result.reason !== 'cancelled') flash(`Calibration failed: ${result.reason}.`);
  restart();
}

// ---------- status line ----------
let flashUntil = 0;
function flash(text: string): void {
  const el = $('status');
  el.textContent = text;
  el.className = 'status warn';
  flashUntil = performance.now() + 4500;
}

function phoneAddress(): string {
  const ip = bridgeConfig.addresses?.[0];
  return ip && bridgeConfig.tlsPort ? `https://${ip}:${bridgeConfig.tlsPort}/tracker/` : `https://<this computer's address>:8788/tracker/`;
}

function refreshStatus(): void {
  if (performance.now() < flashUntil) return;
  const el = $('status');
  let text = '';
  let warn = false;
  if (bot) text = 'The solver is playing. Watch where it looks: behind the puck, never at the goal.';
  else if (sourceKind === 'mouse') text = 'The pointer is your gaze. Keep it behind the puck.';
  else if (sourceKind === 'phone' && remoteTrackers === 0) {
    text = `Waiting for a camera. Start the bridge, then open ${phoneAddress()} on your phone (or http://${bridgeHost}/tracker/ in another window).`;
    warn = true;
  } else if (latest && !latest.face) {
    text = 'Your face is out of view of the camera.';
    warn = true;
  } else if (latest && !latest.calibrated) {
    text = 'Not calibrated yet: press C. Until then the gaze point is a rough guess.';
    warn = true;
  } else if (sourceKind) text = 'Look behind the puck to push it. Look far away to let it glide.';
  else text = 'Choose how to play';
  el.textContent = text;
  el.className = warn ? 'status warn' : 'status';
}

// ---------- menu and controls ----------
function openMenu(): void {
  paused = true;
  $('menu').hidden = false;
}
function closeMenu(): void {
  $('menu').hidden = true;
  paused = false;
  restart();
}

document.querySelectorAll<HTMLButtonElement>('[data-source]').forEach((b) =>
  b.addEventListener('click', () => void choose(b.dataset.source as SourceKind)),
);

const actions: Record<string, () => void> = {
  restart,
  skip: nextLevel,
  bot: toggleBot,
  calibrate: () => void calibrate(),
  menu: openMenu,
};
document.querySelectorAll<HTMLButtonElement>('[data-act]').forEach((b) =>
  b.addEventListener('click', () => {
    audio.unlock();
    actions[b.dataset.act!]?.();
    b.blur();
  }),
);

addEventListener('keydown', (ev) => {
  if (ev.repeat || ev.ctrlKey || ev.metaKey || ev.altKey) return;
  const menuOpen = !$('menu').hidden;
  const key = ev.key.toLowerCase();
  if (key === 'escape') {
    if (menuOpen && source) closeMenu();
    else if (!menuOpen) openMenu();
    return;
  }
  if (menuOpen) return;
  if (key === 'r') restart();
  else if (key === 'n') nextLevel();
  else if (key === 'b') toggleBot();
  else if (key === 'c') void calibrate();
  else if (key === 'f') void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen());
});

// ---------- loop ----------
function resize(): void {
  renderer.resize(innerWidth, innerHeight);
}
addEventListener('resize', resize);

/** The table point the player is looking at right now, or null when the eyes are not tracked. */
function playerGaze(now: number): Vec | null {
  if (!latest || latest.confidence <= 0 || now - latestAt > 400) return null;
  return renderer.screenToTable(latest.x, latest.y);
}

let last = performance.now();
let accumulator = 0;
let statusTick = 0;

function frame(now: number): void {
  const elapsed = Math.min((now - last) / 1000, 0.1);
  last = now;
  let gaze: Vec | null = null;

  if (!paused && !sim.won && now < holdUntil) {
    accumulator = 0;
    gaze = bot ? null : playerGaze(now);
  } else if (!paused && !sim.won) {
    gaze = bot ? bot.gaze : playerGaze(now);
    accumulator += elapsed;
    sim.impact = 0;
    while (accumulator >= params.dt && !sim.won) {
      accumulator -= params.dt;
      if (bot) gaze = bot.update(sim);
      sim.step(gaze);
    }
    if (sim.impact > 0) audio.bounce(sim.impact);
    if (bot) renderer.setPath(bot.path);
    if (sim.won) {
      winAt = now;
      audio.goal();
      const banner = $('banner');
      const beat = !bot && sim.time <= level.par;
      banner.innerHTML = '';
      banner.append('GOAL');
      const detail = document.createElement('small');
      detail.textContent = bot
        ? `The solver took ${sim.time.toFixed(1)} s`
        : `${sim.time.toFixed(1)} s${beat ? ', under par' : ` (par ${level.par.toFixed(1)} s)`}`;
      banner.append(detail);
      banner.hidden = false;
    }
  } else if (!paused) {
    gaze = bot ? null : playerGaze(now);
  }

  if (winAt && now - winAt > 1900) nextLevel();

  $('time').textContent = sim.time.toFixed(1);
  $('time').parentElement!.classList.toggle('beat', sim.won && sim.time <= level.par);
  if (now - statusTick > 500) {
    statusTick = now;
    refreshStatus();
  }
  renderer.render(sim, gaze, now / 1000);
  requestAnimationFrame(frame);
}

loadLevel();
resize();
requestAnimationFrame(frame);

// For development and automated checks: ?auto=mouse|camera|phone skips the menu, ?bot=1 starts the solver.
if (query.has('auto')) await choose(query.get('auto') as SourceKind);
if (query.has('bot')) toggleBot();
