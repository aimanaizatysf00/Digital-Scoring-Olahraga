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
  // Status paparan hukuman bagi pusingan semasa
  penalties: {
    blue: { A1: false, A2: false, T1: false, T2: false, P1: false, P2: false, DQ: false },
    red: { A1: false, A2: false, T1: false, T2: false, P1: false, P2: false, DQ: false }
  },
  // Rekod akumulasi/terkumpul hukuman dari Round 1 hingga pusingan akhir
  totalPenalties: {
    blue: { A1: 0, A2: 0, T1: 0, T2: 0, P1: 0, P2: 0 },
    red: { A1: 0, A2: 0, T1: 0, T2: 0, P1: 0, P2: 0 }
  },
  // Rekod statistik bilangan teknik bagi setiap sudut
  stats: {
    blue: { pukulan: 0, tendangan: 0, jatuhan: 0 },
    red: { pukulan: 0, tendangan: 0, jatuhan: 0 }
  },
  winnerData: null
};

let timerInterval = null;
let currentVerification = null; 

// LOGIK MAJORITI JURI (TIMED BUFFER)
let pendingScores = []; 
const VERIFICATION_WINDOW = 2000; // Sela masa 2.0 saat untuk pengesahan juri

function addLog(text) {
  const timestamp = new Date().toLocaleTimeString('ms-MY', { hour12: false });
  io.emit('newLog', `[${timestamp}] ${text}`);
}

