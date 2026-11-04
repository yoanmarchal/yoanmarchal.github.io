// The "MY" logo as a 3D wireframe on a vector display: its six ribbon
// strips (public/images/yoanmarchal-logo.png) extruded into slabs - the dark
// strips set back behind the light ones - slowly turning, leaning towards
// the pointer, with an accent scan plane sweeping through the edges and a
// small HUD. Drawn into TextWarpLayer through addLiveGraphic, so the CRT
// shader curves, tints and blooms it, and the phosphor persistence turns
// its motion into trails.
//
// Lines are near-white: the shader tints neutral pixels with the theme's
// phosphor. The scan uses the accent, which keeps its hue.

// The visible faces of the logo, traced in its own pixel space (1300x430,
// y down). Dark strips first.
const LOGO_W = 1300;
const LOGO_H = 430;
const DARK = [
  [[0, 430], [193, 0], [270, 225], [189, 430]],
  [[443, 206], [538, 0], [614, 226], [533, 430]],
  [[873, 0], [1043, 0], [1089, 85], [1017, 243]],
];
const LIGHT = [
  [[193, 0], [360, 0], [533, 430], [339, 430]],
  [[538, 0], [707, 0], [877, 430], [683, 430]],
  [[1128, 0], [1300, 0], [1127, 430], [933, 430]],
];

// slab depths, in logo heights: the light strips straddle z = 0, the dark
// ones sit further back
const LIGHT_Z = [0.11, -0.11];
const DARK_Z = [-0.16, -0.38];

const CAMERA = 5;
// seconds for the edges to trace themselves in, when it first appears
const INTRO_S = 1.8;
const DEG = 180 / Math.PI;

function easeOutCubic(t) {
  return 1 - (1 - t) ** 3;
}

// logo pixels → model units: centred, 1 unit = the logo's height, y up
function toModel([x, y]) {
  return [(x - LOGO_W / 2) / LOGO_H, (LOGO_H / 2 - y) / LOGO_H];
}

// every edge of every slab: front outline, back outline, and the depth
// edges joining them; `weight` dims the dark strips' lines
function buildEdges() {
  const edges = [];
  const add = (polys, [zFront, zBack], weight) => {
    for (const poly of polys) {
      const pts = poly.map(toModel);
      pts.forEach(([x, y], i) => {
        const [nx, ny] = pts[(i + 1) % pts.length];
        edges.push({ a: [x, y, zFront], b: [nx, ny, zFront], weight });
        edges.push({ a: [x, y, zBack], b: [nx, ny, zBack], weight: weight * 0.55 });
        edges.push({ a: [x, y, zFront], b: [x, y, zBack], weight: weight * 0.7 });
      });
    }
  };
  add(DARK, DARK_Z, 0.55);
  add(LIGHT, LIGHT_Z, 1);
  return edges;
}

