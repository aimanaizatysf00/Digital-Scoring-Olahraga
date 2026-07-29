const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.get('/tv', (req, res) => res.sendFile(path.join(__dirname, 'tv.html')));
app.get('/pengadil', (req, res) => res.sendFile(path.join(__dirname, 'pengadil.html')));
app.get('/juri', (req, res) => res.sendFile(path.join(__dirname, 'juri.html')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'tv.html')));

let state = {
  score: { red: 0, blue: 0 },
  round: 1,
  timer: { duration: 90, currentTime: 90, isRunning: false },
  matchInfo: {
    className: 'CLASS A',
    matchNo: '1',
    blueName: 'PESILAT BIRU',
    redName: 'PESILAT MERAH',
    blueTeam: 'KONTINJEN BIRU',
    redTeam: 'KONTINJEN MERAH'
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

  // MAKLUMAT MATCH & PESERTA
  socket.on('updateMatchDetails', (data) => {
    state.matchInfo = data;
    io.emit('updateState', state);
  });

  // TEKANAN JURI (3 JURI)
  socket.on('pressScore', (data) => {
    const now = Date.now();
    const { juriId, color, points } = data;

    // Hantar isyarat nyalakan lampu juri ke skrin TV
    io.emit('juriPressSignal', { juriId, color });

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

  socket.on('modifyScore', (data) => {
    state.score[data.color] += data.pts; 
    io.emit('updateState', state);
  });

  socket.on('togglePenalty', (data) => {
    const { color, code, pts } = data;
    const isActive = state.penalties[color][code];
    state.penalties[color][code] = !isActive;
    state.score[color] += isActive ? -pts : pts;
    io.emit('updateState', state);

    const p = state.penalties[color];
    if (p.A1 && p.A2 && p.T1 && p.T2 && p.P1 && p.P2) {
      io.emit('disqualifiedAlert', color);
    }
  });

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

  socket.on('setRound', (r) => {
    pauseTimer();
    state.round = r;
    state.timer.currentTime = state.timer.duration;
    state.penalties = {
      blue: { A1: false, A2: false, T1: false, T2: false, P1: false, P2: false },
      red: { A1: false, A2: false, T1: false, T2: false, P1: false, P2: false }
    };
    io.emit('updateState', state);
  });

  socket.on('resetScore', () => {
    pauseTimer();
    state.score = { red: 0, blue: 0 };
    state.round = 1;
    state.timer.currentTime = state.timer.duration;
    state.penalties = {
      blue: { A1: false, A2: false, T1: false, T2: false, P1: false, P2: false },
      red: { A1: false, A2: false, T1: false, T2: false, P1: false, P2: false }
    };
    io.emit('updateState', state);
  });

  socket.on('requestVerification', (data) => {
    verificationVotes = [];
    currentVerifyTarget = { type: data.type, color: data.color };
    io.emit('promptVerification', data);
  });

  socket.on('submitVerification', (data) => {
    verificationVotes.push(data);
    if (verificationVotes.length >= 3) {
      const sahCount = verificationVotes.filter(v => v.approved).length;
      let isApproved = sahCount >= 2; // Majoriti (2 daripada 3 juri)
      let statusStr = isApproved 
        ? `${currentVerifyTarget.type} ${currentVerifyTarget.color.toUpperCase()}: SAH ✅ (${sahCount}/3)` 
        : `${currentVerifyTarget.type} ${currentVerifyTarget.color.toUpperCase()}: TIDAK SAH ❌ (${sahCount}/3)`;
      
      io.emit('verificationResult', { text: statusStr, isApproved });
      verificationVotes = [];
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Server running on port ' + PORT));
