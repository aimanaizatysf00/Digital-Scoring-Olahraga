const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// 1. KOD HTML SKRIN TV (DENGAN POPUP PENGESAHAN DYNAMIC)
const tvHTML = `
<!DOCTYPE html>
<html lang="ms">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Scoreboard TV</title>
  <script src="/socket.io/socket.io.js"></script>
  <style>
    body { font-family: 'Arial', sans-serif; background: #050505; color: white; margin: 0; padding: 20px; text-align: center; }
    h1 { font-size: 3vw; margin-bottom: 10px; color: #f1c40f; text-transform: uppercase; letter-spacing: 2px; }
    .board { display: flex; height: 70vh; gap: 20px; }
    .team { flex: 1; display: flex; flex-direction: column; justify-content: center; align-items: center; border-radius: 25px; box-shadow: 0 10px 30px rgba(0,0,0,0.8); }
    .blue-bg { background: linear-gradient(145deg, #0f2b92, #1e3799); border: 4px solid #4a69bd; } 
    .red-bg { background: linear-gradient(145deg, #8c0a2b, #b71540); border: 4px solid #e84118; }
    .score { font-size: 22vw; font-weight: 900; line-height: 1; text-shadow: 0 5px 15px rgba(0,0,0,0.5); }
    .label { font-size: 4vw; font-weight: bold; letter-spacing: 4px; margin-bottom: 10px; }
    #status { font-size: 2vw; color: #2ecc71; margin-top: 15px; font-weight: bold; }

    /* OVERLAY POPUP UNTUK SKRIN TV */
    #tvOverlay { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.92); z-index: 999; flex-direction: column; justify-content: center; align-items: center; border: 10px solid #f1c40f; box-sizing: border-box; }
    .overlay-title { font-size: 4vw; font-weight: 900; color: #f1c40f; margin-bottom: 20px; text-transform: uppercase; }
    .overlay-detail { font-size: 6vw; font-weight: bold; margin-bottom: 30px; text-transform: uppercase; }
    .overlay-result { font-size: 7vw; font-weight: 900; padding: 20px 40px; border-radius: 20px; text-transform: uppercase; }
    .result-sah { background: #2ecc71; color: white; box-shadow: 0 0 50px #2ecc71; }
    .result-xsah { background: #e74c3c; color: white; box-shadow: 0 0 50px #e74c3c; }
    .result-pending { background: #f39c12; color: black; animation: pulse 1s infinite alternate; }
    @keyframes pulse { 0% { opacity: 0.6; } 100% { opacity: 1; } }
  </style>
</head>
<body>
  <h1>PAPAN SKOR PERTANDINGAN</h1>
  <div class="board">
    <div class="team blue-bg"><div class="label">BIRU</div><div class="score" id="blueScore">0</div></div>
    <div class="team red-bg"><div class="label">MERAH</div><div class="score" id="redScore">0</div></div>
  </div>
  <div id="status">Status Perlawanan: Berlangsung</div>

  <!-- POPUP TV -->
  <div id="tvOverlay">
    <div class="overlay-title">⚠️ SEMAKAN PENGESAHAN JURI ⚠️</div>
    <div class="overlay-detail" id="tvVerifyDetail">JATUHAN - SUDUT BIRU</div>
    <div class="overlay-result result-pending" id="tvVerifyResult">MENUNGGU 3 JURI...</div>
  </div>

  <script>
    const socket = io();
    socket.on('updateScore', (score) => {
      document.getElementById('blueScore').innerText = score.blue;
      document.getElementById('redScore').innerText = score.red;
    });

    // MUNCULKAN POPUP BILA PENGADIL MINTA PENGESAHAN
    socket.on('promptVerification', (data) => {
      document.getElementById('tvVerifyDetail').innerText = `${data.type} - SUDUT ${data.color.toUpperCase()}`;
      document.getElementById('tvVerifyResult').innerText = "MENUNGGU 3 JURI...";
      document.getElementById('tvVerifyResult').className = "overlay-result result-pending";
      document.getElementById('tvOverlay').style.display = 'flex';
    });

    // KEPUTUSAN DIAPARKAN DI POPUP TV
    socket.on('verificationResult', (data) => {
      const resElem = document.getElementById('tvVerifyResult');
      resElem.innerText = data.text;
      
      if (data.isApproved) {
        resElem.className = "overlay-result result-sah";
      } else {
        resElem.className = "overlay-result result-xsah";
      }

      // POPUP TUTUP AUTOMATIK SELEPAS 4 SAAT
      setTimeout(() => {
        document.getElementById('tvOverlay').style.display = 'none';
      }, 4000);
    });
  </script>
</body>
</html>`;

