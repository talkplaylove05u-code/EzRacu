const storageKey = 'ezracu-room-name-v1';
export const DEFAULT_ROOM_NAME = '우리 둘 채팅방';

export function normalizeRoomName(value) {
  return typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 30) : '';
}
let roomName = DEFAULT_ROOM_NAME;
try { roomName = normalizeRoomName(localStorage.getItem(storageKey)) || DEFAULT_ROOM_NAME; }
catch (_) { /* 저장소 제한 시 기본 이름 사용 */ }
export function getRoomName() { return roomName; }

export function initializeRoomName({onChange, notify}) {
  const button = document.getElementById('roomNameButton');
  const text = document.getElementById('roomNameText');
  const dialog = document.getElementById('roomNameDialog');
  const input = document.getElementById('roomNameInput');
  const error = document.getElementById('roomNameError');
  const form = document.getElementById('roomNameForm');
  function apply(value) {
    roomName = normalizeRoomName(value) || DEFAULT_ROOM_NAME;
    text.textContent = roomName;
    button.setAttribute('aria-label', `${roomName}, 이름 바꾸기`);
    button.title = `${roomName} · 이름 바꾸기`;
    onChange(roomName);
  }
  apply(roomName);
  button.addEventListener('click', () => {
    input.value = roomName;
    error.hidden = true;
    if (!dialog.open) dialog.showModal();
    input.focus();
    input.select();
  });
  input.addEventListener('input', () => { error.hidden = true; });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = normalizeRoomName(input.value);
    if (!value) {
      error.textContent = '채팅방 이름을 입력해 주세요.';
      error.hidden = false;
      input.focus();
      return;
    }
    apply(value);
    let saved = true;
    try { localStorage.setItem(storageKey, value); } catch (_) { saved = false; }
    dialog.close();
    if (!saved) notify('지금 화면에는 적용했어요. 브라우저 저장이 제한돼 새로고침하면 초기화돼요.');
  });
  document.getElementById('roomNameReset').addEventListener('click', () => {
    input.value = DEFAULT_ROOM_NAME;
    error.hidden = true;
    input.focus();
    input.select();
  });
  ['roomNameClose', 'roomNameCancel'].forEach((id) => {
    document.getElementById(id).addEventListener('click', () => dialog.close());
  });
  dialog.addEventListener('click', (event) => {
    const rect = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right ||
        event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close();
  });
  dialog.addEventListener('close', () => button.focus({preventScroll: true}));
  window.addEventListener('storage', (event) => {
    if (event.key === storageKey || event.key === null) apply(event.key === null ? null : event.newValue);
  });
}
