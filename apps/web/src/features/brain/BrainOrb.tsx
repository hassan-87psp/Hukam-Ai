import { useEffect, useRef } from 'react';
import type { BrainState } from '../../services/store';

/**
 * HUKM's signature "live brain": a lightweight Canvas-2D neural orb.
 * - Geometry is generated once; each frame is a handful of path draws.
 * - Pauses when off-screen or the tab is hidden; renders one static frame with reduced motion.
 * It visualises app state only — it never implies an AI model is running.
 */

interface P3 { x: number; y: number; z: number }
interface Params { speed: number; glow: number; pulse: number; signals: number; ring: number; wave: number; tint: [number, number, number]; dim: number; directional: boolean }

const ICE: [number, number, number] = [117, 214, 255];
const PARAMS: Record<BrainState, Params> = {
  idle: { speed: 0.12, glow: 0.75, pulse: 4.2, signals: 0.35, ring: 0.18, wave: 0.35, tint: ICE, dim: 1, directional: false },
  listening: { speed: 0.22, glow: 1.0, pulse: 1.4, signals: 1.2, ring: 0.35, wave: 1, tint: ICE, dim: 1, directional: false },
  processing: { speed: 0.42, glow: 0.95, pulse: 1.8, signals: 3.2, ring: 0.6, wave: 0.55, tint: [140, 200, 255], dim: 1, directional: false },
  executing: { speed: 0.3, glow: 1.0, pulse: 1.2, signals: 4.5, ring: 1.0, wave: 0.6, tint: [120, 190, 255], dim: 1, directional: true },
  success: { speed: 0.16, glow: 1.0, pulse: 2.6, signals: 0.8, ring: 0.3, wave: 0.4, tint: [110, 231, 170], dim: 1, directional: false },
  error: { speed: 0.1, glow: 0.8, pulse: 3.2, signals: 0.2, ring: 0.15, wave: 0.25, tint: [251, 191, 90], dim: 0.95, directional: false },
  offline: { speed: 0.07, glow: 0.45, pulse: 6, signals: 0.1, ring: 0.1, wave: 0.15, tint: [140, 170, 205], dim: 0.6, directional: false },
};