// 2. KOD HTML SKRIN KETUA PENGADIL (PENGESAHAN DENGAN SISI BIRU/MERAH)
const pengadilHTML = `
<!DOCTYPE html>
<html lang="ms">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Panel Ketua Pengadil</title>
  <script src="/socket.io/socket.io.js"></script>
  <style>
    body { font-family: sans-serif; background: #181818; color: white; padding: 15px; text-align: center; }
    .score-display { font-size: 32px; color: #f1c40f; font-weight: bold; margin: 10px 0; background: #000; padding: 10px; border-radius: 10px; }
    .section-title { font-size: 15px; margin-top: 15px; text-align: left; color: #f1c40f; text-transform: uppercase; font-weight: bold; border-bottom: 1px solid #444; padding-bottom: 5px; }
    .btn-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 10px; }
    button { padding: 10px; font-size: 15px; font-weight: bold; border-radius: 8px; border: none; cursor: pointer; color: white; }
    .blue { background: #2980b9; } .red { background: #c0392b; }
    .blue-add { background: #1f618d; border: 2px solid #3498db; } .red-add { background: #922b21; border: 2px solid #e74c3c; }
    .yellow { background: #f39c12; color: black; }
    .grey { background: #7f8c8d; grid-column: span 2; padding: 12px; margin-top: 15px; }
    #verifyStatus { font-size: 16px; color: #2ecc71; font-weight: bold; min-height: 24px; margin: 5px 0; }
  </style>
</head>
<body>
  <h2>PANEL KETUA PENGADIL</h2>
  <div class="score-display">BIRU: <span id="blueScore">0</span> | MERAH: <span id="redScore">0</span></div>
  <div id="verifyStatus"></div>

  <div class="section-title">PENGESAHAN JATUHAN</div>
  <div class="btn-grid">
    <button class="blue" style="padding:12px;" onclick="requestVerification('JATUHAN', 'blue')">JATUHAN BIRU</button>
    <button class="red" style="padding:12px;" onclick="requestVerification('JATUHAN', 'red')">JATUHAN MERAH</button>
  </div>

  <div class="section-title">PENGESAHAN PELANGGARAN</div>
  <div class="btn-grid">
    <button class="blue" style="padding:12px;" onclick="requestVerification('PELANGGARAN', 'blue')">PELANGGARAN BIRU</button>
    <button class="red" style="padding:12px;" onclick="requestVerification('PELANGGARAN', 'red')">PELANGGARAN MERAH</button>
  </div>

  <div class="section-title">➕ TAMBAH MARKAH (MANUAL)</div>
  <div class="btn-grid">
    <button class="blue-add" onclick="modifyScore('blue', 1)">Tambah BIRU +1</button>
    <button class="red-add" onclick="modifyScore('red', 1)">Tambah MERAH +1</button>
    <button class="blue-add" onclick="modifyScore('blue', 2)">Tambah BIRU +2</button>
    <button class="red-add" onclick="modifyScore('red', 2)">Tambah MERAH +2</button>
    <button class="blue-add" onclick="modifyScore('blue', 3)">Tambah BIRU +3</button>
    <button class="red-add" onclick="modifyScore('red', 3)">Tambah MERAH +3</button>
    <button class="blue-add" onclick="modifyScore('blue', 5)">Tambah BIRU +5</button>
    <button class="red-add" onclick="modifyScore('red', 5)">Tambah MERAH +5</button>
    <button class="blue-add" onclick="modifyScore('blue', 10)">Tambah BIRU +10</button>
    <button class="red-add" onclick="modifyScore('red', 10)">Tambah MERAH +10</button>
  </div>

  <div class="section-title">➖ TOLAK MARKAH (PENALTI)</div>
  <div class="btn-grid">
    <button class="blue" onclick="modifyScore('blue', -1)">Tolak BIRU -1</button>
    <button class="red" onclick="modifyScore('red', -1)">Tolak MERAH -1</button>
    <button class="blue" onclick="modifyScore('blue', -2)">Tolak BIRU -2</button>
    <button class="red" onclick="modifyScore('red', -2)">Tolak MERAH -2</button>
    <button class="blue" onclick="modifyScore('blue', -3)">Tolak BIRU -3</button>
    <button class="red" onclick="modifyScore('red', -3)">Tolak MERAH -3</button>
    <button class="blue" onclick="modifyScore('blue', -5)">Tolak BIRU -5</button>
    <button class="red" onclick="modifyScore('red', -5)">Tolak MERAH -5</button>
    <button class="blue" onclick="modifyScore('blue', -10)">Tolak BIRU -10</button>
    <button class="red" onclick="modifyScore('red', -10)">Tolak MERAH -10</button>
  </div>

  <button class="grey" onclick="resetScore()">RESET MARKAH</button>

  <script>
    const socket = io();
    socket.on('updateScore', (score) => {
      document.getElementById('blueScore').innerText = score.blue;
      document.getElementById('redScore').innerText = score.red;
    });
    socket.on('verificationResult', (data) => {
      document.getElementById('verifyStatus').innerText = data.text;
    });
    function modifyScore(color, pts) { socket.emit('modifyScore', { color, pts }); }
    function requestVerification(type, color) { 
      document.getElementById('verifyStatus').innerText = `Menunggu jawapan Juri (${type} ${color.toUpperCase()})...`;
      socket.emit('requestVerification', { type, color }); 
    }
    function resetScore() { if(confirm('Reset semua skor?')) socket.emit('resetScore'); }
  </script>
</body>
</html>`;

