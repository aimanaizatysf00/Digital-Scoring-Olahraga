 io.emit('newLog', logEntry);
}

// FUNGSI PENENTUAN PEMENANG AUTOMATIK JIKA SERI
function calculateWinner() {
  const blueScore = state.score.blue;
  const redScore = state.score.red;
  const blueDeductions = state.penaltyPoints.blue;
  const redDeductions = state.penaltyPoints.red;

  let winner = 'DRAW';
  let reason = '';

  if (blueScore > redScore) {
    winner = 'blue';
    reason = 'Kemenangan Mata Semasa';
    reason = 'Mata Akhir Tertinggi';
  } else if (redScore > blueScore) {
    winner = 'red';
    reason = 'Kemenangan Mata Semasa';
    reason = 'Mata Akhir Tertinggi';
  } else {
    // === APABILA MARKAH SERI (DRAW) ===
    // Penilaian berdasarkan Total Penolakan Hukuman Paling Sedikit
    const blueDeductions = state.penaltyPoints.blue;
    const redDeductions = state.penaltyPoints.red;

    // === APABILA MARKAH AKHIR SERI ===
    // Penilaian dibuat mengikut Penolakan Hukuman Terkumpul Paling Sedikit
    if (blueDeductions < redDeductions) {
      winner = 'blue';
      reason = `Penolakan Mata Hukuman Lebih Sedikit (-${blueDeductions} berbanding -${redDeductions})`;
      reason = `Markah Seri (${blueScore}-${redScore}), Biru Menang Kerana Hukuman Lebih Sedikit (-${blueDeductions} vs -${redDeductions})`;
    } else if (redDeductions < blueDeductions) {
      winner = 'red';
      reason = `Penolakan Mata Hukuman Lebih Sedikit (-${redDeductions} berbanding -${blueDeductions})`;
      reason = `Markah Seri (${blueScore}-${redScore}), Merah Menang Kerana Hukuman Lebih Sedikit (-${redDeductions} vs -${blueDeductions})`;
    } else {
      winner = 'DRAW';
      reason = 'Markah dan Jumlah Hukuman Sama Seri';
      reason = `Markah (${blueScore}-${redScore}) & Jumlah Penolakan Hukuman (-${blueDeductions}) Adalah Sama Seri`;
    }
  }

  addLog(`🏁 PERLAWANAN TAMAT! Pemenang: ${winner.toUpperCase()} | ${reason}`);

  return {
    winner: winner,
    blueScore: blueScore,
    redScore: redScore,
    bluePenalties: blueDeductions,
    redPenalties: redDeductions,
    reason: reason
  };
}

  addLog(`🏁 PERLAWANAN TAMAT! Pemenang: ${winner.toUpperCase()} (${reason})`);

  return {
@@ -208,19 +218,28 @@ io.on('connection', (socket) => {
  socket.on('togglePenalty', (data) => {
    const { color, code, pts } = data;
    const isActive = state.penalties[color][code];
    
    // Tukar status (Toggle)
    state.penalties[color][code] = !isActive;

    const penaltyValue = Math.abs(pts); // Dapatkan nilai positif penolakan (cth: -1 jadi 1)

    if (!isActive) {
      state.score[color] += pts; // pts dalam nilai negatif (contoh: -1, -2, -5)
      state.penaltyPoints[color] += Math.abs(pts); // Tambah jumlah mata penolakan
      addLog(`⚠️ Hukuman Diberi kepada ${color.toUpperCase()}: ${code} (${pts} mata)`);
      // Jika Hukuman Diberi
      state.score[color] += pts; // pts adalah negatif, cth: 5 + (-1) = 4
      state.penaltyPoints[color] += penaltyValue; // Tambah ke dalam rekod penolakan
      addLog(`⚠️ Hukuman Diberi [${color.toUpperCase()}]: ${code} (${pts} mata)`);
    } else {
      state.score[color] -= pts;
      state.penaltyPoints[color] -= Math.abs(pts);
      addLog(`🔄 Hukuman Dibatalkan untuk ${color.toUpperCase()}: ${code}`);
      // Jika Hukuman Dibatalkan
      state.score[color] -= pts; // Cth: 4 - (-1) = 5
      state.penaltyPoints[color] -= penaltyValue; // Tolak dari rekod penolakan
      addLog(`🔄 Hukuman Dibatalkan [${color.toUpperCase()}]: ${code}`);
    }

    // Elak markah paparan jadi negatif bawah 0
    if (state.score[color] < 0) state.score[color] = 0;
    if (state.penaltyPoints[color] < 0) state.penaltyPoints[color] = 0;

    io.emit('updateState', state);
  });
