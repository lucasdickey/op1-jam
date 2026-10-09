import {
  AmbientLight,
  BoxGeometry,
  CanvasTexture,
  CylinderGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  RingGeometry,
  Scene,
  ShadowMaterial,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  type BufferGeometry,
  type Material,
  type Texture,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import {
  BLACK_AFTER,
  COLS,
  EDGE,
  ENCODERS,
  INK,
  KEYBOARD,
  KEYS,
  LIT_KEY,
  ROWS,
  SCREEN,
  SPEAKER,
  VOLUME,
  WHITE_KEYS,
  type KeyId,
  type KeySpec,
} from "./op1-layout";
import { drawScreen, SCREEN_H, SCREEN_W, type ScreenState } from "./op1-screen";

// The OP-1 in 3D, for the Getting started cards: built in code from
// op1-layout.ts (measured from photos of a real one), every key, knob and the
// power switch its own part, so a card can press, turn and slide them. Loaded
// only when a card shows it; the flat drawing stands in until then, and
// instead of it when there's no WebGL or the person prefers reduced motion.
//
// Units are millimetres. x runs along the OP-1 (left to right as you face
// it), z towards you, y up.

export type View = "front" | "edge" | "keys";

export interface SceneBeat {
  hold?: KeyId[];
  press?: KeyId[];
  screen?: ScreenState;
  view?: View;
}

const P = 16; // grid pitch
const GAP = 0.8;
const L = 282;
const D = 102;
const BODY_H = 11;
const TILE_H = 1.6;
const TOP = BODY_H + TILE_H; // top of the key tiles
const X0 = -(COLS * P) / 2;
const Z0 = -(ROWS * P) / 2;
const cx = (col: number, w = 1) => X0 + (col + w / 2) * P;
const cz = (row: number, h = 1) => Z0 + (row + h / 2) * P;

const COLORS = {
  body: "#d6d9dc",
  tile: "#e4e6e7",
  cap: "#eef0f0",
  well: "#c7cacd",
  skirt: "#c9ccd0",
  black: "#141518",
  hold: "#2b2e34",
  press: "#ef6a2c",
};

const VIEWS: Record<View, { eye: [number, number, number]; at: [number, number, number] }> = {
  front: { eye: [0, 262, 168], at: [0, 0, -6] },
  edge: { eye: [228, 62, 92], at: [138, 3, 4] },
  keys: { eye: [-40, 170, 175], at: [-60, 0, 10] },
};

/** A key's cap face: its glyph in the device's ink on the cap's colour. */
function capTexture(spec: KeySpec): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = spec.solid ? INK.orange : COLORS.cap;
  g.fillRect(0, 0, 128, 128);
  g.textAlign = "center";
  g.textBaseline = "middle";
  const font = (px: number, w = 500) => `${w} ${px}px ui-monospace, "SF Mono", Menlo, monospace`;
  if (spec.solid) {
    g.fillStyle = "#fff";
    g.beginPath();
    g.arc(64, 64, 16, 0, Math.PI * 2);
    g.fill();
  } else {
    const word = spec.glyph.length > 2;
    g.fillStyle = INK[spec.ink];
    g.font = font(word ? 26 : spec.sub ? 44 : 56, word ? 600 : 400);
    g.fillText(spec.glyph, 64, spec.sub ? 50 : 66);
    if (spec.sub) {
      g.fillStyle = INK[spec.subInk ?? spec.ink];
      g.font = font(22, 700);
      g.fillText(spec.sub, 64, 94);
    }
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function speakerTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = COLORS.tile;
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = "#8a8f96";
  for (let y = 0; y < 15; y++) {
    for (let x = 0; x < 15; x++) {
      const px = 40 + x * 12.5;
      const py = 40 + y * 12.5;
      if (Math.hypot(px - 128, py - 128) < 92) {
        g.beginPath();
        g.arc(px, py, 3.2, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

function logoTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 64;
  const g = c.getContext("2d")!;
  g.fillStyle = "#5b6470";
  g.font = '500 44px -apple-system, "Helvetica Neue", Arial, sans-serif';
  g.textBaseline = "middle";
  g.fillText("OP-1", 8, 34);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

interface Part {
  ids: KeyId[];
  /** Moves down when pressed. */
  press?: Group;
  /** Turns when its knob is "pressed". */
  turn?: Group;
  /** Slides, for the power switch. */
  slide?: { group: Group; from: number; to: number };
  halo?: Mesh;
  /** Tinted when lit, for the white key. */
  tint?: MeshStandardMaterial;
}

export class Op1Scene {
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera = new PerspectiveCamera(26, 2, 10, 2000);
  private controls: OrbitControls;
  private parts: Part[] = [];
  private screenCanvas = document.createElement("canvas");
  private screenTexture: CanvasTexture;
  private owned: (BufferGeometry | Material | Texture)[] = [];
  private beat: SceneBeat = {};
  private raf = 0;
  private resizeObserver: ResizeObserver;
  private camFrom = { eye: new Vector3(), at: new Vector3() };
  private camTo = { eye: new Vector3(), at: new Vector3() };
  private camStart = -Infinity;
  private dragging = false;
  private haloMat = new MeshBasicMaterial({ color: COLORS.press, transparent: true, opacity: 0.9 });
  private haloHoldMat = new MeshBasicMaterial({ color: COLORS.hold, transparent: true, opacity: 0.9 });

  constructor(private canvas: HTMLCanvasElement) {
    // Throws when there's no WebGL; the caller keeps the flat drawing.
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.owned.push(this.haloMat, this.haloHoldMat);

    this.screenCanvas.width = SCREEN_W;
    this.screenCanvas.height = SCREEN_H;
    this.screenTexture = new CanvasTexture(this.screenCanvas);
    this.screenTexture.colorSpace = SRGBColorSpace;
    this.owned.push(this.screenTexture);

    this.light();
    this.build();

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enablePan = false;
    this.controls.enableDamping = true;
    this.controls.minDistance = 180;
    this.controls.maxDistance = 520;
    this.controls.minPolarAngle = 0.15;
    this.controls.maxPolarAngle = 1.35;
    this.controls.addEventListener("start", () => {
      this.dragging = true;
      this.camStart = -Infinity;
    });
    const v = VIEWS.front;
    this.camera.position.set(...v.eye);
    this.controls.target.set(...v.at);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
    this.frame = this.frame.bind(this);
    this.raf = requestAnimationFrame(this.frame);
  }

  /** Show a step: which keys are held and pressed, the screen, the camera. */
  setBeat(beat: SceneBeat) {
    const lastScreen = this.beat.screen;
    const lastView = this.beat.view ?? "front";
    this.beat = beat;
    if (beat.screen !== lastScreen || !this.screenTexture.version) {
      drawScreen(this.screenCanvas.getContext("2d")!, beat.screen ?? "reels");
      this.screenTexture.needsUpdate = true;
    }
    const view = beat.view ?? "front";
    if (view !== lastView || this.dragging) {
      // A new view, or the person had turned it: glide to the step's view.
      this.dragging = false;
      this.camFrom.eye.copy(this.camera.position);
      this.camFrom.at.copy(this.controls.target);
      this.camTo.eye.set(...VIEWS[view].eye);
      this.camTo.at.set(...VIEWS[view].at);
      this.camStart = performance.now();
    }
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    for (const o of this.owned) o.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }

  /* --- building ----------------------------------------------------------- */

  private own<T extends BufferGeometry | Material | Texture>(x: T): T {
    this.owned.push(x);
    return x;
  }

  private mat(color: string, rough = 0.7, metal = 0.05) {
    return this.own(new MeshStandardMaterial({ color, roughness: rough, metalness: metal }));
  }

  private mesh(geo: BufferGeometry, mat: Material | Material[], shadow = true) {
    const m = new Mesh(geo, mat);
    m.castShadow = shadow;
    m.receiveShadow = true;
    return m;
  }

  private light() {
    this.scene.add(new HemisphereLight("#ffffff", "#b8bcc2", 1.1));
    this.scene.add(new AmbientLight("#ffffff", 0.25));
    const sun = new DirectionalLight("#ffffff", 2.2);
    sun.position.set(-120, 260, 160);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const s = sun.shadow.camera;
    s.left = -170;
    s.right = 170;
    s.top = 90;
    s.bottom = -90;
    s.near = 50;
    s.far = 600;
    sun.shadow.bias = -0.0005;
    sun.shadow.radius = 4;
    this.scene.add(sun);

    const ground = this.mesh(this.own(new PlaneGeometry(900, 500)), this.own(new ShadowMaterial({ opacity: 0.16 })), false);
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);
  }

  private tile(col: number, row: number, w: number, h: number, mat: Material) {
    const geo = this.own(new RoundedBoxGeometry(w * P - GAP, TILE_H, h * P - GAP, 2, 0.9));
    const m = this.mesh(geo, mat);
    m.position.set(cx(col, w), BODY_H + TILE_H / 2, cz(row, h));
    return m;
  }

  private halo(x: number, z: number, r: number, y = TOP + 0.05) {
    const ring = new Mesh(this.own(new RingGeometry(r, r + 1.6, 48)), this.haloMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, y, z);
    ring.visible = false;
    this.scene.add(ring);
    return ring;
  }

  private build() {
    const s = this.scene;
    const tileMat = this.mat(COLORS.tile, 0.75);
    const capSide = this.mat(COLORS.cap, 0.6);

    // The body: an aluminium slab with rounded edges.
    const body = this.mesh(this.own(new RoundedBoxGeometry(L, BODY_H, D, 4, 2.2)), this.mat(COLORS.body, 0.45, 0.35));
    body.position.y = BODY_H / 2;
    s.add(body);

    // Square keys: a tile, and a round cap with the key's print on it.
    const capGeo = this.own(new CylinderGeometry(6, 6.2, 1.6, 40));
    for (const spec of KEYS) {
      const group = new Group();
      group.add(this.tile(spec.col, spec.row, 1, 1, tileMat));
      const top = this.own(new MeshStandardMaterial({ map: this.own(capTexture(spec)), roughness: 0.6 }));
      const cap = this.mesh(capGeo, [capSide, top, capSide]);
      cap.position.set(cx(spec.col), TOP + 0.8, cz(spec.row));
      cap.rotation.y = Math.PI / 2; // print reads facing the person
      group.add(cap);
      s.add(group);
      this.parts.push({ ids: [spec.id], press: group, halo: this.halo(cx(spec.col), cz(spec.row), 6.6, TOP + 1.7) });
    }

    // The speaker grille.
    const speaker = this.tile(SPEAKER.col, SPEAKER.row, SPEAKER.w, SPEAKER.h, tileMat);
    s.add(speaker);
    const grille = new Mesh(
      this.own(new PlaneGeometry(SPEAKER.w * P - 4, SPEAKER.h * P - 4)),
      this.own(new MeshStandardMaterial({ map: this.own(speakerTexture()), roughness: 0.8 })),
    );
    grille.rotation.x = -Math.PI / 2;
    grille.position.set(cx(SPEAKER.col, SPEAKER.w), TOP + 0.02, cz(SPEAKER.row, SPEAKER.h));
    s.add(grille);

    // Volume: a white knob on the left of its tile.
    s.add(this.tile(VOLUME.col, VOLUME.row, VOLUME.w, VOLUME.h, tileMat));
    const vx = X0 + (VOLUME.knobCol - 0.05) * P;
    const vz = cz(VOLUME.row) - 1.5;
    s.add(this.knob("volume", vx, vz, "#f4f4f2", 4.2, 9));

    // The screen, in a frame.
    s.add(this.tile(SCREEN.col, SCREEN.row, SCREEN.w, SCREEN.h, tileMat));
    const glass = new Mesh(
      this.own(new PlaneGeometry(SCREEN.w * P - 5, SCREEN.h * P - 5)),
      this.own(new MeshBasicMaterial({ map: this.screenTexture })),
    );
    glass.rotation.x = -Math.PI / 2;
    glass.position.set(cx(SCREEN.col, SCREEN.w), TOP + 0.03, cz(SCREEN.row, SCREEN.h));
    s.add(glass);

    // The four encoders, each on a two-by-two tile in a recessed well.
    const wellMat = this.mat(COLORS.well, 0.5, 0.2);
    for (const e of ENCODERS) {
      s.add(this.tile(e.col, 0, 2, 2, tileMat));
      const x = cx(e.col, 2);
      const z = cz(0, 2);
      const well = this.mesh(this.own(new CylinderGeometry(10.5, 10.5, 0.4, 48)), wellMat, false);
      well.position.set(x, TOP + 0.05, z);
      s.add(well);
      s.add(this.knob(e.id, x, z, e.color, 5.2, 10));
    }

    // The keyboard: fourteen white keys, F to E, with a raised pill on each,
    // and a row of tiles above them carrying the black keys.
    const pillGeo = this.own(new RoundedBoxGeometry(8.4, 1.2, 22, 4, 4));
    const pillMat = this.mat(COLORS.cap, 0.6);
    for (let i = 0; i < WHITE_KEYS; i++) {
      const col = KEYBOARD.col + i;
      s.add(this.tile(col, KEYBOARD.row - 1, 1, 1, tileMat));
      const group = new Group();
      group.add(this.tile(col, KEYBOARD.row, 1, 2, tileMat));
      const lit = i === LIT_KEY;
      const pill = this.mesh(pillGeo, lit ? this.mat(COLORS.cap, 0.6) : pillMat);
      pill.position.set(cx(col), TOP + 0.6, cz(KEYBOARD.row, 2) + 1);
      group.add(pill);
      s.add(group);
      if (lit) this.parts.push({ ids: ["piano"], press: group, tint: pill.material as MeshStandardMaterial });
    }
    const blackGeo = this.own(new CylinderGeometry(4.6, 4.6, 1.2, 40));
    const blackMat = this.mat(COLORS.black, 0.85);
    for (const after of BLACK_AFTER) {
      const m = this.mesh(blackGeo, blackMat);
      m.position.set(X0 + (KEYBOARD.col + after + 1) * P, TOP + 0.5, cz(KEYBOARD.row - 1));
      s.add(m);
    }

    // "OP-1", printed up the right-hand end beside the keys.
    const logo = new Mesh(this.own(new PlaneGeometry(14, 3.5)), this.own(new MeshBasicMaterial({ map: this.own(logoTexture()), transparent: true })));
    logo.rotation.x = -Math.PI / 2;
    logo.rotation.z = Math.PI / 2;
    logo.position.set(L / 2 - 3.4, BODY_H + 0.02, 30);
    s.add(logo);

    this.buildEdge();
  }

  private knob(id: KeyId, x: number, z: number, cap: string, r: number, h: number) {
    const outer = new Group();
    const turn = new Group();
    const skirt = this.mesh(this.own(new CylinderGeometry(r, r + 0.4, h - 2, 32)), this.mat(COLORS.skirt, 0.5));
    skirt.position.y = TOP + (h - 2) / 2;
    turn.add(skirt);
    const top = this.mesh(this.own(new CylinderGeometry(r - 0.2, r - 0.2, 2.2, 32)), this.mat(cap, 0.45));
    top.position.y = TOP + h - 1;
    turn.add(top);
    // The slot that shows which way it points.
    const slot = this.mesh(this.own(new BoxGeometry(1.1, 0.4, r * 1.3)), this.mat("#55585e", 0.9), false);
    slot.position.set(0, TOP + h + 0.12, 0);
    turn.add(slot);
    turn.position.set(x, 0, z);
    outer.add(turn);
    this.parts.push({ ids: [id], turn, halo: this.halo(x, z, r + 2.4) });
    return outer;
  }

  private buildEdge() {
    const s = this.scene;
    const x = L / 2 + 0.05;
    const front = D / 2;
    const y = BODY_H / 2;
    const dark = this.mat("#1b1d21", 0.8);

    // Strap slots.
    for (const at of EDGE.slots) {
      const slot = new Mesh(this.own(new BoxGeometry(0.3, 5, 1.8)), dark);
      slot.position.set(x, y, front - at);
      s.add(slot);
    }

    // The power switch slides toward the front to turn on.
    const sw = new Group();
    const groove = new Mesh(this.own(new BoxGeometry(0.3, 4.4, 11 + EDGE.power.travel)), dark);
    groove.position.set(x, y, front - EDGE.power.at - EDGE.power.travel / 2);
    s.add(groove);
    const nubMat = this.mat("#f2f2f0", 0.5);
    const nub = this.mesh(this.own(new RoundedBoxGeometry(1.4, 4, 9, 2, 0.6)), nubMat);
    nub.position.set(x + 0.4, y, 0);
    sw.add(nub);
    const on = front - EDGE.power.at;
    sw.position.z = on;
    s.add(sw);
    const swHalo = new Mesh(this.own(new RingGeometry(9.5, 11, 48)), this.haloMat);
    swHalo.rotation.y = Math.PI / 2;
    swHalo.scale.set(1, 0.55, 1);
    swHalo.position.set(x + 0.2, y, on - EDGE.power.travel / 2);
    swHalo.visible = false;
    s.add(swHalo);
    this.parts.push({ ids: ["power"], slide: { group: sw, from: on - EDGE.power.travel, to: on }, halo: swHalo, tint: nubMat });

    // Mini USB.
    const usbGroup = new Group();
    const usb = new Mesh(this.own(new BoxGeometry(0.3, 3.2, 7.6)), dark);
    usb.position.set(x, y, front - EDGE.usb);
    usbGroup.add(usb);
    s.add(usbGroup);
    const usbHalo = new Mesh(this.own(new RingGeometry(5.2, 6.4, 40)), this.haloMat);
    usbHalo.rotation.y = Math.PI / 2;
    usbHalo.position.set(x + 0.2, y, front - EDGE.usb);
    usbHalo.visible = false;
    s.add(usbHalo);
    this.parts.push({ ids: ["usb"], halo: usbHalo });

    // The two 3.5 mm jacks: one ringed red, one grey.
    EDGE.jacks.forEach((at, i) => {
      const ring = this.mesh(this.own(new CylinderGeometry(2.6, 2.6, 0.4, 32)), this.mat(i === 0 ? "#c8343a" : "#b5b9be", 0.5), false);
      ring.rotation.z = Math.PI / 2;
      ring.position.set(x + 0.1, y, front - at);
      s.add(ring);
      const hole = new Mesh(this.own(new CylinderGeometry(1.8, 1.8, 0.5, 32)), dark);
      hole.rotation.z = Math.PI / 2;
      hole.position.set(x + 0.2, y, front - at);
      s.add(hole);
    });
  }

  /* --- running ------------------------------------------------------------- */

  private resize() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private frame(now: number) {
    this.raf = requestAnimationFrame(this.frame);
    const hold = this.beat.hold ?? [];
    const press = this.beat.press ?? [];
    // One press every 1.6 s: down quickly, back up, a rest.
    const phase = (now % 1600) / 1600;
    const pulse = phase < 0.12 ? phase / 0.12 : phase < 0.35 ? 1 - (phase - 0.12) / 0.23 : 0;
    const swing = Math.sin((now / 1600) * Math.PI * 2);

    for (const part of this.parts) {
      const held = part.ids.some((id) => hold.includes(id));
      const pressed = part.ids.some((id) => press.includes(id));
      if (part.press) part.press.position.y = held ? -0.9 : pressed ? -0.9 * pulse : 0;
      if (part.turn) part.turn.rotation.y = pressed ? swing * 1.1 : 0;
      if (part.slide) {
        const t = pressed ? Math.min(1, Math.max(0, (phase - 0.2) / 0.35)) : 1;
        part.slide.group.position.z = part.slide.from + (part.slide.to - part.slide.from) * t;
      }
      if (part.halo) {
        part.halo.visible = held || pressed;
        part.halo.material = held ? this.haloHoldMat : this.haloMat;
      }
      if (part.tint) part.tint.color.set(pressed ? COLORS.press : COLORS.cap);
    }

    // Glide the camera to the step's view.
    const t = Math.min(1, (now - this.camStart) / 900);
    if (t < 1) {
      const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      this.camera.position.lerpVectors(this.camFrom.eye, this.camTo.eye, e);
      this.controls.target.lerpVectors(this.camFrom.at, this.camTo.at, e);
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