// 3. KOD HTML SKRIN JURI
const juriHTML = `
<!DOCTYPE html>
<html lang="ms">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Panel Juri</title>
  <script src="/socket.io/socket.io.js"></script>
  <style>
    body { font-family: sans-serif; background: #111; color: white; padding: 15px; text-align: center; margin: 0; }
    select { font-size: 18px; padding: 8px; margin-bottom: 15px; border-radius: 8px; width: 80%; }
    .category-title { font-size: 20px; font-weight: bold; margin: 15px 0 10px 0; color: #f1c40f; }
    .btn-group { display: flex; gap: 12px; margin-bottom: 15px; }
    .btn { flex: 1; height: 120px; font-size: 24px; font-weight: bold; border-radius: 18px; border: none; color: white; cursor: pointer; }
    .blue { background: #2980b9; } .red { background: #c0392b; }
    .blue:active { background: #1f618d; } .red:active { background: #922b21; }
    
    #overlay { display: none; position: fixed; top:0; left:0; width:100%; height:100%; background: rgba(0,0,0,0.95); z-index: 100; flex-direction: column; justify-content: center; align-items: center; padding: 20px; box-sizing: border-box; }
    .pop-btn { width: 100%; height: 90px; margin: 10px 0; font-size: 26px; font-weight: bold; border-radius: 15px; border: none; cursor: pointer; }
    .btn-sah { background: #2ecc71; color: white; }
    .btn-x-sah { background: #e74c3c; color: white; }
  </style>
</head>
<body>
  <div>
    <label style="font-size:18px;">ID Juri: </label>
    <select id="juriId">
      <option value="1">Juri 1</option>
      <option value="2">Juri 2</option>
      <option value="3">Juri 3</option>
    </select>
  </div>

  <div class="category-title">🥊 TUMBUK (+1 MATA)</div>
  <div class="btn-group">
    <button class="btn blue" onclick="sendPoint('blue', 1)">BIRU<br>+1</button>
    <button class="btn red" onclick="sendPoint('red', 1)">MERAH<br>+1</button>
  </div>

  <div class="category-title">💥 SEPAK (+2 MATA)</div>
  <div class="btn-group">
    <button class="btn blue" onclick="sendPoint('blue', 2)">BIRU<br>+2</button>
    <button class="btn red" onclick="sendPoint('red', 2)">MERAH<br>+2</button>
  </div>

  <div id="overlay">
    <h2 id="verifyTitle" style="color:#f1c40f; font-size: 26px;">PENGESAHAN PENGADIL</h2>
    <p style="font-size:20px; font-weight:bold; color:#fff;" id="verifySubTitle"></p>
    <button class="pop-btn btn-sah" onclick="submitVerify(true)">SAH ✅</button>
    <button class="pop-btn btn-x-sah" onclick="submitVerify(false)">TIDAK SAH ❌</button>
  </div>

  <script>
    const socket = io();
    const urlParams = new URLSearchParams(window.location.search);
    const idFromUrl = urlParams.get('id');
    if(idFromUrl) document.getElementById('juriId').value = idFromUrl;

    function sendPoint(color, points) {
      const id = document.getElementById('juriId').value;
      socket.emit('pressScore', { juriId: id, color, points });
    }

    socket.on('promptVerification', (data) => {
      document.getElementById('verifyTitle').innerText = "PENGESAHAN: " + data.type;
      document.getElementById('verifySubTitle').innerText = "SUDUT " + data.color.toUpperCase();
      document.getElementById('overlay').style.display = 'flex';
    });

    function submitVerify(isApproved) {
      const id = document.getElementById('juriId').value;
      socket.emit('submitVerification', { juriId: id, approved: isApproved });
      document.getElementById('overlay').style.display = 'none';
    }
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
let verificationVotes = [];
let currentVerifyTarget = { type: '', color: '' };
const TIME_WINDOW = 1500;

io.on('connection', (socket) => {
  socket.emit('updateScore', score);

  socket.on('pressScore', (data) => {
    const now = Date.now();
    const { juriId, color, points } = data;
    const key = `${color}_${points}`;
    
    if (!juriVotes[key]) juriVotes[key] = [];
    juriVotes[key].push({ juriId, time: now });
    
    juriVotes[key] = juriVotes[key].filter(v => (now - v.time) <= TIME_WINDOW);
    const uniqueJudges = new Set(juriVotes[key].map(v => v.juriId));

    if (uniqueJudges.size >= 3) {
      score[color] += points;
      juriVotes[key] = [];
      io.emit('updateScore', score);
    }
  });

  socket.on('modifyScore', (data) => {
    const { color, pts } = data;
    score[color] = Math.max(0, score[color] + pts);
    io.emit('updateScore', score);
  });

  socket.on('resetScore', () => {
    score = { red: 0, blue: 0 };
    io.emit('updateScore', score);
    io.emit('verificationResult', { text: 'MARKAH DIRESET', isApproved: false });
  });

  // MINTA PENGESAHAN DENGAN SPESIFIKASI SUDUT
  socket.on('requestVerification', (data) => {
    verificationVotes = [];
    currentVerifyTarget = { type: data.type, color: data.color };
    io.emit('promptVerification', data);
  });

  // KEPUTUSAN UNDIAN 3 JURI
  socket.on('submitVerification', (data) => {
    verificationVotes.push(data);
    
    if (verificationVotes.length >= 3) {
      const sahCount = verificationVotes.filter(v => v.approved === true).length;
      const xSahCount = verificationVotes.filter(v => v.approved === false).length;
      
      let isApproved = false;
      let statusStr = "";

      if (sahCount === 3) {
        isApproved = true;
        statusStr = `${currentVerifyTarget.type} ${currentVerifyTarget.color.toUpperCase()}: SAH ✅`;
      } else if (xSahCount === 3) {
        isApproved = false;
        statusStr = `${currentVerifyTarget.type} ${currentVerifyTarget.color.toUpperCase()}: TIDAK SAH ❌`;
      } else {
        isApproved = false;
        statusStr = `${currentVerifyTarget.type} ${currentVerifyTarget.color.toUpperCase()}: TIDAK SEBULAT SUARA (Sah: ${sahCount}, X-Sah: ${xSahCount})`;
      }

      io.emit('verificationResult', { text: statusStr, isApproved: isApproved });
      verificationVotes = [];
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server berjalan di port ${PORT}`));
