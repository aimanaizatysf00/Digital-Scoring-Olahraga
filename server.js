const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// PENGELAYARAN FAIL HTML
app.get('/tv', (req, res) => res.sendFile(path.join(__dirname, 'tv.html')));
app.get('/pengadil', (req, res) => res.sendFile(path.join(__dirname, 'pengadil.html')));
app.get('/juri', (req, res) => res.sendFile(path.join(__dirname, 'juri.html')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'tv.html')));

// LOGIK MATA & UNDIAN
let score = { red: 0, blue: 0 };
let juriVotes = {}; 
let verificationVotes = [];
let currentVerifyTarget = { type: '', color: '' };
const TIME_WINDOW = 1500;

io.on('connection', (socket) => {
  socket.emit('updateScore', score);

  socket.on('pressScore', (data) => {
    const now = Date.now();
    const { juriId, color, points } = data;
    const key = color + '_' + points;
    
    if (!juriVotes[key]) juriVotes[key] = [];
    juriVotes[key].push({ juriId, time: now });
    
    juriVotes[key] = juriVotes[key].filter(v => (now - v.time) <= TIME_WINDOW);
    const uniqueJudges = new Set(juriVotes[key].map(v => v.juriId));

    if (uniqueJudges.size >= 3) {
      score[color] += points;
      juriVotes[key] = [];
      io.emit('updateScore', score);
    }
  });

  socket.on('modifyScore', (data) => {
    const { color, pts } = data;
    score[color] = Math.max(0, score[color] + pts);
    io.emit('updateScore', score);
  });

  socket.on('resetScore', () => {
    score = { red: 0, blue: 0 };
    io.emit('updateScore', score);
    io.emit('verificationResult', { text: 'MARKAH DIRESET', isApproved: false });
  });

  socket.on('requestVerification', (data) => {
    verificationVotes = [];
    currentVerifyTarget = { type: data.type, color: data.color };
    io.emit('promptVerification', data);
  });

  socket.on('submitVerification', (data) => {
    verificationVotes.push(data);
    
    if (verificationVotes.length >= 3) {
      const sahCount = verificationVotes.filter(v => v.approved === true).length;
      const xSahCount = verificationVotes.filter(v => v.approved === false).length;
      
      let isApproved = false;
      let statusStr = "";

      if (sahCount === 3) {
        isApproved = true;
        statusStr = currentVerifyTarget.type + " " + currentVerifyTarget.color.toUpperCase() + ": SAH ✅";
      } else if (xSahCount === 3) {
        isApproved = false;
        statusStr = currentVerifyTarget.type + " " + currentVerifyTarget.color.toUpperCase() + ": TIDAK SAH ❌";
      } else {
        isApproved = false;
        statusStr = currentVerifyTarget.type + " " + currentVerifyTarget.color.toUpperCase() + ": TIDAK SEBULAT SUARA (Sah: " + sahCount + ", X-Sah: " + xSahCount + ")";
      }

      io.emit('verificationResult', { text: statusStr, isApproved: isApproved });
      verificationVotes = [];
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Server running on port ' + PORT));
