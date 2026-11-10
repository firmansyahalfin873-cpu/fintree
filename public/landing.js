const canvas = document.querySelector('.flow-canvas');
const hero = document.querySelector('.hero-visual');
const motion = window.matchMedia('(prefers-reduced-motion: reduce)');

if (canvas && hero) {
  const context = canvas.getContext('2d');
  let width = 0, height = 0, frame = 0, active = false, pointer = null, lastFrame = 0;
  const points = Array.from({ length: 30 }, (_, index) => ({
    x: ((index * 73 + 11) % 101) / 101,
    y: ((index * 47 + 19) % 97) / 97,
    phase: index * 1.3,
    size: index % 7 === 0 ? 2 : 1.2,
  }));
  function resize() {
    const rect = hero.getBoundingClientRect(), scale = Math.min(window.devicePixelRatio || 1, 1.5);
    width = rect.width; height = rect.height;
    canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale);
    context.setTransform(scale, 0, 0, scale, 0, 0);
  }
  function draw(time) {
    if (!active || motion.matches || document.hidden) { frame = 0; return; }
    frame = requestAnimationFrame(draw);
    if (time - lastFrame < 33) return;
    lastFrame = time; context.clearRect(0, 0, width, height);
    for (const point of points) {
      const x = point.x * width + Math.sin(time / 3500 + point.phase) * 5;
      const y = point.y * height + Math.cos(time / 4000 + point.phase) * 5;
      const distance = pointer ? Math.hypot(pointer.x - x, pointer.y - y) : 1000;
      if (distance < 115) {
        context.beginPath(); context.moveTo(x, y); context.lineTo(pointer.x, pointer.y);
        context.strokeStyle = `rgba(165,180,252,${(1 - distance / 115) * .24})`; context.lineWidth = 0.7; context.stroke();
      }
      context.beginPath(); context.arc(x, y, point.size + (distance < 70 ? .8 : 0), 0, Math.PI * 2);
      context.fillStyle = point.size > 1.5 ? 'rgba(110,231,183,.65)' : 'rgba(199,210,254,.48)'; context.fill();
    }
  }
  function start() { if (active && !frame && !motion.matches && !document.hidden) frame = requestAnimationFrame(draw); }
  const observer = new IntersectionObserver(([entry]) => { active = entry.isIntersecting; start(); });
  observer.observe(hero);
  hero.addEventListener('pointermove', (event) => { const rect = hero.getBoundingClientRect(); pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top }; });
  hero.addEventListener('pointerleave', () => { pointer = null; });
  window.addEventListener('resize', resize, { passive: true });
  document.addEventListener('visibilitychange', start);
  motion.addEventListener('change', () => { if (motion.matches) { context.clearRect(0, 0, width, height); } else start(); });
  resize();
}
