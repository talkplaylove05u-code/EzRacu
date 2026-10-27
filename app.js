import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js';
import { getFirestore, collection, addDoc, query, orderBy, limit, startAfter, getDocsFromServer, onSnapshot, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';
import { createImageViewer } from './image-viewer.js?v=5';
import { createUnreadIndicator, messageDay, dayLabel } from './chat-indicators.js?v=5';

const $ = (id) => document.getElementById(id);
const dom = {
  login: $('loginView'), chat: $('conversation'), loginButton: $('loginButton'), loginError: $('loginError'),
  logoutButton: $('logoutButton'), status: $('connectionStatus'), setupNote: $('setupNote'),
  messages: $('messages'), form: $('messageForm'), input: $('messageInput'), sendButton: $('sendButton'), toast: $('toast'),
  attachButton: $('attachButton'), fileInput: $('fileInput'), attachmentPreview: $('attachmentPreview'),
  attachmentThumbnail: $('attachmentThumbnail'), attachmentDescription: $('attachmentDescription'), attachmentRemove: $('attachmentRemove'),
  notificationToggle: $('notificationToggle'), popupButton: $('popupButton'),
  olderButton: $('olderMessagesButton'), historyStatus: $('historyStatus'),
  unreadBadge: $('unreadBadge'), newMessagesButton: $('newMessagesButton'),
  themeDialog: $('themeDialog'),
};
const isConfigured = firebaseConfig.apiKey && !firebaseConfig.apiKey.includes('PASTE_') &&
  firebaseConfig.projectId && firebaseConfig.projectId !== 'YOUR_PROJECT_ID' &&
  firebaseConfig.appId && !firebaseConfig.appId.includes('PASTE_');
let auth;
let db;
let currentUser = null;
let unsubscribeMessages = null;
let sending = false;
let preparing = false;
let pendingAttachment = null;
const MAX_FILE_BYTES = 400 * 1024; // Firestore 무료 플랜용: 단일 문서에 인코딩해 저장
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const imageViewer = createImageViewer(downloadAttachment, dom.input, () => unreadIndicator.sync());
const unreadIndicator = createUnreadIndicator({
  messages: dom.messages, badge: dom.unreadBadge, button: dom.newMessagesButton,
  canRead: () => Boolean(currentUser) && !imageViewer.isOpen && !dom.themeDialog.open, focusInput: dom.input,
});
dom.themeDialog.addEventListener('close', () => unreadIndicator.sync());
const MESSAGE_PAGE_SIZE = 100;
const messageHistory = new Map();
const messageRows = new Map();
let oldestLoadedMessage = null;
let historyReady = false;
let historyExhausted = false;
let loadingOlder = false;
let chatVersion = 0;
let toastTimeout;
let audioContext = null;
const notificationKey = 'ezracu-notifications-enabled-v2';
let notificationsEnabled = false;
try { notificationsEnabled = localStorage.getItem(notificationKey) === 'true'; } catch (_) { /* 저장소 제한 */ }

if (new URLSearchParams(window.location.search).get('popup') === '1') {
  document.documentElement.classList.add('popup-mode');
  dom.popupButton.hidden = true;
}

function updateNotificationToggle() {
  dom.notificationToggle.textContent = notificationsEnabled ? '🔔 알림 ON' : '🔕 알림 OFF';
  dom.notificationToggle.classList.toggle('notify-on', notificationsEnabled);
  dom.notificationToggle.classList.toggle('notify-off', !notificationsEnabled);
  dom.notificationToggle.setAttribute('aria-pressed', String(notificationsEnabled));
  dom.notificationToggle.title = notificationsEnabled
    ? '새 메시지 소리/알림 끄기' : '새 메시지 소리/알림 켜기';
}

async function prepareSound() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    audioContext ||= new AudioCtx();
    if (audioContext.state === 'suspended') await audioContext.resume();
  } catch (error) { console.debug('Sound preparation unavailable:', error); }
}

function playNotificationSound() {
  if (!audioContext || audioContext.state !== 'running') return;
  try {
    const now = audioContext.currentTime;
    for (const [offset, frequency] of [[0, 740], [0.13, 980]]) {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.065, now + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.13);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start(now + offset);
      oscillator.stop(now + offset + 0.14);
    }
  } catch (error) { console.debug('Sound unavailable:', error); }
}

