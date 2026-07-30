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
  penalties: {
    blue: { A1: false, A2: false, T1: false, T2: false, P1: false, P2: false },
    red: { A1: false, A2: false, T1: false, T2: false, P1: false, P2: false }
  },
  // TAMBAHAN: Rekod statistik bilangan teknik bagi setiap sudut
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
    state.penalties[color] = { A1: false, A2: false, T1: false, T2: false, P1: false, P2: false };
  }

  const p = state.penalties[color];
  let appliedCode = '';
  let pointsDeducted = 0;
  let isDisqualified = false;

  const type = penaltyType.toUpperCase();

  if (type === 'AMARAN') {
    if (!p.A1) {
      p.A1 = true; appliedCode = 'A1'; pointsDeducted = 0; // Amaran 1: 0 Mata
    } else if (!p.A2) {
      p.A2 = true; appliedCode = 'A2'; pointsDeducted = 0; // Amaran 2: 0 Mata
    } else {
      // Amaran 1 & 2 dah ada -> Auto naik ke Teguran
      return applyPenalties(color, 'TEGURAN');
    }
  } else if (type === 'TEGURAN') {
    if (!p.T1) {
      p.T1 = true; appliedCode = 'T1'; pointsDeducted = 1; // Teguran 1: -1 Mata
    } else if (!p.T2) {
      p.T2 = true; appliedCode = 'T2'; pointsDeducted = 2; // Teguran 2: -2 Mata
    } else {
      // Teguran 1 & 2 dah ada -> Auto naik ke Peringatan
      return applyPenalties(color, 'PERINGATAN');
    }
  } else if (type === 'PERINGATAN') {
    if (!p.P1) {
      p.P1 = true; appliedCode = 'P1'; pointsDeducted = 5; // Peringatan 1: -5 Mata
    } else if (!p.P2) {
      p.P2 = true; appliedCode = 'P2'; pointsDeducted = 10; // Peringatan 2: -10 Mata
    } else {
      // Peringatan melebihi P2 -> Auto Batal (DQ)
      isDisqualified = true;
      appliedCode = 'DQ';
    }
  }

  // Tolak markah daripada skor sudut (Markah Boleh Negatif)
  if (pointsDeducted > 0) {
    state.score[color] -= pointsDeducted;
    state.penaltyPoints[color] += pointsDeducted;
  }

  return { appliedCode, pointsDeducted, isDisqualified };
}

function calculateWinner() {
  const blueScore = state.score.blue;
  const redScore = state.score.red;

  // 1. Semakan Pertama: Jumlah Markah Bersih
  if (blueScore > redScore) {
    return { winner: 'blue', blueScore, redScore, reason: 'Mata Akhir Tertinggi' };
  } else if (redScore > blueScore) {
    return { winner: 'red', blueScore, redScore, reason: 'Mata Akhir Tertinggi' };
  }

  // 2. Semakan Kedua (Jika Seri): Penolakan Hukuman dari Terberat (P2) ke Teringan (A1)
  const bluePen = state.penalties.blue;
  const redPen = state.penalties.red;
  const penaltyCheckOrder = ['P2', 'P1', 'T2', 'T1', 'A2', 'A1'];

  for (const code of penaltyCheckOrder) {
    if (bluePen[code] !== redPen[code]) {
      if (!bluePen[code] && redPen[code]) {
        return { winner: 'blue', blueScore, redScore, reason: `Markah Seri, Menang Hukuman Lebih Sedikit (${code})` };
      } else {
        return { winner: 'red', blueScore, redScore, reason: `Markah Seri, Menang Hukuman Lebih Sedikit (${code})` };
      }
    }
  }

  // 3. Semakan Ketiga (Jika Markah & Hukuman Seri): Bilangan Teknik (Jatuhan -> Tendangan -> Pukulan)
  const bStats = state.stats.blue;
  const rStats = state.stats.red;

  // i. Semak Jatuhan
  if (bStats.jatuhan !== rStats.jatuhan) {
    const winner = bStats.jatuhan > rStats.jatuhan ? 'blue' : 'red';
    const count = winner === 'blue' ? bStats.jatuhan : rStats.jatuhan;
    return { winner, blueScore, redScore, reason: `Markah & Hukuman Seri, Menang Jatuhan Terbanyak (${count})` };
  }

  // ii. Semak Tendangan
  if (bStats.tendangan !== rStats.tendangan) {
    const winner = bStats.tendangan > rStats.tendangan ? 'blue' : 'red';
    const count = winner === 'blue' ? bStats.tendangan : rStats.tendangan;
    return { winner, blueScore, redScore, reason: `Markah & Hukuman Seri, Menang Tendangan Terbanyak (${count})` };
  }

  // iii. Semak Pukulan
  if (bStats.pukulan !== rStats.pukulan) {
    const winner = bStats.pukulan > rStats.pukulan ? 'blue' : 'red';
    const count = winner === 'blue' ? bStats.pukulan : rStats.pukulan;
    return { winner, blueScore, redScore, reason: `Markah & Hukuman Seri, Menang Pukulan Terbanyak (${count})` };
  }

  // Jika Semua Elemen Sama Seri Keseluruhan
  return { winner: 'DRAW', blueScore, redScore, reason: 'Markah, Hukuman & Semua Teknik Sama Seri' };
}

