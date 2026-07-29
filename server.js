const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// KOD HTML SKRIN TV
const tvHTML = `
<!DOCTYPE html>
<html lang="ms">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Scoreboard TV</title>
  <script src="/socket.io/socket.io.js"></script>
  <style>
    body { font-family: Arial, sans-serif; background: #000; color: white; margin: 0; padding: 20px; text-align: center; }
    .board { display: flex; height: 70vh; margin-top: 20px; gap: 15px; }
    .team { flex: 1; display: flex; flex-direction: column; justify-content: center; align-items: center; border-radius: 20px; }
    .blue-bg { background: #1e3799; } .red-bg { background: #b71540; }
    .score { font-size: 18vw; font-weight: bold; }
    .label { font-size: 4vw; letter-spacing: 2px; }
    #log { font-size: 2.5vw; color: #f1c40f; margin-top: 25px; font-weight: bold; }
  </style>
</head>
<body>
  <h2>PAPAN SKOR PERTANDINGAN</h2>
  <div class="board">
    <div class="team blue-bg"><div class="label">BIRU</div><div class="score" id="blueScore">0</div></div>
    <div class="team red-bg"><div class="label">MERAH</div><div class="score" id="redScore">0</div></div>
  </div>
  <div id="log">Menunggu Perlawanan...</div>
  <script>
    const socket = io();
    socket.on('updateScore', (score) => {
      document.getElementById('blueScore').innerText = score.blue;
      document.getElementById('redScore').innerText = score.red;
    });
    socket.on('logMessage', (msg) => { document.getElementById('log').innerText = msg; });
  </script>
</body>
</html>`;

// KOD HTML SKRIN KETUA PENGADIL
const pengadilHTML = `
<!DOCTYPE html>
<html lang="ms">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Panel Ketua Pengadil</title>
  <script src="/socket.io/socket.io.js"></script>
  <style>
    body { font-family: sans-serif; background: #222; color: white; padding: 15px; text-align: center; }
    button { width: 100%; height: 70px; margin: 10px 0; font-size: 20px; font-weight: bold; border-radius: 12px; border: none; cursor: pointer; }
    .red { background: #e74c3c; color: white; } .blue { background: #3498db; color: white; }
    .yellow { background: #f1c40f; color: black; } .grey { background: #7f8c8d; color: white; }
  </style>
</head>
<body>
  <h2>PANEL KETUA PENGADIL</h2>
  <h1 style="color:#f1c40f;"><span id="blueScore">0</span> - <span id="redScore">0</span></h1>
  <button class="yellow" onclick="requestVerification('JATUHAN')">Minta Pengesahan Jatuhan</button>
  <button class="yellow" onclick="requestVerification('PELANGGARAN')">Minta Pengesahan Pelanggaran</button>
  <hr>
  <button class="blue" onclick="sendPenalty('blue')">Tolak Mata BIRU (-1)</button>
  <button class="red" onclick="sendPenalty('red')">Tolak Mata MERAH (-1)</button>
  <button class="grey" style="height:50px; font-size:16px;" onclick="resetScore()">RESET SKOR</button>
  <script>
    const socket = io();
    socket.on('updateScore', (score) => {
      document.getElementById('blueScore').innerText = score.blue;
      document.getElementById('redScore').innerText = score.red;
    });
    function sendPenalty(color) { socket.emit('penalty', color); }
    function requestVerification(type) { socket.emit('requestVerification', type); }
    function resetScore() { if(confirm('Reset semua skor?')) socket.emit('resetScore'); }
  </script>
</body>
</html>`;

// KOD HTML SKRIN JURI
const juriHTML = `
<!DOCTYPE html>
<html lang="ms">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Panel Juri</title>
  <script src="/socket.io/socket.io.js"></script>
  <style>
    body { font-family: sans-serif; background: #111; color: white; padding: 15px; text-align: center; }
    .btn { width: 100%; height: 180px; margin: 15px 0; font-size: 32px; font-weight: bold; border-radius: 20px; border: none; color: white; }
    .blue { background: #3498db; } .red { background: #e74c3c; }
    select { font-size: 18px; padding: 8px; margin-bottom: 10px; border-radius: 8px; }
  </style>
</head>
<body>
  <h3>PANEL JURI</h3>
  <label>ID Juri: </label>
  <select id="juriId">
    <option value="1">Juri 1</option>
    <option value="2">Juri 2</option>
    <option value="3">Juri 3</option>
  </select>
  <button class="btn blue" onclick="sendPoint('blue')">+1 BIRU</button>
  <button class="btn red" onclick="sendPoint('red')">+1 MERAH</button>
  <script>
    const socket = io();
    const urlParams = new URLSearchParams(window.location.search);
    const idFromUrl = urlParams.get('id');
    if(idFromUrl) document.getElementById('juriId').value = idFromUrl;

    function sendPoint(color) {
      const id = document.getElementById('juriId').value;
      socket.emit('pressScore', { juriId: id, color: color });
    }
    socket.on('promptVerification', (type) => {
      const id = document.getElementById('juriId').value;
      const isApproved = confirm(\`[PENGADIL MINTA PENGESAHAN]: \${type}\\n\\nAdakah anda setuju?\`);
      socket.emit('submitVerification', { juriId: id, approved: isApproved });
    });
  </script>
</body>
</html>`;

// ROUTES URL
app.get('/tv', (req, res) => res.send(tvHTML));
app.get('/pengadil', (req, res) => res.send(pengadilHTML));
app.get('/juri', (req, res) => res.send(juriHTML));
app.get('/', (req, res) => res.send(tvHTML));

// LOGIK SCORING REAL-TIME
let score = { red: 0, blue: 0 };
let juriVotes = { red: [], blue: [] };
const TIME_WINDOW = 1500;

io.on('connection', (socket) => {
  socket.emit('updateScore', score);

  socket.on('pressScore', (data) => {
    const now = Date.now();
    const color = data.color;
    if (!juriVotes[color]) juriVotes[color] = [];
    
    juriVotes[color].push({ juriId: data.juriId, time: now });
    juriVotes[color] = juriVotes[color].filter(v => (now - v.time) <= TIME_WINDOW);
    
    const uniqueJudges = new Set(juriVotes[color].map(v => v.juriId));
    if (uniqueJudges.size >= 2) {
      score[color]++;
      juriVotes[color] = [];
      io.emit('updateScore', score);
      io.emit('logMessage', `MATA +1 UNTUK ${color.toUpperCase()}`);
    }
  });

  socket.on('penalty', (color) => {
    if (score[color] > 0) score[color]--;
    io.emit('updateScore', score);
    io.emit('logMessage', `PENALTI: TOLAK MATA ${color.toUpperCase()}`);
  });

  socket.on('resetScore', () => {
    score = { red: 0, blue: 0 };
    io.emit('updateScore', score);
    io.emit('logMessage', 'SKOR DIRESET');
  });

  socket.on('requestVerification', (type) => {
    io.emit('promptVerification', type);
  });

  socket.on('submitVerification', (data) => {
    io.emit('logMessage', `Juri ${data.juriId}: ${data.approved ? 'SETUJU' : 'TIDAK SETUJU'}`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server berjalan di port ${PORT}`));
