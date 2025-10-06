const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);
const path = require('path');
const ipRangeCheck = require('ip-range-check');
const mongoose = require('mongoose');
const admin = require('firebase-admin');

// --- 1. CONFIGURATION (ACTION REQUIRED) ---
const PORT = process.env.PORT || 3000;
const COLLEGE_IP_RANGES = ["0.0.0.0/0","::/0", "127.0.0.1", "::1"];
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const MONGO_URI = "mongodb+srv://karnavagarwal07_db_user:vQn3uEBLXwUrcai2@cluster0.unvpy7z.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0"; // e.g., mongodb+srv://user:pass@cluster.mongodb.net/vibeconnect

// Initialize Firebase Admin (for token verification)
// You need to set the service account key in Render environment variables or load it here.
// For zero-cost, you MUST use environment variables (e.g., FIREBASE_CREDENTIALS)
// The logic below assumes you've handled Firebase Admin setup via environment variables for Render.
admin.initializeApp({ /* ... set credentials via environment variables ... */ });


// --- 2. DATABASE SCHEMA ---
mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log('MongoDB connected'))
    .catch(err => console.log(err));

const UserSchema = new mongoose.Schema({
    googleId: { type: String, required: true, unique: true },
    isVerified: { type: Boolean, default: false },
    subscriptionExpires: { type: Date, default: null },
});
const User = mongoose.model('User', UserSchema);

const PendingTxSchema = new mongoose.Schema({
    txId: { type: String, required: true, unique: true },
    googleId: { type: String, required: true },
    submittedAt: { type: Date, default: Date.now }
});
const PendingTx = mongoose.model('PendingTx', PendingTxSchema);


// --- 3. CHAT LOGIC AND UTILITIES ---
let waitingQueue = [];
let activeChats = new Map();
const socketUserMap = new Map(); // socket.id -> googleId

const ADJECTIVES = ['Silly', 'Brave', 'Quiet', 'Witty', 'Curious', 'Zesty', 'Hasty', 'Jolly'];
const NOUNS = ['Panda', 'Comet', 'Scholar', 'Tiger', 'Ninja', 'Phantom', 'Wizard', 'Geek'];

// Middleware to serve static files
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });

// Helper to check user status from DB
async function checkSubscription(googleId) {
    const user = await User.findOne({ googleId });
    if (!user) return { status: 'new' };

    const isActive = user.subscriptionExpires && user.subscriptionExpires.getTime() > Date.now();
    return { status: isActive ? 'active' : 'expired', user };
}


// --- 4. SOCKET.IO CONNECTION HANDLING ---
io.on('connection', (socket) => {
    let currentUserId = null; // Store Google ID for this session

    // --- A. IP CHECK ---
    const clientIP = socket.handshake.address;
    const isCollegeIP = ipRangeCheck(clientIP, COLLEGE_IP_RANGES);
    if (!isCollegeIP) {
        socket.emit('ip_block', 'You must be connected to the college Wi-Fi.');
        socket.disconnect(true);
        return;
    }

    // --- B. AUTHENTICATION & ACCESS CHECK ---
    socket.on('authenticate', async (token) => {
        try {
            const decodedToken = await admin.auth().verifyIdToken(token);
            currentUserId = decodedToken.uid;
            socketUserMap.set(socket.id, currentUserId); // Map socket to GoogleId

            const { status, user } = await checkSubscription(currentUserId);
            
            if (status === 'active') {
                socket.emit('access_granted');
            } else {
                // User is new or expired, show paywall
                socket.emit('access_required');
                if (status === 'new') {
                    // Create user record for the first time
                    await User.create({ googleId: currentUserId });
                }
            }
        } catch (error) {
            console.error('Authentication error:', error.message);
            socket.emit('access_required'); // Force paywall/login view
        }
    });

    // --- C. TRANSACTION ID SUBMISSION ---
    socket.on('submit_tx_id', async ({ txId, token }) => {
        if (!currentUserId) return; // Must be authenticated first

        try {
            const txExists = await PendingTx.findOne({ txId });
            if (txExists) {
                return socket.emit('tx_submission_result', { success: false, message: 'Transaction ID already submitted.' });
            }

            // Save the TX ID and the user ID to the database for manual verification
            await PendingTx.create({ txId, googleId: currentUserId });
            
            socket.emit('tx_submission_result', { 
                success: true, 
                message: 'Submitted! Please wait for manual verification (up to 1 hour).' 
            });
        } catch (error) {
            console.error('TX Submission error:', error.message);
            socket.emit('tx_submission_result', { success: false, message: 'Database error. Try again.' });
        }
    });


    // --- D. CHAT START / PAIRING LOGIC ---
    socket.on('start_chat', async () => {
        const { status } = await checkSubscription(currentUserId);
        if (status !== 'active') return socket.emit('access_required'); // Must be active

        // ... (Keep existing pairing logic using socket.id) ...
        // [NOTE: Pairing logic is complex in this file. The full implementation would use the Google ID for smarter pairing, but for simplicity, we keep the original socket.id queue]
        if (waitingQueue.length > 0) {
            const partnerId = waitingQueue.shift();
            const partnerSocket = io.sockets.sockets.get(partnerId);

            // Ensure partner is also active before pairing
            const partnerGoogleId = socketUserMap.get(partnerId);
            const { status: partnerStatus } = await checkSubscription(partnerGoogleId);

            if (partnerSocket && partnerSocket.connected && partnerStatus === 'active') {
                const myNickname = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)] + NOUNS[Math.floor(Math.random() * NOUNS.length)];
                const partnerNickname = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)] + NOUNS[Math.floor(Math.random() * NOUNS.length)];
                
                activeChats.set(socket.id, partnerId);
                activeChats.set(partnerId, socket.id);

                socket.emit('chat_started', partnerNickname);
                partnerSocket.emit('chat_started', myNickname);
            } else {
                waitingQueue.push(socket.id); 
            }
        } else {
            waitingQueue.push(socket.id);
        }
    });

    // --- E. DISCONNECT/END CHAT ---
    const handleEndChat = () => {
        // ... (Keep existing disconnect/end chat logic) ...
        waitingQueue = waitingQueue.filter(id => id !== socket.id);
        const partnerId = activeChats.get(socket.id);
        if (partnerId) {
            io.to(partnerId).emit('partner_left');
            activeChats.delete(partnerId);
            activeChats.delete(socket.id);
            if (!waitingQueue.includes(partnerId)) {
                waitingQueue.push(partnerId);
            }
        }
        socketUserMap.delete(socket.id); // Remove Google ID mapping on disconnect
    };

    socket.on('end_chat_manual', handleEndChat);
    socket.on('disconnect', handleEndChat);
});

server.listen(PORT, () => {
    console.log(`Listening on *:${PORT}`);

});
