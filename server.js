const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(express.static(__dirname));

// Routing Fail Web
app.get('/', (req, res) => res.sendFile(__dirname + '/pengadil.html'));
app.get('/tv', (req, res) => res.sendFile(__dirname + '/tv.html'));
app.get('/juri', (req, res) => res.sendFile(__dirname + '/juri.html'));

// KEADAAN ASAL SISTEM (STATE GLOBAL)
let state = {
  timer: { currentTime: 90, duration: 90, isRunning: false },
  round: 1,
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
  totalPenalties: {
    blue: { A1: 0, A2: 0, T1: 0, T2: 0, P1: 0, P2: 0 },
    red: { A1: 0, A2: 0, T1: 0, T2: 0, P1: 0, P2: 0 }
  },
  stats: {
    blue: { pukulan: 0, tendangan: 0, jatuhan: 0 },
    red: { pukulan: 0, tendangan: 0, jatuhan: 0 }
  },
  winnerData: null
};

let timerInterval = null;
let currentVerification = null; 
let pendingScores = []; 
const VERIFICATION_WINDOW = 2000; // Sela masa 2 saat untuk juri

function addLog(text) {
  const timestamp = new Date().toLocaleTimeString('ms-MY', { hour12: false });
  io.emit('newLog', `[${timestamp}] ${text}`);
}

// AUTOMATIK HUKUMAN BERPERINGKAT
function applyPenalties(color, penaltyType) {
  if (!state.penalties[color]) {
    state.penalties[color] = { A1: false, A2: false, T1: false, T2: false, P1: false, P2: false };
  }

  const p = state.penalties[color];
  let appliedCode = '';
  let pointsDeducted = 0;
  let isDisqualified = false;

  const type = penaltyType.toUpperCase();

  if (type === 'AMARAN') {
    if (!p.A1) { p.A1 = true; appliedCode = 'A1'; pointsDeducted = 0; }
    else if (!p.A2) { p.A2 = true; appliedCode = 'A2'; pointsDeducted = 0; }
    else { return applyPenalties(color, 'TEGURAN'); }
  } else if (type === 'TEGURAN') {
    if (!p.T1) { p.T1 = true; appliedCode = 'T1'; pointsDeducted = 1; }
    else if (!p.T2) { p.T2 = true; appliedCode = 'T2'; pointsDeducted = 2; }
    else { return applyPenalties(color, 'PERINGATAN'); }
  } else if (type === 'PERINGATAN') {
    if (!p.P1) { p.P1 = true; appliedCode = 'P1'; pointsDeducted = 5; }
    else if (!p.P2) { p.P2 = true; appliedCode = 'P2'; pointsDeducted = 10; }
    else { isDisqualified = true; appliedCode = 'DQ'; }
  }

  if (appliedCode && appliedCode !== 'DQ') {
    state.totalPenalties[color][appliedCode] += 1;
  }

  if (pointsDeducted > 0) {
    state.score[color] -= pointsDeducted;
    state.penaltyPoints[color] += pointsDeducted;
  }

  return { appliedCode, pointsDeducted, isDisqualified };
}

