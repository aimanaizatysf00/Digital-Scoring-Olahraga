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
  },
  penaltyPoints: { blue: 0, red: 0 }, // Mengira jumlah mata penolakan hukuman
  logs: [] // Menyimpan log rekod perlawanan
};

let timerInterval = null;
let juriVotes = {}; 
let verificationVotes = [];
let currentVerifyTarget = { type: '', color: '' };
const TIME_WINDOW = 1500; 

// FUNGSI UTAMA: TULIS LOG
function addLog(message) {
  const m = Math.floor(state.timer.currentTime / 60).toString().padStart(2, '0');
  const s = (state.timer.currentTime % 60).toString().padStart(2, '0');
  const timestamp = `[R${state.round} - ${m}:${s}]`;
  
  const logEntry = `${timestamp} ${message}`;
  state.logs.unshift(logEntry); // Tambah log baharu di atas sekali
  io.emit('newLog', logEntry);
}

// FUNGSI PENENTUAN PEMENANG AUTOMATIK JIKA SERI
function calculateWinner() {
  const blueScore = state.score.blue;
  const redScore = state.score.red;

  let winner = 'DRAW';
  let reason = '';

  if (blueScore > redScore) {
    winner = 'blue';
    reason = 'Kemenangan Mata Semasa';
  } else if (redScore > blueScore) {
    winner = 'red';
    reason = 'Kemenangan Mata Semasa';
  } else {
    // === APABILA MARKAH SERI (DRAW) ===
    // Penilaian berdasarkan Total Penolakan Hukuman Paling Sedikit
    const blueDeductions = state.penaltyPoints.blue;
    const redDeductions = state.penaltyPoints.red;

    if (blueDeductions < redDeductions) {
      winner = 'blue';
      reason = `Penolakan Mata Hukuman Lebih Sedikit (-${blueDeductions} berbanding -${redDeductions})`;
    } else if (redDeductions < blueDeductions) {
      winner = 'red';
      reason = `Penolakan Mata Hukuman Lebih Sedikit (-${redDeductions} berbanding -${blueDeductions})`;
    } else {
      winner = 'DRAW';
      reason = 'Markah dan Jumlah Hukuman Sama Seri';
    }
  }

  addLog(`🏁 PERLAWANAN TAMAT! Pemenang: ${winner.toUpperCase()} (${reason})`);

  return {
    winner: winner,
    blueScore: blueScore,
    redScore: redScore,
    bluePenalties: state.penaltyPoints.blue,
    redPenalties: state.penaltyPoints.red,
    reason: reason
  };
}

// FUNGSI MULA PEMASA
function startTimer() {
  if (timerInterval) clearInterval(timerInterval);

  state.timer.isRunning = true;
  addLog('▶️ Masa Dimulakan');
  io.emit('updateState', state);

  timerInterval = setInterval(() => {
    if (state.timer.currentTime > 0) {
      state.timer.currentTime--;
      io.emit('updateState', state);
    } else {
      // MASA TAMAT
      clearInterval(timerInterval);
      timerInterval = null;
      state.timer.isRunning = false;
      io.emit('updateState', state);

      const result = calculateWinner();
      io.emit('matchEndedNotification', result);
    }
  }, 1000);
}

// FUNGSI PAUSE PEMASA
function pauseTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  if(state.timer.isRunning) addLog('⏸️ Masa Dihentikan');
  state.timer.isRunning = false;
  io.emit('updateState', state);
}