function signalIncomingMessage(doc) {
  if (!notificationsEnabled || !currentUser) return;
  const data = doc.data();
  if (data.uid === currentUser.uid) return;

  // 동일 브라우저의 일반창과 팝업창에서 알림이 겹치는 일을 줄입니다.
  try {
    const key = 'ezracu-last-notified-v2';
    const previous = JSON.parse(localStorage.getItem(key) || '{}');
    if (previous.id === doc.id && Date.now() - previous.time < 60000) return;
    localStorage.setItem(key, JSON.stringify({id: doc.id, time: Date.now()}));
  } catch (_) { /* 개인 정보 보호 모드에서 로컬 저장소를 못 쓸 수 있음 */ }

  playNotificationSound();
  if ('Notification' in window && Notification.permission === 'granted' &&
      (document.hidden || !document.hasFocus())) {
    try {
      const alert = new Notification('우리 둘 채팅방 · 새 메시지', {
        body: data.kind === 'attachment' ? `📎 ${data.fileName || '첨부 파일'}` : (data.text || '').slice(0, 100),
        tag: 'ezracu-new-message',
      });
      alert.onclick = () => { window.focus(); alert.close(); };
    } catch (error) { console.debug('Desktop notification unavailable:', error); }
  }
}

updateNotificationToggle();
dom.notificationToggle.addEventListener('click', async () => {
  notificationsEnabled = !notificationsEnabled;
  try { localStorage.setItem(notificationKey, String(notificationsEnabled)); } catch (_) { /* 저장소 제한 */ }
  updateNotificationToggle();
  if (!notificationsEnabled) { notify('새 메시지 알림을 껐습니다.'); return; }
  // 클릭 동작 안에서 요청해야 브라우저가 알림 권한 대화상자를 열 수 있습니다.
  const soundPromise = prepareSound();
  let permission = 'unsupported';
  if ('Notification' in window && Notification.permission === 'default') {
    try { permission = await Notification.requestPermission(); }
    catch (_) { permission = 'denied'; }
  } else if ('Notification' in window) {
    permission = Notification.permission;
  }
  await soundPromise;
  notify(permission === 'granted' ? '알림 ON · 새 메시지 소리와 PC 알림을 사용합니다.' :
    '알림 ON · 소리를 사용합니다. PC 알림은 브라우저 권한을 확인해 주세요.');
});

dom.popupButton.addEventListener('click', () => {
  const url = new URL(window.location.href);
  url.searchParams.set('popup', '1');
  const popup = window.open(url.toString(), 'EzRacuCompactChat',
    'popup=yes,width=440,height=680,resizable=yes,scrollbars=yes');
  if (!popup) { notify('팝업 창이 차단되었습니다. 브라우저에서 이 사이트의 팝업을 허용해 주세요.'); return; }
  popup.focus();
});