export function createVectorLogo() {
  const edges = buildEdges();
  let firstSeen = null;

  // the pointer, smoothed, so the logo leans towards it (hover devices only)
  const pointer = { x: 0, y: 0, sx: 0, sy: 0 };
  if (window.matchMedia("(hover: hover)").matches) {
    window.addEventListener("pointermove", (event) => {
      pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
      pointer.y = (event.clientY / window.innerHeight) * 2 - 1;
    });
  }

  return function draw(ctx, width, height, seconds) {
    // under reduced motion `seconds` stays 0: one still, fully drawn frame
    const still = seconds === 0;
    if (firstSeen === null || seconds < firstSeen) firstSeen = seconds;
    const local = seconds - firstSeen;
    const intro = still ? 1 : easeOutCubic(Math.min(local / INTRO_S, 1));

    const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#ffb000";
    const font = '"Departure Mono", ui-monospace, monospace';
    const unit = Math.max(Math.min(width, height) / 34, 9);

    if (!still) {
      pointer.sx += (pointer.x - pointer.sx) * 0.06;
      pointer.sy += (pointer.y - pointer.sy) * 0.06;
    }

    // a slow sway past three-quarter views, never quite edge-on, plus a
    // lean towards the pointer
    const yaw = still ? -0.45 : Math.sin(local * 0.32) * 0.75 + pointer.sx * 0.35;
    const pitch = still ? 0.18 : 0.14 + Math.sin(local * 0.21) * 0.1 + pointer.sy * 0.2;
    const cosY = Math.cos(yaw);
    const sinY = Math.sin(yaw);
    const cosP = Math.cos(pitch);
    const sinP = Math.sin(pitch);

    const cx = width / 2;
    const cy = height * 0.47;
    const scale = (width * 0.78) / (LOGO_W / LOGO_H);

    function project([x, y, z]) {
      const x1 = x * cosY + z * sinY;
      const z1 = -x * sinY + z * cosY;
      const y2 = y * cosP - z1 * sinP;
      const z2 = y * sinP + z1 * cosP;
      const f = CAMERA / (CAMERA - z2);
      return { x: cx + x1 * f * scale, y: cy - y2 * f * scale, z: z2 };
    }

    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 1.4;

    // the edges, nearer ones brighter; while it first appears each edge
    // traces itself from one end
    for (const { a, b, weight } of edges) {
      const pa = project(a);
      const pb = project(b);
      const depth = Math.min(Math.max(((pa.z + pb.z) / 2 + 0.8) / 1.6, 0), 1);
      const alpha = weight * (0.35 + 0.65 * depth);
      ctx.strokeStyle = `rgba(242, 242, 242, ${alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pa.x + (pb.x - pa.x) * intro, pa.y + (pb.y - pa.y) * intro);
      ctx.stroke();
    }

    // the scan plane: a horizontal slice sweeping up and down through the
    // model, marking where it cuts each edge
    if (intro >= 1) {
      const level = still ? 0.1 : Math.sin(local * 0.7) * 0.52;
      const hits = [];
      for (const { a, b } of edges) {
        if ((a[1] - level) * (b[1] - level) > 0 || a[1] === b[1]) continue;
        const t = (level - a[1]) / (b[1] - a[1]);
        hits.push(project([a[0] + (b[0] - a[0]) * t, level, a[2] + (b[2] - a[2]) * t]));
      }
      if (hits.length) {
        ctx.fillStyle = accent;
        ctx.strokeStyle = accent;
        for (const hit of hits) {
          ctx.globalAlpha = 0.55 + 0.45 * Math.min(Math.max((hit.z + 0.8) / 1.6, 0), 1);
          ctx.fillRect(hit.x - 1.5, hit.y - 1.5, 3, 3);
        }
        const xs = hits.map((h) => h.x);
        const ys = hits.map((h) => h.y);
        const midY = ys.reduce((sum, y) => sum + y, 0) / ys.length;
        ctx.globalAlpha = 0.28;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(Math.min(...xs) - unit, midY);
        ctx.lineTo(Math.max(...xs) + unit, midY);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    // HUD: corner brackets and a few readouts
    ctx.globalAlpha = intro;
    const pad = 4;
    const arm = Math.min(width, height) * 0.08;
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(242, 242, 242, 0.7)";
    ctx.beginPath();
    for (const [x, y, dx, dy] of [
      [pad, pad, 1, 1],
      [width - pad, pad, -1, 1],
      [pad, height - pad, 1, -1],
      [width - pad, height - pad, -1, -1],
    ]) {
      ctx.moveTo(x + dx * arm, y);
      ctx.lineTo(x, y);
      ctx.lineTo(x, y + dy * arm);
    }
    ctx.stroke();

    ctx.font = `${Math.round(unit)}px ${font}`;
    ctx.fillStyle = accent;
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    ctx.fillText("OBJ  MY-01", pad + unit, pad + unit * 0.9);
    ctx.fillStyle = "rgba(242, 242, 242, 0.6)";
    ctx.textAlign = "right";
    ctx.fillText(`${edges.length} ARÊTES`, width - pad - unit, pad + unit * 0.9);

    ctx.textBaseline = "bottom";
    ctx.textAlign = "left";
    const yawDeg = ((yaw * DEG) % 360 + 360) % 360;
    ctx.fillText(
      `ROT ${yawDeg.toFixed(1).padStart(5, "0")}°  INCL ${(pitch * DEG).toFixed(1).padStart(4, "0")}°`,
      pad + unit,
      height - pad - unit * 0.9
    );
    ctx.textAlign = "right";
    const blink = still || Math.floor(local * 1.6) % 2 === 0;
    ctx.fillText(blink ? "● SCAN" : "  SCAN", width - pad - unit, height - pad - unit * 0.9);
    ctx.globalAlpha = 1;
  };
}
