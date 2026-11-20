import * as THREE from 'three';
import type { Level, PhysicsParams, PuckSim, Vec } from '../core/index.js';
import { winRadius } from '../core/index.js';

const WALL_HEIGHT = 0.34;
const RIM = 0.35;
const TRAIL = 48;

const COLORS = {
  background: 0x05070d,
  felt: 0x0b1220,
  rim: 0x1b2638,
  wall: 0x2a3a57,
  wallTop: 0x4c6a9c,
  puck: 0xf2f6ff,
  puckGlow: 0x7fd4ff,
  goal: 0xffc266,
  gaze: 0x7fd4ff,
  pull: 0xff9ad5,
  path: 0x5fe3a1,
};

/**
 * Draws the table with three.js. World coordinates (x right, y down the table) map to the scene's
 * (x, 0, z); the scene's y axis is height above the felt.
 */
export class TableRenderer {
  readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(34, 1, 0.1, 200);
  private readonly levelGroup = new THREE.Group();
  private readonly puck: THREE.Group;
  private readonly puckLight: THREE.PointLight;
  private readonly goalRing: THREE.Mesh;
  private readonly goalFill: THREE.Mesh;
  private readonly goalProgress: THREE.Mesh;
  private readonly field: THREE.Mesh;
  private readonly fieldUniforms: {
    uTime: { value: number };
    uStrength: { value: number };
    uSoft: { value: number };
    uDir: { value: number };
    uColor: { value: THREE.Color };
  };
  private readonly trail: THREE.Line;
  private readonly trailPositions = new Float32Array(TRAIL * 3);
  private readonly pathLine: THREE.Line;
  private readonly raycaster = new THREE.Raycaster();
  private readonly plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly hit = new THREE.Vector3();
  private level: Level | null = null;
  private fieldRange: number;

