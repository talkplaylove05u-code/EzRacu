import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js';
import { getFirestore, collection, addDoc, query, orderBy, limit, onSnapshot, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

const $ = (id) => document.getElementById(id);
const dom = {
  login: $('loginView'), chat: $('conversation'), loginButton: $('loginButton'), loginError: $('loginError'),
  logoutButton: $('logoutButton'), status: $('connectionStatus'), setupNote: $('setupNote'),
  messages: $('messages'), form: $('messageForm'), input: $('messageInput'), sendButton: $('sendButton'), toast: $('toast'),
};
const isConfigured = firebaseConfig.apiKey && !firebaseConfig.apiKey.includes('PASTE_') &&
  firebaseConfig.projectId && firebaseConfig.projectId !== 'YOUR_PROJECT_ID' &&
  firebaseConfig.appId && !firebaseConfig.appId.includes('PASTE_');
let auth;
let db;
let currentUser = null;
let unsubscribeMessages = null;
let sending = false;
let toastTimeout;

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
function renderMessages(snapshot) {
  const nearBottom = dom.messages.scrollHeight - dom.messages.scrollTop - dom.messages.clientHeight < 90;
  const items = [...snapshot.docs].reverse();
  const fragment = document.createDocumentFragment();
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = '아직 대화가 없어요.\n첫 인사를 남겨보세요 ☺';
    fragment.append(empty);
  }
  for (const item of items) {
    const data = item.data();
    const mine = data.uid === currentUser?.uid;
    const row = document.createElement('div');
    row.className = `message-line${mine ? ' mine' : ''}`;
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = typeof data.text === 'string' ? data.text : '';
    const time = document.createElement('time');
    time.className = 'message-time';
    time.textContent = displayTime(data.createdAt);
    row.append(bubble, time);
    fragment.append(row);
  }
  dom.messages.replaceChildren(fragment);
  if (nearBottom || items.length < 6) dom.messages.scrollTop = dom.messages.scrollHeight;
}
function clearListener() {
  if (unsubscribeMessages) unsubscribeMessages();
  unsubscribeMessages = null;
}
function subscribeToChat() {
  clearListener();
  status('채팅방 연결 중...');
  const messagesRef = collection(db, 'rooms', 'private-room', 'messages');
  const recent = query(messagesRef, orderBy('createdAt', 'desc'), limit(100));
  unsubscribeMessages = onSnapshot(recent, (snapshot) => {
    status('채팅방 연결됨 · 최근 100개 메시지');
    renderMessages(snapshot);
  }, (error) => {
    console.error('Message subscription failed:', error);
    status('접속 권한 또는 연결 확인 필요');
    if (error.code === 'permission-denied') {
      notify('접근할 수 없는 계정입니다. 두 계정의 이메일과 Firestore 보안 규칙을 확인하세요.');
      dom.messages.textContent = '채팅 권한이 없습니다. 관리자에게 계정 등록을 요청하세요.';
    } else {
      notify('대화를 불러오지 못했습니다. 네트워크와 Firestore 설정을 확인하세요.');
    }
  });
}
function updateSubmitState() {
  dom.sendButton.disabled = sending || !currentUser || !dom.input.value.trim();
}
function resizeTextarea() {
  dom.input.style.height = 'auto';
  dom.input.style.height = `${Math.min(dom.input.scrollHeight, 100)}px`;
}
async function sendMessage(event) {
  event.preventDefault();
  const text = dom.input.value.trim();
  if (!currentUser || sending || !text || text.length > 1000) return;
  sending = true;
  updateSubmitState();
  try {
    await addDoc(collection(db, 'rooms', 'private-room', 'messages'), {
      uid: currentUser.uid,
      text,
      createdAt: serverTimestamp(),
    });
    dom.input.value = '';
    resizeTextarea();
  } catch (error) {
    console.error('Send failed:', error);
    notify(error.code === 'permission-denied' ? '전송 권한이 없습니다. 등록된 두 계정인지 확인하세요.' : '메시지 전송에 실패했습니다. 연결 상태를 확인하세요.');
  } finally {
    sending = false;
    updateSubmitState();
    dom.input.focus();
  }
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