io.on('connection', (socket) => {
  // Hantar state terkini sebaik sahaja mana-mana peranti bersambung
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

  // --- LOGIK MAJORITI JURI (TERSUKAT & DIPATUHI) ---
  socket.on('pressScore', (data) => {
    const juriId = Number(data.juriId);
    const color = String(data.color).toLowerCase();
    const points = Number(data.points);
    const now = Date.now();

    addLog(`🔘 Juri ${juriId} tekan +${points} (${color.toUpperCase()})`);

    // 1. Hantar signal visual lampu ke TV/Pengadil
    io.emit('juriPressSignal', { juriId, color, points });

    // 2. Tapis rekod butang yang telah melepasi tempoh masa 2 saat
    pendingScores = pendingScores.filter(item => (now - item.timestamp) <= VERIFICATION_WINDOW);

    // 3. Semak jika juri yang SAMA menekan butang yang SAMA dalam tetingkap masa ini
    const existingIndex = pendingScores.findIndex(
      item => item.juriId === juriId && item.color === color && item.points === points
    );

    if (existingIndex !== -1) {
      pendingScores[existingIndex].timestamp = now;
    } else {
      pendingScores.push({ juriId, color, points, timestamp: now });
    }

    // 4. Cari senarai juri yang menekan warna dan markah yang sama
    const matchingPresses = pendingScores.filter(
      item => item.color === color && item.points === points
    );

    // 5. Hitung bilangan juri UNIK (Juri 1, Juri 2, Juri 3)
    const uniqueJuriCount = new Set(matchingPresses.map(item => item.juriId)).size;

    // 6. SYARAT MAJORITI: Sekurang-kurangnya 2 JURI UNIK bersetuju
    if (uniqueJuriCount >= 2) {
      state.score[color] += points;

      // TAMBAHAN: Rekod statistik pukulan (+1) atau tendangan (+2)
      if (points === 1) state.stats[color].pukulan += 1;
      if (points === 2) state.stats[color].tendangan += 1;

      addLog(`✅ MATA SAH! +${points} untuk SUDUT ${color.toUpperCase()} (${uniqueJuriCount} Juri bersetuju)`);

      // Bersihkan buffer bagi kategori warna & markah ini
      pendingScores = pendingScores.filter(
        item => !(item.color === color && item.points === points)
      );

      io.emit('updateState', state);
    }
  });

  // --- HUKUMAN & PENALTI MANUAL ---
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

    if (state.penaltyPoints[color] < 0) state.penaltyPoints[color] = 0;

    io.emit('updateState', state);
  });

  // --- PELARASAN MARKAH MANUAL ---
  socket.on('modifyScore', ({ color, pts }) => {
    state.score[color] += pts;
    addLog(`✏️ Markah Manual [${color.toUpperCase()}]: ${pts > 0 ? '+' : ''}${pts}`);
    io.emit('updateState', state);
  });

  // --- SEMAKAN UNDIAN JURI (VERIFICATION) & AUTOMASI MARKAH ---
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
      const color = currentVerification.color;
      const type = currentVerification.type.toUpperCase();

      if (isAccepted) {
        if (type === 'JATUHAN') {
          // AUTOMATIK +3 MATA JIKA JATUHAN SAH
          state.score[color] += 3;

          // TAMBAHAN: Rekod statistik jatuhan (+3)
          state.stats[color].jatuhan += 1;

          addLog(`✅ Jatuhan SAH (+3 Mata [${color.toUpperCase()}])`);

          io.emit('verificationResult', {
            type: currentVerification.type,
            color: color,
            isApproved: true,
            text: `JATUHAN SAH (+3 MATA)`
          });

        } else if (['AMARAN', 'TEGURAN', 'PERINGATAN'].includes(type)) {
          // AUTOMATIK TUKAR HUKUMAN & POTONG MARKAH
          const penResult = applyPenalties(color, type);

          if (penResult.isDisqualified) {
            addLog(`❌ DISQUALIFIED: Sudut ${color.toUpperCase()} Dibatalkan (DQ)`);
            io.emit('disqualifiedAlert', color);
          } else {
            addLog(`⚠️ ${type} SAH (${penResult.appliedCode}): -${penResult.pointsDeducted} Mata [${color.toUpperCase()}]`);
            
            io.emit('verificationResult', {
              type: currentVerification.type,
              color: color,
              isApproved: true,
              text: `${type} SAH (${penResult.appliedCode}) -${penResult.pointsDeducted} MATA`
            });
          }
        } else {
          io.emit('verificationResult', {
            type: currentVerification.type,
            color: color,
            isApproved: true,
            text: `${currentVerification.type} - SAH (${yesVotes}/3)`
          });
        }
      } else {
        addLog(`❌ Semakan ${type} TIDAK SAH [${color.toUpperCase()}]`);
        io.emit('verificationResult', {
          type: currentVerification.type,
          color: color,
          isApproved: false,
          text: `${currentVerification.type} - TIDAK SAH (${3 - yesVotes}/3)`
        });
      }

      currentVerification = null;
      io.emit('updateState', state); // Kemaskini skrin TV, Pengadil, Juri
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
    // TAMBAHAN: Reset statistik kaunter teknik
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

const PORT = 3000;
server.listen(PORT, () => console.log(`Server Silat Berjalan di http://localhost:${PORT}`));