function notify(message) {
  dom.toast.textContent = message;
  dom.toast.hidden = false;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => { dom.toast.hidden = true; }, 4500);
}
function showLoginError(message) {
  dom.loginError.hidden = !message;
  dom.loginError.textContent = message || '';
}
function status(message) { dom.status.textContent = message; }
function displayTime(timestamp) {
  if (!timestamp || typeof timestamp.toDate !== 'function') return '전송 중';
  return new Intl.DateTimeFormat('ko-KR', {hour:'2-digit', minute:'2-digit', hour12:false}).format(timestamp.toDate());
}
function isImageAttachment(data) {
  return data?.kind === 'attachment' && data.isImage === true && IMAGE_TYPES.has(data.fileMime);
}
function attachmentBlob(data) {
  const binary = atob(data.fileData);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], {type: data.fileMime || 'application/octet-stream'});
}
function downloadAttachment(data) {
  try {
    const blob = attachmentBlob(data);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = data.fileName || 'attachment';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (error) {
    console.error('Attachment download failed:', error);
    notify('첨부 파일을 열지 못했습니다.');
  }
}
function formatFileSize(bytes) {
  if (!Number.isFinite(bytes)) return '';
  return bytes < 1024 ? `${bytes} B` : `${Math.round(bytes / 1024)} KB`;
}
function orderedMessages() {
  return [...messageHistory.values()].sort((a, b) => {
    const timeA = a.data().createdAt?.toMillis() ?? Number.MAX_SAFE_INTEGER;
    const timeB = b.data().createdAt?.toMillis() ?? Number.MAX_SAFE_INTEGER;
    return timeA - timeB || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  });
}
function imageGallery() {
  return orderedMessages().filter((doc) => isImageAttachment(doc.data()))
    .map((doc) => ({id: doc.id, data: doc.data()}));
}
function renderMessages({preservePosition = false, animateIds = new Set()} = {}) {
  const nearBottom = dom.messages.scrollHeight - dom.messages.scrollTop - dom.messages.clientHeight < 90;
  const previousHeight = dom.messages.scrollHeight;
  const previousTop = dom.messages.scrollTop;
  const items = orderedMessages();
  const fragment = document.createDocumentFragment();
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = '아직 대화가 없어요.\n첫 인사를 남겨보세요 ☺';
    fragment.append(empty);
  }
  let previousDay = null;
  for (const item of items) {
    const data = item.data();
    const day = messageDay(data.createdAt);
    if (day !== previousDay) {
      const divider = document.createElement('div');
      divider.className = 'date-divider';
      divider.dataset.day = day;
      divider.setAttribute('role', 'separator');
      divider.setAttribute('aria-label', dayLabel(day));
      const label = document.createElement('span');
      label.textContent = dayLabel(day);
      divider.append(label);
      fragment.append(divider);
      previousDay = day;
    }
    const existing = messageRows.get(item.id);
    if (existing) {
      existing.querySelector('time').textContent = displayTime(data.createdAt);
      fragment.append(existing);
      continue;
    }
    const mine = data.uid === currentUser?.uid;
    const row = document.createElement('div');
    row.dataset.messageId = item.id;
    row.className = `message-line${mine ? ' mine' : ''}`;
    if (animateIds.has(item.id)) {
      row.classList.add('message-new');
      setTimeout(() => row.classList.remove('message-new'), 350);
    }
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    const isAttachment = data.kind === 'attachment' &&
      typeof data.fileData === 'string' && typeof data.fileName === 'string';
    if (isAttachment) {
      bubble.classList.add('attachment-bubble');
      if (isImageAttachment(data)) {
        const openImage = document.createElement('button');
        openImage.type = 'button';
        openImage.className = 'image-open';
        openImage.setAttribute('aria-label', `사진 크게 보기: ${data.fileName}`);
        openImage.title = '클릭하면 크게 볼 수 있어요';
        const image = document.createElement('img');
        image.className = 'chat-image';
        image.alt = `첨부 사진: ${data.fileName}`;
        image.loading = 'lazy';
        image.src = `data:${data.fileMime};base64,${data.fileData}`;
        openImage.append(image);
        openImage.addEventListener('click', () => imageViewer.open(imageGallery(), item.id, openImage));
        bubble.append(openImage);
      }
      const download = document.createElement('button');
      download.type = 'button';
      download.className = 'file-download';
      download.textContent = `📎 ${data.fileName} · ${formatFileSize(data.fileSize)} · 다운로드`;
      download.addEventListener('click', () => downloadAttachment(data));
      bubble.append(download);
      if (data.text) {
        const caption = document.createElement('div');
        caption.className = 'attachment-caption';
        caption.textContent = data.text;
        bubble.append(caption);
      }
    } else {
      bubble.textContent = typeof data.text === 'string' ? data.text : '';
    }
    const time = document.createElement('time');
    time.className = 'message-time';
    time.textContent = displayTime(data.createdAt);
    row.append(bubble, time);
    messageRows.set(item.id, row);
    fragment.append(row);
  }
  dom.messages.replaceChildren(fragment);
  if (preservePosition) {
    dom.messages.scrollTop = previousTop + dom.messages.scrollHeight - previousHeight;
  } else if (nearBottom || items.length < 6) {
    dom.messages.scrollTop = dom.messages.scrollHeight;
  } else {
    dom.messages.scrollTop = previousTop;
  }
}