function rand(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

function buildBrain(count: number) {
  const r = rand(42);
  const pts: P3[] = [];
  for (let side = -1; side <= 1; side += 2) {
    let made = 0;
    while (made < count / 2) {
      // random direction on a sphere, kept to this hemisphere
      const u = r() * 2 - 1;
      const th = r() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      let x = s * Math.cos(th), y = u, z = s * Math.sin(th);
      if (x * side < 0.04) continue;
      // cortex folds
      const fold = 1 + 0.07 * Math.sin(7 * th + side) * Math.sin(5 * Math.acos(u)) + 0.03 * Math.sin(13 * u);
      const depth = r() < 0.18 ? 0.55 + r() * 0.35 : 1; // some interior neurons
      x *= 0.43 * fold * depth;
      y *= 0.36 * fold * depth;
      z *= 0.52 * fold * depth;
      if (y > 0.18) y = 0.18 + (y - 0.18) * 0.45; // flatter underside
      x += side * 0.035; // longitudinal fissure
      pts.push({ x, y: y - 0.02, z });
      made++;
    }
  }
  // edges: 3 nearest neighbours within a radius, same hemisphere preferred
  const edges: [number, number][] = [];
  const seen = new Set<string>();
  for (let i = 0; i < pts.length; i++) {
    const d: [number, number][] = [];
    for (let j = 0; j < pts.length; j++) {
      if (i === j) continue;
      const a = pts[i], b = pts[j];
      const dd = (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;
      if (Math.sign(a.x) !== Math.sign(b.x) && r() > 0.04) continue;
      d.push([dd, j]);
    }
    d.sort((p, q) => p[0] - q[0]);
    for (let k = 0; k < 3 && k < d.length; k++) {
      if (d[k][0] > 0.035) break;
      const j = d[k][1];
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (!seen.has(key)) {
        seen.add(key);
        edges.push([i, j]);
      }
    }
  }
  return { pts, edges };
}

function makeSprite(size: number) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(180,235,255,0.85)');
  grd.addColorStop(0.6, 'rgba(76,168,255,0.25)');
  grd.addColorStop(1, 'rgba(41,137,254,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  return c;
}

export default function BrainOrb({ state, level = 0, reducedMotion = false, className }: { state: BrainState; level?: number; reducedMotion?: boolean; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(state);
  const levelRef = useRef(level);
  stateRef.current = state;
  levelRef.current = level;

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d', { alpha: true })!;
    const small = window.matchMedia('(max-width: 640px)').matches;
    const { pts, edges } = buildBrain(small ? 170 : 240);
    const sprite = makeSprite(64);
    const r = rand(7);
    const particles = Array.from({ length: small ? 26 : 44 }, () => ({ a: r() * Math.PI * 2, d: 1.05 + r() * 0.75, y: r() * 2 - 1, s: 0.3 + r() * 0.9, sz: 0.6 + r() * 1.6 }));
    const signals: { e: number; t: number; v: number; dir: number }[] = [];
    let w = 0, h = 0, dpr = 1;
    let raf = 0, running = true, visible = true;
    let last = performance.now(), t0 = last, angle = 0, ringA = 0, spawnAcc = 0;
    // eased parameters
    let cur: Params = { ...PARAMS[stateRef.current] };
    let lvl = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, small ? 1.5 : 2);
      w = rect.width;
      h = rect.height;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      if (reducedMotion) draw(0, performance.now());
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

    function draw(dt: number, now: number) {
      const target = PARAMS[stateRef.current];
      const k = Math.min(1, dt * 3);
      cur = {
        ...target,
        speed: lerp(cur.speed, target.speed, k), glow: lerp(cur.glow, target.glow, k), pulse: lerp(cur.pulse, target.pulse, k),
        signals: lerp(cur.signals, target.signals, k), ring: lerp(cur.ring, target.ring, k), wave: lerp(cur.wave, target.wave, k),
        dim: lerp(cur.dim, target.dim, k),
        tint: [lerp(cur.tint[0], target.tint[0], k), lerp(cur.tint[1], target.tint[1], k), lerp(cur.tint[2], target.tint[2], k)],
      };
      lvl = lerp(lvl, stateRef.current === 'listening' ? levelRef.current : 0, Math.min(1, dt * 10));
      const time = (now - t0) / 1000;
      angle += dt * cur.speed;
      ringA += dt * (0.25 + cur.ring * 0.9);
      const [tr, tg, tb] = cur.tint.map(Math.round);
      const col = (a: number) => `rgba(${tr},${tg},${tb},${Math.max(0, Math.min(1, a * cur.dim))})`;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const cx = w / 2, cy = h / 2;
      const breathe = 0.5 + 0.5 * Math.sin((time * Math.PI * 2) / cur.pulse);
      const R = Math.min(w, h) * 0.32 * (1 + 0.014 * breathe + 0.05 * lvl);

      // outer glow
      const glow = ctx.createRadialGradient(cx, cy, R * 0.4, cx, cy, R * 2.1);
      glow.addColorStop(0, `rgba(41,137,254,${0.42 * cur.glow * cur.dim})`);
      glow.addColorStop(0.45, `rgba(41,137,254,${0.12 * cur.glow * cur.dim})`);
      glow.addColorStop(1, 'rgba(41,137,254,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);

      // flowing sound/energy waves behind the orb
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const amp = R * (0.06 + 0.1 * cur.wave + 0.35 * lvl);
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        const ph = time * (0.8 + i * 0.25) + i * 1.7;
        for (let x = 0; x <= w; x += 6) {
          const nx = (x - cx) / (w / 2);
          const env = Math.exp(-nx * nx * 2.2);
          const y = cy + Math.sin(nx * (7 + i * 1.5) + ph) * amp * env * (1 - i * 0.18) + (i - 1.5) * 3;
          x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        const lg = ctx.createLinearGradient(0, 0, w, 0);
        lg.addColorStop(0, 'rgba(41,137,254,0)');
        lg.addColorStop(0.5, col(0.32 - i * 0.05));
        lg.addColorStop(1, 'rgba(41,137,254,0)');
        ctx.strokeStyle = lg;
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
      ctx.restore();

      // orbit rings — back halves
      const rings = [
        { rx: R * 1.42, ry: R * 0.34, rot: -0.32, sp: 1 },
        { rx: R * 1.26, ry: R * 0.26, rot: 0.42, sp: -0.7 },
      ];
      const ringPath = (g: (typeof rings)[0], from: number, to: number) => {
        ctx.beginPath();
        ctx.ellipse(cx, cy, g.rx, g.ry, g.rot, from, to);
      };
      for (const g of rings) {
        ringPath(g, Math.PI, Math.PI * 2);
        ctx.strokeStyle = col(0.18 + 0.15 * cur.ring);
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // sphere body
      const body = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R);
      body.addColorStop(0, `rgba(76,168,255,${0.32 * cur.dim})`);
      body.addColorStop(0.55, `rgba(25,70,150,${0.38 * cur.dim})`);
      body.addColorStop(1, `rgba(10,30,70,${0.55 * cur.dim})`);
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fillStyle = body;
      ctx.fill();
      // inner rim light
      const rim = ctx.createRadialGradient(cx, cy, R * 0.78, cx, cy, R);
      rim.addColorStop(0, 'rgba(117,214,255,0)');
      rim.addColorStop(1, col(0.38 * cur.glow));
      ctx.fillStyle = rim;
      ctx.fill();
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = col(0.55 + 0.25 * breathe * cur.glow);
      ctx.stroke();

      // brain network
      const ca = Math.cos(angle), sa = Math.sin(angle);
      const tilt = 0.22, ct = Math.cos(tilt), st = Math.sin(tilt);
      const S = R * 1.55;
      const proj = pts.map((p) => {
        let x = p.x * ca + p.z * sa;
        let z = -p.x * sa + p.z * ca;
        const y = p.y * ct - z * st;
        z = p.y * st + z * ct;
        const f = 2.6 / (2.6 + z);
        return { x: cx + x * S * f, y: cy + y * S * f, z };
      });
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.985, 0, Math.PI * 2);
      ctx.clip();
      ctx.lineWidth = 0.7;
      for (let pass = 0; pass < 2; pass++) {
        ctx.beginPath();
        for (const [i, j] of edges) {
          const a = proj[i], b = proj[j];
          const front = (a.z + b.z) / 2 < 0;
          if ((pass === 0) === front) continue;
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
        }
        ctx.strokeStyle = col(pass === 0 ? 0.16 : 0.42 + 0.15 * breathe);
        ctx.stroke();
      }
      ctx.globalCompositeOperation = 'lighter';
      for (const p of proj) {
        const front = p.z < 0 ? 1 : 0.45;
        const sz = (2.2 + 2.6 * front) * (1 + 0.3 * breathe * cur.glow);
        ctx.globalAlpha = (0.35 + 0.55 * front) * cur.dim;
        ctx.drawImage(sprite, p.x - sz, p.y - sz, sz * 2, sz * 2);
      }
      // signals travelling along synapses
      spawnAcc += dt * cur.signals * 6;
      while (spawnAcc > 1 && signals.length < 60) {
        spawnAcc -= 1;
        let e = Math.floor(r() * edges.length);
        if (cur.directional) {
          // prefer edges that point left→right for a focused "executing" flow
          for (let tries = 0; tries < 6; tries++) {
            const [i, j] = edges[e];
            if (pts[j].x > pts[i].x + 0.02) break;
            e = Math.floor(r() * edges.length);
          }
        }
        signals.push({ e, t: 0, v: 0.9 + r() * 1.6, dir: cur.directional ? (pts[edges[e][1]].x >= pts[edges[e][0]].x ? 1 : -1) : r() > 0.5 ? 1 : -1 });
      }
      for (let s = signals.length - 1; s >= 0; s--) {
        const sg = signals[s];
        sg.t += dt * sg.v;
        if (sg.t >= 1) {
          signals.splice(s, 1);
          continue;
        }
        const [i, j] = edges[sg.e];
        const a = sg.dir > 0 ? proj[i] : proj[j], b = sg.dir > 0 ? proj[j] : proj[i];
        const x = a.x + (b.x - a.x) * sg.t, y = a.y + (b.y - a.y) * sg.t;
        const sz = 5.5;
        ctx.globalAlpha = Math.sin(sg.t * Math.PI) * cur.dim;
        ctx.drawImage(sprite, x - sz, y - sz, sz * 2, sz * 2);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.restore();

      // specular highlight
      ctx.beginPath();
      ctx.ellipse(cx - R * 0.38, cy - R * 0.52, R * 0.36, R * 0.16, -0.55, 0, Math.PI * 2);
      const sp = ctx.createRadialGradient(cx - R * 0.38, cy - R * 0.52, 0, cx - R * 0.38, cy - R * 0.52, R * 0.36);
      sp.addColorStop(0, 'rgba(255,255,255,0.16)');
      sp.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = sp;
      ctx.fill();

      // orbit rings — front halves + travelling light
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      rings.forEach((g, idx) => {
        ringPath(g, 0, Math.PI);
        ctx.strokeStyle = col(0.35 + 0.3 * cur.ring);
        ctx.lineWidth = 1.2;
        ctx.stroke();
        const th = (ringA * g.sp + idx * 2.1) % (Math.PI * 2);
        const ex = g.rx * Math.cos(th), ey = g.ry * Math.sin(th);
        const x = cx + ex * Math.cos(g.rot) - ey * Math.sin(g.rot);
        const y = cy + ex * Math.sin(g.rot) + ey * Math.cos(g.rot);
        const behind = Math.sin(th) < 0;
        const sz = behind ? 4 : 7 + 4 * cur.ring;
        ctx.globalAlpha = behind ? 0.35 : 0.95;
        ctx.drawImage(sprite, x - sz, y - sz, sz * 2, sz * 2);
        if (cur.ring > 0.5 && !behind) {
          // comet tail when executing/processing
          for (let tIdx = 1; tIdx < 7; tIdx++) {
            const th2 = th - tIdx * 0.06 * Math.sign(g.sp);
            const ex2 = g.rx * Math.cos(th2), ey2 = g.ry * Math.sin(th2);
            const x2 = cx + ex2 * Math.cos(g.rot) - ey2 * Math.sin(g.rot);
            const y2 = cy + ex2 * Math.sin(g.rot) + ey2 * Math.cos(g.rot);
            const s2 = sz * (1 - tIdx / 8);
            ctx.globalAlpha = 0.5 * (1 - tIdx / 7);
            ctx.drawImage(sprite, x2 - s2, y2 - s2, s2 * 2, s2 * 2);
          }
        }
      });
      // floating particles
      for (const p of particles) {
        p.a += dt * 0.05 * p.s * (0.5 + cur.speed * 3);
        p.y -= dt * 0.02 * p.s;
        if (p.y < -1.1) p.y = 1.1;
        const x = cx + Math.cos(p.a) * R * p.d * 1.15;
        const y = cy + p.y * R * 1.3 + Math.sin(p.a * 2) * 6;
        ctx.globalAlpha = (0.25 + 0.35 * Math.abs(Math.sin(p.a * 3))) * cur.dim;
        const sz = p.sz * 1.6;
        ctx.drawImage(sprite, x - sz, y - sz, sz * 2, sz * 2);
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    const loop = (now: number) => {
      if (!running) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      // ~40fps cap keeps phones cool
      if (now - last >= 24) {
        last = now;
        draw(dt, now);
      }
      raf = requestAnimationFrame(loop);
    };
    const startLoop = () => {
      if (reducedMotion) {
        draw(1, performance.now());
        return;
      }
      if (raf) return;
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(loop);
    };
    const stopLoop = () => {
      running = false;
      cancelAnimationFrame(raf);
      raf = 0;
    };
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      visible && document.visibilityState === 'visible' ? startLoop() : stopLoop();
    });
    io.observe(canvas);
    const vis = () => (document.visibilityState === 'visible' && visible ? startLoop() : stopLoop());
    document.addEventListener('visibilitychange', vis);
    const redraw = () => draw(1, performance.now());
    canvas.addEventListener('hukm-redraw', redraw);
    resize();
    startLoop();
    return () => {
      stopLoop();
      ro.disconnect();
      io.disconnect();
      document.removeEventListener('visibilitychange', vis);
      canvas.removeEventListener('hukm-redraw', redraw);
    };
  }, [reducedMotion]);

  // redraw static frame on state change when motion is reduced
  useEffect(() => {
    if (reducedMotion) canvasRef.current?.dispatchEvent(new Event('hukm-redraw'));
  }, [state, reducedMotion]);

  return <canvas ref={canvasRef} className={className} role="img" aria-label={`HUKM status: ${state}`} />;
}
