(() => {
  const layout = document.querySelector('#app') || document.querySelector('.nav-main');
  if (!layout) return;

  const panel = layout.querySelector('#right') || layout.querySelector('.route-panel');
  if (!panel) return;

  const divider = document.createElement('div');
  divider.id = 'layoutDivider';
  divider.setAttribute('role', 'separator');
  divider.setAttribute('aria-orientation', 'vertical');
  divider.setAttribute('aria-label', '地図と区間情報の幅を調整');
  divider.setAttribute('aria-valuemin', '280');
  divider.setAttribute('aria-valuemax', '50%');
  divider.setAttribute('tabindex', '0');
  divider.title = '左右に動かして幅を調整';
  layout.insertBefore(divider, panel);

  const storageKey = 'carNaviLayoutPanelWidth';
  const minimumWidth = 280;
  let desiredWidth = panel.getBoundingClientRect().width;
  let hasSavedWidth = false;
  let pointerId = null;

  const clampWidth = width => Math.max(minimumWidth, Math.min(layout.clientWidth * 0.5, width));
  const render = () => {
    const width = hasSavedWidth ? clampWidth(desiredWidth) : panel.getBoundingClientRect().width;
    if (hasSavedWidth) layout.style.setProperty('--right-panel-width', width + 'px');
    divider.setAttribute('aria-valuemin', String(minimumWidth));
    divider.setAttribute('aria-valuemax', String(Math.round(layout.clientWidth * 0.5)));
    divider.setAttribute('aria-valuenow', String(Math.round(width)));
  };
  const notifyStorageError = message => {
    const status = document.getElementById('status') || document.getElementById('gpsState');
    if (status) status.textContent = message;
  };
  const save = () => {
    hasSavedWidth = true;
    desiredWidth = clampWidth(desiredWidth);
    render();
    try {
      localStorage.setItem(storageKey, String(Math.round(desiredWidth)));
    } catch (error) {
      console.error('画面幅を保存できませんでした', error);
      notifyStorageError('画面幅を保存できませんでした');
    }
  };

  try {
    const savedWidth = localStorage.getItem(storageKey);
    if (savedWidth !== null) {
      const parsedWidth = Number(savedWidth);
      if (Number.isFinite(parsedWidth) && parsedWidth > 0) {
        desiredWidth = parsedWidth;
        hasSavedWidth = true;
      }
      else console.warn('保存された画面幅が不正なため、初期幅を使います');
    }
  } catch (error) {
    console.error('保存した画面幅を読み込めませんでした', error);
    notifyStorageError('保存した画面幅を読み込めませんでした');
  }
  render();

  divider.addEventListener('pointerdown', event => {
    if (event.button !== 0 || document.body.classList.contains('guidance-active')) return;
    pointerId = event.pointerId;
    divider.setPointerCapture(pointerId);
    document.body.classList.add('layout-resizing');
    event.preventDefault();
  });

  divider.addEventListener('pointermove', event => {
    if (event.pointerId !== pointerId) return;
    const bounds = layout.getBoundingClientRect();
    hasSavedWidth = true;
    desiredWidth = bounds.right - event.clientX - divider.getBoundingClientRect().width / 2;
    render();
  });

  const finishDrag = event => {
    if (event.pointerId !== pointerId) return;
    pointerId = null;
    document.body.classList.remove('layout-resizing');
    if (divider.hasPointerCapture(event.pointerId)) divider.releasePointerCapture(event.pointerId);
    save();
  };
  divider.addEventListener('pointerup', finishDrag);
  divider.addEventListener('pointercancel', finishDrag);

  divider.addEventListener('keydown', event => {
    if (document.body.classList.contains('guidance-active')) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    if (event.key === 'Home') desiredWidth = minimumWidth;
    else if (event.key === 'End') desiredWidth = layout.clientWidth * 0.5;
    else desiredWidth += event.key === 'ArrowLeft' ? 20 : -20;
    hasSavedWidth = true;
    save();
  });

  window.addEventListener('resize', () => requestAnimationFrame(render));
})();
