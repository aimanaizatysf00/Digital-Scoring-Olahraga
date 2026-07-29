JavaScript
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let score = { red: 0, blue: 0 };
let juriVotes = { red: [], blue: [] };
const TIME_WINDOW = 1500;

io.on('connection', (socket) => {
  socket.emit('updateScore', score);

  socket.on('pressScore', (data) => {
    const now = Date.now();
    const color = data.color;
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

  socket.on('requestVerification', (type) => {
    io.emit('promptVerification', type);
  });

  socket.on('submitVerification', (approved) => {
    io.emit('logMessage', approved ? 'Pengesahan: DITERIMA' : 'Pengesahan: DITOLAK');
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server berjalan di port ${PORT}`));
