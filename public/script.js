const firebaseConfig = {
  apiKey: "AIzaSyAeSVIHdoREWrSGXZ6Hgjf4pQFpnfgwZ5A",
  authDomain: "vibeconnect-chat.firebaseapp.com",
  projectId: "vibeconnect-chat",
  storageBucket: "vibeconnect-chat.firebasestorage.app",
  messagingSenderId: "806750556723",
  appId: "1:806750556723:web:edda2de75e595c0f820946"
};
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const googleProvider = new firebase.auth.GoogleAuthProvider();
// --- END FIREBASE CONFIG ---

const socket = io();
const authWall = document.getElementById('auth-wall');
const paywall = document.getElementById('paywall');
const googleLoginBtn = document.getElementById('google-login-btn');
const txIdInput = document.getElementById('tx-id-input');
const submitTxIdButton = document.getElementById('submit-tx-id');
const txStatusMsg = document.getElementById('tx-status-msg');

const statusDiv = document.getElementById('status');
const startButton = document.getElementById('start-button');
const form = document.getElementById('message-form');
const input = document.getElementById('m');
const messages = document.getElementById('messages');

let userToken = null; // Store the authenticated user's token

function updateStatus(message, type = 'info') {
    statusDiv.textContent = message;
    statusDiv.className = type;
}

// --- 1. FIREBASE AUTHENTICATION LOGIC ---
googleLoginBtn.addEventListener('click', () => {
    auth.signInWithPopup(googleProvider);
});

auth.onAuthStateChanged(user => {
    if (user) {
        user.getIdToken().then(token => {
            userToken = token;
            socket.emit('authenticate', token); // Send token to back-end
            authWall.style.display = 'none';
        });
    } else {
        authWall.style.display = 'flex';
        paywall.style.display = 'none';
        updateStatus('Please sign in to continue.', 'info');
        startButton.disabled = true;
    }
});

// --- 2. SOCKET AND ACCESS HANDLERS ---
socket.on('connect', () => {
    if (userToken) {
        socket.emit('authenticate', userToken); // Re-authenticate on reconnect
    }
});

socket.on('ip_block', (message) => {
    updateStatus('🚫 ACCESS DENIED: ' + message, 'error');
});

socket.on('access_granted', () => {
    paywall.style.display = 'none';
    updateStatus('Subscription Active. Ready to find your Vibe!', 'success');
    startButton.disabled = false;
});

socket.on('access_required', () => {
    paywall.style.display = 'flex';
    updateStatus('Subscription required.', 'error');
    startButton.disabled = true;
});

// --- 3. TRANSACTION SUBMISSION ---
submitTxIdButton.addEventListener('click', () => {
    const txId = txIdInput.value.trim();
    console.log('Submit button clicked. Transaction ID:', txId); // <-- ADD THIS LINE
    if (txId.length > 5) {
        txStatusMsg.style.color = '#17a2b8';
        txStatusMsg.textContent = 'Submitting ID for manual verification...';
        console.log('Attempting to send data to server...'); // <-- ADD THIS LINE
        socket.emit('submit_tx_id', { txId: txId, token: userToken });
    } else {
        txStatusMsg.style.color = '#dc3545';
        txStatusMsg.textContent = 'Please enter a valid Transaction ID.';
    }
});

socket.on('tx_submission_result', (result) => {
    txStatusMsg.style.color = result.success ? '#28a745' : '#dc3545';
    txStatusMsg.textContent = result.message;
    // Do not hide paywall, user must wait for manual approval.
});

// --- 4. CHAT LOGIC (Keep existing listeners for startButton, form, chat_started, etc.) ---
startButton.addEventListener('click', () => {
    if (startButton.textContent === 'End Chat') {
        socket.emit('end_chat_manual');
        updateStatus('Ending chat...', 'info');
        startButton.disabled = true;
    } else {
        socket.emit('start_chat');
        updateStatus('Searching for a connection...', 'info');
        startButton.disabled = true;
        form.style.display = 'none';
        messages.innerHTML = '';
    }
});

socket.on('chat_started', (partnerNickname) => {
    updateStatus(`Chatting with ${partnerNickname}!`, 'success');
    startButton.textContent = 'End Chat';
    startButton.disabled = false;
    form.style.display = 'flex';
    const welcomeItem = document.createElement('li');
    welcomeItem.textContent = `You've connected with ${partnerNickname}! Say hello!`;
    welcomeItem.classList.add('partner-msg');
    messages.appendChild(welcomeItem);
    messages.scrollTop = messages.scrollHeight;
});

form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (input.value.trim()) {
        socket.emit('chat_message', input.value);
        const item = document.createElement('li');
        item.textContent = 'You: ' + input.value;
        item.classList.add('my-msg');
        messages.appendChild(item);
        input.value = '';
        messages.scrollTop = messages.scrollHeight;
    }
});

socket.on('chat_message', (msg) => {
    const item = document.createElement('li');
    item.textContent = msg;
    item.classList.add('partner-msg');
    messages.appendChild(item);
    messages.scrollTop = messages.scrollHeight;
});

socket.on('partner_left', () => {
    const item = document.createElement('li');
    item.textContent = 'Partner disconnected. Click "Start Chat" to find a new Vibe.';
    item.classList.add('partner-msg');
    messages.appendChild(item);
    updateStatus('Chat ended.', 'info');
    startButton.textContent = 'Start Chat';
    startButton.disabled = false;
    form.style.display = 'none';
    messages.scrollTop = messages.scrollHeight;
});

// script.js

socket.on('chat_ended_self', () => {
    updateStatus('Chat ended. Find a new Vibe!', 'info');
    startButton.textContent = 'Start Chat';
    startButton.disabled = false;
    form.style.display = 'none';
    messages.scrollTop = messages.scrollHeight;
});