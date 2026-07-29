const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

// Sajikan fail statik dari folder 'public'
app.use(express.static(path.join(__dirname, 'public')));

// State global bagi perlawanan
let gameState = {
  matchInfo: {
    blueName: 'PESILAT BIRU',
    blueTeam: 'KONTINJEN BIRU',
    redName: 'PESILAT MERAH',
    redTeam: 'KONTINJEN MERAH',
    className: 'CLASS A',
    matchNo: '1'
  },
  score: { blue: 0, red: 0 },
  round: 1,
  timer: { currentTime: 90, isRunning: false },
  penalties: {
    blue: { A1: false, A2: false, T1: false, T2: false, P1: false, P2: false },
    red: { A1: false, A2: false, T1: false, T2: false, P1: false, P2: false }
  }
};

io.on('connection', (socket) => {
  console.log('Peranti terhubung:', socket.id);

  // Hantar data semasa apabila mana-mana peranti connect
  socket.emit('updateState', gameState);

  // 1. Terima tekanan dari Controller Juri -> pancar ke TV
  socket.on('juriPress', (data) => {
    // data: { juriId: 1, color: 'blue', points: 1 }
    io.emit('juriPressSignal', data);
  });

  // 2. Terima isyarat majoriti daripada TV -> kemaskini markah
  socket.on('addScoreFromMajority', (data) => {
    if (!data || !data.color || !data.points) return;

    if (data.color === 'blue') {
      gameState.score.blue += Number(data.points);
    } else if (data.color === 'red') {
      gameState.score.red += Number(data.points);
    }

    // Kemaskini semua paparan
    io.emit('updateState', gameState);
  });

  // 3. Reset perlawanan (pilihan)
  socket.on('resetMatch', () => {
    gameState.score = { blue: 0, red: 0 };
    gameState.penalties = {
      blue: { A1: false, A2: false, T1: false, T2: false, P1: false, P2: false },
      red: { A1: false, A2: false, T1: false, T2: false, P1: false, P2: false }
    };
    io.emit('updateState', gameState);
  });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log(`Server Silat Scoreboard berjalan di http://localhost:${PORT}`);
});
