JavaScript
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Tetapkan folder public untuk fail statik
app.use(express.static(path.join(__dirname, 'public')));

// LALUAN URL KHAS (ROUTES)
app.get('/tv', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'tv.html'));
});

app.get('/pengadil', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pengadil.html'));
});

app.get('/juri', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'juri.html'));
});

// Route asas jika orang buka link utama terus
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'tv.html'));
});

// LOGIK SCORING
let score = { red: 0, blue: 0 };
let juriVotes = { red: [], blue: [] };
const TIME_WINDOW = 1500;

io.on('connection', (socket) => {
  socket.emit('updateScore', score);

  socket.on('pressScore', (data) => {
    const now = Date.now();
    const color = data.color;
    
    if (!juriVotes[color]) juriVotes[color] = [];
    
    juriVotes[color].push({ juriId: data.juriId, time: now });
    juriVotes[color] = juriVotes[color].filter(v => (now - v.time) <= TIME_WINDOW);
    
    const uniqueJudges = new Set(juriVotes[color].map(v => v.juriId));
    
    if (uniqueJudges.size >= 2) {
      score[color]++;
      juriVotes[color] = [];
      io.emit('updateScore', score);
      io.emit('logMessage', `MATA +1 UNTUK ${color.toUpperCase()}`);
    }
  });

  socket.on('penalty', (color) => {
    if (score[color] > 0) score[color]--;
    io.emit('updateScore', score);
    io.emit('logMessage', `PENALTI: TOLAK MATA ${color.toUpperCase()}`);
  });

  socket.on('resetScore', () => {
    score = { red: 0, blue: 0 };
    io.emit('updateScore', score);
    io.emit('logMessage', 'SKOR DIRESET');
  });

  socket.on('requestVerification', (type) => {
    io.emit('promptVerification', type);
  });

  socket.on('submitVerification', (data) => {
    io.emit('logMessage', `Juri ${data.juriId}: ${data.approved ? 'SETUJU' : 'TIDAK SETUJU'}`);
  });
});

// Render perlukan PORT dari process.env.PORT
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server berjalan di port ${PORT}`));
