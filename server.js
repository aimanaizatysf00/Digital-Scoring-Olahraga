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
    button { width: 100%; height: 60px; margin: 8px 0; font-size: 18px; font-weight: bold; border-radius: 12px; border: none; cursor: pointer; }
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

// KOD HTML SKRIN JURI (DIKEMASKINI DENGAN 3 KATEGORI SERANGAN)
const juriHTML = `
<!DOCTYPE html>
<html lang="ms">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Panel Juri</title>
  <script src="/socket.io/socket.io.js"></script>
  <style>
    body { font-family: sans-serif; background: #111; color: white; padding: 10px; text-align: center; margin: 0; }
    select { font-size: 18px; padding: 8px; margin-bottom: 10px; border-radius: 8px; width: 60%; }
    .category-title { font-size: 18px; font-weight: bold; margin-top: 15px; text-align: center; color: #f1c40f; }
    .btn-group { display: flex; gap: 10px; margin-bottom: 10px; }
    .btn { flex: 1; height: 90px; font-size: 22px; font-weight: bold; border-radius: 15px; border: none; color: white; cursor: pointer; }
    .blue { background: #3498db; } .red { background: #e74c3c; }
    .blue:active { background: #1d6fa5; } .red:active { background: #962d22; }
  </style>
</head>
<body>
  <div style="margin-top:10px;">
    <label style="font-size:18px;">ID Juri: </label>
    <select id="juriId">
      <option value="1">Juri 1</option>
      <option value="2">Juri 2</option>
      <option value="3">Juri 3</option>
    </select>
  </div>

  <!-- CATEGORY 1: TUMBUK (+1) -->
  <div class="category-title">🥊 TUMBUK (+1 MATA)</div>
  <div class="btn-group">
    <button class="btn blue" onclick="sendPoint('blue', 1, 'TUMBUK')">BIRU<br>+1</button>
    <button class="btn red" onclick="sendPoint('red', 1, 'TUMBUK')">MERAH<br>+1</button>
  </div>

  <!-- CATEGORY 2: SEPAK (+2) -->
  <div class="category-title">💥 SEPAK (+2 MATA)</div>
  <div class="btn-group">
    <button class="btn blue" onclick="sendPoint('blue', 2, 'SEPAK')">BIRU<br>+2</button>
    <button class="btn red" onclick="sendPoint('red', 2, 'SEPAK')">MERAH<br>+2</button>
  </div>

  <!-- CATEGORY 3: JATUHAN (+3) -->
  <div class="category-title">🤼 JATUHAN (+3 MATA)</div>
  <div class="btn-group">
    <button class="btn blue" onclick="sendPoint('blue', 3, 'JATUHAN')">BIRU<br>+3</button>
    <button class="btn red" onclick="sendPoint('red', 3, 'JATUHAN')">MERAH<br>+3</button>
  </div>

  <script>
    const socket = io();
    const urlParams = new URLSearchParams(window.location.search);
    const idFromUrl = urlParams.get('id');
    if(idFromUrl) document.getElementById('juriId').value = idFromUrl;

    function sendPoint(color, points, actionType) {
      const id = document.getElementById('juriId').value;
      socket.emit('pressScore', { juriId: id, color: color, points: points, actionType: actionType });
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
let juriVotes = {}; 
const TIME_WINDOW = 1500; // 1.5 Saat Window Sync

io.on('connection', (socket) => {
  socket.emit('updateScore', score);

  socket.on('pressScore', (data) => {
    const now = Date.now();
    const { juriId, color, points, actionType } = data;
    
    // Kunci unik berdasarkan warna + jenis serangan (cth: "blue_2")
    const key = `${color}_${points}`;
    
    if (!juriVotes[key]) juriVotes[key] = [];
    
    // Simpan undian juri
    juriVotes[key].push({ juriId: juriId, time: now });
    
    // Tapis undian yang melepasi tempoh 1.5 saat
    juriVotes[key] = juriVotes[key].filter(v => (now - v.time) <= TIME_WINDOW);
    
    // Ambil juri-juri unik yang menekan
    const uniqueJudges = new Set(juriVotes[key].map(v => v.juriId));

    // SYARAT MUTLAK: 3/3 JURI TEKAN BUTANG & WARNA YANG SAMA
    if (uniqueJudges.size >= 3) {
      score[color] += points;
      juriVotes[key] = []; // Clearkan undian
      io.emit('updateScore', score);
      io.emit('logMessage', `${actionType} (+${points}): 3 JURI SETUJU UNTUK ${color.toUpperCase()}`);
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