// LOGIK KIRAAN PEMENANG (PENALTI & TEKNIK)
function calculateWinner() {
  const blueScore = state.score.blue;
  const redScore = state.score.red;

  // 1. Semakan Markah Utama
  if (blueScore > redScore) return { winner: 'blue', blueScore, redScore, reason: `Mata Akhir Tertinggi (${blueScore} - ${redScore})` };
  if (redScore > blueScore) return { winner: 'red', blueScore, redScore, reason: `Mata Akhir Tertinggi (${redScore} - ${blueScore})` };

  // 2. Semakan Beban Penalti (Beban penalti paling rendah dikira menang)
  const getPenaltyWeight = (color) => {
    const tp = state.totalPenalties[color] || {};
    return (tp.P2 || 0) * 10 + (tp.P1 || 0) * 5 + (tp.T2 || 0) * 2 + (tp.T1 || 0) * 1 + (tp.A2 || 0) * 0.5 + (tp.A1 || 0) * 0.1;
  };

  const bluePenaltyWeight = getPenaltyWeight('blue');
  const redPenaltyWeight = getPenaltyWeight('red');

  if (bluePenaltyWeight < redPenaltyWeight) return { winner: 'blue', blueScore, redScore, reason: 'Markah Seri - Menang Hukuman/Penalti Lebih Sedikit' };
  if (redPenaltyWeight < bluePenaltyWeight) return { winner: 'red', blueScore, redScore, reason: 'Markah Seri - Menang Hukuman/Penalti Lebih Sedikit' };

  // 3. Semakan Statistik Teknik (Jatuhan -> Tendangan -> Pukulan)
  const bStats = state.stats.blue;
  const rStats = state.stats.red;

  if (bStats.jatuhan !== rStats.jatuhan) {
    const winner = bStats.jatuhan > rStats.jatuhan ? 'blue' : 'red';
    return { winner, blueScore, redScore, reason: `Markah & Penalti Seri - Menang Jatuhan Terbanyak (${Math.max(bStats.jatuhan, rStats.jatuhan)})` };
  }
  if (bStats.tendangan !== rStats.tendangan) {
    const winner = bStats.tendangan > rStats.tendangan ? 'blue' : 'red';
    return { winner, blueScore, redScore, reason: `Markah & Penalti Seri - Menang Tendangan Terbanyak (${Math.max(bStats.tendangan, rStats.tendangan)})` };
  }
  if (bStats.pukulan !== rStats.pukulan) {
    const winner = bStats.pukulan > rStats.pukulan ? 'blue' : 'red';
    return { winner, blueScore, redScore, reason: `Markah & Penalti Seri - Menang Pukulan Terbanyak (${Math.max(bStats.pukulan, rStats.pukulan)})` };
  }

  return { winner: 'DRAW', blueScore, redScore, reason: 'Markah, Hukuman & Semua Statistik Teknik Seri' };
}

