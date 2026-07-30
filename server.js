const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Hantar fail HTML (Pengadil/Juri/TV) dari folder public
app.use(express.static('public'));

// -------------------------------------------------------------
// STATE UTAMA PERLAWANAN SILAT
// -------------------------------------------------------------
let matchState = {
  timer: {
    currentTime: 90,
    duration: 90,
    isRunning: false
  },
  round: 1,
  score: {
    blue: 0,
    red: 0
  },
  penalties: {
    blue: { A1: false, A2: false, T1: false, T2: false, P1: false, P2: false },
    red:  { A1: false, A2: false, T1: false, T2: false, P1: false, P2: false }
  },
  matchDetails: {
    className: 'CLASS A',
    matchNo: '1',
    blueName: 'PESILAT BIRU',
    redName: 'PESILAT MERAH',
    blueTeam: 'KONTINJEN BIRU',
    redTeam: 'KONTINJEN MERAH'
  }
};

// Sesi Semakan Undian Juri (Semasa)
let currentVerification = null;
let timerInterval = null;

// TOTAL JURI (Tukar mengikut bilangan juri anda, contoh: 3 orang juri)
const TOTAL_JURIES = 3;

// -------------------------------------------------------------
// PENGURUSAN SOCKET.IO REAL-TIME
// -------------------------------------------------------------
io.on('connection', (socket) => {
  console.log(`Peranti terhubung: ${socket.id}`);

  // Hantar status terkini sewaktu peranti baru connect
  socket.emit('updateState', matchState);

  // 1. KAWALAN PEMASA (TIMER)
  socket.on('controlTimer', (action) => {
    if (action === 'start' && !matchState.timer.isRunning) {
      matchState.timer.isRunning = true;
      clearInterval(timerInterval);
      timerInterval = setInterval(() => {
        if (matchState.timer.currentTime > 0) {
          matchState.timer.currentTime--;
          io.emit('updateState', matchState);
        } else {
          matchState.timer.isRunning = false;
          clearInterval(timerInterval);
          io.emit('updateState', matchState);
          io.emit('newLog', `⏱️ Masa bagi Pusingan ${matchState.round} telah tamat!`);
        }
      }, 1000);
    } else if (action === 'pause') {
      matchState.timer.isRunning = false;
      clearInterval(timerInterval);
      io.emit('updateState', matchState);
    }
  });

  socket.on('setTimerDuration', (seconds) => {
    matchState.timer.duration = seconds;
    matchState.timer.currentTime = seconds;
    io.emit('updateState', matchState);
  });

  socket.on('setRound', (roundNum) => {
    matchState.round = roundNum;
    matchState.timer.currentTime = matchState.timer.duration;
    matchState.timer.isRunning = false;
    clearInterval(timerInterval);
    io.emit('updateState', matchState);
    io.emit('newLog', `🔔 Pusingan ditukar ke ROUND ${roundNum}`);
  });

  // 2. KEMASKINI MAKLUMAT PERLAWANAN
  socket.on('updateMatchDetails', (details) => {
    matchState.matchDetails = { ...matchState.matchDetails, ...details };
    io.emit('updateState', matchState);
  });

  // 3. PENALTI & MARKAH MANUAL (BUTTON DI PANEL PENGADIL)
  socket.on('togglePenalty', ({ color, code, pts }) => {
    // Toggle (On/Off) status penalti
    const currentStatus = matchState.penalties[color][code];
    matchState.penalties[color][code] = !currentStatus;

    // Laraskan markah jika penalti diaktifkan/dinyahaktifkan
    if (!currentStatus) {
      matchState.score[color] += pts; // pts berharga negatif (contoh: -1, -2, -5, -10)
      io.emit('newLog', `⚠️ [HUKUMAN] Sudut ${color.toUpperCase()} dikenakan ${code} (${pts} mata)`);
    } else {
      matchState.score[color] -= pts; // Pembatalan penalti
      io.emit('newLog', `🔄 [BATAL HUKUMAN] Penalti ${code} Sudut ${color.toUpperCase()} dibatalkan`);
    }

    io.emit('updateState', matchState);
  });

  socket.on('modifyScore', ({ color, pts }) => {
    matchState.score[color] += pts;
    const sign = pts > 0 ? `+${pts}` : `${pts}`;
    io.emit('newLog', `✏️ [PELARASAN MARKAH] Sudut ${color.toUpperCase()} ${sign} mata`);
    io.emit('updateState', matchState);
  });

  // -------------------------------------------------------------
  // 4. PEMPROSESAN SEMAKAN PENGESAHAN JURI (MAJORITY VOTE)
  // -------------------------------------------------------------
  
  // A. Pengadil menghantar permohonan semakan
  socket.on('requestVerification', ({ type, color }) => {
    currentVerification = {
      type: type,      // 'Jatuhan', 'Pelanggaran Ringan', 'Pelanggaran Sederhana', 'Pelanggaran Berat'
      color: color,    // 'blue' atau 'red'
      votes: {},       // Mengumpul undian juri
      active: true
    };

    io.emit('newLog', `🔍 [SEMAKAN JURI] Semakan ${type.toUpperCase()} diminta untuk Sudut ${color.toUpperCase()}`);
    
    // Hantar notifikasi pop-up semakan ke semua skrin Juri
    io.emit('startJuryVote', currentVerification);
  });

  // B. Juri menghantar keputusan undian ('VALID' / 'INVALID')
  socket.on('submitJuryVote', ({ juryId, decision }) => {
    if (!currentVerification || !currentVerification.active) return;

    // Simpan undian mengikut ID Juri
    currentVerification.votes[juryId] = decision;

    const votesArray = Object.values(currentVerification.votes);

    // Apabila semua Juri telah buat undian
    if (votesArray.length >= TOTAL_JURIES) {
      const validVotes = votesArray.filter(vote => vote === 'VALID').length;
      const isApproved = validVotes >= Math.ceil(TOTAL_JURIES / 2); // Syarat Majoriti

      if (isApproved) {
        applyVerificationResult(currentVerification.color, currentVerification.type);
      } else {
        io.emit('newLog', `❌ [KEPUTUSAN JURI] Semakan ${currentVerification.type} DITOLAK oleh juri (${validVotes}/${TOTAL_JURIES} SAH)`);
      }

      // Tutup sesi undian
      currentVerification.active = false;
      io.emit('endJuryVote', { approved: isApproved });
    }
  });

  // C. Logik Pemotongan Markah & Nyalaan Butang Hukuman
  function applyVerificationResult(color, type) {
    let logMessage = '';

    if (type === 'Jatuhan') {
      matchState.score[color] += 3;
      logMessage = `✅ [JURI SAH] JATUHAN SAH (+3 mata) bagi Sudut ${color.toUpperCase()}`;
    } 
    else if (type === 'Pelanggaran Ringan') {
      // Aktifkan Teguran 1 (-1 markah)
      if (!matchState.penalties[color].T1) {
        matchState.penalties[color].T1 = true;
        matchState.score[color] -= 1;
      }
      logMessage = `✅ [JURI SAH] TEGURAN 1 (-1 mata) disahkan untuk Sudut ${color.toUpperCase()}`;
    } 
    else if (type === 'Pelanggaran Sederhana') {
      // Aktifkan Teguran 2 (-2 markah)
      if (!matchState.penalties[color].T2) {
        matchState.penalties[color].T2 = true;
        matchState.score[color] -= 2;
      }
      logMessage = `✅ [JURI SAH] TEGURAN 2 (-2 mata) disahkan untuk Sudut ${color.toUpperCase()}`;
    } 
    else if (type === 'Pelanggaran Berat') {
      // Aktifkan Peringatan 1 (-5 markah)
      if (!matchState.penalties[color].P1) {
        matchState.penalties[color].P1 = true;
        matchState.score[color] -= 5;
      }
      logMessage = `✅ [JURI SAH] PERINGATAN 1 (-5 mata) disahkan untuk Sudut ${color.toUpperCase()}`;
    }

    // BROADCAST KEPADA PENGADIL & TV: Butang akan menyala & markah akan terus terkini
    io.emit('updateState', matchState);
    io.emit('newLog', logMessage);
  }

  // 5. PENGISYTIHARAN PEMENANG & RESET
  socket.on('publishWinnerToTV', () => {
    let winner = 'draw';
    let reason = 'Markah Seri';

    if (matchState.score.blue > matchState.score.red) {
      winner = 'blue';
      reason = `Mata Atas Keputusan: ${matchState.score.blue} vs ${matchState.score.red}`;
    } else if (matchState.score.red > matchState.score.blue) {
      winner = 'red';
      reason = `Mata Atas Keputusan: ${matchState.score.red} vs ${matchState.score.blue}`;
    }

    const result = { winner, reason };
    io.emit('showWinnerOnTV', result);
    io.emit('newLog', `🏆 [PEMENANG] ${winner.toUpperCase()} diisytiharkan sebagai pemenang!`);
  });

  socket.on('resetScore', () => {
    matchState.score = { blue: 0, red: 0 };
    matchState.penalties = {
      blue: { A1: false, A2: false, T1: false, T2: false, P1: false, P2: false },
      red:  { A1: false, A2: false, T1: false, T2: false, P1: false, P2: false }
    };
    matchState.timer.currentTime = matchState.timer.duration;
    matchState.timer.isRunning = false;
    matchState.round = 1;
    clearInterval(timerInterval);

    io.emit('updateState', matchState);
    io.emit('newLog', '🔄 [RESET] Seluruh mata dan hukuman telah di-reset.');
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server Silat Olahraga beroperasi di port ${PORT}`);
});
