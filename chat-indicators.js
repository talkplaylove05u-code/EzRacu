function dayKey(date) {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

export function messageDay(timestamp, now = new Date()) {
  const date = timestamp?.toDate?.() || now;
  return dayKey(Number.isFinite(date.getTime()) ? date : now);
}

export function dayLabel(key, now = new Date()) {
  if (key === dayKey(now)) return '오늘';
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (key === dayKey(yesterday)) return '어제';
  const [year, month, day] = key.split('-').map(Number);
  return `${year}년 ${month}월 ${day}일`;
}

export function createUnreadIndicator({messages, badge, button, canRead, focusInput}) {
  let baseTitle = document.title;
  const unread = new Set();
  const atBottom = () => messages.scrollHeight - messages.scrollTop - messages.clientHeight < 90;
  const reading = () => canRead() && !document.hidden && document.hasFocus() && atBottom();
  function update() {
    const count = unread.size;
    document.title = count ? `(${count}) ${baseTitle}` : baseTitle;
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.hidden = !count;
    button.hidden = !count;
    button.textContent = `새 메시지 ${count}개 · 아래로 ↓`;
  }
  function sync() {
    if (unread.size && reading()) {
      unread.clear();
      update();
    }
  }
  messages.addEventListener('scroll', sync, {passive: true});
  window.addEventListener('focus', () => requestAnimationFrame(sync));
  document.addEventListener('visibilitychange', sync);
  button.addEventListener('click', () => {
    messages.scrollTop = messages.scrollHeight;
    focusInput.focus({preventScroll: true});
    sync();
  });
  return {
    receive(ids) {
      if (!ids.length || reading()) return;
      ids.forEach((id) => unread.add(id));
      update();
    },
    reset() { unread.clear(); update(); },
    setTitle(title) { baseTitle = title; update(); },
    sync,
  };
}