  constructor(
    canvas: HTMLCanvasElement,
    private readonly params: PhysicsParams,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.scene.background = new THREE.Color(COLORS.background);
    this.fieldRange = params.repelRange;

    this.scene.add(new THREE.HemisphereLight(0xb8c8ee, 0x0a0e18, 0.9));
    const key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(4, 14, -2);
    this.scene.add(key);
    this.scene.add(this.levelGroup);

    // Puck: a low cylinder with a bright rim.
    this.puck = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1, 0.16, 56),
      new THREE.MeshStandardMaterial({ color: COLORS.puck, roughness: 0.3, metalness: 0.1 }),
    );
    body.position.y = 0.1;
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(0.86, 0.06, 10, 56),
      new THREE.MeshBasicMaterial({ color: COLORS.puckGlow }),
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.19;
    this.puck.add(body, rim);
    this.puckLight = new THREE.PointLight(COLORS.puckGlow, 6, 5, 1.8);
    this.puckLight.position.y = 0.8;
    this.puck.add(this.puckLight);
    this.scene.add(this.puck);

    // Goal pad: a ring, a soft fill, and a sweep that fills while the puck rests on it.
    const flat = (geometry: THREE.BufferGeometry, color: number, opacity: number) => {
      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide }),
      );
      mesh.rotation.x = -Math.PI / 2;
      return mesh;
    };
    this.goalRing = flat(new THREE.RingGeometry(0.93, 1, 72), COLORS.goal, 0.95);
    this.goalFill = flat(new THREE.CircleGeometry(0.93, 72), COLORS.goal, 0.12);
    this.goalProgress = flat(new THREE.RingGeometry(0.72, 0.9, 72, 1, 0, 0.001), COLORS.goal, 0.9);
    this.goalRing.position.y = 0.012;
    this.goalFill.position.y = 0.01;
    this.goalProgress.position.y = 0.014;
    this.scene.add(this.goalRing, this.goalFill, this.goalProgress);

    // The repulsion field around the gaze point: rings travelling outward, fading with the same
    // curve the physics uses, so what the player sees is the push they get.
    this.fieldUniforms = {
      uTime: { value: 0 },
      uStrength: { value: 1 },
      uSoft: { value: params.repelSoftness / params.repelRange },
      uDir: { value: -1 },
      uColor: { value: new THREE.Color(COLORS.pull) },
    };
    this.field = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        uniforms: this.fieldUniforms,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `
          varying vec2 vUv; uniform float uTime; uniform float uStrength; uniform float uSoft; uniform float uDir; uniform vec3 uColor;
          void main(){
            float r = length(vUv);
            if (r > 1.0) discard;
            float reach = (1.0 - r) * (1.0 - r);
            float push = reach / (1.0 + (r / uSoft) * (r / uSoft));
            // uDir +1: rings travel outward (repulsor). -1: they fall inward (magnet).
            float rings = 0.5 + 0.5 * sin(r * 34.0 - uDir * uTime * 7.0);
            float core = smoothstep(0.035, 0.0, r);
            float a = push * (0.16 + 0.5 * rings * rings) + core;
            gl_FragColor = vec4(uColor, a * uStrength);
          }`,
      }),
    );
    this.field.rotation.x = -Math.PI / 2;
    this.field.position.y = 0.03;
    this.field.scale.setScalar(this.fieldRange);
    this.scene.add(this.field);

    const trailGeometry = new THREE.BufferGeometry();
    trailGeometry.setAttribute('position', new THREE.BufferAttribute(this.trailPositions, 3));
    this.trail = new THREE.Line(
      trailGeometry,
      new THREE.LineBasicMaterial({ color: COLORS.puckGlow, transparent: true, opacity: 0.35 }),
    );
    this.trail.frustumCulled = false;
    this.scene.add(this.trail);

    this.pathLine = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineDashedMaterial({ color: COLORS.path, dashSize: 0.18, gapSize: 0.14, transparent: true, opacity: 0.8 }),
    );
    this.pathLine.frustumCulled = false;
    this.pathLine.visible = false;
    this.scene.add(this.pathLine);
  }

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.frame();
  }

  /** Place the camera so the whole table, rim included, fits the view. */
  private frame(): void {
    const lv = this.level;
    const w = lv?.width ?? 16;
    const h = lv?.height ?? 9;
    const half = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const margin = RIM + 0.45;
    const fitHeight = (h / 2 + margin) / half;
    const fitWidth = (w / 2 + margin) / (half * this.camera.aspect);
    const distance = Math.max(fitHeight, fitWidth) * 1.04;
    const tilt = THREE.MathUtils.degToRad(11);
    this.camera.position.set(w / 2, Math.cos(tilt) * distance, h / 2 + Math.sin(tilt) * distance);
    this.camera.lookAt(w / 2, 0, h / 2 + 0.12);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }

  /** Turn a normalized screen point (0..1, y down) into a table position. */
  screenToTable(nx: number, ny: number): Vec {
    this.raycaster.setFromCamera(new THREE.Vector2(nx * 2 - 1, 1 - ny * 2), this.camera);
    const point = this.raycaster.ray.intersectPlane(this.plane, this.hit);
    const lv = this.level;
    const w = lv?.width ?? 16;
    const h = lv?.height ?? 9;
    if (!point) return { x: w / 2, y: h / 2 };
    return {
      x: THREE.MathUtils.clamp(point.x, -1.5, w + 1.5),
      y: THREE.MathUtils.clamp(point.z, -1.5, h + 1.5),
    };
  }

  setLevel(level: Level): void {
    this.level = level;
    for (const child of [...this.levelGroup.children]) {
      this.levelGroup.remove(child);
      const mesh = child as THREE.Mesh;
      mesh.geometry?.dispose();
    }
    const { width: w, height: h } = level;

    const felt = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshStandardMaterial({ color: COLORS.felt, roughness: 0.85, map: gridTexture(w, h) }),
    );
    felt.rotation.x = -Math.PI / 2;
    felt.position.set(w / 2, 0, h / 2);
    this.levelGroup.add(felt);

    const rimMaterial = new THREE.MeshStandardMaterial({ color: COLORS.rim, roughness: 0.6 });
    const rim = (x: number, z: number, sx: number, sz: number) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, WALL_HEIGHT, sz), rimMaterial);
      mesh.position.set(x, WALL_HEIGHT / 2, z);
      this.levelGroup.add(mesh);
    };
    rim(w / 2, -RIM / 2, w + RIM * 2, RIM);
    rim(w / 2, h + RIM / 2, w + RIM * 2, RIM);
    rim(-RIM / 2, h / 2, RIM, h);
    rim(w + RIM / 2, h / 2, RIM, h);

    const side = new THREE.MeshStandardMaterial({ color: COLORS.wall, roughness: 0.55 });
    const top = new THREE.MeshStandardMaterial({ color: COLORS.wallTop, roughness: 0.4, emissive: 0x16243d });
    for (const poly of level.obstacles) {
      const shape = new THREE.Shape(poly.map((v) => new THREE.Vector2(v.x, v.y)));
      const geometry = new THREE.ExtrudeGeometry(shape, { depth: WALL_HEIGHT, bevelEnabled: false });
      // The shape was drawn in (x, y); stand it up so y becomes the table's depth and the
      // extrusion becomes height.
      geometry.rotateX(Math.PI / 2);
      const mesh = new THREE.Mesh(geometry, [top, side]);
      mesh.position.y = WALL_HEIGHT;
      this.levelGroup.add(mesh);
    }

    const g = level.goal;
    for (const part of [this.goalRing, this.goalFill, this.goalProgress]) {
      part.position.x = g.x;
      part.position.z = g.y;
    }
    this.goalRing.scale.setScalar(g.r);
    this.goalFill.scale.setScalar(g.r);
    this.goalProgress.scale.setScalar(winRadius(level) / 0.9);
    this.puck.scale.set(level.puckRadius, 1, level.puckRadius);
    this.resetTrail(level.start);
    this.frame();
  }

  private resetTrail(at: Vec): void {
    for (let i = 0; i < TRAIL; i++) {
      this.trailPositions[i * 3] = at.x;
      this.trailPositions[i * 3 + 1] = 0.05;
      this.trailPositions[i * 3 + 2] = at.y;
    }
  }

  /** Show the solver's route, or hide it with null. */
  setPath(path: Vec[] | null): void {
    this.pathLine.visible = !!path && path.length > 1;
    if (!path || path.length < 2) return;
    this.pathLine.geometry.dispose();
    this.pathLine.geometry = new THREE.BufferGeometry().setFromPoints(path.map((p) => new THREE.Vector3(p.x, 0.04, p.y)));
    this.pathLine.computeLineDistances();
  }

  /** Draw one frame. `gaze` is the table point being looked at, or null when the eyes are not tracked. */
  render(sim: PuckSim, gaze: Vec | null, timeSeconds: number): void {
    const { pos } = sim;
    if (sim.time === 0) this.resetTrail(pos);
    this.puck.position.set(pos.x, 0, pos.y);
    const speed = Math.hypot(sim.vel.x, sim.vel.y);
    this.puckLight.intensity = 5 + Math.min(speed, 8) * 1.4;

    this.trailPositions.copyWithin(3, 0, (TRAIL - 1) * 3);
    this.trailPositions[0] = pos.x;
    this.trailPositions[1] = 0.05;
    this.trailPositions[2] = pos.y;
    (this.trail.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;

    this.field.visible = !!gaze;
    if (gaze) this.field.position.set(gaze.x, 0.03, gaze.y);
    this.fieldUniforms.uTime.value = timeSeconds;
    this.fieldUniforms.uStrength.value = 0.85;
    const repel = sim.mode === 'repel';
    this.fieldUniforms.uDir.value = repel ? 1 : -1;
    this.fieldUniforms.uColor.value.setHex(repel ? COLORS.gaze : COLORS.pull);
    this.field.scale.setScalar(repel ? this.fieldRange : this.fieldRange * 0.55);

    const progress = sim.won ? 1 : Math.min(sim.dwell / this.params.dwell, 1);
    this.goalProgress.visible = progress > 0;
    if (progress > 0) {
      this.goalProgress.geometry.dispose();
      this.goalProgress.geometry = new THREE.RingGeometry(0.72, 0.9, 72, 1, Math.PI / 2, -progress * Math.PI * 2);
    }
    (this.goalFill.material as THREE.MeshBasicMaterial).opacity = 0.1 + 0.05 * Math.sin(timeSeconds * 2.4) + (sim.won ? 0.4 : 0);

    this.renderer.render(this.scene, this.camera);
  }
}

/** A faint grid for the felt, drawn once to a canvas. It gives the eye something to judge speed against. */
function gridTexture(w: number, h: number): THREE.CanvasTexture {
  const scale = 64;
  const canvas = document.createElement('canvas');
  canvas.width = w * scale;
  canvas.height = h * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = 'rgba(120,160,230,0.5)';
  ctx.lineWidth = 2;
  for (let x = 0; x <= w; x++) {
    ctx.beginPath();
    ctx.moveTo(x * scale, 0);
    ctx.lineTo(x * scale, canvas.height);
    ctx.stroke();
  }
  for (let y = 0; y <= h; y++) {
    ctx.beginPath();
    ctx.moveTo(0, y * scale);
    ctx.lineTo(canvas.width, y * scale);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}