// FUNGSI AUTOMATIK HUKUMAN BERPERINGKAT (DENGAN PEMOTONGAN RASMI & MARKAH NEGATIF)
function applyPenalties(color, penaltyType) {
  if (!state.penalties[color]) {
    state.penalties[color] = { A1: false, A2: false, T1: false, T2: false, P1: false, P2: false, DQ: false };
  }

  const p = state.penalties[color];
  let appliedCode = '';
  let pointsDeducted = 0;
  let isDisqualified = false;

  const rawType = String(penaltyType).toUpperCase().trim();
  let type = rawType;

  if (rawType.includes('RINGAN') || rawType.includes('AMARAN')) {
    type = 'AMARAN';
  } else if (rawType.includes('SEDERHANA') || rawType.includes('TEGURAN')) {
    type = 'TEGURAN';
  } else if (rawType.includes('BERAT') || rawType.includes('PERINGATAN')) {
    type = 'PERINGATAN';
  }

  if (type === 'AMARAN') {
    if (!p.A1) {
      p.A1 = true; appliedCode = 'A1'; pointsDeducted = 0;
    } else if (!p.A2) {
      p.A2 = true; appliedCode = 'A2'; pointsDeducted = 0;
    } else {
      return applyPenalties(color, 'TEGURAN');
    }
  } else if (type === 'TEGURAN') {
    if (!p.T1) {
      p.T1 = true; appliedCode = 'T1'; pointsDeducted = 1;
    } else if (!p.T2) {
      p.T2 = true; appliedCode = 'T2'; pointsDeducted = 2;
    } else {
      return applyPenalties(color, 'PERINGATAN');
    }
  } else if (type === 'PERINGATAN') {
    if (!p.P1) {
      p.P1 = true; appliedCode = 'P1'; pointsDeducted = 5;
    } else if (!p.P2) {
      p.P2 = true; appliedCode = 'P2'; pointsDeducted = 10;
    } else {
      isDisqualified = true;
      appliedCode = 'DQ';
    }
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

// LOGIK KIRAAN PEMENANG TERBAHARU
function calculateWinner() {
  const blueScore = state.score.blue;
  const redScore = state.score.red;

  // 1. SEMAKAN JIKA ADA DISKUALIFIKASI (DQ)
  if (state.penalties.blue && state.penalties.blue.DQ) {
    return { winner: 'red', blueScore, redScore, reason: 'Kemenangan Diskualifikasi (DQ) Lawan' };
  }
  if (state.penalties.red && state.penalties.red.DQ) {
    return { winner: 'blue', blueScore, redScore, reason: 'Kemenangan Diskualifikasi (DQ) Lawan' };
  }

  // 2. TOTAL MARKAH AKHIR
  if (blueScore > redScore) {
    return { winner: 'blue', blueScore, redScore, reason: `Mata Akhir Tertinggi (${blueScore} - ${redScore})` };
  }
  if (redScore > blueScore) {
    return { winner: 'red', blueScore, redScore, reason: `Mata Akhir Tertinggi (${redScore} - ${blueScore})` };
  }

  // 3. BEBAN PENALTI TERKUMPUL
  const calculatePenaltyWeight = (color) => {
    const tp = state.totalPenalties[color] || {};
    let weight = 0;
    weight += (tp.P2 || 0) * 10;
    weight += (tp.P1 || 0) * 5;
    weight += (tp.T2 || 0) * 2;
    weight += (tp.T1 || 0) * 1;
    weight += (tp.A2 || 0) * 0.5;
    weight += (tp.A1 || 0) * 0.1;
    return weight;
  };

  const bluePenaltyWeight = calculatePenaltyWeight('blue');
  const redPenaltyWeight = calculatePenaltyWeight('red');

  if (bluePenaltyWeight < redPenaltyWeight) {
    return { winner: 'blue', blueScore, redScore, reason: 'Markah Seri - Menang Hukuman/Penalti Lebih Sedikit' };
  } 
  if (redPenaltyWeight < bluePenaltyWeight) {
    return { winner: 'red', blueScore, redScore, reason: 'Markah Seri - Menang Hukuman/Penalti Lebih Sedikit' };
  }

  // 4. STATISTIK TEKNIK
  const bStats = state.stats.blue;
  const rStats = state.stats.red;

  if (bStats.jatuhan !== rStats.jatuhan) {
    const winner = bStats.jatuhan > rStats.jatuhan ? 'blue' : 'red';
    const count = winner === 'blue' ? bStats.jatuhan : rStats.jatuhan;
    return { winner, blueScore, redScore, reason: `Markah & Penalti Seri - Menang Jatuhan Terbanyak (${count})` };
  }

  if (bStats.tendangan !== rStats.tendangan) {
    const winner = bStats.tendangan > rStats.tendangan ? 'blue' : 'red';
    const count = winner === 'blue' ? bStats.tendangan : rStats.tendangan;
    return { winner, blueScore, redScore, reason: `Markah & Penalti Seri - Menang Tendangan Terbanyak (${count})` };
  }

  if (bStats.pukulan !== rStats.pukulan) {
    const winner = bStats.pukulan > rStats.pukulan ? 'blue' : 'red';
    const count = winner === 'blue' ? bStats.pukulan : rStats.pukulan;
    return { winner, blueScore, redScore, reason: `Markah & Penalti Seri - Menang Pukulan Terbanyak (${count})` };
  }

  return { winner: 'DRAW', blueScore, redScore, reason: 'Markah, Hukuman & Semua Statistik Teknik Seri' };
}

// FUNGSI PROSES DISKUALIFIKASI (DQ)
function triggerDisqualification(color) {
  const dqColor = String(color).toLowerCase();
  const winningColor = (dqColor === 'blue' || dqColor === 'biru') ? 'red' : 'blue';
  
  if (state.penalties[dqColor]) {
    state.penalties[dqColor].DQ = true;
  }

  state.winnerData = {
    winner: winningColor,
    disqualified: dqColor,
    reason: `SUDUT ${dqColor.toUpperCase()} DI-DISKUALIFIKASI (DQ)`
  };

  addLog(`❌ DISQUALIFIED: Sudut ${dqColor.toUpperCase()} Dibatalkan (DQ)!`);
  
  io.emit('showDisqualifiedOnTV', { color: dqColor });
  io.emit('disqualifiedAlert', dqColor);
  io.emit('updateState', state);
}

io.on('connection', (socket) => {
  // Hantar state terkini sebaik sahaja bersambung
  socket.emit('updateState', state);

  // --- KAWALAN PEMASA (TIMER) ---
  socket.on('controlTimer', (action) => {
    if (action === 'start' && !state.timer.isRunning) {
      state.timer.isRunning = true;
      addLog(`▶️ Pemasa Dimulakan (Round ${state.round})`);
      
      clearInterval(timerInterval); // Elak pertindihan interval
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
    } else if (action === 'pause' || action === 'stop') {
      clearInterval(timerInterval);
      state.timer.isRunning = false;
      addLog(`⏸️ Pemasa Dihentikan`);
    }
    io.emit('updateState', state);
  });

  socket.on('toggleTimer', () => {
    if (state.timer.isRunning) {
      clearInterval(timerInterval);
      state.timer.isRunning = false;
      addLog(`⏸️ Pemasa Dihentikan`);
    } else {
      state.timer.isRunning = true;
      addLog(`▶️ Pemasa Dimulakan (Round ${state.round})`);
      clearInterval(timerInterval);
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
    }
    io.emit('updateState', state);
  });

  socket.on('setTimerDuration', (seconds) => {
    state.timer.duration = Number(seconds);
    state.timer.currentTime = Number(seconds);
    addLog(`⏱️ Masa Disetkan ke ${seconds} saat`);
    io.emit('updateState', state);
  });

  // TUKAR PUSINGAN / SET ROUND
  socket.on('setRound', (roundNum) => {
    state.round = Number(roundNum);

    // Reset butang paparan hukuman pusingan semasa sahaja
    state.penalties = {
      blue: { A1: false, A2: false, T1: false, T2: false, P1: false, P2: false, DQ: false },
      red:  { A1: false, A2: false, T1: false, T2: false, P1: false, P2: false, DQ: false }
    };

    state.timer.currentTime = state.timer.duration || 90;
    state.timer.isRunning = false;
    clearInterval(timerInterval);

    io.emit('updateState', state);
    addLog(`--- PUSINGAN ${roundNum} BERMULA ---`);
  });

  // KEMASKINI MAKLUMAT PESERTA (Sokong dua-dua nama property: matchInfo & matchDetails)
  socket.on('updateMatchDetails', (data) => {
    const updated = {
      className: data.className || state.matchInfo.className,
      matchNo: data.matchNo || state.matchInfo.matchNo,
      blueName: data.blueName || state.matchInfo.blueName,
      blueTeam: data.blueTeam || state.matchInfo.blueTeam,
      redName: data.redName || state.matchInfo.redName,
      redTeam: data.redTeam || state.matchInfo.redTeam
    };
    state.matchInfo = updated;
    addLog(`📝 Maklumat Perlawanan Dikemaskini (Match #${state.matchInfo.matchNo})`);
    io.emit('updateState', state);
  });

  // LOGIK MAJORITI JURI
  socket.on('pressScore', (data) => {
    const juriId = Number(data.juriId);
    const color = String(data.color).toLowerCase();
    const points = Number(data.points);
    const now = Date.now();

    addLog(`🔘 Juri ${juriId} tekan +${points} (${color.toUpperCase()})`);

    io.emit('juriPressSignal', { juriId, color, points });

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

    if (uniqueJuriCount >= 2) {
      state.score[color] += points;

      if (points === 1) state.stats[color].pukulan += 1;
      if (points === 2) state.stats[color].tendangan += 1;

      addLog(`✅ MATA SAH! +${points} untuk SUDUT ${color.toUpperCase()} (${uniqueJuriCount} Juri bersetuju)`);

      pendingScores = pendingScores.filter(
        item => !(item.color === color && item.points === points)
      );

      io.emit('updateState', state);
    }
  });

  // HUKUMAN & PENALTI MANUAL
  socket.on('togglePenalty', ({ color, code, pts }) => {
    if (code === 'DQ') {
      triggerDisqualification(color);
      return;
    }

    if (!state.penalties[color]) {
      state.penalties[color] = { A1: false, A2: false, T1: false, T2: false, P1: false, P2: false, DQ: false };
    }

    const isActive = !!state.penalties[color][code];
    state.penalties[color][code] = !isActive;
    
    const penaltyVal = Math.abs(pts || 0);

    if (!isActive) {
      state.score[color] += (pts || 0);
      state.penaltyPoints[color] += penaltyVal;
      if (state.totalPenalties[color][code] !== undefined) {
        state.totalPenalties[color][code] += 1;
      }
      addLog(`⚠️ Hukuman Diberi [${color.toUpperCase()}]: ${code} (${pts || 0} mata)`);
    } else {
      state.score[color] -= (pts || 0);
      state.penaltyPoints[color] -= penaltyVal;
      if (state.totalPenalties[color][code] > 0) {
        state.totalPenalties[color][code] -= 1;
      }
      addLog(`🔄 Hukuman Dibatalkan [${color.toUpperCase()}]: ${code}`);
    }

    if (state.penaltyPoints[color] < 0) state.penaltyPoints[color] = 0;

    io.emit('updateState', state);
  });

  // PELARASAN MARKAH MANUAL
  socket.on('modifyScore', ({ color, pts }) => {
    state.score[color] += Number(pts);
    addLog(`✏️ Markah Manual [${color.toUpperCase()}]: ${pts > 0 ? '+' : ''}${pts}`);
    io.emit('updateState', state);
  });

  // SEMAKAN UNDIAN JURI (VERIFICATION)
  socket.on('requestVerification', (data) => {
    currentVerification = {
      type: data.type,
      color: data.color,
      votes: {}
    };
    addLog(`🔍 Semakan Juri Dibuat: ${data.type} [${data.color.toUpperCase()}]`);
    io.emit('promptVerification', data);
    io.emit('showVerificationOnTV', data);
  });

  socket.on('submitVerification', ({ juriId, approved }) => {
    if (!currentVerification) return;
    
    currentVerification.votes[juriId] = approved;
    addLog(`🗳️ Undian Juri ${juriId}: ${approved ? 'SAH' : 'TAK SAH'}`);

    if (Object.keys(currentVerification.votes).length >= 3) {
      const yesVotes = Object.values(currentVerification.votes).filter(v => v === true).length;
      const isAccepted = yesVotes >= 2;
      const color = currentVerification.color;
      const rawType = String(currentVerification.type).toUpperCase().trim();

      if (isAccepted) {
        if (rawType.includes('JATUHAN')) {
          state.score[color] += 3;
          state.stats[color].jatuhan += 1;

          addLog(`✅ Jatuhan SAH (+3 Mata [${color.toUpperCase()}])`);

          io.emit('verificationResult', {
            type: currentVerification.type,
            color: color,
            isApproved: true,
            text: `JATUHAN SAH (+3 MATA)`
          });

        } else {
          const penResult = applyPenalties(color, rawType);

          if (penResult.isDisqualified) {
            triggerDisqualification(color);
          } else {
            addLog(`⚠️ ${currentVerification.type} SAH (${penResult.appliedCode}): -${penResult.pointsDeducted} Mata [${color.toUpperCase()}]`);
            
            io.emit('verificationResult', {
              type: currentVerification.type,
              color: color,
              isApproved: true,
              text: `${currentVerification.type} SAH (${penResult.appliedCode}) -${penResult.pointsDeducted} MATA`
            });
          }
        }
      } else {
        addLog(`❌ Semakan ${currentVerification.type} TIDAK SAH [${color.toUpperCase()}]`);
        io.emit('verificationResult', {
          type: currentVerification.type,
          color: color,
          isApproved: false,
          text: `${currentVerification.type} - TIDAK SAH (${3 - yesVotes}/3)`
        });
      }

      currentVerification = null;
      io.emit('updateState', state);
    }
  });

  // PEMENANG, DISQUALIFIED & RESET
  socket.on('publishWinnerToTV', () => {
    const result = calculateWinner();
    state.winnerData = result;
    addLog(`🏆 PEMENANG DIISYTIHARKAN: ${result.winner.toUpperCase()} (${result.reason})`);
    io.emit('updateState', state);
    io.emit('showWinnerOnTV', result);
  });

  socket.on('disqualify', (color) => {
    triggerDisqualification(color);
  });

  socket.on('disqualifiedAlert', (data) => {
    const targetColor = typeof data === 'object' ? data.color : data;
    triggerDisqualification(targetColor);
  });

  socket.on('resetScore', () => {
    clearInterval(timerInterval);
    state.timer.currentTime = state.timer.duration;
    state.timer.isRunning = false;
    state.round = 1;
    state.score = { blue: 0, red: 0 };
    state.penaltyPoints = { blue: 0, red: 0 };
    state.penalties = {
      blue: { A1: false, A2: false, T1: false, T2: false, P1: false, P2: false, DQ: false },
      red: { A1: false, A2: false, T1: false, T2: false, P1: false, P2: false, DQ: false }
    };
    state.totalPenalties = {
      blue: { A1: 0, A2: 0, T1: 0, T2: 0, P1: 0, P2: 0 },
      red: { A1: 0, A2: 0, T1: 0, T2: 0, P1: 0, P2: 0 }
    };
    state.stats = {
      blue: { pukulan: 0, tendangan: 0, jatuhan: 0 },
      red: { pukulan: 0, tendangan: 0, jatuhan: 0 }
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