// 탭을 밤새 열어 두어도 오늘/어제 표시를 갱신합니다.
function refreshDateLabels() {
  dom.messages.querySelectorAll('.date-divider').forEach((divider) => {
    const label = dayLabel(divider.dataset.day);
    divider.querySelector('span').textContent = label;
    divider.setAttribute('aria-label', label);
  });
}
function scheduleDateRefresh() {
  const now = new Date();
  const nextDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  setTimeout(() => { refreshDateLabels(); scheduleDateRefresh(); }, nextDay - now + 100);
}
scheduleDateRefresh();
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshDateLabels(); });
function updateHistoryControls() {
  dom.olderButton.disabled = !historyReady || loadingOlder;
  dom.olderButton.hidden = historyExhausted;
  dom.olderButton.textContent = loadingOlder ? '이전 대화 불러오는 중...' : '이전 대화 100개 더 보기';
  dom.historyStatus.textContent = historyExhausted && messageHistory.size ? '처음 대화까지 모두 불러왔어요.' : '';
}
async function loadOlderMessages() {
  if (!currentUser || !historyReady || historyExhausted || loadingOlder || !oldestLoadedMessage) return;
  const version = chatVersion;
  loadingOlder = true;
  updateHistoryControls();
  try {
    const older = query(collection(db, 'rooms', 'private-room', 'messages'),
      orderBy('createdAt', 'desc'), startAfter(oldestLoadedMessage), limit(MESSAGE_PAGE_SIZE));
    const snapshot = await getDocsFromServer(older);
    // 로그아웃하거나 계정이 바뀐 뒤 도착한 이전 요청은 화면에 반영하지 않습니다.
    if (version !== chatVersion) return;
    snapshot.docs.forEach((doc) => messageHistory.set(doc.id, doc));
    if (snapshot.docs.length) oldestLoadedMessage = snapshot.docs[snapshot.docs.length - 1];
    historyExhausted = snapshot.docs.length < MESSAGE_PAGE_SIZE;
    renderMessages({preservePosition: true});
    status(`채팅방 연결됨 · 불러온 메시지 ${messageHistory.size}개`);
  } catch (error) {
    if (version !== chatVersion) return;
    console.error('Older messages failed:', error);
    notify('이전 대화를 불러오지 못했어요. 연결 상태를 확인하고 다시 눌러 주세요.');
  } finally {
    if (version === chatVersion) {
      loadingOlder = false;
      updateHistoryControls();
    }
  }
}
function clearListener() {
  if (unsubscribeMessages) unsubscribeMessages();
  unsubscribeMessages = null;
  imageViewer.close();
  chatVersion++;
  messageHistory.clear();
  messageRows.clear();
  unreadIndicator.reset();
  dom.messages.replaceChildren();
  oldestLoadedMessage = null;
  historyReady = historyExhausted = loadingOlder = false;
  updateHistoryControls();
}
function subscribeToChat() {
  clearListener();
  status('채팅방 연결 중...');
  const messagesRef = collection(db, 'rooms', 'private-room', 'messages');
  const recent = query(messagesRef, orderBy('createdAt', 'desc'), limit(MESSAGE_PAGE_SIZE));
  // 최초 로딩에 포함된 이전 메시지는 새 메시지 알림을 내지 않습니다.
  let initialServerSnapshotReceived = false;
  unsubscribeMessages = onSnapshot(recent, { includeMetadataChanges: true }, (snapshot) => {
    const freshIds = new Set(initialServerSnapshotReceived ? snapshot.docs
      .filter((doc) => !messageHistory.has(doc.id)).map((doc) => doc.id) : []);
    const added = initialServerSnapshotReceived ? snapshot.docChanges()
      .filter((change) => change.type === 'added' && !change.doc.metadata.hasPendingWrites)
      .map((change) => change.doc)
      .filter((doc) => doc.data().uid !== currentUser?.uid && !messageHistory.has(doc.id)) : [];
    snapshot.docs.forEach((doc) => messageHistory.set(doc.id, doc));
    if (!initialServerSnapshotReceived && !snapshot.metadata.fromCache) {
      oldestLoadedMessage = snapshot.docs[snapshot.docs.length - 1] || null;
      historyExhausted = snapshot.docs.length < MESSAGE_PAGE_SIZE;
      historyReady = true;
    }
    status(`채팅방 연결됨 · 불러온 메시지 ${messageHistory.size}개`);
    renderMessages({animateIds: freshIds});
    updateHistoryControls();
    if (added.length) {
      unreadIndicator.receive(added.map((doc) => doc.id));
      // Firestore의 내림차순 조회 결과이므로 가장 최근 메시지 하나로 알립니다.
      signalIncomingMessage(added[0]);
    }
    if (!snapshot.metadata.fromCache) initialServerSnapshotReceived = true;
  }, (error) => {
    console.error('Message subscription failed:', error);
    status('접속 권한 또는 연결 확인 필요');
    chatVersion++;
    loadingOlder = false;
    historyReady = false;
    if (error.code === 'permission-denied') {
      unreadIndicator.reset();
      imageViewer.close();
      messageHistory.clear();
      messageRows.clear();
      notify('접근할 수 없는 계정입니다. 두 계정의 이메일과 Firestore 보안 규칙을 확인하세요.');
      dom.messages.textContent = '채팅 권한이 없습니다. 관리자에게 계정 등록을 요청하세요.';
    } else {
      notify('대화를 불러오지 못했습니다. 네트워크와 Firestore 설정을 확인하세요.');
    }
    updateHistoryControls();
  });
}
function updateSubmitState() {
  dom.sendButton.disabled = preparing || sending || !currentUser || !(pendingAttachment || dom.input.value.trim());
  dom.attachButton.disabled = preparing || sending || !currentUser;
}
function resizeTextarea() {
  dom.input.style.height = 'auto';
  dom.input.style.height = `${Math.min(dom.input.scrollHeight, 100)}px`;
}
function encodeBase64(bytes) {
  let binary = '';
  const step = 8192;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}
