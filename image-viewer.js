// 사진은 서버에 저장된 첨부 데이터를 그대로 열어 봅니다.
export function createImageViewer(download, fallbackFocus) {
  const dialog = document.createElement('dialog');
  dialog.className = 'image-viewer';
  dialog.setAttribute('aria-labelledby', 'imageViewerTitle');
  dialog.innerHTML = `
    <header class="image-viewer-header">
      <div class="image-viewer-heading"><strong id="imageViewerTitle">사진 보기</strong><span class="image-viewer-name"></span></div>
      <button type="button" class="image-viewer-close" aria-label="사진창 닫기" autofocus>✕</button>
    </header>
    <div class="image-viewer-viewport" tabindex="0" aria-label="사진 · 확대 후 스크롤로 이동">
      <div class="image-viewer-canvas"><img class="image-viewer-photo" alt="" /><p class="image-viewer-message" role="status"></p></div>
    </div>
    <footer class="image-viewer-toolbar">
      <div class="image-viewer-zoom">
        <button type="button" data-action="out" aria-label="사진 축소" title="축소">−</button>
        <output aria-live="polite" aria-label="사진 배율">100%</output>
        <button type="button" data-action="in" aria-label="사진 확대" title="확대">＋</button>
        <button type="button" data-action="fit">맞춤</button>
      </div>
      <button type="button" data-action="download">다운로드</button>
    </footer>`;
  document.body.append(dialog);
  const find = (selector) => dialog.querySelector(selector);
  const image = find('.image-viewer-photo');
  const viewport = find('.image-viewer-viewport');
  const message = find('.image-viewer-message');
  const zoomIn = find('[data-action="in"]');
  const zoomOut = find('[data-action="out"]');
  let attachment = null;
  let returnFocus = null;
  let zoom = 1;

  function resize() {
    if (!dialog.open || !image.naturalWidth) return;
    const fit = Math.min(1, Math.max(1, viewport.clientWidth - 32) / image.naturalWidth,
      Math.max(1, viewport.clientHeight - 32) / image.naturalHeight);
    const scale = fit * zoom;
    image.style.width = `${Math.max(1, Math.round(image.naturalWidth * scale))}px`;
    image.style.height = `${Math.max(1, Math.round(image.naturalHeight * scale))}px`;
    find('output').textContent = `${Math.round(scale * 100)}%`;
    zoomOut.disabled = zoom <= 0.5;
    zoomIn.disabled = zoom >= 8;
  }
  function changeZoom(value) {
    if (!image.naturalWidth) return;
    const centerX = (viewport.scrollLeft + viewport.clientWidth / 2) / Math.max(1, viewport.scrollWidth);
    const centerY = (viewport.scrollTop + viewport.clientHeight / 2) / Math.max(1, viewport.scrollHeight);
    zoom = Math.max(0.5, Math.min(8, value));
    resize();
    viewport.scrollLeft = centerX * viewport.scrollWidth - viewport.clientWidth / 2;
    viewport.scrollTop = centerY * viewport.scrollHeight - viewport.clientHeight / 2;
  }
  image.addEventListener('load', () => {
    if (!dialog.open) return;
    message.hidden = true;
    image.hidden = false;
    resize();
  });
  image.addEventListener('error', () => {
    if (!dialog.open || !attachment) return;
    image.hidden = true;
    message.hidden = false;
    message.textContent = '사진을 표시하지 못했어요. 다운로드해서 확인해 주세요.';
    zoomIn.disabled = zoomOut.disabled = true;
  });
  zoomIn.addEventListener('click', () => changeZoom(zoom * 1.5));
  zoomOut.addEventListener('click', () => changeZoom(zoom / 1.5));
  find('[data-action="fit"]').addEventListener('click', () => {
    zoom = 1;
    resize();
    viewport.scrollTo(0, 0);
  });
  find('[data-action="download"]').addEventListener('click', () => {
    if (attachment) download(attachment);
  });
  find('.image-viewer-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    const bounds = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right ||
        event.clientY < bounds.top || event.clientY > bounds.bottom)) dialog.close();
  });
  dialog.addEventListener('close', () => {
    attachment = null;
    image.removeAttribute('src');
    image.alt = '';
    find('.image-viewer-name').textContent = '';
    document.body.classList.remove('image-viewer-open');
    (returnFocus?.isConnected ? returnFocus : fallbackFocus)?.focus({preventScroll: true});
    returnFocus = null;
  });
  window.addEventListener('resize', resize);
  return {
    open(data, trigger) {
      attachment = data;
      returnFocus = trigger;
      zoom = 1;
      image.hidden = true;
      image.style.removeProperty('width');
      image.style.removeProperty('height');
      message.hidden = false;
      message.textContent = '사진을 여는 중...';
      zoomIn.disabled = zoomOut.disabled = true;
      find('output').textContent = '…';
      find('.image-viewer-name').textContent = data.fileName || '사진';
      image.alt = data.fileName || '첨부 사진';
      if (!dialog.open) dialog.showModal();
      document.body.classList.add('image-viewer-open');
      viewport.scrollTo(0, 0);
      image.src = `data:${data.fileMime};base64,${data.fileData}`;
    },
    close() { if (dialog.open) dialog.close(); },
  };
}
