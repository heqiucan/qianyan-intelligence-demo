/** Original procedural artwork. Canvas projection, no remote video or paid template assets. */
export type ParticleScene = 'orbit' | 'flow' | 'converge';
/** The background changes shape on its own: it holds each shape briefly, then morphs into the next one. */
const SCENES: ParticleScene[] = ['orbit', 'flow', 'converge'];
const HOLD_SECONDS = 6;

export function createParticleField(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) {
    canvas.dataset.motion = 'unavailable';
    return { setScene: (_: ParticleScene) => {}, setPaused: (_: boolean) => {}, dispose: () => {} };
  }
  const context = ctx;
  // Keep the engine safe when reused outside the React wrapper as well.
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let seed = 241107;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const points = Array.from({ length: 5200 }, () => ({
    u: random() * Math.PI * 2, v: random() * Math.PI * 2,
    spread: random(), brightness: random(), size: .5 + random() * 1.4,
  }));
  const stars = Array.from({ length: 180 }, () => ({ x: random(), y: random(), size: random() * 1.2 + .3, phase: random() * 6 }));
  let width = 0, height = 0, frame = 0, previous = 0, time = 0, paused = false, intersecting = true, disposed = false;
  let scene: ParticleScene = 'orbit';
  let sceneIndex = 0, held = 0;
  canvas.dataset.scene = scene;
  const weights = [1, 0, 0];
  const pointer = { x: 0, y: 0, targetX: 0, targetY: 0 };
  const PALETTES = {
    dark: {
      star: '#c8afea', blend: 'screen' as GlobalCompositeOperation, hazeA: '#7941b708', hazeB: '#8b5cf610', hazeC: '#8b5cf600',
      dot: ['#eedbff', '#bd9bff', '#8b5cf6'], glow: ['#f5eaff', '#c9a9ffb0', '#9a65ed28', '#8b5cf600'], glowAlpha: .4,
    },
    light: {
      star: '#6b4bb0', blend: 'source-over' as GlobalCompositeOperation, hazeA: '#8b5cf61c', hazeB: '#a58bea16', hazeC: '#a58bea00',
      dot: ['#4c2a9c', '#6c43d0', '#8761e0'], glow: ['#6c43d0', '#7a55da70', '#8b6be320', '#8b6be300'], glowAlpha: .3,
    },
  };
  const currentTheme = () => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark') as keyof typeof PALETTES;
  let theme = currentTheme();
  let palette = PALETTES[theme];
  const glow = document.createElement('canvas');
  glow.width = glow.height = 48;
  const glowCtx = glow.getContext('2d')!;
  function paintGlow() {
    glowCtx.clearRect(0, 0, 48, 48);
    const gradient = glowCtx.createRadialGradient(24, 24, 0, 24, 24, 24);
    gradient.addColorStop(0, palette.glow[0]); gradient.addColorStop(.14, palette.glow[1]); gradient.addColorStop(.42, palette.glow[2]); gradient.addColorStop(1, palette.glow[3]);
    glowCtx.fillStyle = gradient; glowCtx.fillRect(0, 0, 48, 48);
  }
  paintGlow();
  const themeObserver = new MutationObserver(() => {
    const next = currentTheme();
    if (next === theme) return;
    theme = next; palette = PALETTES[next]; paintGlow(); draw();
  });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  function draw() {
    if (!width || !height || disposed) return;
    const mobile = width < 700;
    const target = scene === 'orbit' ? 0 : scene === 'flow' ? 1 : 2;
    for (let i = 0; i < 3; i++) weights[i] += ((i === target ? 1 : 0) - weights[i]) * .05;
    pointer.x += (pointer.targetX - pointer.x) * .035;
    pointer.y += (pointer.targetY - pointer.y) * .035;
    context.clearRect(0, 0, width, height);
    context.globalCompositeOperation = 'source-over';
    for (const star of stars) {
      context.globalAlpha = .12 + (Math.sin(time * .35 + star.phase) + 1) * .11;
      context.fillStyle = palette.star;
      context.fillRect(star.x * width, star.y * height, star.size, star.size);
    }
    context.globalAlpha = 1;
    // The hero can be taller than the screen, so the artwork is placed against the first screen, not the whole section.
    const view = Math.min(height, window.innerHeight || height);
    const compact = width < 960; // phones and tablets: the artwork sits behind the headline instead of beside it
    const centerX = width * (compact ? .66 : .68) + pointer.x * 14;
    const centerY = view * (compact ? .27 : .4) + pointer.y * 10;
    const scale = Math.min(width * (mobile ? .34 : compact ? .3 : .21), view * (compact ? .26 : .31));
    const haze = context.createRadialGradient(centerX, centerY, 0, centerX, centerY, scale * 1.5);
    haze.addColorStop(0, palette.hazeA); haze.addColorStop(.6, palette.hazeB); haze.addColorStop(1, palette.hazeC);
    context.fillStyle = haze; context.fillRect(0, 0, width, height);
    context.globalCompositeOperation = palette.blend;

    // Closely spaced curves form a translucent ribbon instead of a flat gradient blob.
    const horizon = view * (compact ? .5 : .74);
    for (let ribbon = 0; ribbon < 3; ribbon++) {
      for (let strand = 0; strand < 26; strand++) {
        const offset = strand / 25 - .5;
        context.beginPath();
        for (let step = 0; step <= 80; step++) {
          const x = step / 80 * width;
          const phase = x / width * Math.PI * 2;
          const envelope = .42 + .58 * Math.abs(x / width - .55) * 2;
          const y = horizon + Math.sin(phase * .74 + time * .13 + ribbon * 1.7) * height * .07
            + Math.cos(phase * 1.25 - time * .1 + ribbon) * height * .035
            + offset * (60 + 60 * Math.sin(phase + ribbon)) * envelope;
          if (step === 0) context.moveTo(x, y); else context.lineTo(x, y);
        }
        context.strokeStyle = strand === 12 ? '#d7afff60' : `rgba(156,102,239,${.018 + (1 - Math.abs(offset) * 2) * .036})`;
        context.lineWidth = strand === 12 ? 1.1 : .75;
        context.stroke();
      }
    }
    const rotation = time * .065;
    const tilt = .47 + pointer.y * .14;
    const cosTilt = Math.cos(tilt), sinTilt = Math.sin(tilt);
    const count = mobile ? 2700 : points.length;
    for (let i = 0; i < count; i++) {
      const p = points[i], angle = p.u + rotation;
      const radius = 1 + Math.cos(p.v) * (.10 + p.spread * .12);
      const ringX = Math.cos(angle) * radius;
      const ringY = Math.sin(p.v) * (.10 + p.spread * .11);
      const ringZ = Math.sin(angle) * radius;
      const sphereZ = p.spread * 2 - 1;
      const sphereR = Math.sqrt(1 - sphereZ * sphereZ);
      const x = ringX * weights[0] + ((p.u / Math.PI - 1) * 1.4) * weights[1] + Math.cos(angle) * sphereR * weights[2];
      const y = ringY * weights[0] + (Math.sin(p.u * 1.8 + time * .26) * .34 + Math.cos(p.v) * .10) * weights[1] + sphereZ * .8 * weights[2];
      const z = ringZ * weights[0] + Math.sin(p.v) * .25 * weights[1] + Math.sin(angle) * sphereR * weights[2];
      const projectedY = y * cosTilt - z * sinTilt;
      const depth = y * sinTilt + z * cosTilt;
      const perspective = 3.4 / (3.4 + depth * .4);
      const px = centerX + (x + pointer.x * depth * .07) * scale * perspective;
      const py = centerY + projectedY * scale * perspective;
      const size = p.size * perspective * (mobile ? .8 : 1);
      context.globalAlpha = (.19 + p.brightness * .65) * (.78 + depth * .14);
      context.fillStyle = p.brightness > .8 ? palette.dot[0] : p.brightness > .4 ? palette.dot[1] : palette.dot[2];
      context.fillRect(px, py, size, size);
      if (p.brightness > .982) { context.globalAlpha = palette.glowAlpha; context.drawImage(glow, px - 8, py - 8, 16, 16); }
    }
    context.globalAlpha = 1;
    context.globalCompositeOperation = 'source-over';
  }

  function canAnimate() { return !paused && !reducedMotion.matches && intersecting && !document.hidden && !disposed; }
  function tick(stamp: number) {
    frame = 0;
    if (!canAnimate()) return;
    const delta = stamp - previous;
    if (delta >= 1000 / 30) {
      const step = Math.min(delta, 60) / 1000;
      time += step;
      held += step;
      if (held >= HOLD_SECONDS) {
        held = 0;
        sceneIndex = (sceneIndex + 1) % SCENES.length;
        scene = SCENES[sceneIndex];
        canvas.dataset.scene = scene;
      }
      previous = stamp;
      draw();
    }
    frame = requestAnimationFrame(tick);
  }
  function reconcile() {
    cancelAnimationFrame(frame); frame = 0;
    canvas.dataset.motion = paused || reducedMotion.matches ? 'paused' : intersecting && !document.hidden ? 'running' : 'offscreen';
    if (canAnimate()) { previous = performance.now(); frame = requestAnimationFrame(tick); }
  }
  function resize() {
    const bounds = canvas.getBoundingClientRect();
    width = bounds.width; height = bounds.height;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }
  const move = (event: PointerEvent) => {
    if (paused || reducedMotion.matches || event.pointerType !== 'mouse') return;
    const bounds = canvas.getBoundingClientRect();
    pointer.targetX = (event.clientX - bounds.left) / width - .5;
    pointer.targetY = (event.clientY - bounds.top) / height - .5;
  };
  const leave = () => { pointer.targetX = pointer.targetY = 0; };
  const surface = canvas.parentElement!;
  surface.addEventListener('pointermove', move, { passive: true });
  surface.addEventListener('pointerleave', leave);
  document.addEventListener('visibilitychange', reconcile);
  reducedMotion.addEventListener('change', reconcile);
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  const visibility = new IntersectionObserver(([entry]) => { intersecting = entry.isIntersecting; reconcile(); });
  visibility.observe(canvas);
  resize(); reconcile();
  return {
    setScene(next: ParticleScene) {
      scene = next; sceneIndex = SCENES.indexOf(next); held = 0; canvas.dataset.scene = next;
      if (paused || reducedMotion.matches) { weights.fill(0); weights[next === 'orbit' ? 0 : next === 'flow' ? 1 : 2] = 1; draw(); }
    },
    setPaused(next: boolean) { paused = next; reconcile(); },
    dispose() {
      disposed = true; cancelAnimationFrame(frame); themeObserver.disconnect(); resizeObserver.disconnect(); visibility.disconnect();
      surface.removeEventListener('pointermove', move); surface.removeEventListener('pointerleave', leave);
      document.removeEventListener('visibilitychange', reconcile);
      reducedMotion.removeEventListener('change', reconcile);
    },
  };
}