async function toFileData(blob) {
  return encodeBase64(new Uint8Array(await blob.arrayBuffer()));
}
async function compressImage(file) {
  // 큰 이미지/스크린샷은 WebP로 변환해 무료 Firestore 크기 한도에 맞춥니다.
  // 작은 GIF는 애니메이션을 유지하기 위해 원본 그대로 사용합니다.
  if (file.size <= MAX_FILE_BYTES && IMAGE_TYPES.has(file.type)) return file;
  if (!IMAGE_TYPES.has(file.type)) return file;
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
    for (const dimension of [1600, 1280, 1024, 800, 640, 480]) {
      const ratio = Math.min(1, dimension / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
      canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.82, 0.68, 0.52]) {
        const compressed = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
        if (compressed && compressed.size > 0 && compressed.size <= MAX_FILE_BYTES) return compressed;
      }
    }
    throw new Error('image-too-large');
  } finally { bitmap?.close?.(); }
}
function clearAttachment() {
  pendingAttachment = null;
  dom.attachmentPreview.hidden = true;
  dom.attachmentThumbnail.hidden = true;
  dom.attachmentThumbnail.removeAttribute('src');
  dom.attachmentDescription.textContent = '';
  dom.fileInput.value = '';
  updateSubmitState();
}
async function setAttachment(file) {
  if (!file || !currentUser || sending || preparing) return;
  if (file.size === 0) { notify('빈 파일은 전송할 수 없습니다.'); return; }
  preparing = true;
  updateSubmitState();
  dom.attachmentPreview.hidden = false;
  dom.attachmentDescription.textContent = '첨부 파일 준비 중...';
  dom.attachmentThumbnail.hidden = true;
  try {
    const image = IMAGE_TYPES.has(file.type);
    const blob = image ? await compressImage(file) : file;
    if (blob.size > MAX_FILE_BYTES) {
      throw new Error('file-too-large');
    }
    const fileData = await toFileData(blob);
    const fileName = (file.name || (image ? '붙여넣은_사진.webp' : '파일'))
      .replace(/[\\/\x00-\x1f\x7f]/g, '_').slice(0, 120) || '파일';
    const mime = blob.type || 'application/octet-stream';
    pendingAttachment = {
      fileName: (image && blob !== file ? fileName.replace(/\.[^.]+$/, '') + '.webp' : fileName),
      fileMime: mime.slice(0, 100), fileData, fileSize: blob.size, isImage: image && IMAGE_TYPES.has(mime),
    };
    dom.attachmentDescription.textContent = `${pendingAttachment.fileName} (${formatFileSize(blob.size)})`;
    if (pendingAttachment.isImage) {
      dom.attachmentThumbnail.src = `data:${pendingAttachment.fileMime};base64,${fileData}`;
      dom.attachmentThumbnail.hidden = false;
    }
    dom.attachmentPreview.hidden = false;
    dom.input.focus();
  } catch (error) {
    console.error('Attachment preparation failed:', error);
    clearAttachment();
    notify(error.message === 'file-too-large' ? '일반 파일은 400KB 이하만 전송할 수 있어요. 큰 파일은 Cloud Storage가 필요합니다.' :
      '사진을 압축하지 못했습니다. 더 작은 이미지를 선택해 주세요.');
  } finally { preparing = false; updateSubmitState(); }
}
async function sendMessage(event) {
  event.preventDefault();
  const text = dom.input.value.trim();
  if (!currentUser || preparing || sending || (!text && !pendingAttachment) || text.length > 1000) return;
  sending = true;
  updateSubmitState();
  try {
    const message = {uid: currentUser.uid, text, createdAt: serverTimestamp()};
    if (pendingAttachment) Object.assign(message, {kind: 'attachment', ...pendingAttachment});
    await addDoc(collection(db, 'rooms', 'private-room', 'messages'), message);
    dom.input.value = '';
    clearAttachment();
    resizeTextarea();
  } catch (error) {
    console.error('Send failed:', error);
    notify(error.code === 'permission-denied' ? '전송 권한 오류: Firestore 규칙 업데이트 및 두 계정 등록을 확인하세요.' :
      '메시지/파일 전송에 실패했습니다. 연결 상태와 파일 용량을 확인하세요.');
  } finally { sending = false; updateSubmitState(); dom.input.focus(); }
}

