const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const LOGS_DIR = path.join(__dirname, 'logs');
if (!fs.existsSync(LOGS_DIR)) {
    try {
        fs.mkdirSync(LOGS_DIR, { recursive: true });
    } catch (e) {
        console.log("Logs dir error:", e.message);
    }
}

// Room store: roomId -> { password, users: Set, messages: [] }
const rooms = new Map();

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    socket.on('create-room', ({ roomId, password }) => {
        if (rooms.has(roomId)) {
            socket.emit('error-msg', 'Room already exists! Choose another secret code.');
            return;
        }
        rooms.set(roomId, {
            password: password || '',
            users: new Set([socket.id]),
            messages: []
        });
        socket.join(roomId);
        socket.emit('room-joined', { roomId });
    });

    socket.on('join-room', ({ roomId, password }) => {
        const room = rooms.get(roomId);
        if (!room) {
            socket.emit('error-msg', 'Room not found! Did you type the right secret code?');
            return;
        }
        if (room.password && room.password !== password) {
            socket.emit('error-msg', 'Incorrect password for this room!');
            return;
        }
        room.users.add(socket.id);
        socket.join(roomId);
        socket.emit('room-joined', { roomId });
        socket.emit('load-history', room.messages);
    });

    socket.on('send-message', ({ roomId, sender, text, isSecret }) => {
        const room = rooms.get(roomId);
        if (!room) return;

        const messageData = {
            id: Math.random().toString(36).substring(2, 9),
            sender: sender || 'Anonymous',
            text,
            isSecret: !!isSecret,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };

        room.messages.push(messageData);
        if (room.messages.length > 100) room.messages.shift();

        io.to(roomId).emit('receive-message', messageData);

        // Archive to local HTML file in logs directory
        try {
            const logFile = path.join(LOGS_DIR, `${roomId}.html`);
            const logEntry = `<div class="msg"><b>[${messageData.timestamp}] ${escapeHtml(messageData.sender)}:</b> ${escapeHtml(text)} ${isSecret ? '<i>(Secret)</i>' : ''}</div>\n`;
            if (!fs.existsSync(logFile)) {
                const header = `<!DOCTYPE html><html><head><title>Archive: ${roomId}</title><style>body{background:#0f172a;color:#cbd5e1;font-family:sans-serif;padding:20px;}.msg{margin-bottom:8px;border-bottom:1px solid #1e293b;padding-bottom:6px;}</style></head><body><h2>Archive for Room: #${roomId}</h2><hr/>`;
                fs.writeFileSync(logFile, header);
            }
            fs.appendFileSync(logFile, logEntry);
        } catch (e) {
            console.error("Archive write error:", e.message);
        }
    });

    socket.on('clear-room', ({ roomId }) => {
        const room = rooms.get(roomId);
        if (room) {
            room.messages = [];
            io.to(roomId).emit('room-cleared');
        }
    });

    socket.on('disconnect', () => {
        for (const [roomId, room] of rooms.entries()) {
            if (room.users.has(socket.id)) {
                room.users.delete(socket.id);
                if (room.users.size === 0) {
                    rooms.delete(roomId);
                }
            }
        }
    });
});

function escapeHtml(text) {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`WhisperBox server running on http://localhost:${PORT}`);
});
