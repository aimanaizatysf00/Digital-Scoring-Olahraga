const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

// Routing Fail Web
app.get('/', (req, res) => res.sendFile(__dirname + '/pengadil.html'));
app.get('/tv', (req, res) => res.sendFile(__dirname + '/tv.html'));
app.get('/juri', (req, res) => res.sendFile(__dirname + '/juri.html'));

// KEADAAN ASAL SISTEM (STATE)
let state = {
  timer: { currentTime: 90, duration: 90, isRunning: false },
  round: 1,
  // Disesuaikan nama 'matchInfo' supaya serasi terus dengan tv.html
  matchInfo: {
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
let currentVerification = null; // Menyimpan status undian juri

function addLog(text) {
  const timestamp = new Date().toLocaleTimeString('ms-MY', { hour12: false });
  io.emit('newLog', `[${timestamp}] ${text}`);
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
      reason = `Markah Seri (${blueScore}-${redScore}), Menang Hukuman Lebih Sedikit`;
    } else if (redDeductions < blueDeductions) {
      winner = 'red';
      reason = `Markah Seri (${blueScore}-${redScore}), Menang Hukuman Lebih Sedikit`;
    } else {
      winner = 'DRAW';
      reason = `Markah & Hukuman Sama Seri`;
    }
  }

  return { winner, blueScore, redScore, reason };
}

io.on('connection', (socket) => {
  // Hantar state terkini sebaik sahaja mana-mana peranti (TV/Juri/Pengadil) bersambung
  socket.emit('updateState', state);

  // --- KAWALAN PEMASA (TIMER) ---
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

  // --- KEMASKINI MAKLUMAT PESERTA / MATCH ---
  socket.on('updateMatchDetails', (data) => {
    state.matchInfo = {
      className: data.className || state.matchInfo.className,
      matchNo: data.matchNo || state.matchInfo.matchNo,
      blueName: data.blueName || state.matchInfo.blueName,
      blueTeam: data.blueTeam || state.matchInfo.blueTeam,
      redName: data.redName || state.matchInfo.redName,
      redTeam: data.redTeam || state.matchInfo.redTeam
    };
    addLog(`📝 Maklumat Perlawanan Dikemaskini (Match #${state.matchInfo.matchNo})`);
    io.emit('updateState', state);
  });

  // --- LOGIK MAJORITI JURI (BERATURAN MASA / TIMED BUFFER) ---
let pendingScores = []; // Menyimpan rekod tekanan juri sementara
const VERIFICATION_WINDOW = 1500; // Sela masa kelulusan (1.5 saat)

socket.on('pressScore', ({ juriId, color, points }) => {
  const now = Date.now();

  // 1. Hantar signal visual lampu ke TV/Pengadil (supaya tahu Juri mana yang tekan)
  io.emit('juriPressSignal', { juriId, color, points });
  addLog(`🔘 [JURI ${juriId}] menekan +${points} (${color.toUpperCase()})`);

  // 2. Buang rekod tekanan juri yang sudah melepasi tempoh 1.5 saat
  pendingScores = pendingScores.filter(item => now - item.timestamp <= VERIFICATION_WINDOW);

  // 3. Semak sama ada juri yang sama sudah menekan jenis markah ini dalam buffer
  const existingIndex = pendingScores.findIndex(
    item => item.juriId === juriId && item.color === color && item.points === points
  );

  if (existingIndex !== -1) {
    // Kemaskini masa jika juri menekan butang yang sama semula
    pendingScores[existingIndex].timestamp = now;
  } else {
    // Masukkan rekod baru ke dalam buffer
    pendingScores.push({ juriId, color, points, timestamp: now });
  }

  // 4. Cari padanan (Berapa juri unik menekan color & points yang sama)
  const matchingPresses = pendingScores.filter(
    item => item.color === color && item.points === points
  );

  // 5. Syarat: Jika 2 atau lebih juri bersetuju
  if (matchingPresses.length >= 2) {
    // Tambah markah rasmi
    state.score[color] += points;
    addLog(`✅ MATA SAH! +${points} untuk SUDUT ${color.toUpperCase()} (Disokong oleh ${matchingPresses.length} Juri)`);

    // Bersihkan buffer bagi kategori ini supaya markah tidak bertambah secara berulang (double count)
    pendingScores = pendingScores.filter(
      item => !(item.color === color && item.points === points)
    );

    // Kemaskini keadaan papan markah (TV & Pengadil)
    io.emit('updateState', state);
  }
});

  // --- HUKUMAN & PENALTI ---
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
      addLog(`🔄 Hukuman Dibatalkan [${color.toUpperCase()}]: ${code}`);
    }

    if (state.score[color] < 0) state.score[color] = 0;
    if (state.penaltyPoints[color] < 0) state.penaltyPoints[color] = 0;

    io.emit('updateState', state);
  });

  // --- PELARASAN MARKAH MANUAL ---
  socket.on('modifyScore', ({ color, pts }) => {
    state.score[color] += pts;
    if (state.score[color] < 0) state.score[color] = 0;
    addLog(`✏️ Markah Manual [${color.toUpperCase()}]: ${pts > 0 ? '+' : ''}${pts}`);
    io.emit('updateState', state);
  });

  // --- SEMAKAN UNDIAN JURI (VERIFICATION) ---
  socket.on('requestVerification', (data) => {
    currentVerification = {
      type: data.type,
      color: data.color,
      votes: {}
    };
    addLog(`🔍 Semakan Juri Dibuat: ${data.type} [${data.color.toUpperCase()}]`);
    io.emit('promptVerification', data);
  });

  socket.on('submitVerification', ({ juriId, approved }) => {
    if (!currentVerification) return;
    
    currentVerification.votes[juriId] = approved;
    addLog(`🗳️ Undian Juri ${juriId}: ${approved ? 'SAH' : 'TAK SAH'}`);

    if (Object.keys(currentVerification.votes).length >= 3) {
      const yesVotes = Object.values(currentVerification.votes).filter(v => v === true).length;
      const isAccepted = yesVotes >= 2;

      const resultText = isAccepted ? `SAH (${yesVotes}/3)` : `TAK SAH (${3 - yesVotes}/3)`;

      addLog(`📢 Keputusan Undian ${currentVerification.type}: ${resultText}`);
      
      io.emit('verificationResult', {
        type: currentVerification.type,
        color: currentVerification.color,
        isApproved: isAccepted,
        text: `${currentVerification.type} - ${resultText}`
      });

      currentVerification = null;
    }
  });

  // --- PEMENANG, DISQUALIFIED & RESET ---
  socket.on('publishWinnerToTV', () => {
    const result = calculateWinner();
    state.winnerData = result;
    addLog(`🏆 PEMENANG DIISYTIHARKAN: ${result.winner.toUpperCase()} (${result.reason})`);
    io.emit('updateState', state);
    io.emit('showWinnerOnTV', result);
  });

  socket.on('disqualify', (color) => {
    addLog(`❌ DISQUALIFIED: Sudut ${color.toUpperCase()} Dibatalkan`);
    io.emit('disqualifiedAlert', color);
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
    currentVerification = null;
    addLog(`🔄 Sistem Direset Keseluruhan`);
    io.emit('updateState', state);
  });
});

const PORT = 3000;
server.listen(PORT, () => console.log(`Server Silat Berjalan di http://localhost:${PORT}`));