// INTERAKSI SOCKET
io.on('connection', (socket) => {
  socket.emit('updateState', state);

  // KAWALAN MASA
  socket.on('controlTimer', (action) => {
    if (action === 'start' && state.timer.currentTime > 0 && !state.timer.isRunning) {
      startTimer();
    } else if (action === 'pause') {
      pauseTimer();
    }
  });

  socket.on('setTimerDuration', (seconds) => {
    pauseTimer();
    state.timer.duration = seconds;
    state.timer.currentTime = seconds;
    addLog(`⏱️ Durasi masa ditetapkan kepada ${seconds} saat`);
    io.emit('updateState', state);
  });

  socket.on('setRound', (r) => {
    pauseTimer();
    state.round = r;
    state.timer.currentTime = state.timer.duration;
    addLog(`🔔 Pusingan Ke-${r} Dimulakan`);
    io.emit('updateState', state);
  });

  socket.on('updateMatchDetails', (data) => {
    state.matchInfo = data;
    addLog(`📝 Info Perlawanan Dikemaskini: ${data.blueName} vs ${data.redName}`);
    io.emit('updateState', state);
  });

  // TEKAN MARKAH JURI
  socket.on('pressScore', (data) => {
    const now = Date.now();
    const juriId = String(data.juriId);
    const { color, points } = data;

    io.emit('juriPressSignal', { elementId: `${color}_juri_${juriId}`, color, juriId, points });

    const key = `${color}_${points}`;
    if (!juriVotes[key]) juriVotes[key] = [];

    juriVotes[key] = juriVotes[key].filter(v => (now - v.time) <= TIME_WINDOW);

    const existingVoteIndex = juriVotes[key].findIndex(v => v.juriId === juriId);
    if (existingVoteIndex !== -1) {
      juriVotes[key][existingVoteIndex].time = now;
    } else {
      juriVotes[key].push({ juriId, time: now });
    }

    const uniqueJudges = new Set(juriVotes[key].map(v => v.juriId));

    if (uniqueJudges.size >= 2) {
      state.score[color] += Number(points);
      const jenisSerangan = Number(points) === 1 ? 'Pukulan (+1)' : 'Tendangan (+2)';
      addLog(`🎯 SAH! 2/3 Juri menekan ${jenisSerangan} untuk ${color.toUpperCase()}`);
      
      juriVotes[key] = [];
      io.emit('updateState', state);
    }
  });

  // MODIFIKASI MARKAH MANUAL (PENGADIL)
  socket.on('modifyScore', (data) => {
    state.score[data.color] += data.pts;
    if (state.score[data.color] < 0) state.score[data.color] = 0;
    addLog(`✏️ Pelarasan Markah Manual ${data.color.toUpperCase()}: ${data.pts > 0 ? '+' : ''}${data.pts}`);
    io.emit('updateState', state);
  });

  // HUKUMAN MANUAL (PENGADIL)
  socket.on('togglePenalty', (data) => {
    const { color, code, pts } = data;
    const isActive = state.penalties[color][code];
    state.penalties[color][code] = !isActive;
    
    if (!isActive) {
      state.score[color] += pts; // pts dalam nilai negatif (contoh: -1, -2, -5)
      state.penaltyPoints[color] += Math.abs(pts); // Tambah jumlah mata penolakan
      addLog(`⚠️ Hukuman Diberi kepada ${color.toUpperCase()}: ${code} (${pts} mata)`);
    } else {
      state.score[color] -= pts;
      state.penaltyPoints[color] -= Math.abs(pts);
      addLog(`🔄 Hukuman Dibatalkan untuk ${color.toUpperCase()}: ${code}`);
    }

    if (state.score[color] < 0) state.score[color] = 0;
    io.emit('updateState', state);
  });

  // PUBLISH PEMENANG KE TV
  socket.on('publishWinnerToTV', () => {
    const result = calculateWinner();
    io.emit('showWinnerOnTV', result);
  });

  // RESET
  socket.on('resetScore', () => {
    pauseTimer();
    state.score = { red: 0, blue: 0 };
    state.round = 1;
    state.timer.currentTime = state.timer.duration;
    state.penaltyPoints = { blue: 0, red: 0 };
    state.penalties = {
      blue: { A1: false, A2: false, T1: false, T2: false, P1: false, P2: false },
      red: { A1: false, A2: false, T1: false, T2: false, P1: false, P2: false }
    };
    state.logs = [];
    addLog('🔄 Sistem Diresetkan Semula');
    io.emit('updateState', state);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Server running on port ' + PORT));
