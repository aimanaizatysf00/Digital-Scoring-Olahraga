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
const TIME_WINDOW = 1500; // 1.5 saat tetingkap masa penekanan serentak

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

  // PENERIMAAN MARKAH DARI PANEL JURI
  socket.on('pressScore', (data) => {
    const now = Date.now();
    const juriId = String(data.juriId);
    const { color, points } = data;

    // 1. Hantar isyarat untuk menyalakan lampu indikator Juri di TV
    const juriElementId = `${color}_juri_${juriId}`;
    io.emit('juriPressSignal', { 
      elementId: juriElementId,
      color: color,
      juriId: juriId,
      points: points 
    });

    // 2. Semakan keputusan majoriti (2 daripada 3 Juri)
    const key = `${color}_${points}`;
    if (!juriVotes[key]) juriVotes[key] = [];

    // Tapis undian yang telah tamat tempoh 1.5 saat
    juriVotes[key] = juriVotes[key].filter(v => (now - v.time) <= TIME_WINDOW);

    // Kemaskini masa sekiranya Juri sama menekan butang berturut-turut
    const existingVoteIndex = juriVotes[key].findIndex(v => v.juriId === juriId);
    if (existingVoteIndex !== -1) {
      juriVotes[key][existingVoteIndex].time = now;
    } else {
      juriVotes[key].push({ juriId, time: now });
    }

    // Kira jumlah Juri unik yang menekan
    const uniqueJudges = new Set(juriVotes[key].map(v => v.juriId));

    // Jika sekurang-kurangnya 2 Juri menekan dalam tetingkap 1.5s
    if (uniqueJudges.size >= 2) {
      state.score[color] += Number(points);
      juriVotes[key] = []; // Reset pusingan undian
      io.emit('updateState', state); // Kemaskini skrin TV
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
      let isApproved = sahCount >= 2;
      const { type, color } = currentVerifyTarget;

      let statusStr = "";

      if (isApproved) {
        statusStr = `${type} ${color.toUpperCase()}: SAH ✅ (${sahCount}/3)`;

        if (type === 'AMARAN') {
          if (!state.penalties[color].A1) {
            state.penalties[color].A1 = true;
          } else if (!state.penalties[color].A2) {
            state.penalties[color].A2 = true;
          }
        } 
        else if (type === 'TEGURAN') {
          if (!state.penalties[color].T1) {
            state.penalties[color].T1 = true;
            state.score[color] -= 1;
          } else if (!state.penalties[color].T2) {
            state.penalties[color].T2 = true;
            state.score[color] -= 2;
          }
        } 
        else if (type === 'PERINGATAN') {
          if (!state.penalties[color].P1) {
            state.penalties[color].P1 = true;
            state.score[color] -= 5;
          } else if (!state.penalties[color].P2) {
            state.penalties[color].P2 = true;
            state.score[color] -= 10;
          }
        }

        const p = state.penalties[color];
        if (p.A1 && p.A2 && p.T1 && p.T2 && p.P1 && p.P2) {
          io.emit('disqualifiedAlert', color);
        }

      } else {
        statusStr = `${type} ${color.toUpperCase()}: TIDAK SAH ❌ (${sahCount}/3)`;
      }

      io.emit('updateState', state);
      io.emit('verificationResult', { text: statusStr, isApproved });
      verificationVotes = [];
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Server running on port ' + PORT));