// SOCKET HANDLERS
io.on('connection', (socket) => {
  // Hantar data awal bila ada peranti baharu berhubung
  socket.emit('updateState', state);

  // --- KAWALAN PEMASA ---
  socket.on('controlTimer', (action) => {
    if (action === 'start' && !state.timer.isRunning) {
      clearInterval(timerInterval); // Elak pemasa berjalan ganda (double speed bug)
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
    clearInterval(timerInterval);
    state.timer.isRunning = false;
    state.timer.duration = Number(seconds);
    state.timer.currentTime = Number(seconds);
    addLog(`⏱️ Masa Disetkan ke ${seconds} saat`);
    io.emit('updateState', state);
  });

  socket.on('setRound', (roundNum) => {
    clearInterval(timerInterval);
    state.round = roundNum;
    state.penalties = {
      blue: { A1: false, A2: false, T1: false, T2: false, P1: false, P2: false },
      red:  { A1: false, A2: false, T1: false, T2: false, P1: false, P2: false }
    };
    state.timer.currentTime = state.timer.duration || 90;
    state.timer.isRunning = false;
    io.emit('updateState', state);
    addLog(`--- PUSINGAN ${roundNum} BERMULA ---`);
  });

  // --- KEMASKINI MAKLUMAT ---
  socket.on('updateMatchDetails', (data) => {
    state.matchInfo = { ...state.matchInfo, ...data };
    addLog(`📝 Maklumat Perlawanan Dikemaskini (Match #${state.matchInfo.matchNo})`);
    io.emit('updateState', state);
  });

  // --- LOGIK MAJORITI JURI ---
  socket.on('pressScore', (data) => {
    const juriId = Number(data.juriId);
    const color = String(data.color).toLowerCase();
    const points = Number(data.points);
    const now = Date.now();

    addLog(`🔘 Juri ${juriId} tekan +${points} (${color.toUpperCase()})`);
    io.emit('juriPressSignal', { juriId, color, points });

    // Tapis buffer melebihi 2 saat
    pendingScores = pendingScores.filter(item => (now - item.timestamp) <= VERIFICATION_WINDOW);

    const existingIndex = pendingScores.findIndex(
      item => item.juriId === juriId && item.color === color && item.points === points
    );

    if (existingIndex !== -1) {
      pendingScores[existingIndex].timestamp = now;
    } else {
      pendingScores.push({ juriId, color, points, timestamp: now });
    }

    const matchingPresses = pendingScores.filter(
      item => item.color === color && item.points === points
    );
    const uniqueJuriCount = new Set(matchingPresses.map(item => item.juriId)).size;

    // Sekurang-kurangnya 2 Juri Unik
    if (uniqueJuriCount >= 2) {
      state.score[color] += points;

      if (points === 1) state.stats[color].pukulan += 1;
      if (points === 2) state.stats[color].tendangan += 1;

      addLog(`✅ MATA SAH! +${points} untuk SUDUT ${color.toUpperCase()} (${uniqueJuriCount} Juri)`);

      pendingScores = pendingScores.filter(
        item => !(item.color === color && item.points === points)
      );
      io.emit('updateState', state);
    }
  });

  // --- HUKUMAN & SCORE MANUAL ---
  socket.on('togglePenalty', ({ color, code, pts }) => {
    const isActive = state.penalties[color][code];
    state.penalties[color][code] = !isActive;
    const penaltyVal = Math.abs(pts);

    if (!isActive) {
      state.score[color] += pts;
      state.penaltyPoints[color] += penaltyVal;
      state.totalPenalties[color][code] += 1;
      addLog(`⚠️ Hukuman Diberi [${color.toUpperCase()}]: ${code} (${pts} mata)`);
    } else {
      state.score[color] -= pts;
      state.penaltyPoints[color] -= penaltyVal;
      if (state.totalPenalties[color][code] > 0) state.totalPenalties[color][code] -= 1;
      addLog(`🔄 Hukuman Dibatalkan [${color.toUpperCase()}]: ${code}`);
    }

    if (state.penaltyPoints[color] < 0) state.penaltyPoints[color] = 0;
    io.emit('updateState', state);
  });

  socket.on('modifyScore', ({ color, pts }) => {
    state.score[color] += pts;
    addLog(`✏️ Markah Manual [${color.toUpperCase()}]: ${pts > 0 ? '+' : ''}${pts}`);
    io.emit('updateState', state);
  });

  // --- SEMAKAN UNDIAN JURI (VERIFICATION) ---
  socket.on('requestVerification', (data) => {
    currentVerification = { type: data.type, color: data.color, votes: {} };
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
      const color = currentVerification.color;
      const type = currentVerification.type.toUpperCase();

      if (isAccepted) {
        if (type === 'JATUHAN') {
          state.score[color] += 3;
          state.stats[color].jatuhan += 1;
          addLog(`✅ Jatuhan SAH (+3 Mata [${color.toUpperCase()}])`);
          io.emit('verificationResult', { type: currentVerification.type, color, isApproved: true, text: `JATUHAN SAH (+3 MATA)` });
        } else if (['AMARAN', 'TEGURAN', 'PERINGATAN'].includes(type)) {
          const penResult = applyPenalties(color, type);
          if (penResult.isDisqualified) {
            addLog(`❌ DISQUALIFIED: Sudut ${color.toUpperCase()} Dibatalkan (DQ)`);
            io.emit('disqualifiedAlert', color);
          } else {
            addLog(`⚠️ ${type} SAH (${penResult.appliedCode}): -${penResult.pointsDeducted} Mata [${color.toUpperCase()}]`);
            io.emit('verificationResult', { type: currentVerification.type, color, isApproved: true, text: `${type} SAH (${penResult.appliedCode}) -${penResult.pointsDeducted} MATA` });
          }
        } else {
          io.emit('verificationResult', { type: currentVerification.type, color, isApproved: true, text: `${currentVerification.type} - SAH (${yesVotes}/3)` });
        }
      } else {
        addLog(`❌ Semakan ${type} TIDAK SAH [${color.toUpperCase()}]`);
        io.emit('verificationResult', { type: currentVerification.type, color, isApproved: false, text: `${currentVerification.type} - TIDAK SAH (${3 - yesVotes}/3)` });
      }

      currentVerification = null;
      io.emit('updateState', state);
    }
  });

  // --- PEMENANG & RESET ---
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
      red:  { A1: false, A2: false, T1: false, T2: false, P1: false, P2: false }
    };
    state.totalPenalties = {
      blue: { A1: 0, A2: 0, T1: 0, T2: 0, P1: 0, P2: 0 },
      red:  { A1: 0, A2: 0, T1: 0, T2: 0, P1: 0, P2: 0 }
    };
    state.stats = {
      blue: { pukulan: 0, tendangan: 0, jatuhan: 0 },
      red:  { pukulan: 0, tendangan: 0, jatuhan: 0 }
    };
    state.winnerData = null;
    currentVerification = null;
    pendingScores = [];
    addLog(`🔄 Sistem Direset Keseluruhan`);
    io.emit('updateState', state);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server Silat Berjalan di port ${PORT}`));
