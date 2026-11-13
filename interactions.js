'use strict';

// A short, finite touch response. No timers run while the interface is idle.
document.addEventListener('pointerdown', event => {
  if (event.isPrimary === false || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const button = event.target.closest('button.button, button.chip, button.routine-option, button.quick-link, .main-nav button');
  if (!button || button.disabled) return;
  for (const previous of button.querySelectorAll('.tap-feedback')) previous.remove();
  const bounds = button.getBoundingClientRect();
  const dot = document.createElement('span');
  dot.className = 'tap-feedback';
  dot.setAttribute('aria-hidden','true');
  dot.style.left = Math.max(0,Math.min(bounds.width,event.clientX-bounds.left)) + 'px';
  dot.style.top = Math.max(0,Math.min(bounds.height,event.clientY-bounds.top)) + 'px';
  dot.style.setProperty('--tap-scale',String(Math.max(bounds.width,bounds.height)/5));
  button.classList.add('has-tap-feedback');
  button.append(dot);
  let cleanupTimer;
  const cleanup = () => { clearTimeout(cleanupTimer); dot.remove(); };
  dot.addEventListener('animationend',cleanup,{once:true});
  cleanupTimer = setTimeout(cleanup,700);
}, {passive:true});