if (!isConfigured) {
  dom.loginButton.disabled = true;
  dom.setupNote.textContent = '먼저 firebase-config.js에 Firebase 설정을 입력하세요. 자세한 방법은 README_KO.md를 참고하세요.';
  status('Firebase 설정이 필요해요');
} else {
  try {
    const app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    onAuthStateChanged(auth, (user) => {
      currentUser = user;
      dom.login.hidden = Boolean(user);
      dom.chat.hidden = !user;
      dom.logoutButton.hidden = !user;
      dom.notificationToggle.hidden = !user;
      showLoginError('');
      if (user) {
        subscribeToChat();
      } else {
        clearListener();
        status('로그인 대기 중');
        dom.messages.replaceChildren();
      }
      updateSubmitState();
    });
  } catch (error) {
    dom.loginButton.disabled = true;
    status('설정 오류');
    showLoginError('Firebase 초기화에 실패했습니다. 설정값을 확인하세요.');
    console.error(error);
  }
}
dom.loginButton.addEventListener('click', async () => {
  if (!auth) return;
  dom.loginButton.disabled = true;
  showLoginError('');
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (error) {
    console.error('Sign-in failed:', error);
    const message = error.code === 'auth/popup-closed-by-user' ? '로그인이 취소되었습니다.' :
      error.code === 'auth/popup-blocked' ? '팝업이 차단되었습니다. 브라우저 팝업 허용 여부를 확인하세요.' :
      '로그인에 실패했습니다. Authentication의 Google 로그인과 승인된 도메인 설정을 확인하세요.';
    showLoginError(message);
  } finally { dom.loginButton.disabled = false; }
});
dom.logoutButton.addEventListener('click', async () => {
  if (!auth) return;
  try { await signOut(auth); } catch (error) { console.error(error); notify('로그아웃에 실패했습니다.'); }
});
dom.input.addEventListener('input', () => { resizeTextarea(); updateSubmitState(); });
dom.input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
    event.preventDefault();
    dom.form.requestSubmit();
  }
});
dom.form.addEventListener('submit', sendMessage);
dom.olderButton.addEventListener('click', loadOlderMessages);
dom.attachButton.addEventListener('click', () => dom.fileInput.click());
dom.fileInput.addEventListener('change', () => {
  if (dom.fileInput.files?.length) setAttachment(dom.fileInput.files[0]);
});
dom.attachmentRemove.addEventListener('click', clearAttachment);
// 클립보드 이미지를 붙여넣으면 사진 첨부 미리보기로 변환합니다.
document.addEventListener('paste', (event) => {
  if (!currentUser || !event.clipboardData) return;
  const imageItem = [...event.clipboardData.items].find((item) =>
    item.kind === 'file' && item.type.startsWith('image/'));
  if (!imageItem) return; // 텍스트 붙여넣기는 원래 기능 유지
  event.preventDefault();
  const file = imageItem.getAsFile();
  if (file) setAttachment(new File([file], '붙여넣은_사진.png', {type: file.type}));
});
// 탐색기 파일을 페이지 위에 끌어 놓아도 첨부할 수 있습니다.
document.addEventListener('dragover', (event) => {
  if (![...(event.dataTransfer?.types || [])].includes('Files')) return;
  event.preventDefault();
  document.body.classList.add('drag-over');
});
document.addEventListener('dragleave', (event) => {
  if (!event.relatedTarget) document.body.classList.remove('drag-over');
});
document.addEventListener('drop', (event) => {
  document.body.classList.remove('drag-over');
  if (![...(event.dataTransfer?.types || [])].includes('Files')) return;
  event.preventDefault();
  if (event.dataTransfer?.files?.length) setAttachment(event.dataTransfer.files[0]);
});
