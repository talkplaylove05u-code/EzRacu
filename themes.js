(() => {
  const key = 'ezracu-chat-theme-v1';
  const colors = {midnight: '#171d32', jelly: '#f7f8fd', soda: '#f3faf8'};
  const normalize = (theme) => Object.hasOwn(colors, theme) ? theme : 'midnight';

  function apply(theme) {
    const messages = document.getElementById('messages');
    const atBottom = messages && messages.scrollHeight - messages.scrollTop - messages.clientHeight < 90;
    const anchor = messages && [...messages.querySelectorAll('.message-line')].find((row) =>
      row.getBoundingClientRect().bottom >= messages.getBoundingClientRect().top);
    const anchorTop = anchor?.getBoundingClientRect().top;
    theme = normalize(theme);
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]').content = colors[theme];
    document.querySelectorAll('input[name="chatTheme"]').forEach((input) => {
      input.checked = input.value === theme;
      input.closest('.theme-option').classList.toggle('is-selected', input.checked);
    });
    if (messages) {
      if (atBottom) messages.scrollTop = messages.scrollHeight;
      else if (anchor) messages.scrollTop += anchor.getBoundingClientRect().top - anchorTop;
    }
  }

  let saved = 'midnight';
  try { saved = localStorage.getItem(key); } catch (_) { /* 브라우저 저장소 제한 */ }
  apply(saved);

  window.addEventListener('storage', (event) => {
    if (event.key === key || event.key === null) apply(event.key === null ? 'midnight' : event.newValue);
  });
  document.addEventListener('DOMContentLoaded', () => {
    const dialog = document.getElementById('themeDialog');
    const button = document.getElementById('themeButton');
    apply(document.documentElement.dataset.theme);
    button.addEventListener('click', () => {
      if (!dialog.open) dialog.showModal();
      dialog.querySelector('input:checked').focus();
    });
    document.querySelectorAll('input[name="chatTheme"]').forEach((input) => {
      input.addEventListener('change', () => {
        apply(input.value);
        const note = document.getElementById('themeSaveNote');
        try {
          localStorage.setItem(key, input.value);
          note.textContent = '선택한 디자인은 이 브라우저에서 기억해요.';
        } catch (_) {
          note.textContent = '이 브라우저는 저장이 제한돼 있어요. 지금 화면에는 적용됐어요.';
        }
      });
    });
    document.getElementById('themeClose').addEventListener('click', () => dialog.close());
    document.getElementById('themeDone').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', (event) => {
      const rect = dialog.getBoundingClientRect();
      if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right ||
          event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close();
    });
    dialog.addEventListener('close', () => button.focus({preventScroll: true}));
  });
})();
