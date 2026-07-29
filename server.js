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

// DATA STATE UTAMA
let state = {
  score: { red: 0, blue: 0 },
  round: 1,
  timer: {
    duration: 90,     // Default 1:30 (90 saat)
    currentTime: 90,  
    isRunning: false
  },
  penalties: {
    blue: { A1: false, A2: false, T1: false, T2: false, P1: false, P2: false },
    red: { A1: false, A2: false, T1: false, T2: false, P1: false, P2: false }
  }
};

let timerInterval = null;
let juriVotes = {}; 
let verificationVotes = [];
let currentVerifyTarget = { type: '', color: '' };
const TIME_WINDOW = 1500;

// LOGIK PEMASA (TIMER)
function startTimer() {
  if (timerInterval) clearInterval(timerInterval);
  state.timer.isRunning = true;
  
  timerInterval = setInterval(() => {
    if (state.timer.currentTime > 0) {
      state.timer.currentTime -= 1;
      io.emit('updateState', state);
    } else {
      clearInterval(timerInterval);
      state.timer.isRunning = false;
      io.emit('updateState', state);
    }
  }, 1000);
}

function pauseTimer() {
  if (timerInterval) clearInterval(timerInterval);
  state.timer.isRunning = false;
  io.emit('updateState', state);
}

io.on('connection', (socket) => {
  socket.emit('updateState', state);

  // MATA DARI JURI (3/3 SAMA)
  socket.on('pressScore', (data) => {
    const now = Date.now();
    const { juriId, color, points } = data;
    const key = color + '_' + points;
    
    if (!juriVotes[key]) juriVotes[key] = [];
    juriVotes[key].push({ juriId, time: now });
    
    juriVotes[key] = juriVotes[key].filter(v => (now - v.time) <= TIME_WINDOW);
    const uniqueJudges = new Set(juriVotes[key].map(v => v.juriId));

    if (uniqueJudges.size >= 3) {
      state.score[color] += points;
      juriVotes[key] = [];
      io.emit('updateState', state);
    }
  });

  // TAMBAH / TOLAK MARKAH MANUAL
  socket.on('modifyScore', (data) => {
    const { color, pts } = data;
    state.score[color] += pts; 
    io.emit('updateState', state);
  });

  // TOGGLE HUKUMAN / PENALTI (ON / OFF)
  socket.on('togglePenalty', (data) => {
    const { color, code, pts } = data;
    const isCurrentlyActive = state.penalties[color][code];

    if (!isCurrentlyActive) {
      // AKTIFKAN PENALTI -> TOLAK MARKAH
      state.penalties[color][code] = true;
      state.score[color] += pts; 
    } else {
      // PADAMKAN PENALTI -> PULANGKAN MARKAH BALIK
      state.penalties[color][code] = false;
      state.score[color] -= pts; 
    }

    io.emit('updateState', state);

    // Semak Disqualified (Semua 6 Aktif)
    const p = state.penalties[color];
    if (p.A1 && p.A2 && p.T1 && p.T2 && p.P1 && p.P2) {
      io.emit('disqualifiedAlert', color);
    }
  });

  // KAWALAN TIMER
  socket.on('controlTimer', (action) => {
    if (action === 'start') startTimer();
    if (action === 'pause') pauseTimer();
  });

  socket.on('setTimerDuration', (seconds) => {
    pauseTimer();
    state.timer.duration = seconds;
    state.timer.currentTime = seconds;
    io.emit('updateState', state);
  });

  // TUKAR PUSINGAN (AUTO-RESET PENALTI & TIMER)
  socket.on('setRound', (r) => {
    pauseTimer();
    state.round = r;
    state.timer.currentTime = state.timer.duration; // Reset masa mengikut tetapan duration
    state.penalties = {
      blue: { A1: false, A2: false, T1: false, T2: false, P1: false, P2: false },
      red: { A1: false, A2: false, T1: false, T2: false, P1: false, P2: false }
    };
    io.emit('updateState', state);
  });

  // RESET KESELURUHAN
  socket.on('resetScore', () => {
    pauseTimer();
    state = {
      score: { red: 0, blue: 0 },
      round: 1,
      timer: {
        duration: 90,
        currentTime: 90,
        isRunning: false
      },
      penalties: {
        blue: { A1: false, A2: false, T1: false, T2: false, P1: false, P2: false },
        red: { A1: false, A2: false, T1: false, T2: false, P1: false, P2: false }
      }
    };
    io.emit('updateState', state);
    io.emit('verificationResult', { text: 'SISTEM DIRESET', isApproved: false });
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
        statusStr = currentVerifyTarget.type + " " + currentVerifyTarget.color.toUpperCase() + ": TIDAK SEBULAT SUARA";
      }

      io.emit('verificationResult', { text: statusStr, isApproved: isApproved });
      verificationVotes = [];
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Server running on port ' + PORT));
