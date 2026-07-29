const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Supaya fail html/css/js diproses tanpa error
app.use(express.static(__dirname));

// Routing asas supaya tak keluar error "Cannot GET /"
app.get('/', (req, res) => res.sendFile(__dirname + '/pengadil.html'));
app.get('/tv', (req, res) => res.sendFile(__dirname + '/tv.html'));

// KEADAAN ASAL SISTEM (STATE)
let state = {
  timer: {
    currentTime: 90,
    duration: 90,
    isRunning: false
  },
  round: 1,
  matchDetails: {
    className: 'CLASS A',
    matchNo: '1',
    blueName: 'PESILAT BIRU',
    blueTeam: 'KONTINJEN BIRU',
    redName: 'PESILAT MERAH',
    redTeam: 'KONTINJEN MERAH'
  },
  score: { blue: 0, red: 0 },
  penaltyPoints: { blue: 0, red: 0 },
  penalties: {
    blue: { A1: false, A2: false, T1: false, T2: false, P1: false, P2: false },
    red: { A1: false, A2: false, T1: false, T2: false, P1: false, P2: false }
  },
  winnerData: null
};

let timerInterval = null;

function addLog(text) {
  const timestamp = new Date().toLocaleTimeString('ms-MY', { hour12: false });
  io.emit('newLog', `[${timestamp}]${text}`);
}

function calculateWinner() {
  const blueScore = state.score.blue;
  const redScore = state.score.red;
  const blueDeductions = state.penaltyPoints.blue;
  const redDeductions = state.penaltyPoints.red;

  let winner = 'DRAW';
  let reason = '';

  if (blueScore > redScore) {
    winner = 'blue';
    reason = 'Mata Akhir Tertinggi';
  } else if (redScore > blueScore) {
    winner = 'red';
    reason = 'Mata Akhir Tertinggi';
  } else {
    if (blueDeductions < redDeductions) {
      winner = 'blue';
      reason = `Markah Seri (${blueScore}-${redScore}), Biru Menang Hukuman Lebih Sedikit (-${blueDeductions} vs -${redDeductions})`;
    } else if (redDeductions < blueDeductions) {
      winner = 'red';
      reason = `Markah Seri (${blueScore}-${redScore}), Merah Menang Hukuman Lebih Sedikit (-${redDeductions} vs -${blueDeductions})`;
    } else {
      winner = 'DRAW';
      reason = `Markah (${blueScore}-${redScore}) & Hukuman (-${blueDeductions}) Sama Seri`;
    }
  }

  return { winner, blueScore, redScore, reason };
}

io.on('connection', (socket) => {
  socket.emit('updateState', state);

  socket.on('controlTimer', (action) => {
    if (action === 'start' && !state.timer.isRunning) {
      state.timer.isRunning = true;
      addLog(`▶️ Pemasa Dimulakan (Round ${state.round})`);
      
      timerInterval = setInterval(() => {
        if (state.timer.currentTime > 0) {
          state.timer.currentTime--;
          io.emit('updateState', state);
        } else {
          clearInterval(timerInterval);
          state.timer.isRunning = false;
          addLog(`⏱️ Masa Tamat untuk Round ${state.round}`);
          io.emit('updateState', state);
        }
      }, 1000);
    } else if (action === 'pause') {
      clearInterval(timerInterval);
      state.timer.isRunning = false;
      addLog(`⏸️ Pemasa Dihentikan`);
    }
    io.emit('updateState', state);
  });

  socket.on('setTimerDuration', (seconds) => {
    state.timer.duration = seconds;
    state.timer.currentTime = seconds;
    addLog(`⏱️ Masa Disetkan ke ${seconds} saat`);
    io.emit('updateState', state);
  });

  socket.on('setRound', (r) => {
    state.round = r;
    state.timer.currentTime = state.timer.duration;
    state.timer.isRunning = false;
    clearInterval(timerInterval);
    addLog(`🔄 Pusingan Ditukar ke Round ${r}`);
    io.emit('updateState', state);
  });

  socket.on('updateMatchDetails', (data) => {
    state.matchDetails = data;
    addLog(`📝 Maklumat Perlawanan Dikemaskini (Match #${data.matchNo})`);
    io.emit('updateState', state);
  });

  socket.on('togglePenalty', ({ color, code, pts }) => {
    const isActive = state.penalties[color][code];
    state.penalties[color][code] = !isActive;
    const penaltyVal = Math.abs(pts);

    if (!isActive) {
      state.score[color] += pts;
      state.penaltyPoints[color] += penaltyVal;
      addLog(`⚠️ Hukuman Diberi [${color.toUpperCase()}]: ${code} (${pts} mata)`);
    } else {
      state.score[color] -= pts;
      state.penaltyPoints[color] -= penaltyVal;
      addLog(`🔄 Hukuman Dibatalkan [${color.toUpperCase()}]:${code}`);
    }

    if (state.score[color] < 0) state.score[color] = 0;
    if (state.penaltyPoints[color] < 0) state.penaltyPoints[color] = 0;

    io.emit('updateState', state);
  });

  socket.on('modifyScore', ({ color, pts }) => {
    state.score[color] += pts;
    if (state.score[color] < 0) state.score[color] = 0;
    addLog(`✏️ Markah Manual [${color.toUpperCase()}]: ${pts > 0 ? '+' : ''}${pts}`);
    io.emit('updateState', state);
  });

  socket.on('requestVerification', (data) => {
    addLog(`🔍 Semakan Juri Dibuat: ${data.type} [${data.color.toUpperCase()}]`);
    io.emit('showVerificationOnTV', data);
  });

  socket.on('publishWinnerToTV', () => {
    const result = calculateWinner();
    state.winnerData = result;
    addLog(`🏆 PEMENANG DIISYTIHARKAN: ${result.winner.toUpperCase()} (${result.reason})`);
    io.emit('updateState', state);
    io.emit('showWinnerOnTV', result);
  });

  socket.on('resetScore', () => {
    clearInterval(timerInterval);
    state.timer.currentTime = state.timer.duration;
    state.timer.isRunning = false;
    state.round = 1;
    state.score = { blue: 0, red: 0 };
    state.penaltyPoints = { blue: 0, red: 0 };
    state.penalties = {
      blue: { A1: false, A2: false, T1: false, T2: false, P1: false, P2: false },
      red: { A1: false, A2: false, T1: false, T2: false, P1: false, P2: false }
    };
    state.winnerData = null;
    addLog(`🔄 Sistem Direset Keseluruhan`);
    io.emit('updateState', state);
  });
});

const PORT = 3000;
server.listen(PORT, () => console.log(`Server Silat Berjalan di http://localhost:${PORT}`));
