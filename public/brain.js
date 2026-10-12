// A lightweight signal globe. It rests when idle, off screen, or motion is reduced.
// Research, evidence and contacts remain the meaningful progress indicators.
export function createBrain(canvas, { onReady } = {}) {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas unavailable");
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let energy = .15, angle = .4, frame = 0, previous = 0, visible = true;
  const pulses = [];
  const transfers = [], activeAgents = new Map();
  let accent = "#b8aaff", timer = 0;
  const points = Array.from({ length: 76 }, (_, index) => {
    const y = 1 - 2 * index / 75, radius = Math.sqrt(1 - y * y), longitude = index * 2.399963;
    return { x: radius * Math.cos(longitude), y, z: radius * Math.sin(longitude) };
  });
  const links = [];
  for (let i = 0; i < points.length; i++) {
    const nearest = points.map((point, j) => ({ j, distance: (point.x - points[i].x) ** 2 + (point.y - points[i].y) ** 2 + (point.z - points[i].z) ** 2 })).filter((point) => point.j !== i).sort((a, b) => a.distance - b.distance).slice(0, 4);
    for (const point of nearest) if (point.j > i) links.push([i, point.j]);
  }
  function draw(now = performance.now()) {
    frame = 0;
    const delta = previous ? Math.min(.05, (now - previous) / 1000) : 0; previous = now;
    const moving = energy > .5 && !motion.matches && !document.hidden && visible;
    if (moving) angle += delta * .13;
    const width = canvas.clientWidth, height = canvas.clientHeight;
    if (!width || !height) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
      canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0); context.clearRect(0, 0, width, height);
    const cx = width * .62, cy = height * .51, radius = Math.min(height * .35, width * .275);
    const halo = context.createRadialGradient(cx, cy, radius * .1, cx, cy, radius * 1.42);
    halo.addColorStop(0, "rgba(135,119,244,.11)"); halo.addColorStop(.7, "rgba(117,106,221,.06)"); halo.addColorStop(1, "rgba(101,91,232,0)");
    context.fillStyle = halo; context.beginPath(); context.arc(cx, cy, radius * 1.42, 0, Math.PI * 2); context.fill();
    const project = (point) => {
      const x = point.x * Math.cos(angle) + point.z * Math.sin(angle), z = -point.x * Math.sin(angle) + point.z * Math.cos(angle);
      return { x: cx + x * radius, y: cy + point.y * radius, depth: (z + 1) / 2 };
    };
    const projected = points.map(project);
    if (moving && context.createConicGradient) {
      context.save(); context.translate(cx, cy); context.rotate(angle * 1.7);
      const beam = context.createConicGradient(0, 0, 0);
      beam.addColorStop(0, "rgba(139,126,255,.12)"); beam.addColorStop(.16, "rgba(139,126,255,0)"); beam.addColorStop(1, "rgba(139,126,255,0)");
      context.fillStyle = beam; context.beginPath(); context.arc(0, 0, radius * 1.22, 0, Math.PI * 2); context.fill(); context.restore();
    }
    context.strokeStyle = "rgba(151,143,227,.18)"; context.lineWidth = .7;
    context.beginPath(); context.arc(cx, cy, radius, 0, Math.PI * 2); context.stroke();
    for (const [i, j] of links) {
      const a = projected[i], b = projected[j];
      context.strokeStyle = `rgba(155,149,227,${.07 + (a.depth + b.depth) * .14})`;
      context.beginPath(); context.moveTo(a.x, a.y); context.lineTo(b.x, b.y); context.stroke();
    }
    for (let i = 0; i < projected.length; i++) {
      const point = projected[i], emphasis = i % 11 === 0;
      context.fillStyle = emphasis ? `rgba(195,182,255,${.4 + point.depth * .6})` : `rgba(152,152,231,${.18 + point.depth * .63})`;
      context.beginPath(); context.arc(point.x, point.y, emphasis ? 3.2 : 1.6, 0, Math.PI * 2); context.fill();
      if (emphasis && point.depth > .5) { context.strokeStyle = "rgba(187,171,255,.2)"; context.beginPath(); context.arc(point.x, point.y, 7, 0, Math.PI * 2); context.stroke(); }
    }
    const names = ["scout", "analyst", "judge", "finder", "writer"];
    for (const [name, color] of activeAgents) {
      const theta = names.indexOf(name) * Math.PI * 2 / 5 - Math.PI / 2;
      const x = cx + Math.cos(theta) * radius * 1.14, y = cy + Math.sin(theta) * radius * 1.14;
      context.strokeStyle = color; context.lineWidth = 1.4; context.globalAlpha = .7;
      context.beginPath(); context.moveTo(x, y); context.quadraticCurveTo(cx + Math.cos(theta + .8) * radius * .4, cy + Math.sin(theta + .8) * radius * .4, cx, cy); context.stroke();
      context.globalAlpha = 1; context.fillStyle = color; context.shadowColor = color; context.shadowBlur = 12;
      context.beginPath(); context.arc(x, y, 4, 0, Math.PI * 2); context.fill(); context.shadowBlur = 0;
    }
    for (let i = transfers.length - 1; i >= 0; i--) {
      const transfer = transfers[i], progress = (now - transfer.start) / 1600;
      if (progress >= 1) { transfers.splice(i, 1); continue; }
      if (!moving) continue;
      const theta = names.indexOf(transfer.agent) * Math.PI * 2 / 5 - Math.PI / 2;
      const distance = radius * 1.14 * (1 - progress);
      const x = cx + Math.cos(theta + Math.sin(progress * Math.PI) * .3) * distance, y = cy + Math.sin(theta + Math.sin(progress * Math.PI) * .3) * distance;
      context.fillStyle = transfer.color; context.shadowColor = transfer.color; context.shadowBlur = 15;
      context.beginPath(); context.arc(x, y, 3.5, 0, Math.PI * 2); context.fill(); context.shadowBlur = 0;
    }
    context.fillStyle = accent; context.globalAlpha = .65; context.beginPath(); context.arc(cx, cy, moving ? 4 + Math.sin(now / 250) : 4, 0, Math.PI * 2); context.fill(); context.globalAlpha = 1;
    for (let i = pulses.length - 1; i >= 0; i--) {
      const pulse = pulses[i], progress = (now - pulse.start) / 1000;
      if (progress > 1) { pulses.splice(i, 1); continue; }
      if (!motion.matches) { context.globalAlpha = (1 - progress) * .5; context.strokeStyle = pulse.color; context.lineWidth = 1; context.beginPath(); context.arc(cx, cy, radius * (.7 + progress * .5), 0, Math.PI * 2); context.stroke(); context.globalAlpha = 1; }
    }
    if (moving || pulses.length && !motion.matches && !document.hidden && visible) timer = setTimeout(() => { timer = 0; frame = requestAnimationFrame(draw); }, 33);
  }
  const refresh = () => { if (!frame && !timer && !document.hidden && visible) { previous = 0; frame = requestAnimationFrame(draw); } };
  new ResizeObserver(refresh).observe(canvas);
  if (typeof IntersectionObserver !== "undefined") new IntersectionObserver((entries) => { visible = entries[0].isIntersecting; if (visible) refresh(); }).observe(canvas);
  document.addEventListener("visibilitychange", refresh);
  motion.addEventListener("change", refresh);
  refresh(); onReady?.();
  return {
    setEnergy(value) { energy = Number(value) || 0; refresh(); },
    pulse(color = "#b8aaff") { if (motion.matches || document.hidden || !visible) return; pulses.push({ start: performance.now(), color }); if (pulses.length > 5) pulses.shift(); refresh(); },
    setAgent(name, running, color = "#b8aaff") { if (running) { activeAgents.set(name, color); accent = color; } else activeAgents.delete(name); refresh(); },
    transfer(agent, kind) { if (motion.matches || energy <= .5 || document.hidden || !visible) return; const color = activeAgents.get(agent) || accent; transfers.push({ agent, kind, color, start: performance.now() }); if (transfers.length > 18) transfers.shift(); refresh(); },
    reset() { activeAgents.clear(); pulses.length = 0; transfers.length = 0; accent = "#b8aaff"; refresh(); },
    finish() { activeAgents.clear(); pulses.length = 0; transfers.length = 0; refresh(); },
    progress: () => 1,
  };
}
