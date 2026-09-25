// ─── State ───────────────────────────────────────────
let cameraStream = null;
let micStream = null;
let audioCtx = null;
let sourceNode = null;
let analyser = null;
let specAnalyser = null;
let currentEffect = 'normal';
let currentPitch = 1.0;
let currentRate = 1.0;
let vuBars = [];
let filterStyle = '';
// ─── TOAST ───────────────────────────────────────────
function toast(msg, type='info', duration=3500) {
  const icons = { info:'ℹ️', success:'✅', warn:'⚠️', error:'❌' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${icons[type]||'ℹ️'}</span><span>${msg}</span>`;
  document.getElementById('toastContainer').appendChild(el);
  setTimeout(() => {
    el.classList.add('fade-out');
    setTimeout(() => el.remove(), 320);
  }, duration);
}

// ─── GLOBAL ESC — zamyka wszystkie modale ─────────────
document.addEventListener('keydown', e => {
  if(e.key !== 'Escape') return;
  const modals = [
    { id:'perfModal',          close: closePerfMonitor },
    { id:'wifiModal',          close: closeWifiInfo    },
    { id:'mouseModal',         close: closeMouseTest   },
    { id:'sysModal',           close: closeSysInfo     },
    { id:'kbModal',            close: closeKbTest      },
    { id:'micModal',           close: closeMicTest     },
    { id:'micStudioModal',     close: closeMicStudio   },
    { id:'speakerModal',       close: closeSpeakerTest },
    { id:'reactionModal',      close: closeReactionTest },
    { id:'vrModal',            close: closeVoiceRec     },
    { id:'netModal',           close: () => closeNetTest(true) },
    { id:'displayTestOverlay', close: closeDisplayTest },
    { id:'cspModal',           close: closeCspTester },
    { id:'aboutModal',         close: closeAbout },
  ];
  for(const m of modals) {
    const el = document.getElementById(m.id);
    if(el && el.classList.contains('show')) { m.close(); return; }
  }
});

let rafId = null;
let micTestRafId = null;
let peakDb = -Infinity;
let dbHistory = [];
let camWidth = 1280, camHeight = 720;

// Build VU meter bars
const vuMeter = document.getElementById('vuMeter');
for(let i = 0; i < 16; i++) {
  const bar = document.createElement('div');
  bar.className = 'vu-bar';
  const fill = document.createElement('div');
  fill.className = 'vu-fill';
  bar.appendChild(fill);
  vuMeter.appendChild(bar);
  vuBars.push(fill);
}

// ─── Camera quality ───────────────────────────────────
let camFps = 60;

async function setCamFps(fps, btn) {
  camFps = fps;
  document.querySelectorAll('.fps-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  if(cameraStream) { stopCamera(); try { await startCamera(); } catch(e) { toast(t('toast_fps_err') + e.message, 'error'); } }
}

async function setCamQuality(w, h, btn) {
  camWidth = w; camHeight = h;
  document.querySelectorAll('.qual-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  if(cameraStream) {
    stopCamera();
    try {
      await startCamera();
    } catch(e) {
      toast(t('toast_res_err') + e.message, 'error');
    }
  }
}

// Wykryj jakie rozdzielczości obsługuje kamera i oznacz przyciski
async function detectSupportedResolutions() {
  const resolutions = [
    { id: 'q-480',  w: 640,  h: 480  },
    { id: 'q-720',  w: 1280, h: 720  },
    { id: 'q-1080', w: 1920, h: 1080 },
    { id: 'q-4k',   w: 3840, h: 2160 },
  ];

  for(const r of resolutions) {
    const btn = document.getElementById(r.id);
    if(!btn) continue;
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { width: { exact: r.w }, height: { exact: r.h } }
      });
      s.getTracks().forEach(t => t.stop());
      btn.style.opacity = '1';
      btn.title = `${r.w}×${r.h} px ✓`;
      btn.disabled = false;
    } catch(e) {
      btn.style.opacity = '0.35';
      btn.title = `${r.w}×${r.h} px — niedostępna dla tej kamery`;
      // nie blokuj — fallback do ideal
    }
  }
}

// ─── Camera ──────────────────────────────────────────
async function toggleCamera() {
  if(camStarting) return; // BUG FIX: blokuj podwójne kliknięcie podczas uruchamiania
  if(cameraStream) { stopCamera(); } else { await startCamera(); }
}

let camStarting = false;

async function startCamera() {
  if(camStarting) return;
  if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    toast(t('toast_cam_unsupported'), 'error'); return;
  }
  camStarting = true;
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        width:     { exact: camWidth },
        height:    { exact: camHeight },
        frameRate: { ideal: camFps, max: camFps },
        facingMode: 'user'
      }
    }).catch(() => navigator.mediaDevices.getUserMedia({
      video: {
        width:     { ideal: camWidth },
        height:    { ideal: camHeight },
        frameRate: { ideal: camFps, max: camFps },
        facingMode: 'user'
      }
    }));
    const vid = document.getElementById('videoEl');
    vid.srcObject = cameraStream;
    vid.style.display = 'block';
    vid.style.transform = 'scaleX(-1)'; // domyślne lustro — ręka po tej samej stronie co na żywo
    // Bug fix: jawne play() — niektóre przeglądarki ignorują autoplay attr
    vid.play().catch(() => {});
    document.getElementById('placeholder').style.display = 'none';
    document.getElementById('btnCam').classList.add('active');
    // Bug fix: użyj i18n zamiast hardcoded 'Kamera ON'
    document.getElementById('camLabel').textContent = t('cam_on') || 'Kamera ON';
    document.getElementById('camPill').classList.add('active');
    applyVideoFilter(filterStyle);

    vid.onloadedmetadata = () => {
      // guard: stream may have been stopped before metadata arrived (e.g. quick quality switch)
      if(!cameraStream) return;
      const track = cameraStream.getVideoTracks()[0];
      if(!track) return;
      const settings = track.getSettings();
      const realW   = settings.width  || vid.videoWidth;
      const realH   = settings.height || vid.videoHeight;
      const realFps = settings.frameRate ? Math.round(settings.frameRate) : camFps;

      document.getElementById('camResInfo').textContent = `${realW} × ${realH} @ ${realFps} fps`;

      // Pokaż toast jeśli kamera dała inną rozdzielczość niż proszona
      if(realW !== camWidth || realH !== camHeight) {
        toast(t('toast_cam_res_warn').replace('%W%',realW).replace('%H%',realH).replace('%RW%',camWidth).replace('%RH%',camHeight), 'warn');
        // Zaktualizuj aktywny przycisk na faktyczną rozdzielczość
        document.querySelectorAll('.qual-btn').forEach(b => {
          const [bw, bh] = b.title.replace(' px','').replace(' ✓','').replace(/— .*/,'').trim().split('×').map(Number);
          b.classList.toggle('active', bw === realW && bh === realH);
        });
      }

      // color-code FPS info
      const fpsColor = realFps >= 60 ? '#00f5a0' : realFps >= 30 ? '#f5c400' : '#ff4d6d';
      const overlay = document.getElementById('camInfoOverlay');
      overlay.innerHTML = `${realW}×${realH} | <span style="color:${fpsColor};font-weight:700;">${realFps} fps</span>`;
      overlay.classList.add('show');

      // warn if camera couldn't reach requested fps
      if(realFps < camFps * 0.8) {
        const warn = document.createElement('div');
        warn.style.cssText = 'position:absolute;bottom:52px;left:12px;right:12px;background:rgba(245,196,0,0.15);border:1px solid rgba(245,196,0,0.4);border-radius:8px;padding:6px 10px;font-family:Space Mono,monospace;font-size:9px;color:#f5c400;z-index:10;';
        warn.id = 'fpsWarn';
        warn.textContent = `⚠ Kamera obsługuje max ${realFps} fps (prosiłeś o ${camFps} fps)`;
        const wrap = document.getElementById('videoWrap');
        const old = document.getElementById('fpsWarn');
        if(old) old.remove();
        wrap.appendChild(warn);
        setTimeout(() => warn.remove(), 5000);
      }

      // Wykryj obsługiwane rozdzielczości (tylko raz)
      if(!window._camResDetected) {
        window._camResDetected = true;
        detectSupportedResolutions();
      }
    };
  } catch(e) {
    toast(t('toast_cam_no_access') + e.message, 'error');
  } finally {
    camStarting = false;
  }
}

function stopCamera() {
  // stop recording first if active
  if(mediaRecorder && mediaRecorder.state === 'recording') stopRecording();

  if(cameraStream) { cameraStream.getTracks().forEach(t => t.stop()); cameraStream = null; }
  // stop canvas effects
  if(fxRafId) { cancelAnimationFrame(fxRafId); fxRafId = null; }
  // BUG 1 FIX: zatrzymaj rAF nagrywania CSS filtrów
  if(recFilterRafId) { cancelAnimationFrame(recFilterRafId); recFilterRafId = null; }
  currentFx = 'none';
  document.getElementById('filterCanvas').style.display = 'none';
  document.querySelectorAll('[id^="fx-"]').forEach(b => b.classList.remove('active'));
  // reset CSS filter preset buttons + filterStyle
  filterStyle = '';
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  const noneBtn = document.querySelector('.filter-btn[onclick*="\'none\'"]');
  if(noneBtn) noneBtn.classList.add('active');
  applyVideoFilter('');
  // clear fps warning if visible
  const fpsWarnEl = document.getElementById('fpsWarn');
  if(fpsWarnEl) fpsWarnEl.remove();
  const vid = document.getElementById('videoEl');
  vid.style.display = 'none';
  vid.srcObject = null;
  document.getElementById('placeholder').style.display = 'flex';
  document.getElementById('btnCam').classList.remove('active');
  document.getElementById('camLabel').textContent = t('cam_off') || 'Kamera OFF';
  document.getElementById('camPill').classList.remove('active');
  document.getElementById('camResInfo').textContent = '— (wyłączona)';
  document.getElementById('camInfoOverlay').classList.remove('show');
  // Bug fix: wyczyść podgląd nagrania gdy kamera jest zatrzymana
  recClearPreview();
}

// ─── Microphone ──────────────────────────────────────
async function toggleMic() {
  if(micStream) { stopMic(); } else { await startMic(); }
}

async function startMic() {
  if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    toast(t('toast_mic_unsupported'), 'error'); return;
  }
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, sampleRate: 48000 } });
    audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
    sourceNode = audioCtx.createMediaStreamSource(micStream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 64;
    sourceNode.connect(analyser);
    applyAudioEffect(currentEffect);
    startVU();
    document.getElementById('btnMic').classList.add('active');
    document.getElementById('micLabel').textContent = 'Mikrofon ON';
    document.getElementById('micPill').classList.add('active');
    // Fill mic details if modal open
    updateMicDetails();
  } catch(e) {
    toast(t('toast_mic_no_access') + e.message, 'error');
  }
}

function stopMic() {
  if(rafId) cancelAnimationFrame(rafId);
  if(micTestRafId) cancelAnimationFrame(micTestRafId);
  if(audioCtx) { audioCtx.close(); audioCtx = null; }
  if(micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
  sourceNode = null; analyser = null;
  vuBars.forEach(b => b.style.height = '0%');
  document.getElementById('btnMic').classList.remove('active');
  document.getElementById('micLabel').textContent = 'Mikrofon OFF';
  document.getElementById('micPill').classList.remove('active');
}

// ─── VU Meter ─────────────────────────────────────────
function startVU() {
  const data = new Uint8Array(analyser.frequencyBinCount);
  function frame() {
    rafId = requestAnimationFrame(frame);
    analyser.getByteFrequencyData(data);
    const step = Math.floor(data.length / vuBars.length);
    vuBars.forEach((bar, i) => {
      const val = data[i * step] / 255;
      bar.style.height = (val * 100) + '%';
      bar.style.background = val > 0.7
        ? 'linear-gradient(to top, #ff4d6d, #ff8800)'
        : val > 0.5
        ? 'linear-gradient(to top, #f5c400, #00f5a0)'
        : 'linear-gradient(to top, #00f5a0, #00c875)';
    });
  }
  frame();
}

// ─── MIC TEST MODAL ───────────────────────────────────
let peakPct = 0;
let noiseFloorDb = null;
let noiseCalibSamples = [];
let speakSeconds = 0;
let speakInterval = null;
let isSpeaking = false;
let levelHistory = []; // 0-100 values for chart

async function openMicTest() {
  document.getElementById('micModal').classList.add('show');
  peakDb = -Infinity; peakPct = 0;
  dbHistory = []; levelHistory = [];
  noiseFloorDb = null; noiseCalibSamples = [];
  speakSeconds = 0;
  clearInterval(speakInterval);
  document.getElementById('speakTimer').textContent = '0:00';
  document.getElementById('noiseFloor').textContent = '—';
  document.getElementById('snrVal').textContent = '—';
  if(!micStream) await startMic();
  if(micStream) startMicTest();
}

function closeMicTest() {
  document.getElementById('micModal').classList.remove('show');
  if(micTestRafId) { cancelAnimationFrame(micTestRafId); micTestRafId = null; }
  clearInterval(speakInterval);
}

function resetPeak() {
  peakDb = -Infinity; peakPct = 0;
  document.getElementById('dbPeak').textContent = '—';
  document.getElementById('dbPeakPct').textContent = '—%';
  document.getElementById('peakMarker').style.left = '0%';
}

// Convert raw RMS dB (-60..0) to friendly 0-100 scale
function dbToPercent(db) {
  if(!isFinite(db)) return 0;
  const clamped = Math.max(-60, Math.min(0, db));
  return Math.round(((clamped + 60) / 60) * 100);
}

// Format percent as label
function pctLabel(pct) {
  if(pct < 5) return 'Cisza';
  if(pct < 30) return 'Cicho';
  if(pct < 55) return 'Normalnie';
  if(pct < 80) return 'Głośno';
  return 'Bardzo głośno';
}

function updateMicDetails() {
  if(!micStream) return;
  const track = micStream.getAudioTracks()[0];
  if(!track) return;
  const settings = track.getSettings();
  document.getElementById('micDetails').innerHTML =
    `Urządzenie: ${track.label || 'Nieznane'}<br>` +
    `Próbkowanie: ${settings.sampleRate || audioCtx?.sampleRate || '—'} Hz<br>` +
    `Kanały: ${settings.channelCount || 1} | Echo cancellation: ${settings.echoCancellation ? 'TAK' : 'NIE'}`;
}

function startMicTest() {
  const testAnalyser = audioCtx.createAnalyser();
  testAnalyser.fftSize = 2048;
  testAnalyser.smoothingTimeConstant = 0.5;
  sourceNode.connect(testAnalyser);

  const freqData = new Uint8Array(testAnalyser.frequencyBinCount);
  const timeData = new Float32Array(testAnalyser.fftSize);
  const specCanvas = document.getElementById('spectrumCanvas');
  const specCtx = specCanvas.getContext('2d');
  const histCanvas = document.getElementById('historyCanvas');
  const histCtx = histCanvas.getContext('2d');

  updateMicDetails();

  // Speaking timer
  speakInterval = setInterval(() => {
    if(isSpeaking) {
      speakSeconds++;
      const m = Math.floor(speakSeconds/60), s = speakSeconds % 60;
      document.getElementById('speakTimer').textContent = `${m}:${s.toString().padStart(2,'0')}`;
    }
  }, 1000);

  function frame() {
    micTestRafId = requestAnimationFrame(frame);
    testAnalyser.getByteFrequencyData(freqData);
    testAnalyser.getFloatTimeDomainData(timeData);

    // RMS dB
    let sum = 0;
    for(let i = 0; i < timeData.length; i++) sum += timeData[i] * timeData[i];
    const rms = Math.sqrt(sum / timeData.length);
    const db = rms > 0.00001 ? 20 * Math.log10(rms) : -Infinity;
    const pct = dbToPercent(db);

    // Speaking detection
    isSpeaking = pct > 15;

    // Noise floor calibration (first 2 sec when quiet)
    if(noiseCalibSamples.length < 60 && pct < 20 && isFinite(db)) {
      noiseCalibSamples.push(db);
      if(noiseCalibSamples.length >= 10) {
        noiseFloorDb = noiseCalibSamples.reduce((a,b)=>a+b,0)/noiseCalibSamples.length;
        const nfPct = dbToPercent(noiseFloorDb);
        document.getElementById('noiseFloor').textContent = nfPct + '%';
      }
    }

    // Peak
    if(pct > peakPct) { peakPct = pct; peakDb = db; }

    // History for avg
    dbHistory.push(pct);
    if(dbHistory.length > 200) dbHistory.shift();
    const avgPct = Math.round(dbHistory.reduce((a,b)=>a+b,0)/dbHistory.length);

    // Level history for chart (300 samples = ~5sec at 60fps)
    levelHistory.push(pct);
    if(levelHistory.length > 300) levelHistory.shift();

    // SNR
    if(noiseFloorDb !== null && isFinite(db) && db > noiseFloorDb) {
      const snr = Math.round(db - noiseFloorDb);
      document.getElementById('snrVal').textContent = '+' + snr;
    }

    // Update number displays
    document.getElementById('dbCurrent').textContent = pct + '%';
    document.getElementById('dbCurrentPct').textContent = pctLabel(pct);
    document.getElementById('dbPeak').textContent = peakPct + '%';
    document.getElementById('dbPeakPct').textContent = pctLabel(peakPct);
    document.getElementById('dbAvg').textContent = avgPct + '%';
    document.getElementById('dbAvgPct').textContent = pctLabel(avgPct);

    // Volume bar
    document.getElementById('dbBarFill').style.width = pct + '%';
    document.getElementById('peakMarker').style.left = peakPct + '%';

    // Color the bar based on level
    const barFill = document.getElementById('dbBarFill');
    if(pct > 85) barFill.style.background = 'linear-gradient(to right,#00f5a0,#f5c400,#ff4d6d)';
    else if(pct > 60) barFill.style.background = 'linear-gradient(to right,#00f5a0,#f5c400)';
    else barFill.style.background = 'linear-gradient(to right,#00f5a0,#00c875)';

    // Quality badge
    const badge = document.getElementById('micQualityBadge');
    const sub = document.getElementById('micQualitySub');
    badge.className = 'mic-quality';
    if(pct < 5) {
      badge.classList.add('bad');
      badge.querySelector('.q-text').textContent = '🔇 Brak sygnału — sprawdź mikrofon';
      sub.textContent = 'Nic nie słyszę';
    } else if(pct > 90) {
      badge.classList.add('bad');
      badge.querySelector('.q-text').textContent = '🔴 Przesterowanie! Zbyt głośno';
      sub.textContent = 'Oddal się od mikrofonu';
    } else if(pct > 55) {
      badge.classList.add('good');
      badge.querySelector('.q-text').textContent = '✅ Świetny poziom sygnału';
      sub.textContent = 'Idealne do nagrań';
    } else if(pct > 25) {
      badge.classList.add('medium');
      badge.querySelector('.q-text').textContent = '⚡ Dobry sygnał';
      sub.textContent = 'Możesz mówić głośniej';
    } else {
      badge.classList.add('bad');
      badge.querySelector('.q-text').textContent = '⚠️ Słaby sygnał';
      sub.textContent = 'Przybliż się do mikrofonu';
    }

    // ── Draw history chart ──
    const HW = histCanvas.width, HH = histCanvas.height;
    histCtx.clearRect(0, 0, HW, HH);
    histCtx.fillStyle = '#08080e';
    histCtx.fillRect(0, 0, HW, HH);
    // Grid lines at 25%, 50%, 75%
    [25, 50, 75].forEach(g => {
      const y = HH - (g / 100) * HH;
      histCtx.strokeStyle = 'rgba(255,255,255,0.05)';
      histCtx.beginPath(); histCtx.moveTo(0, y); histCtx.lineTo(HW, y); histCtx.stroke();
    });
    // Draw line
    if(levelHistory.length > 1) {
      histCtx.beginPath();
      levelHistory.forEach((v, i) => {
        const x = (i / (levelHistory.length - 1)) * HW;
        const y = HH - (v / 100) * HH;
        i === 0 ? histCtx.moveTo(x, y) : histCtx.lineTo(x, y);
      });
      histCtx.strokeStyle = 'rgba(0,245,160,0.8)';
      histCtx.lineWidth = 1.5;
      histCtx.stroke();
      // Fill under
      histCtx.lineTo(HW, HH); histCtx.lineTo(0, HH);
      histCtx.closePath();
      const grad = histCtx.createLinearGradient(0, 0, 0, HH);
      grad.addColorStop(0, 'rgba(0,245,160,0.25)');
      grad.addColorStop(1, 'rgba(0,245,160,0)');
      histCtx.fillStyle = grad;
      histCtx.fill();
    }

    // ── Draw spectrum ──
    const SW = specCanvas.width, SH = specCanvas.height;
    specCtx.clearRect(0, 0, SW, SH);
    specCtx.fillStyle = '#08080e';
    specCtx.fillRect(0, 0, SW, SH);
    const bins = freqData.length / 2;
    const bw = SW / bins;
    for(let i = 0; i < bins; i++) {
      const v = freqData[i] / 255;
      const bh = v * SH;
      const hue = 140 - v * 130;
      specCtx.fillStyle = `hsl(${hue},85%,${38 + v*28}%)`;
      specCtx.fillRect(i * bw, SH - bh, bw - 0.5, bh);
    }
  }
  frame();
}

// ─── Voice Effects ────────────────────────────────────
function setVoiceEffect(name) {
  currentEffect = name;
  document.querySelectorAll('.effect-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('eff-' + name).classList.add('active');
  if(audioCtx && sourceNode) applyAudioEffect(name);
}

function applyAudioEffect(name) {
  if(!audioCtx || !sourceNode) return;
  try { sourceNode.disconnect(); } catch(e) {}
  const effects = buildEffectChain(name);
  let node = sourceNode;
  effects.forEach(n => { node.connect(n); node = n; });
  node.connect(analyser);
}

function buildEffectChain(name) {
  const nodes = [];
  if(name === 'robot') {
    const osc = audioCtx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(currentPitch * 80, audioCtx.currentTime);
    const ring = audioCtx.createGain();
    ring.gain.value = 0.5;
    osc.connect(ring);
    osc.start();
    nodes.push(ring);
  }
  if(name === 'deep') {
    const biquad = audioCtx.createBiquadFilter();
    biquad.type = 'lowshelf';
    biquad.frequency.value = 300;
    biquad.gain.value = 18;
    nodes.push(biquad);
  }
  if(name === 'chipmunk') {
    const bq = audioCtx.createBiquadFilter();
    bq.type = 'highshelf';
    bq.frequency.value = 1000;
    bq.gain.value = 15;
    nodes.push(bq);
  }
  if(name === 'echo') {
    const delay = audioCtx.createDelay(1.0);
    delay.delayTime.value = 0.35;
    const fb = audioCtx.createGain();
    fb.gain.value = 0.5;
    delay.connect(fb);
    fb.connect(delay);
    nodes.push(delay);
  }
  if(name === 'phone') {
    const lo = audioCtx.createBiquadFilter();
    lo.type = 'bandpass';
    lo.frequency.value = 1500;
    lo.Q.value = 0.8;
    nodes.push(lo);
    const dist = audioCtx.createWaveShaper();
    dist.curve = makeDistortionCurve(40);
    nodes.push(dist);
  }
  return nodes;
}

function makeDistortionCurve(amount) {
  const n = 256, curve = new Float32Array(n);
  for(let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = (Math.PI + amount) * x / (Math.PI + amount * Math.abs(x));
  }
  return curve;
}

function updatePitch(v) {
  currentPitch = parseFloat(v);
  document.getElementById('pitchVal').textContent = currentPitch.toFixed(2) + 'x';
}

function updateRate(v) {
  currentRate = parseFloat(v);
  document.getElementById('rateVal').textContent = currentRate.toFixed(2) + 'x';
}

function setFilter(style, btn) {
  filterStyle = style;
  document.querySelectorAll('.filter-grid .filter-btn').forEach(b => b.classList.remove('active'));
  if(btn) btn.classList.add('active');
  applyVideoFilter(style);
  setFx('none', null);
}

const FILTER_PRESETS = {
  none:       '',
  // --- Czarno-białe ---
  bw:         'grayscale(100%) contrast(1.1)',
  noir:       'grayscale(100%) contrast(2) brightness(0.7)',
  silver:     'grayscale(80%) contrast(0.9) brightness(1.1) sepia(10%)',
  // --- Kolorowe klasyki ---
  sepia:      'sepia(90%) contrast(1.05)',
  vintage:    'sepia(60%) contrast(1.1) brightness(0.9) saturate(0.7) hue-rotate(-10deg)',
  faded:      'saturate(0.4) brightness(1.15) contrast(0.85)',
  matte:      'contrast(0.8) brightness(1.05) saturate(0.5)',
  // --- Ciepłe ---
  warm:       'sepia(40%) saturate(1.4) brightness(1.05) hue-rotate(-15deg)',
  sunset:     'sepia(50%) hue-rotate(-20deg) saturate(2) brightness(1.1)',
  golden:     'sepia(30%) saturate(2) brightness(1.15) hue-rotate(-25deg) contrast(1.1)',
  amber:      'sepia(70%) hue-rotate(-30deg) saturate(2.5) brightness(1.05)',
  // --- Zimne ---
  cold:       'hue-rotate(180deg) saturate(1.3) brightness(0.95)',
  arctic:     'hue-rotate(200deg) saturate(1.8) brightness(1.1) contrast(1.1)',
  moonlight:  'hue-rotate(210deg) saturate(0.8) brightness(0.85) contrast(1.2)',
  // --- Żywe / intensywne ---
  vivid:      'saturate(4) contrast(1.2)',
  neon:       'hue-rotate(90deg) saturate(3) brightness(1.1)',
  cyberpunk:  'hue-rotate(270deg) saturate(4) contrast(1.4) brightness(0.9)',
  acid:       'hue-rotate(120deg) saturate(5) contrast(1.3) brightness(1.05)',
  infrared:   'hue-rotate(150deg) saturate(6) contrast(1.5) brightness(0.9)',
  // --- Filmowe ---
  cinema:     'contrast(1.5) brightness(0.85) saturate(0.6) sepia(20%)',
  dramatic:   'contrast(2.2) brightness(0.75) saturate(0.8)',
  teal:       'hue-rotate(160deg) saturate(1.5) contrast(1.2) brightness(0.9) sepia(10%)',
  moody:      'contrast(1.6) brightness(0.7) saturate(0.7) hue-rotate(200deg)',
  // --- Specjalne efekty ---
  soft:       'brightness(1.1) contrast(0.85) saturate(1.2) blur(0.5px)',
  sharp:      'contrast(1.8) brightness(1.05) saturate(1.3)',
  dream:      'brightness(1.2) contrast(0.75) saturate(1.5) blur(1px)',
  glitch:     'hue-rotate(45deg) saturate(3) contrast(1.8) invert(15%)',
  xray:       'invert(100%) grayscale(100%) contrast(2) brightness(1.3)',
  invert:     'invert(100%)',
  thermal:    'invert(100%) hue-rotate(120deg) saturate(5) contrast(1.4)',
  vaporwave:  'hue-rotate(300deg) saturate(3) brightness(1.05) contrast(1.1)',
  lofi:       'sepia(30%) contrast(0.85) brightness(0.95) saturate(0.6) blur(0.3px)',
  // --- Portret ---
  beauty:     'brightness(1.1) contrast(0.9) saturate(1.1) blur(0.4px)',
  portrait:   'contrast(1.1) brightness(1.05) saturate(1.2) sepia(10%)',
  glow:       'brightness(1.3) contrast(0.8) saturate(1.4) blur(1.5px)',
  blush:      'sepia(20%) saturate(1.8) hue-rotate(-5deg) brightness(1.1) contrast(0.95)',
  // --- Retro ---
  polaroid:   'contrast(1.2) brightness(1.1) saturate(0.8) sepia(20%) blur(0.2px)',
  kodak:      'sepia(30%) saturate(1.4) contrast(1.1) brightness(1.05) hue-rotate(-5deg)',
  fuji:       'hue-rotate(5deg) saturate(1.3) contrast(1.05) brightness(1.0) sepia(15%)',
  cross:      'hue-rotate(20deg) saturate(2) contrast(1.3) brightness(0.95) sepia(25%)',
  // --- Noc / Ciemne ---
  midnight:   'brightness(0.5) contrast(1.8) saturate(0.6) hue-rotate(220deg)',
  horror:     'contrast(3) brightness(0.5) saturate(0) hue-rotate(0deg)',
  rednight:   'brightness(0.6) contrast(1.5) saturate(2) hue-rotate(-10deg) sepia(50%)',
  // --- Pop / Artystyczne ---
  pop:        'saturate(3.5) contrast(1.3) brightness(1.1)',
  holo:       'hue-rotate(45deg) saturate(2.5) contrast(1.15) brightness(1.1)',
  duochrome:  'grayscale(60%) sepia(40%) hue-rotate(200deg) saturate(3)',
  comics:     'contrast(2.5) saturate(2) brightness(1.1)',
  watercolor: 'saturate(1.8) contrast(0.75) brightness(1.2) blur(0.8px)',
  // --- Sportowe ---
  action:     'contrast(1.7) saturate(1.5) brightness(1.05) sharpness(1)',
  bleach:     'contrast(2) saturate(0.3) brightness(1.2)',
  chrome:     'contrast(1.4) saturate(1.6) brightness(1.1) hue-rotate(-5deg)',
};

function setPresetFilter(key, btn) {
  filterStyle = FILTER_PRESETS[key] || '';
  document.querySelectorAll('.filter-grid .filter-btn').forEach(b => b.classList.remove('active'));
  if(btn) btn.classList.add('active');
  // apply slider base + preset
  applyVideoFilter(buildCombinedFilter(filterStyle));
  setFx('none', null);
}

function buildCombinedFilter(presetStr) {
  const bright = document.getElementById('fsBright')?.value ?? 100;
  const contrast = document.getElementById('fsContrast')?.value ?? 100;
  const sat = document.getElementById('fsSat')?.value ?? 100;
  const hue = document.getElementById('fsHue')?.value ?? 0;
  const blur = document.getElementById('fsBlur')?.value ?? 0;
  const sliders = `brightness(${bright}%) contrast(${contrast}%) saturate(${sat}%) hue-rotate(${hue}deg) blur(${blur}px)`;
  return presetStr ? presetStr + ' ' + sliders : sliders;
}

function applyCustomFilters() {
  const bright = document.getElementById('fsBright').value;
  const contrast = document.getElementById('fsContrast').value;
  const sat = document.getElementById('fsSat').value;
  const hue = document.getElementById('fsHue').value;
  const blur = document.getElementById('fsBlur').value;
  document.getElementById('fsBrightV').textContent = bright;
  document.getElementById('fsContrastV').textContent = contrast;
  document.getElementById('fsSatV').textContent = sat;
  document.getElementById('fsHueV').textContent = hue + '°';
  document.getElementById('fsBlurV').textContent = blur + 'px';
  applyVideoFilter(buildCombinedFilter(filterStyle));
}

function resetFilterSliders() {
  ['fsBright','fsContrast','fsSat'].forEach(id => document.getElementById(id).value = 100);
  document.getElementById('fsHue').value = 0;
  document.getElementById('fsBlur').value = 0;
  applyCustomFilters();
}

function applyVideoFilter(style) {
  document.getElementById('videoEl').style.filter = style || 'none';
}

// ─── Canvas FX engine ────────────────────────────────
let currentFx = 'none';
let fxRafId = null;
const ASCII_CHARS = ' .\'`^",:;Il!i><~+_-?][}{1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$';

function setFx(name, btn) {
  currentFx = name;
  // update active button
  document.querySelectorAll('[id^="fx-"]').forEach(b => b.classList.remove('active'));
  if(btn) btn.classList.add('active');

  const canvas = document.getElementById('filterCanvas');
  const vid    = document.getElementById('videoEl');

  if(name === 'none') {
    canvas.style.display = 'none';
    vid.style.display = cameraStream ? 'block' : 'none';
    if(fxRafId) { cancelAnimationFrame(fxRafId); fxRafId = null; }
    return;
  }

  if(!cameraStream) { toast(t('toast_cam_first'), 'warn'); currentFx='none'; return; }

  // hide raw video, show canvas on top
  vid.style.display = 'block'; // keep for pixel reading
  canvas.style.display = 'block';
  canvas.style.transform = currentFx === 'mirror' ? 'scaleX(-1)' : 'scaleX(1)';

  if(fxRafId) cancelAnimationFrame(fxRafId);
  renderFx();
}

function renderFx() {
  if(currentFx === 'none' || !cameraStream) return;
  const vid = document.getElementById('videoEl');
  const canvas = document.getElementById('filterCanvas');
  if(!vid.videoWidth) return;
  fxRafId = requestAnimationFrame(renderFx);

  const W = vid.videoWidth, H = vid.videoHeight;

  if(currentFx === 'ascii') {
    renderAscii(vid, canvas, W, H);
  } else {
    canvas.width  = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    // mirror source always
    ctx.save();
    ctx.translate(W, 0); ctx.scale(-1, 1);
    ctx.drawImage(vid, 0, 0, W, H);
    ctx.restore();

    const id = ctx.getImageData(0, 0, W, H);
    const d  = id.data;

    if(currentFx === 'mirror') {
      // already drawn mirrored, done
    } else if(currentFx === 'pixel') {
      pixelate(ctx, W, H, 12);
    } else if(currentFx === 'thermal') {
      thermal(d, W, H);
      ctx.putImageData(id, 0, 0);
    } else if(currentFx === 'glitch') {
      glitch(ctx, canvas, W, H);
    } else if(currentFx === 'sketch') {
      sketch(ctx, d, W, H);
      ctx.putImageData(id, 0, 0);
    } else if(currentFx === 'night') {
      nightVision(d, W, H);
      ctx.putImageData(id, 0, 0);
    } else if(currentFx === 'halftone') {
      halftone(ctx, d, W, H);
    } else if(currentFx === 'neon2') {
      neonGlow(ctx, d, W, H);
    } else if(currentFx === 'oil') {
      oilPaint(ctx, d, W, H);
    } else if(currentFx === 'mosaic') {
      pixelate(ctx, W, H, 22);
    } else if(currentFx === 'matrix') {
      matrixFx(ctx, d, W, H);
    } else if(currentFx === 'vhs') {
      vhsFx(ctx, d, W, H); ctx.putImageData(id,0,0); vhsOverlay(ctx, W, H);
    } else if(currentFx === 'duotone') {
      duotone(d, W, H); ctx.putImageData(id, 0, 0);
    } else if(currentFx === 'cartoon') {
      cartoon(ctx, d, W, H);
    } else if(currentFx === 'mirror2') {
      quadMirror(ctx, vid, W, H);
    } else if(currentFx === 'rain') {
      ctx.putImageData(id, 0, 0); rainFx(ctx, W, H);
    } else if(currentFx === 'snow') {
      ctx.putImageData(id, 0, 0); snowFx(ctx, W, H);
    } else if(currentFx === 'fire') {
      ctx.putImageData(id, 0, 0); fireFx(ctx, W, H);
    } else if(currentFx === 'blur') {
      blurBgFx(ctx, vid, id, W, H);
    } else if(currentFx === 'zoom') {
      zoomPulseFx(ctx, vid, W, H);
    } else if(currentFx === 'kaleid') {
      kaleidFx(ctx, vid, W, H);
    } else if(currentFx === 'scanlines') {
      ctx.putImageData(id, 0, 0); scanlinesFx(ctx, W, H);
    } else if(currentFx === 'mirror3') {
      nineMirror(ctx, vid, W, H);
    } else if(currentFx === 'shake') {
      shakeFx(ctx, vid, W, H);
    } else if(currentFx === 'fisheye') {
      fisheyeFx(ctx, id, W, H);
    } else if(currentFx === 'tunnel') {
      tunnelFx(ctx, vid, W, H);
    } else if(currentFx === 'stars') {
      ctx.putImageData(id, 0, 0); starsFx(ctx, W, H);
    } else if(currentFx === 'rgb') {
      fxRgbSplit(ctx, id, W, H);
    } else if(currentFx === 'crt') {
      ctx.putImageData(id, 0, 0); fxCrt(ctx, W, H);
    } else if(currentFx === 'sonar') {
      ctx.putImageData(id, 0, 0); fxSonar(ctx, W, H);
    } else if(currentFx === 'prism') {
      fxPrism(ctx, id, W, H);
    } else if(currentFx === 'datamosh') {
      fxDatamosh(ctx, id, W, H);
    } else if(currentFx === 'hologram') {
      ctx.putImageData(id, 0, 0); fxHologram(ctx, W, H);
    } else if(currentFx === 'emboss') {
      fxEmboss(ctx, id, W, H);
    } else if(currentFx === 'edge') {
      fxEdge(ctx, id, W, H);
    } else if(currentFx === 'posterize') {
      fxPosterize(id); ctx.putImageData(id, 0, 0);
    } else if(currentFx === 'tilt') {
      ctx.putImageData(id, 0, 0); fxTiltShift(ctx, W, H);
    } else if(currentFx === 'comic') {
      fxComic(ctx, id, W, H);
    } else if(currentFx === 'warp') {
      fxWarp(ctx, id, W, H);
    } else if(currentFx === 'neon3') {
      ctx.putImageData(id, 0, 0); fxNeonGlow(ctx, W, H);
    } else if(currentFx === 'hearts') {
      ctx.putImageData(id, 0, 0); fxHearts(ctx, W, H);
    } else if(currentFx === 'confetti') {
      ctx.putImageData(id, 0, 0); fxConfetti(ctx, W, H);
    } else if(currentFx === 'lightning') {
      ctx.putImageData(id, 0, 0); fxLightning(ctx, W, H);
    } else if(currentFx === 'negative') {
      fxNegative(id); ctx.putImageData(id, 0, 0);
    } else if(currentFx === 'oldfilm') {
      ctx.putImageData(id, 0, 0); fxOldFilm(ctx, W, H);
    } else if(currentFx === 'split') {
      fxSplit(ctx, id, W, H);
    } else if(currentFx === 'bubble') {
      ctx.putImageData(id, 0, 0); fxBubble(ctx, W, H);
    }
  }
}

// ════════════════════════════════════════
// 20 NOWYCH EFEKTÓW
// ════════════════════════════════════════

// RGB Split — rozsuwa kanały R/G/B
function fxRgbSplit(ctx, id, W, H) {
  const shift = Math.round(8 + Math.sin(Date.now()/400)*6);
  const tmp = document.createElement('canvas'); tmp.width=W; tmp.height=H;
  const t = tmp.getContext('2d'); t.putImageData(id,0,0);
  ctx.clearRect(0,0,W,H);
  ctx.globalCompositeOperation='screen';
  ctx.filter='url(#none)';
  // R shifted left
  ctx.globalAlpha=0.9; ctx.drawImage(tmp, -shift, 0);
  // G center
  ctx.globalAlpha=0.9; ctx.drawImage(tmp, 0, 0);
  // B shifted right
  ctx.globalAlpha=0.9; ctx.drawImage(tmp, shift, 0);
  ctx.globalCompositeOperation='source-over'; ctx.globalAlpha=1;
  // Proper per-pixel split
  const out = ctx.getImageData(0,0,W,H); const d = out.data;
  const src = id.data;
  for(let y=0; y<H; y++) {
    for(let x=0; x<W; x++) {
      const i = (y*W+x)*4;
      const ir = (y*W+Math.min(W-1,x+shift))*4;
      const ib = (y*W+Math.max(0,x-shift))*4;
      d[i]   = src[ir];   // R from right
      d[i+1] = src[i+1];  // G center
      d[i+2] = src[ib+2]; // B from left
      d[i+3] = 255;
    }
  }
  ctx.putImageData(out,0,0);
}

// CRT Monitor — scanlines + barrel distortion vignette
function fxCrt(ctx, W, H) {
  const t = Date.now();
  // scanlines
  for(let y=0; y<H; y+=2) {
    ctx.fillStyle='rgba(0,0,0,0.25)';
    ctx.fillRect(0,y,W,1);
  }
  // horizontal roll line
  const roll = (t/20)%H;
  ctx.fillStyle='rgba(255,255,255,0.04)';
  ctx.fillRect(0,roll,W,3);
  // vignette
  const g = ctx.createRadialGradient(W/2,H/2,H*0.3,W/2,H/2,H*0.8);
  g.addColorStop(0,'transparent');
  g.addColorStop(1,'rgba(0,0,0,0.6)');
  ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
  // screen flicker
  if(Math.random()<0.02) { ctx.fillStyle='rgba(255,255,255,0.03)'; ctx.fillRect(0,0,W,H); }
}

// Sonar — rozchodzące się kręgi
let _sonarRings=[];
function fxSonar(ctx, W, H) {
  if(Math.random()<0.03) _sonarRings.push({r:0,a:0.8,t:Date.now()});
  _sonarRings=_sonarRings.filter(r=>r.a>0.01);
  ctx.save();
  _sonarRings.forEach(ring=>{
    ring.r+=3; ring.a*=0.97;
    ctx.beginPath(); ctx.arc(W/2,H/2,ring.r,0,Math.PI*2);
    ctx.strokeStyle=`rgba(0,245,160,${ring.a})`; ctx.lineWidth=2; ctx.stroke();
  });
  // crosshair
  ctx.strokeStyle='rgba(0,245,160,0.3)'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(W/2,0); ctx.lineTo(W/2,H); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0,H/2); ctx.lineTo(W,H/2); ctx.stroke();
  ctx.restore();
}

// Pryzmat — kolorowe obramowanie przez offset
function fxPrism(ctx, id, W, H) {
  const t = Date.now()/1000;
  const out = ctx.createImageData(W,H); const d=out.data; const s=id.data;
  for(let y=0;y<H;y++) for(let x=0;x<W;x++) {
    const i=(y*W+x)*4;
    const ox=Math.round(Math.sin(y/30+t)*8);
    const oy=Math.round(Math.cos(x/30+t)*8);
    const ir=(Math.max(0,Math.min(H-1,y+oy))*W+Math.max(0,Math.min(W-1,x+ox)))*4;
    const ib=(Math.max(0,Math.min(H-1,y-oy))*W+Math.max(0,Math.min(W-1,x-ox)))*4;
    d[i]=s[ir]; d[i+1]=s[i+1]; d[i+2]=s[ib+2]; d[i+3]=255;
  }
  ctx.putImageData(out,0,0);
}

// Datamosh — losowe bloki poprzedniej klatki
let _dmPrev=null;
function fxDatamosh(ctx, id, W, H) {
  if(!_dmPrev || _dmPrev.width!==W) { _dmPrev=new ImageData(W,H); }
  const out=new ImageData(W,H); const d=out.data; const c=id.data; const p=_dmPrev.data;
  for(let i=0;i<d.length;i+=4) {
    if(Math.random()<0.003) {
      // glitch block
      const bx=Math.floor(Math.random()*W), by=Math.floor(Math.random()*H);
      const bw=20+Math.floor(Math.random()*60), bh=4+Math.floor(Math.random()*20);
      for(let dy=0;dy<bh;dy++) for(let dx=0;dx<bw;dx++) {
        const si=((Math.min(H-1,by+dy))*W+Math.min(W-1,bx+dx))*4;
        const pi=((Math.min(H-1,by+dy))*W+Math.min(W-1,bx+dx))*4;
        d[si]=p[pi]; d[si+1]=p[pi+1]; d[si+2]=p[pi+2]; d[si+3]=255;
      }
    }
    if(!d[i+3]) { d[i]=c[i]; d[i+1]=c[i+1]; d[i+2]=c[i+2]; d[i+3]=255; }
  }
  _dmPrev.data.set(c);
  ctx.putImageData(out,0,0);
}

// Hologram — niebiesko-cyjanowe scanlines + shimmer
function fxHologram(ctx, W, H) {
  const t=Date.now()/1000;
  // tint blue
  ctx.fillStyle='rgba(0,100,255,0.15)'; ctx.fillRect(0,0,W,H);
  // scanlines
  for(let y=0;y<H;y+=3) {
    ctx.fillStyle=`rgba(0,200,255,${0.04+0.02*Math.sin(y/10+t)})`;
    ctx.fillRect(0,y,W,1);
  }
  // vertical shimmer band
  const bx=((t*80)%W+W)%W;
  const g=ctx.createLinearGradient(bx-20,0,bx+20,0);
  g.addColorStop(0,'transparent');
  g.addColorStop(0.5,'rgba(0,255,255,0.12)');
  g.addColorStop(1,'transparent');
  ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
  // edge glow
  const eg=ctx.createLinearGradient(0,0,W,0);
  eg.addColorStop(0,'rgba(0,200,255,0.15)'); eg.addColorStop(0.5,'transparent'); eg.addColorStop(1,'rgba(0,200,255,0.15)');
  ctx.fillStyle=eg; ctx.fillRect(0,0,W,H);
}

// Emboss — relief 3D
function fxEmboss(ctx, id, W, H) {
  const s=id.data; const out=ctx.createImageData(W,H); const d=out.data;
  for(let y=1;y<H-1;y++) for(let x=1;x<W-1;x++) {
    const i=(y*W+x)*4;
    const tl=((y-1)*W+(x-1))*4, br=((y+1)*W+(x+1))*4;
    for(let c=0;c<3;c++) d[i+c]=Math.min(255,Math.max(0,s[tl+c]-s[br+c]+128));
    d[i+3]=255;
  }
  ctx.putImageData(out,0,0);
}

// Edge detection — Sobel operator
function fxEdge(ctx, id, W, H) {
  const s=id.data; const out=ctx.createImageData(W,H); const d=out.data;
  const gray=new Uint8Array(W*H);
  for(let i=0;i<W*H;i++) gray[i]=(s[i*4]*0.299+s[i*4+1]*0.587+s[i*4+2]*0.114);
  for(let y=1;y<H-1;y++) for(let x=1;x<W-1;x++) {
    const i=y*W+x;
    const gx=(-gray[(y-1)*W+x-1]+gray[(y-1)*W+x+1]-2*gray[y*W+x-1]+2*gray[y*W+x+1]-gray[(y+1)*W+x-1]+gray[(y+1)*W+x+1]);
    const gy=(-gray[(y-1)*W+x-1]-2*gray[(y-1)*W+x]-gray[(y-1)*W+x+1]+gray[(y+1)*W+x-1]+2*gray[(y+1)*W+x]+gray[(y+1)*W+x+1]);
    const mag=Math.min(255,Math.sqrt(gx*gx+gy*gy));
    const pi=i*4; d[pi]=d[pi+1]=d[pi+2]=mag; d[pi+3]=255;
  }
  ctx.putImageData(out,0,0);
}

// Posterize — redukuje liczbę kolorów
function fxPosterize(id) {
  const d=id.data; const levels=4; const step=255/levels;
  for(let i=0;i<d.length;i+=4) {
    d[i]  =Math.round(d[i]  /step)*step;
    d[i+1]=Math.round(d[i+1]/step)*step;
    d[i+2]=Math.round(d[i+2]/step)*step;
  }
}

// Tilt-shift — blur na górze i dole, ostro w środku
function fxTiltShift(ctx, W, H) {
  // Optymalizacja: 2 pass zamiast bh iteracji z ctx.filter per linia
  // Pass 1: blurred version na offscreen canvas
  const off = document.createElement('canvas');
  off.width=W; off.height=H;
  const octx=off.getContext('2d');
  octx.filter='blur(5px)';
  octx.drawImage(ctx.canvas,0,0);
  octx.filter='none';

  // Pass 2: gradient mask — środek ostry, góra/dół blurred
  const bh=Math.round(H*0.28); // 28% z góry i dołu
  // Rysuj blurred tylko w strefach góra/dół z gradientem alpha
  const grad=ctx.createLinearGradient(0,0,0,bh);
  grad.addColorStop(0,'rgba(0,0,0,1)');
  grad.addColorStop(1,'rgba(0,0,0,0)');
  ctx.save();

  // Górna strefa
  ctx.globalCompositeOperation='source-over';
  ctx.drawImage(off,0,0,W,bh,0,0,W,bh); // blurred top
  // Gradient mask (wymaż krawędź)
  ctx.globalCompositeOperation='destination-in';
  ctx.globalAlpha=1;
  // Nie używamy maski — po prostu narysuj blurred z alpha gradientem
  ctx.globalCompositeOperation='source-over';

  // Dolna strefa
  ctx.drawImage(off,0,H-bh,W,bh,0,H-bh,W,bh); // blurred bottom

  ctx.restore();
}

// Comic — halftone + boost nasycenia + kontur
function fxComic(ctx, id, W, H) {
  // Boost contrast & saturation
  const d=id.data;
  for(let i=0;i<d.length;i+=4) {
    d[i]  =Math.min(255,d[i]*1.4);
    d[i+1]=Math.min(255,d[i+1]*1.4);
    d[i+2]=Math.min(255,d[i+2]*1.4);
  }
  ctx.putImageData(id,0,0);
  // Ben-Day dots overlay
  ctx.save();
  for(let y=0;y<H;y+=6) for(let x=0;x<W;x+=6) {
    const px=id.data[(y*W+x)*4];
    const r=(px/255)*2.5;
    if(r>0.5) {
      ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2);
      ctx.fillStyle='rgba(0,0,0,0.15)'; ctx.fill();
    }
  }
  ctx.restore();
}

// Warp — sinusoidalne zniekształcenie
function fxWarp(ctx, id, W, H) {
  const t=Date.now()/800; const amp=12;
  const out=ctx.createImageData(W,H); const d=out.data; const s=id.data;
  for(let y=0;y<H;y++) for(let x=0;x<W;x++) {
    const sx=Math.round(x+Math.sin(y/20+t)*amp);
    const sy=Math.round(y+Math.cos(x/20+t)*amp);
    const si=(Math.max(0,Math.min(H-1,sy))*W+Math.max(0,Math.min(W-1,sx)))*4;
    const di=(y*W+x)*4;
    d[di]=s[si]; d[di+1]=s[si+1]; d[di+2]=s[si+2]; d[di+3]=255;
  }
  ctx.putImageData(out,0,0);
}

// Neon Glow — jasne krawędzie z poświatą
function fxNeonGlow(ctx, W, H) {
  ctx.save();
  ctx.filter='blur(8px)';
  ctx.globalCompositeOperation='screen';
  ctx.globalAlpha=0.5;
  ctx.drawImage(ctx.canvas,0,0);
  ctx.globalCompositeOperation='source-over';
  ctx.globalAlpha=1; ctx.filter='none';
  ctx.restore();
}

// Hearts — spadające serduszka
let _hearts=[];
function fxHearts(ctx, W, H) {
  if(Math.random()<0.08) _hearts.push({x:Math.random()*W,y:H+20,s:14+Math.random()*20,v:1.5+Math.random()*2,op:0.8+Math.random()*0.2,hue:Math.random()*60-10});
  _hearts=_hearts.filter(h=>h.y>-30);
  _hearts.forEach(h=>{
    h.y-=h.v; h.x+=Math.sin(h.y/40)*0.8;
    ctx.save(); ctx.globalAlpha=h.op;
    ctx.fillStyle=`hsl(${350+h.hue},100%,65%)`;
    ctx.font=`${h.s}px serif`; ctx.textAlign='center';
    ctx.fillText('❤',h.x,h.y);
    ctx.restore();
  });
}

// Confetti — kolorowe paski
let _conf=[];
function fxConfetti(ctx, W, H) {
  if(Math.random()<0.12) {
    const colors=['#ff4d6d','#f5c400','#00f5a0','#00b4d8','#a855f7','#ff9a3c'];
    _conf.push({x:Math.random()*W,y:-10,w:6+Math.random()*8,h:3+Math.random()*4,vx:(Math.random()-0.5)*3,vy:2+Math.random()*3,rot:Math.random()*Math.PI*2,vr:(Math.random()-0.5)*0.2,col:colors[Math.floor(Math.random()*colors.length)]});
  }
  _conf=_conf.filter(c=>c.y<H+20);
  _conf.forEach(c=>{
    c.x+=c.vx; c.y+=c.vy; c.rot+=c.vr;
    ctx.save(); ctx.translate(c.x,c.y); ctx.rotate(c.rot);
    ctx.fillStyle=c.col; ctx.globalAlpha=0.85;
    ctx.fillRect(-c.w/2,-c.h/2,c.w,c.h);
    ctx.restore();
  });
}

// Lightning — losowe błyskawice
let _ltTimer=0;
function fxLightning(ctx, W, H) {
  if(Date.now()-_ltTimer > 600+Math.random()*800) {
    _ltTimer=Date.now();
    ctx.save();
    ctx.strokeStyle=`rgba(255,230,80,${0.7+Math.random()*0.3})`;
    ctx.lineWidth=1.5+Math.random()*2;
    ctx.shadowBlur=20; ctx.shadowColor='rgba(255,230,80,0.8)';
    let x=Math.random()*W, y=0;
    ctx.beginPath(); ctx.moveTo(x,y);
    while(y<H) {
      x+=(Math.random()-0.5)*60; y+=20+Math.random()*30;
      ctx.lineTo(Math.max(0,Math.min(W,x)),y);
    }
    ctx.stroke(); ctx.restore();
  }
}

// Negatyw — odwraca kolory
function fxNegative(id) {
  const d=id.data;
  for(let i=0;i<d.length;i+=4) { d[i]=255-d[i]; d[i+1]=255-d[i+1]; d[i+2]=255-d[i+2]; }
}

// Old Film — sepię + ziarnistość + zarysowania
function fxOldFilm(ctx, W, H) {
  // Sepia overlay
  ctx.fillStyle='rgba(180,120,40,0.18)'; ctx.fillRect(0,0,W,H);
  // Grain
  for(let i=0;i<800;i++) {
    const x=Math.random()*W, y=Math.random()*H, r=Math.random()*1.5;
    ctx.fillStyle=`rgba(255,255,255,${Math.random()*0.08})`;
    ctx.fillRect(x,y,r,r);
  }
  // Vertical scratch
  if(Math.random()<0.15) {
    const sx=Math.random()*W;
    ctx.strokeStyle=`rgba(255,255,255,${0.1+Math.random()*0.15})`;
    ctx.lineWidth=0.5+Math.random();
    ctx.beginPath(); ctx.moveTo(sx,0); ctx.lineTo(sx+Math.random()*4-2,H); ctx.stroke();
  }
  // Vignette
  const g=ctx.createRadialGradient(W/2,H/2,H*0.25,W/2,H/2,H*0.7);
  g.addColorStop(0,'transparent'); g.addColorStop(1,'rgba(0,0,0,0.5)');
  ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
}

// Split screen — lustrzane odbicie poziome / pionowe
function fxSplit(ctx, id, W, H) {
  ctx.putImageData(id,0,0);
  // lewa połowa normalna, prawa odbita
  ctx.save();
  ctx.translate(W,0); ctx.scale(-1,1);
  ctx.drawImage(ctx.canvas,0,0,W/2,H, W/2,0,W/2,H);
  ctx.restore();
  // linia podziału
  ctx.strokeStyle='rgba(255,255,255,0.3)'; ctx.lineWidth=2;
  ctx.beginPath(); ctx.moveTo(W/2,0); ctx.lineTo(W/2,H); ctx.stroke();
}

// Bąbelki — pęczki bąbelków
let _bubbles=[];
function fxBubble(ctx, W, H) {
  if(Math.random()<0.06) _bubbles.push({x:Math.random()*W,y:H+10,r:8+Math.random()*20,v:0.8+Math.random()*1.5,op:0.4+Math.random()*0.4});
  _bubbles=_bubbles.filter(b=>b.y+b.r>0);
  _bubbles.forEach(b=>{
    b.y-=b.v; b.x+=Math.sin(b.y/30)*0.5;
    ctx.save(); ctx.globalAlpha=b.op;
    ctx.beginPath(); ctx.arc(b.x,b.y,b.r,0,Math.PI*2);
    const g=ctx.createRadialGradient(b.x-b.r*0.3,b.y-b.r*0.3,b.r*0.1,b.x,b.y,b.r);
    g.addColorStop(0,'rgba(255,255,255,0.6)');
    g.addColorStop(0.3,'rgba(100,200,255,0.2)');
    g.addColorStop(1,'rgba(100,200,255,0.05)');
    ctx.fillStyle=g; ctx.fill();
    ctx.strokeStyle='rgba(150,230,255,0.4)'; ctx.lineWidth=1; ctx.stroke();
    ctx.restore();
  });
}

// ── Pixelate ──
function pixelate(ctx, W, H, size) {
  ctx.imageSmoothingEnabled = false;
  const tmp = document.createElement('canvas');
  tmp.width = Math.floor(W/size); tmp.height = Math.floor(H/size);
  const t = tmp.getContext('2d');
  t.imageSmoothingEnabled = false;
  t.drawImage(ctx.canvas, 0, 0, tmp.width, tmp.height);
  ctx.clearRect(0,0,W,H);
  ctx.drawImage(tmp, 0, 0, W, H);
}

// ── Thermal ──
function thermal(d, W, H) {
  for(let i=0; i<d.length; i+=4) {
    const v = (d[i]*0.299 + d[i+1]*0.587 + d[i+2]*0.114) / 255;
    // map 0→blue, 0.5→red, 1→yellow/white
    if(v < 0.25)      { d[i]=0;         d[i+1]=0;           d[i+2]=Math.round(v*4*255); }
    else if(v < 0.5)  { d[i]=0;         d[i+1]=Math.round((v-0.25)*4*255); d[i+2]=255-Math.round((v-0.25)*4*255); }
    else if(v < 0.75) { d[i]=Math.round((v-0.5)*4*255); d[i+1]=255; d[i+2]=0; }
    else              { d[i]=255;        d[i+1]=255;         d[i+2]=Math.round((v-0.75)*4*255); }
  }
}

// ── Glitch ──
function glitch(ctx, canvas, W, H) {
  const slices = 6 + Math.floor(Math.random()*6);
  for(let s=0; s<slices; s++) {
    const sy = Math.floor(Math.random()*H);
    const sh = Math.floor(4 + Math.random()*20);
    const dx = Math.floor((Math.random()-0.5)*40);
    ctx.drawImage(canvas, 0, sy, W, sh, dx, sy, W, sh);
  }
  // color aberration
  ctx.globalCompositeOperation='screen';
  ctx.globalAlpha=0.15;
  ctx.fillStyle='#ff0000';
  ctx.fillRect(Math.random()*10-5, 0, W, H);
  ctx.fillStyle='#0000ff';
  ctx.fillRect(-Math.random()*10+5, 0, W, H);
  ctx.globalAlpha=1; ctx.globalCompositeOperation='source-over';
}

// ── Sketch (edge detect) ──
function sketch(ctx, d, W, H) {
  const gray = new Uint8Array(W*H);
  for(let i=0;i<W*H;i++) gray[i] = d[i*4]*0.299 + d[i*4+1]*0.587 + d[i*4+2]*0.114;
  for(let y=1;y<H-1;y++) {
    for(let x=1;x<W-1;x++) {
      const gx = -gray[(y-1)*W+(x-1)] + gray[(y-1)*W+(x+1)]
                 -2*gray[y*W+(x-1)]   + 2*gray[y*W+(x+1)]
                 -gray[(y+1)*W+(x-1)] + gray[(y+1)*W+(x+1)];
      const gy = -gray[(y-1)*W+(x-1)] - 2*gray[(y-1)*W+x] - gray[(y-1)*W+(x+1)]
                 +gray[(y+1)*W+(x-1)] + 2*gray[(y+1)*W+x] + gray[(y+1)*W+(x+1)];
      const mag = Math.min(255, Math.sqrt(gx*gx+gy*gy)*1.5);
      const edge = 255 - mag;
      const idx = (y*W+x)*4;
      d[idx]=d[idx+1]=d[idx+2]=edge; d[idx+3]=255;
    }
  }
}

// ── Night vision ──
function nightVision(d, W, H) {
  for(let i=0;i<d.length;i+=4) {
    const v = (d[i]*0.299 + d[i+1]*0.587 + d[i+2]*0.114);
    const boosted = Math.min(255, v * 2.2);
    d[i]   = Math.floor(boosted * 0.1);
    d[i+1] = Math.floor(boosted * 1.0);
    d[i+2] = Math.floor(boosted * 0.1);
    // random noise
    if(Math.random() < 0.01) { d[i]=d[i+1]=d[i+2]=Math.random()*60+180; }
  }
}

// ── Halftone ──
function halftone(ctx, d, W, H) {
  const size = 8;
  ctx.fillStyle = '#000'; ctx.fillRect(0,0,W,H);
  for(let y=0;y<H;y+=size) {
    for(let x=0;x<W;x+=size) {
      const idx = (y*W+x)*4;
      const br  = (d[idx]+d[idx+1]+d[idx+2])/3/255;
      const r   = br * size * 0.7;
      const hue = Math.round(d[idx+0]*1.2) % 360;
      ctx.fillStyle = `hsl(${hue},80%,55%)`;
      ctx.beginPath();
      ctx.arc(x+size/2, y+size/2, r, 0, Math.PI*2);
      ctx.fill();
    }
  }
}

// ── Neon Glow ──
function neonGlow(ctx, d, W, H) {
  // Optymalizacja: grayscale tylko co 2. piksel (interpolacja reszty)
  // + precompute hue jako 3 wartości zamiast 3x sin per piksel
  const gray = new Uint8Array(W*H);
  for(let i=0;i<W*H;i++) gray[i]=(d[i*4]*77+d[i*4+1]*150+d[i*4+2]*29)>>8;
  const hueBase = (Date.now()/40) % 360;
  const RAD = Math.PI/180;
  // Precompute 3 color channels dla hue
  const r0 = (Math.sin(hueBase*RAD)*0.5+0.5);
  const g0 = (Math.sin((hueBase+120)*RAD)*0.5+0.5);
  const b0 = (Math.sin((hueBase+240)*RAD)*0.5+0.5);
  // Sobel tylko co 2. piksel w Y, interpoluj między nimi
  for(let y=1;y<H-1;y+=2) {
    for(let x=1;x<W-1;x++) {
      const gx=(-gray[(y-1)*W+x-1]+gray[(y-1)*W+x+1]-2*gray[y*W+x-1]+2*gray[y*W+x+1]-gray[(y+1)*W+x-1]+gray[(y+1)*W+x+1]);
      const gy=(-gray[(y-1)*W+x-1]-2*gray[(y-1)*W+x]-gray[(y-1)*W+x+1]+gray[(y+1)*W+x-1]+2*gray[(y+1)*W+x]+gray[(y+1)*W+x+1]);
      const e=Math.min(255,(Math.abs(gx)+Math.abs(gy))*1.5);
      const idx=(y*W+x)*4;
      d[idx]  =e*r0; d[idx+1]=e*g0; d[idx+2]=e*b0;
      // interpoluj wiersz y+1 (kopiuj wartość)
      if(y+1<H-1){const idx2=((y+1)*W+x)*4; d[idx2]=d[idx];d[idx2+1]=d[idx+1];d[idx2+2]=d[idx+2];}
    }
  }
  ctx.putImageData(new ImageData(d,W,H),0,0);
}

// ── Oil Paint (radius-based mode) ──
function oilPaint(ctx, d, W, H) {
  // Optymalizacja: R=2 zamiast 4 (25px zamiast 81px), LEVELS=8, flat arrays
  const R=2, LEVELS=8;
  const out=new Uint8ClampedArray(d.length);
  // Przetwarzaj co 2. piksel, interpoluj resztę
  for(let y=R;y<H-R;y++) {
    for(let x=R;x<W-R;x++) {
      const cnt=new Uint16Array(LEVELS);
      const sr=new Uint16Array(LEVELS), sg=new Uint16Array(LEVELS), sb=new Uint16Array(LEVELS);
      for(let dy=-R;dy<=R;dy++) {
        for(let dx=-R;dx<=R;dx++) {
          const i=((y+dy)*W+(x+dx))<<2;
          const lv=((d[i]+d[i+1]+d[i+2])*LEVELS/765)|0;
          const lvc=lv<LEVELS?lv:LEVELS-1;
          cnt[lvc]++; sr[lvc]+=d[i]; sg[lvc]+=d[i+1]; sb[lvc]+=d[i+2];
        }
      }
      let max=0, mi=0;
      for(let l=0;l<LEVELS;l++) if(cnt[l]>max){max=cnt[l];mi=l;}
      const idx=(y*W+x)<<2;
      out[idx]=sr[mi]/cnt[mi]; out[idx+1]=sg[mi]/cnt[mi]; out[idx+2]=sb[mi]/cnt[mi]; out[idx+3]=255;
    }
  }
  ctx.putImageData(new ImageData(out,W,H),0,0);
}

// ── Matrix rain ──
const matrixDrops=[];
function matrixFx(ctx, d, W, H) {
  // Darken original
  for(let i=0;i<d.length;i+=4){d[i]=d[i]*0.1;d[i+1]=d[i+1]*0.3+40;d[i+2]=d[i+2]*0.1;}
  ctx.putImageData(new ImageData(d,W,H),0,0);
  // init drops
  const cols=Math.floor(W/12);
  if(matrixDrops.length!==cols){matrixDrops.length=0;for(let i=0;i<cols;i++)matrixDrops.push(Math.random()*H);}
  ctx.font='11px Space Mono,monospace'; ctx.fillStyle='#00ff41';
  matrixDrops.forEach((y,i)=>{
    const ch=String.fromCharCode(0x30A0+Math.random()*96);
    ctx.globalAlpha=0.8; ctx.fillText(ch,i*12,y);
    ctx.globalAlpha=1;
    if(y>H&&Math.random()>0.975) matrixDrops[i]=0;
    else matrixDrops[i]+=14;
  });
}

// ── VHS ──
function vhsFx(ctx, d, W, H) {
  // color shift + noise
  for(let i=0;i<d.length;i+=4){
    d[i]  =Math.min(255,d[i]+10);
    d[i+2]=Math.max(0,d[i+2]-15);
    if(Math.random()<0.004){d[i]=d[i+1]=d[i+2]=200+Math.random()*55;}
  }
}
function vhsOverlay(ctx, W, H) {
  // scanlines
  ctx.globalAlpha=0.07;
  for(let y=0;y<H;y+=2){ctx.fillStyle='#000';ctx.fillRect(0,y,W,1);}
  // horizontal glitch band
  if(Math.random()<0.08){
    const by=Math.random()*H, bh=2+Math.random()*6, bx=(Math.random()-0.5)*20;
    ctx.globalAlpha=0.4; ctx.drawImage(ctx.canvas,0,by,W,bh,bx,by,W,bh);
  }
  // timestamp
  ctx.globalAlpha=0.6; ctx.fillStyle='#fff';
  ctx.font='12px Space Mono,monospace';
  const now=new Date(); ctx.fillText(`REC ${now.toTimeString().slice(0,8)}`,10,H-12);
  ctx.globalAlpha=1;
}

// ── Duotone (purple + cyan) ──
function duotone(d, W, H) {
  for(let i=0;i<d.length;i+=4){
    const v=(d[i]*0.299+d[i+1]*0.587+d[i+2]*0.114)/255;
    d[i]  =Math.round(v*123+(1-v)*0);
    d[i+1]=Math.round(v*31+(1-v)*180);
    d[i+2]=Math.round(v*162+(1-v)*216);
  }
}

// ── Cartoon ──
function cartoon(ctx, d, W, H) {
  // quantize colors + sketch edges overlay
  const qd=new Uint8ClampedArray(d.length);
  const LEVELS=5;
  for(let i=0;i<d.length;i+=4){
    qd[i]  =Math.round(d[i]  /255*(LEVELS-1))/(LEVELS-1)*255;
    qd[i+1]=Math.round(d[i+1]/255*(LEVELS-1))/(LEVELS-1)*255;
    qd[i+2]=Math.round(d[i+2]/255*(LEVELS-1))/(LEVELS-1)*255;
    qd[i+3]=255;
  }
  ctx.putImageData(new ImageData(qd,W,H),0,0);
  // edge overlay
  const gray=new Uint8Array(W*H);
  for(let i=0;i<W*H;i++) gray[i]=d[i*4]*0.299+d[i*4+1]*0.587+d[i*4+2]*0.114;
  const ed=ctx.getImageData(0,0,W,H);
  for(let y=1;y<H-1;y++) for(let x=1;x<W-1;x++){
    const gx=Math.abs(-gray[(y-1)*W+x-1]+gray[(y-1)*W+x+1]-2*gray[y*W+x-1]+2*gray[y*W+x+1]-gray[(y+1)*W+x-1]+gray[(y+1)*W+x+1]);
    const gy=Math.abs(-gray[(y-1)*W+x-1]-2*gray[(y-1)*W+x]-gray[(y-1)*W+x+1]+gray[(y+1)*W+x-1]+2*gray[(y+1)*W+x]+gray[(y+1)*W+x+1]);
    if(gx+gy>80){const idx=(y*W+x)*4;ed.data[idx]=0;ed.data[idx+1]=0;ed.data[idx+2]=0;}
  }
  ctx.putImageData(ed,0,0);
}

// ── 4x Quad Mirror ──
function quadMirror(ctx, vid, W, H) {
  const hw=W/2, hh=H/2;
  ctx.clearRect(0,0,W,H);
  // top-left: normal mirrored
  ctx.save(); ctx.translate(hw,0); ctx.scale(-1,1);
  ctx.drawImage(vid,0,0,hw,hh); ctx.restore();
  // top-right: copy top-left
  ctx.save(); ctx.translate(W,0); ctx.scale(-1,1);
  ctx.drawImage(ctx.canvas,0,0,hw,hh,0,0,hw,hh); ctx.restore();
  // bottom: flip top half vertically
  ctx.save(); ctx.translate(0,H); ctx.scale(1,-1);
  ctx.drawImage(ctx.canvas,0,0,W,hh,0,0,W,hh); ctx.restore();
}

// ── Rain drops ──
const rainDropsArr=[];
function rainFx(ctx, W, H) {
  if(rainDropsArr.length<120) for(let i=rainDropsArr.length;i<120;i++)
    rainDropsArr.push({x:Math.random()*W,y:Math.random()*H,len:10+Math.random()*20,spd:4+Math.random()*8,op:0.3+Math.random()*0.5});
  ctx.strokeStyle='rgba(150,200,255,0.5)'; ctx.lineWidth=1;
  rainDropsArr.forEach(drop=>{
    ctx.globalAlpha=drop.op;
    ctx.beginPath(); ctx.moveTo(drop.x,drop.y); ctx.lineTo(drop.x-2,drop.y+drop.len); ctx.stroke();
    drop.y+=drop.spd; drop.x-=1;
    if(drop.y>H){drop.y=-drop.len; drop.x=Math.random()*W;}
  });
  ctx.globalAlpha=1;
}

// ── Snow ──
const snowArr=[];
function snowFx(ctx, W, H) {
  if(snowArr.length<180) for(let i=snowArr.length;i<180;i++)
    snowArr.push({x:Math.random()*W, y:Math.random()*H, r:1+Math.random()*3, spd:0.5+Math.random()*2, drift:Math.random()*0.8-0.4, op:0.4+Math.random()*0.6});
  snowArr.forEach(s=>{
    ctx.globalAlpha=s.op;
    ctx.fillStyle='#fff'; ctx.beginPath(); ctx.arc(s.x,s.y,s.r,0,Math.PI*2); ctx.fill();
    s.y+=s.spd; s.x+=s.drift;
    if(s.y>H+4){s.y=-4; s.x=Math.random()*W;}
    if(s.x>W+4) s.x=-4; if(s.x<-4) s.x=W+4;
  });
  ctx.globalAlpha=1;
}

// ── Fire particles ──
const fireArr=[];
function fireFx(ctx, W, H) {
  // spawn new embers at bottom
  for(let i=0;i<4;i++)
    fireArr.push({x:Math.random()*W, y:H, vx:(Math.random()-0.5)*2, vy:-(2+Math.random()*4), life:1, size:3+Math.random()*6});
  // draw & update
  for(let i=fireArr.length-1;i>=0;i--){
    const f=fireArr[i];
    const l=f.life;
    ctx.globalAlpha=l*0.85;
    // color: white→yellow→orange→red as life fades
    const r=255, g=Math.round(l>0.5?255:l*2*255), b=Math.round(l>0.7?l*200:0);
    ctx.fillStyle=`rgb(${r},${g},${b})`;
    ctx.beginPath(); ctx.arc(f.x,f.y,f.size*l,0,Math.PI*2); ctx.fill();
    f.x+=f.vx; f.y+=f.vy; f.vy-=0.05; f.life-=0.018; f.size*=0.99;
    if(f.life<=0) fireArr.splice(i,1);
  }
  if(fireArr.length>600) fireArr.splice(0, fireArr.length-600);
  ctx.globalAlpha=1;
}

// ── Blur background (portrait mode simulation) ──
function blurBgFx(ctx, vid, id, W, H) {
  // draw blurred full frame
  ctx.filter='blur(12px) brightness(0.7)';
  ctx.drawImage(vid, 0, 0, W, H);
  ctx.filter='none';
  // draw sharp center crop (60% of frame)
  const cw=W*0.6, ch=H*0.6;
  const sx=(W-cw)/2, sy=(H-ch)/2;
  ctx.save();
  ctx.beginPath(); ctx.ellipse(W/2,H/2,cw/2,ch/2,0,0,Math.PI*2); ctx.clip();
  ctx.translate(W,0); ctx.scale(-1,1);
  ctx.drawImage(vid,-W,0,W,H);
  ctx.restore();
  // vignette
  const vg=ctx.createRadialGradient(W/2,H/2,H*0.25,W/2,H/2,H*0.65);
  vg.addColorStop(0,'rgba(0,0,0,0)'); vg.addColorStop(1,'rgba(0,0,0,0.5)');
  ctx.fillStyle=vg; ctx.fillRect(0,0,W,H);
}

// ── Zoom pulse ──
let _zoomPhase=0;
function zoomPulseFx(ctx, vid, W, H) {
  _zoomPhase+=0.04;
  const sc=1+Math.sin(_zoomPhase)*0.06; // oscillates ±6%
  const ox=(W-(W*sc))/2, oy=(H-(H*sc))/2;
  ctx.save();
  ctx.translate(W,0); ctx.scale(-1,1);
  ctx.drawImage(vid, -ox-W, oy, W*sc, H*sc);
  ctx.restore();
}

// ── Kalejdoskop ──
function kaleidFx(ctx, vid, W, H) {
  const tmp=document.createElement('canvas'); tmp.width=W; tmp.height=H;
  const t=tmp.getContext('2d');
  t.translate(W,0); t.scale(-1,1); t.drawImage(vid,-W,0,W,H);
  const slices=8;
  const angle=Math.PI*2/slices;
  ctx.clearRect(0,0,W,H);
  ctx.save(); ctx.translate(W/2,H/2);
  for(let i=0;i<slices;i++){
    ctx.save(); ctx.rotate(i*angle);
    ctx.beginPath(); ctx.moveTo(0,0);
    ctx.arc(0,0,Math.max(W,H),0,angle); ctx.clip();
    if(i%2===1){ ctx.scale(-1,1); ctx.rotate(-angle/2); } else ctx.rotate(-angle/2);
    ctx.drawImage(tmp,-W/2,-H/2,W,H);
    ctx.restore();
  }
  ctx.restore();
}

// ── Scanlines ──
function scanlinesFx(ctx, W, H) {
  ctx.fillStyle='rgba(0,0,0,0.35)';
  for(let y=0;y<H;y+=3){ ctx.fillRect(0,y,W,1); }
  // slight horizontal RGB shift
  ctx.globalCompositeOperation='screen'; ctx.globalAlpha=0.06;
  ctx.fillStyle='#ff0000'; ctx.fillRect(-2,0,W,H);
  ctx.fillStyle='#0000ff'; ctx.fillRect(2,0,W,H);
  ctx.globalCompositeOperation='source-over'; ctx.globalAlpha=1;
}

// ── 9x Mirror ──
function nineMirror(ctx, vid, W, H) {
  const cw=W/3, ch=H/3;
  for(let col=0;col<3;col++) for(let row=0;row<3;row++){
    ctx.save(); ctx.translate(col*cw,row*ch);
    const fx=(col%2===1)?-1:1, fy=(row%2===1)?-1:1;
    ctx.scale(fx,fy);
    ctx.drawImage(vid, fx===-1?-cw:0, fy===-1?-ch:0, cw, ch);
    ctx.restore();
  }
}

// ── Shake ──
let _shakeT=0;
function shakeFx(ctx, vid, W, H) {
  _shakeT+=0.15;
  const dx=Math.sin(_shakeT*3.7)*6, dy=Math.cos(_shakeT*2.9)*4;
  ctx.save();
  ctx.translate(dx,dy);
  ctx.translate(W,0); ctx.scale(-1,1);
  ctx.drawImage(vid,-W,0,W,H);
  ctx.restore();
  // chromatic aberration
  ctx.globalCompositeOperation='screen'; ctx.globalAlpha=0.12;
  ctx.fillStyle='#ff0000'; ctx.fillRect(dx-3,dy,W,H);
  ctx.fillStyle='#0000ff'; ctx.fillRect(dx+3,dy,W,H);
  ctx.globalCompositeOperation='source-over'; ctx.globalAlpha=1;
}

// ── Fisheye ──
function fisheyeFx(ctx, id, W, H) {
  const src=id.data;
  const out=ctx.createImageData(W,H);
  const d=out.data;
  const cx=W/2, cy=H/2, R=Math.min(W,H)/2;
  for(let y=0;y<H;y++) for(let x=0;x<W;x++){
    const nx=(x-cx)/R, ny=(y-cy)/R;
    const r=Math.sqrt(nx*nx+ny*ny);
    if(r>1){const i=(y*W+x)*4;d[i]=0;d[i+1]=0;d[i+2]=0;d[i+3]=255;continue;}
    const theta=Math.atan2(ny,nx);
    const r2=r*r; // barrel distortion
    const sx=Math.round(cx+r2*Math.cos(theta)*R);
    const sy=Math.round(cy+r2*Math.sin(theta)*R);
    const si=((Math.max(0,Math.min(H-1,sy))*W+Math.max(0,Math.min(W-1,sx)))*4);
    const di=(y*W+x)*4;
    d[di]=src[si]; d[di+1]=src[si+1]; d[di+2]=src[si+2]; d[di+3]=255;
  }
  ctx.putImageData(out,0,0);
}

// ── Tunnel (zoom-in warp) ──
let _tunnelT=0;
function tunnelFx(ctx, vid, W, H) {
  _tunnelT+=0.02;
  const layers=6;
  for(let i=layers;i>=0;i--){
    const t=((i/layers)+_tunnelT)%1;
    const sc=1-t*0.95;
    const alpha=i===0?1:0.25;
    ctx.globalAlpha=alpha;
    const dw=W*sc, dh=H*sc;
    ctx.save(); ctx.translate(W,0); ctx.scale(-1,1);
    ctx.drawImage(vid,-(W-dw)/2-W,(H-dh)/2,dw,dh);
    ctx.restore();
  }
  ctx.globalAlpha=1;
}

// ── Stars ──
const starsArr=[];
function starsFx(ctx, W, H) {
  if(starsArr.length<120) for(let i=starsArr.length;i<120;i++)
    starsArr.push({x:Math.random()*W, y:Math.random()*H, r:0.5+Math.random()*1.5, twinkle:Math.random()*Math.PI*2, speed:0.05+Math.random()*0.1});
  starsArr.forEach(s=>{
    s.twinkle+=s.speed;
    const op=0.4+Math.sin(s.twinkle)*0.5;
    ctx.globalAlpha=Math.max(0,op);
    ctx.fillStyle='#fff';
    ctx.beginPath(); ctx.arc(s.x,s.y,s.r,0,Math.PI*2); ctx.fill();
    // cross sparkle for bigger stars
    if(s.r>1.2){
      ctx.strokeStyle='rgba(255,255,255,0.4)'; ctx.lineWidth=0.5;
      ctx.beginPath(); ctx.moveTo(s.x-s.r*3,s.y); ctx.lineTo(s.x+s.r*3,s.y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(s.x,s.y-s.r*3); ctx.lineTo(s.x,s.y+s.r*3); ctx.stroke();
    }
  });
  ctx.globalAlpha=1;
}

// ── ASCII art ──
function renderAscii(vid, canvas, W, H) {
  const COLS = 100, ROWS = 55;
  canvas.width  = COLS * 7;
  canvas.height = ROWS * 12;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000'; ctx.fillRect(0,0,canvas.width,canvas.height);

  const tmp = document.createElement('canvas');
  tmp.width = COLS; tmp.height = ROWS;
  const t = tmp.getContext('2d');
  t.translate(COLS,0); t.scale(-1,1);
  t.drawImage(vid, 0, 0, COLS, ROWS);
  const pd = t.getImageData(0,0,COLS,ROWS).data;

  ctx.font = '10px Space Mono, monospace';
  for(let row=0;row<ROWS;row++) {
    for(let col=0;col<COLS;col++) {
      const i = (row*COLS+col)*4;
      const br = (pd[i]+pd[i+1]+pd[i+2])/3;
      const ci = Math.floor((br/255)*(ASCII_CHARS.length-1));
      const ch = ASCII_CHARS[ci];
      const hue = Math.round(pd[i] * 1.5) % 360;
      ctx.fillStyle = `hsl(${hue},70%,65%)`;
      ctx.fillText(ch, col*7, row*12+10);
    }
  }
}

function toggleVideoFullscreen() {
  const wrap = document.getElementById('videoWrap');
  const btn  = document.getElementById('fsBtnVideo');
  const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement);

  if (!isFs) {
    const req = wrap.requestFullscreen || wrap.webkitRequestFullscreen || wrap.mozRequestFullScreen;
    if (req) req.call(wrap);
  } else {
    const ex = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen;
    if (ex) ex.call(document);
  }
}

// Update button icon on fullscreen change
document.addEventListener('fullscreenchange',      updateFsBtn);
document.addEventListener('webkitfullscreenchange', updateFsBtn);
document.addEventListener('mozfullscreenchange',    updateFsBtn);

function updateFsBtn() {
  const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement);
  const btn = document.getElementById('fsBtnVideo');
  if (btn) btn.textContent = isFs ? '✕' : '⛶';
}

function takeSnapshot() {
  if(!cameraStream) { toast(t('toast_cam_first'), 'warn'); return; }
  const vid = document.getElementById('videoEl');
  const fxCanvas = document.getElementById('filterCanvas');
  const snap = document.getElementById('snapCanvas');

  // if canvas FX is active, grab from it — otherwise grab from video with mirror+filter
  if(currentFx !== 'none' && fxCanvas.style.display !== 'none' && fxCanvas.width > 0) {
    snap.width  = fxCanvas.width;
    snap.height = fxCanvas.height;
    snap.getContext('2d').drawImage(fxCanvas, 0, 0);
  } else {
    snap.width  = vid.videoWidth  || 640;
    snap.height = vid.videoHeight || 480;
    const ctx = snap.getContext('2d');
    ctx.save();
    ctx.translate(snap.width, 0);
    ctx.scale(-1, 1);
    const f = buildCombinedFilter(filterStyle);
    if(f && f !== 'none') ctx.filter = f;
    ctx.drawImage(vid, 0, 0, snap.width, snap.height);
    ctx.restore();
  }

  const img = document.getElementById('snapPreview');
  img.src = snap.toDataURL('image/png');
  img.style.display = 'block';
  const link = document.getElementById('snapLink');
  link.href = img.src;
  link.download = 'snapshot_' + Date.now() + '.png';
  link.click();
}

// ─── INTERNET TEST ────────────────────────────────────
let netTesting = false;
let netSession = 0; // incremented each start — stale async checks against this
const CX = 160, CY = 210, R = 120, MAX_SPEED = 1000;
let gaugeInited = false;

function polarToXY(angleDeg, r) {
  const rad = (angleDeg - 90) * Math.PI / 180;
  return { x: CX + r * Math.cos(rad), y: CY + r * Math.sin(rad) };
}

function arcPath(startDeg, endDeg, r) {
  const s = polarToXY(startDeg, r);
  const e = polarToXY(endDeg, r);
  const large = (endDeg - startDeg) > 180 ? 1 : 0;
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y}`;
}

function initGaugeSvg() {
  if(gaugeInited) return;
  gaugeInited = true;
  document.getElementById('arcBg').setAttribute('d', arcPath(-180, 0, R));
  const arcEl = document.getElementById('arcFill');
  const totalLen = Math.PI * R;
  arcEl.setAttribute('d', arcPath(-180, 0, R));
  arcEl.style.strokeDasharray = totalLen;
  arcEl.style.strokeDashoffset = totalLen;

  const tickG = document.getElementById('ticks');
  const labG  = document.getElementById('scaleLabels');
  // Clear old ticks if re-init
  tickG.innerHTML = ''; labG.innerHTML = '';

  const steps = [0, 50, 100, 200, 300, 500, 700, 1000];
  const bigLabels = [0, 100, 200, 300, 500, 700, 1000];
  steps.forEach(spd => {
    const ang   = -180 + (spd / MAX_SPEED) * 180;
    const isBig = bigLabels.includes(spd);
    const outer = polarToXY(ang, R + (isBig ? 16 : 10));
    const inner = polarToXY(ang, R + 4);
    const tick  = document.createElementNS('http://www.w3.org/2000/svg','line');
    tick.setAttribute('x1', inner.x); tick.setAttribute('y1', inner.y);
    tick.setAttribute('x2', outer.x); tick.setAttribute('y2', outer.y);
    tick.setAttribute('stroke', isBig ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.1)');
    tick.setAttribute('stroke-width', isBig ? '2.5' : '1');
    tickG.appendChild(tick);
    if(isBig) {
      const lp = polarToXY(ang, R + 30);
      const t  = document.createElementNS('http://www.w3.org/2000/svg','text');
      t.setAttribute('x', lp.x); t.setAttribute('y', lp.y);
      t.setAttribute('text-anchor','middle'); t.setAttribute('dominant-baseline','middle');
      t.textContent = spd >= 1000 ? '1G' : spd;
      labG.appendChild(t);
    }
  });
}

function setGaugeSpeed(mbps) {
  const arcEl   = document.getElementById('arcFill');
  const totalLen = Math.PI * R;
  // Auto-scale: gauge shows full arc at 2x current max — always fills nicely
  let scale = MAX_SPEED;
  if(mbps > 0) {
    // Round up to next nice scale: 10, 25, 50, 100, 200, 500, 1000, 2000
    const scales = [10, 25, 50, 100, 200, 500, 1000, 2000];
    scale = scales.find(s => s >= mbps * 1.3) || 2000;
    // Update gauge labels if scale changed
    const scaleEl = document.getElementById('netGaugeMax');
    if(scaleEl && scaleEl.dataset.scale !== String(scale)) {
      scaleEl.textContent = scale >= 1000 ? (scale/1000)+'Gbps' : scale+'Mb/s';
      scaleEl.dataset.scale = scale;
    }
  }
  const pct = Math.min(mbps / scale, 1);
  arcEl.style.strokeDashoffset = totalLen * (1 - pct);
  const color = mbps > 500 ? '#00f5a0' : mbps > 200 ? '#00d4c0' : mbps > 50 ? '#00b4d8' : mbps > 10 ? '#f5c400' : '#ff4d6d';
  arcEl.setAttribute('stroke', color);
  arcEl.style.filter = `drop-shadow(0 0 10px ${color})`;
  const ang = -180 + pct * 180;
  document.getElementById('needle').style.transform = `rotate(${ang}deg)`;
  document.getElementById('netSpeedNum').textContent = mbps >= 1 ? mbps.toFixed(1) : mbps.toFixed(2);
  document.getElementById('netSpeedNum').style.color = color;
}

function resetGauge() {
  const arcEl   = document.getElementById('arcFill');
  const totalLen = Math.PI * R;
  arcEl.style.strokeDashoffset = totalLen;
  arcEl.setAttribute('stroke', '#00b4d8');
  arcEl.style.filter = 'drop-shadow(0 0 8px #00b4d8)';
  document.getElementById('needle').style.transform = 'rotate(-180deg)';
  document.getElementById('netSpeedNum').textContent = '—';
  document.getElementById('netSpeedNum').style.color = '#fff';
}

// ── Net side panel state ──
let netSpeedHistory = [];
let netHistRafId = null;

function netLog(msg, cls='') {
  const log = document.getElementById('netLiveLog');
  if(!log) return;
  const t = new Date(); const ts = `${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}:${String(t.getSeconds()).padStart(2,'0')}`;
  const div = document.createElement('div');
  div.className = 'log-line' + (cls?' '+cls:'');
  div.textContent = `[${ts}] ${msg}`;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

// ── Historia canvas — throttle do ~10fps (nie potrzeba 60fps) ──
let _netHistLastDraw = 0;
function drawNetHistory() {
  const modal = document.getElementById('netModal');
  if(!modal || !modal.classList.contains('show')) { netHistRafId = null; return; }
  netHistRafId = requestAnimationFrame(drawNetHistory);
  const now = performance.now();
  if(now - _netHistLastDraw < 50) return;
  _netHistLastDraw = now;
  const canvas = document.getElementById('netHistoryCanvas');
  if(!canvas) return;
  const w = canvas.offsetWidth || 280;
  if(canvas.width !== w) canvas.width = w;
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d');

  // Dark background with subtle grid
  ctx.fillStyle = 'rgba(0,5,15,0.85)'; ctx.fillRect(0,0,W,H);

  // Grid lines
  ctx.strokeStyle = 'rgba(0,180,216,0.08)'; ctx.lineWidth = 1;
  for(let i=1;i<4;i++) {
    const y = Math.round(H/4*i);
    ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke();
  }
  for(let i=1;i<6;i++) {
    const x = Math.round(W/6*i);
    ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke();
  }

  if(netSpeedHistory.length < 2) {
    ctx.fillStyle='rgba(0,180,216,0.3)'; ctx.font='12px Space Mono,monospace';
    ctx.textAlign='center'; ctx.fillText('czeka na dane...', W/2, H/2);
    ctx.textAlign='left';
    return;
  }

  const maxVal = Math.max(...netSpeedHistory, 1) * 1.15;

  // Gradient fill under curve
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, 'rgba(0,245,160,0.35)');
  grad.addColorStop(0.5, 'rgba(0,180,216,0.2)');
  grad.addColorStop(1, 'rgba(0,180,216,0.02)');

  // Smooth curve using bezier
  ctx.beginPath();
  const pts = netSpeedHistory.map((v,i) => ({
    x: (i/(netSpeedHistory.length-1))*W,
    y: H - (v/maxVal)*(H-12) - 6
  }));
  ctx.moveTo(pts[0].x, pts[0].y);
  for(let i=1;i<pts.length-1;i++) {
    const cx = (pts[i].x + pts[i+1].x)/2;
    const cy = (pts[i].y + pts[i+1].y)/2;
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, cx, cy);
  }
  ctx.lineTo(pts[pts.length-1].x, pts[pts.length-1].y);
  ctx.lineTo(W,H); ctx.lineTo(0,H); ctx.closePath();
  ctx.fillStyle = grad; ctx.fill();

  // Main line — glow effect
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for(let i=1;i<pts.length-1;i++) {
    const cx = (pts[i].x + pts[i+1].x)/2;
    const cy = (pts[i].y + pts[i+1].y)/2;
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, cx, cy);
  }
  ctx.lineTo(pts[pts.length-1].x, pts[pts.length-1].y);
  ctx.strokeStyle = '#00f5a0'; ctx.lineWidth = 2.5;
  ctx.shadowBlur = 10; ctx.shadowColor = '#00f5a0';
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Dot at current value
  const last = pts[pts.length-1];
  ctx.beginPath(); ctx.arc(last.x, last.y, 5, 0, Math.PI*2);
  ctx.fillStyle = '#00f5a0';
  ctx.shadowBlur = 12; ctx.shadowColor = '#00f5a0';
  ctx.fill(); ctx.shadowBlur = 0;

  // Speed label — big and visible
  const lastVal = netSpeedHistory[netSpeedHistory.length-1];
  const maxV = netSpeedHistory[netSpeedHistory.length-1];
  ctx.fillStyle = '#00f5a0';
  ctx.font = 'bold 18px Space Mono,monospace';
  ctx.textAlign = 'right';
  ctx.shadowBlur = 8; ctx.shadowColor = '#00f5a0';
  ctx.fillText(lastVal >= 100 ? lastVal.toFixed(0) : lastVal.toFixed(1), W-8, 22);
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.font = '9px Space Mono,monospace';
  ctx.fillText('Mb/s', W-8, 34);
  ctx.textAlign = 'left';

  // Max label
  ctx.fillStyle = 'rgba(255,255,255,0.2)';
  ctx.font = '8px Space Mono,monospace';
  ctx.fillText('max: ' + (Math.max(...netSpeedHistory)).toFixed(1), 5, H-5);
}

async function fetchIpInfo() {
  // reset all fields to "Ładowanie..."
  ['nspIp','nspIsp','nspOrg','nspAsn','nspType','nspProtocol','nspDeclaredSpeed','nspRtt','nspVpn','nspCountry','nspCity','nspRegion','nspTimezone','nspCoords'].forEach(id => {
    const el = document.getElementById(id);
    if(el) el.textContent = '⏳';
  });
  document.getElementById('nspTestTime').textContent = new Date().toLocaleTimeString(currentLang === 'pl' ? 'pl-PL' : currentLang === 'de' ? 'de-DE' : currentLang === 'ru' ? 'ru-RU' : currentLang === 'zh' ? 'zh-CN' : currentLang === 'fr' ? 'fr-FR' : currentLang === 'es' ? 'es-ES' : currentLang === 'it' ? 'it-IT' : currentLang === 'ja' ? 'ja-JP' : currentLang === 'ko' ? 'ko-KR' : currentLang === 'nl' ? 'nl-NL' : currentLang === 'pt' ? 'pt-PT' : currentLang === 'ua' ? 'uk-UA' : 'en-GB');

  // ── 1. Try IP APIs — tylko te które działają z HTTPS + CORS ──
  // ip-api.com blokuje HTTPS na darmowym planie → zastępujemy Cloudflare trace
  const IP_APIS = [
    {
      // Cloudflare trace — zawsze działa (używamy CF do speed testu)
      url: 'https://cloudflare.com/cdn-cgi/trace',
      isText: true,
      parse: text => {
        const get = key => { const m = new RegExp('^' + key + '=(.+)$', 'm').exec(text); return m ? m[1].trim() : null; };
        return {
          ip: get('ip'),
          isp: 'Cloudflare PoP: ' + (get('colo') || '—'),
          org: get('warp') === 'on' ? 'Cloudflare Warp' : null,
          cc: get('loc'),
          country: get('loc'),
          _cfColo: get('colo'),
          _cfWarp: get('warp'),
        };
      }
    },
    {
      // ipinfo.io — bezpłatny, CORS OK, dobra geolokalizacja
      url: 'https://ipinfo.io/json',
      parse: d => ({
        ip: d.ip,
        city: d.city,
        region: d.region,
        country: d.country,
        cc: d.country,
        lat: d.loc ? parseFloat(d.loc.split(',')[0]) : null,
        lon: d.loc ? parseFloat(d.loc.split(',')[1]) : null,
        tz: d.timezone,
        isp: d.org,
        org: d.org,
        asn: d.org ? d.org.split(' ')[0] : null,
      })
    },
    {
      // ipwho.is — CORS OK
      url: 'https://ipwho.is/',
      parse: d => ({
        ip: d.ip, city: d.city, region: d.region, country: d.country, cc: d.country_code,
        lat: d.latitude, lon: d.longitude, tz: d.timezone?.id,
        isp: d.connection?.isp, org: d.connection?.org, asn: d.connection?.asn,
        proxy: d.security?.proxy, vpn: d.security?.vpn
      })
    },
    {
      // ipify — tylko IP, ostatnia deska
      url: 'https://api.ipify.org?format=json',
      parse: d => ({ ip: d.ip })
    },
  ];

  // Helper: XHR zamiast fetch() — XHR NIE jest przechwytywane przez service workery
  // fetch() na Netlify jest interceptowane przez SW → "Failed to fetch" dla zewnętrznych domen
  function fetchWithTimeout(url, ms) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      xhr.responseType = 'text';
      xhr.timeout = ms;
      xhr.onload = () => {
        if(xhr.status >= 200 && xhr.status < 400) {
          // Emuluj Response API żeby reszta kodu działała bez zmian
          resolve({
            ok: true,
            status: xhr.status,
            headers: { get: () => null },
            text: () => Promise.resolve(xhr.responseText),
            json: () => Promise.resolve(JSON.parse(xhr.responseText))
          });
        } else {
          reject(new Error('HTTP ' + xhr.status));
        }
      };
      xhr.onerror   = () => reject(new Error('Network error'));
      xhr.ontimeout = () => reject(new Error('Timeout ' + ms + 'ms'));
      xhr.send();
    });
  }

  let data = null;
  let usedApi = '';
  const apiErrors = [];
  for(const api of IP_APIS) {
    try {
      const t0 = performance.now();
      const resp = await fetchWithTimeout(api.url, 7000);
      if(!resp.ok) { apiErrors.push(`${api.url.split('/')[2]}: HTTP ${resp.status}`); continue; }
      const raw  = api.isText ? await resp.text() : await resp.json();
      const rtt  = Math.round(performance.now() - t0);
      if(!api.isText && raw.status === 'fail') { apiErrors.push(`${api.url.split('/')[2]}: status=fail`); continue; }
      if(!api.isText && !raw.ip && !raw.ipAddress && !raw.query) { apiErrors.push(`${api.url.split('/')[2]}: brak IP`); continue; }
      if(api.isText && !raw.includes('ip=')) { apiErrors.push(`${api.url.split('/')[2]}: brak ip= w trace`); continue; }
      data = api.parse(raw);
      data._rtt = rtt;
      usedApi = api.url.replace('https://','').split('/')[0];
      console.log('[IP] OK via', usedApi, data);

      // Jeśli CF trace — dokup geolokalizację z ipinfo.io
      if(api.isText && data.ip) {
        try {
          const geoResp = await fetchWithTimeout('https://ipinfo.io/json', 5000);
          if(geoResp.ok) {
            const geo = await geoResp.json();
            data.city    = geo.city    || data.city;
            data.region  = geo.region  || data.region;
            data.country = geo.country || data.country;
            data.cc      = geo.country || data.cc;
            data.tz      = geo.timezone || data.tz;
            data.isp     = geo.org     || data.isp;
            data.org     = geo.org     || data.org;
            data.asn     = geo.org?.split(' ')[0] || data.asn;
            if(geo.loc) {
              const [lat, lon] = geo.loc.split(',').map(Number);
              data.lat = lat; data.lon = lon;
            }
          }
        } catch(e) { /* geo optional */ }
      }
      break;
    } catch(e) {
      apiErrors.push(`${api.url.split('/')[2]}: ${e.name} ${e.message}`);
      console.warn('[IP] fail', api.url.split('/')[2], e.name + ': ' + e.message);
    }
  }
  if(!data) console.error('[IP] Wszystkie API zawiodły:', apiErrors);

  if(data) {
    // ── IP ──
    document.getElementById('nspIp').textContent  = data.ip || '—';
    document.getElementById('nspRtt').textContent = `${data._rtt} ms (via ${usedApi})`;

    // ── Location ──
    const flag = data.cc ? [...data.cc.toUpperCase()].map(c => String.fromCodePoint(c.charCodeAt(0)+127397)).join('') : '';
    document.getElementById('nspCountry').textContent = [flag, data.country, data.cc ? '('+data.cc+')' : ''].filter(Boolean).join(' ') || '—';
    document.getElementById('nspCity').textContent    = data.city   || '—';
    document.getElementById('nspRegion').textContent  = data.region || '—';
    document.getElementById('nspTimezone').textContent = data.tz || Intl.DateTimeFormat().resolvedOptions().timeZone || '—';

    // ── Współrzędne: GPS (przeglądarka) > IP geolokalizacja ──
    const ipLat = Number(data.lat), ipLon = Number(data.lon);
    const hasIpCoords = data.lat != null && !isNaN(ipLat);

    async function showCoords(lat, lon, source) {
      const latStr = Math.abs(lat).toFixed(5) + '° ' + (lat >= 0 ? 'N' : 'S');
      const lonStr = Math.abs(lon).toFixed(5) + '° ' + (lon >= 0 ? 'E' : 'W');
      const sourceLabel = source === 'gps' ? ' 📍 GPS' : ' 🌐 IP';
      document.getElementById('nspCoords').innerHTML =
        `${latStr} / ${lonStr}<br><span style="font-size:8px;color:rgba(255,255,255,0.3);">${sourceLabel} ${source === 'gps' ? '(dokładny)' : '(lokalizacja ISP — może się różnić)'}</span>`;

      const mapsUrl = `https://www.google.com/maps?q=${lat.toFixed(6)},${lon.toFixed(6)}&z=${source==='gps'?15:10}`;
      const mapsLink = document.getElementById('nspMapsLink');
      if(mapsLink) { mapsLink.href = mapsUrl; mapsLink.style.display = 'inline'; }

      const mapWrap = document.getElementById('nspMapWrap');
      if(mapWrap) {
        mapWrap.style.display = 'block';
        mapWrap.style.height  = '180px';
        mapWrap.innerHTML = '<div id="nspLeafletMap" style="width:100%;height:180px;border-radius:10px;"></div>';
        if(!window.L) {
          const css = document.createElement('link');
          css.rel = 'stylesheet';
          css.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
          document.head.appendChild(css);
          await new Promise(resolve => {
            const s = document.createElement('script');
            s.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
            s.onload = resolve; document.head.appendChild(s);
          });
        }
        if(window._nspMap) { window._nspMap.remove(); window._nspMap = null; }
        const zoom = source === 'gps' ? 15 : 9;
        const map = L.map('nspLeafletMap', { zoomControl: true, attributionControl: false }).setView([lat, lon], zoom);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
        const color = source === 'gps' ? '#00f5a0' : '#ff4d6d';
        const icon = L.divIcon({
          html: `<div style="width:${source==='gps'?'14px':'16px'};height:${source==='gps'?'14px':'16px'};background:${color};border:3px solid #fff;border-radius:50%;box-shadow:0 0 10px ${color}80;"></div>`,
          iconSize: [16,16], iconAnchor: [8,8], className: ''
        });
        const cityLabel = source === 'gps' ? 'Twoja lokalizacja (GPS)' : (data.city || '—');
        L.marker([lat, lon], { icon }).addTo(map).bindPopup(`<b>${cityLabel}</b><br>${data.country || ''}`).openPopup();
        window._nspMap = map;
      }
    }

    // Spróbuj GPS przeglądarki najpierw (dokładne)
    const coordsEl = document.getElementById('nspCoords');
    if('geolocation' in navigator) {
      coordsEl.innerHTML = '<span style="color:rgba(255,255,255,0.3);font-size:9px;">📍 Pytam o pozwolenie GPS...</span>';
      navigator.geolocation.getCurrentPosition(
        pos => {
          // GPS sukces — nadpisz IP coords dokładnymi
          showCoords(pos.coords.latitude, pos.coords.longitude, 'gps');
        },
        err => {
          // Odmowa lub błąd — użyj IP coords jako fallback
          if(hasIpCoords) showCoords(ipLat, ipLon, 'ip');
          else coordsEl.textContent = '— (GPS odmowa · brak IP coords)';
        },
        { timeout: 8000, maximumAge: 60000, enableHighAccuracy: true }
      );
    } else if(hasIpCoords) {
      showCoords(ipLat, ipLon, 'ip');
    } else {
      coordsEl.textContent = '—';
    }

    // ── ISP / ASN ──
    const asnRaw = String(data.asn || data.org || '');
    const asnMatch = asnRaw.match(/^(AS\d+)\s*(.*)/i);
    const asnNum  = asnMatch ? asnMatch[1] : (data.asn ? `AS${data.asn}` : '—');
    const ispName = data.isp || (asnMatch ? asnMatch[2] : '') || data.org || '—';
    document.getElementById('nspIsp').textContent = ispName;
    document.getElementById('nspOrg').textContent = data.org || ispName || '—';
    document.getElementById('nspAsn').textContent = asnNum;

    // ── VPN / Proxy — pokaż co wiedzą API, nie blokuj testu ──
    const flags = [];
    if(data.proxy)   flags.push('⚠️ Proxy');
    if(data.vpn)     flags.push('🔒 VPN');
    if(data.tor)     flags.push('🧅 Tor');
    if(data.hosting) flags.push('🖥️ Datacenter/VPS');
    // Jeśli API nie zwrócił tych pól (np. ipapi.co nie ma), nie zakładaj braku VPN
    const hasVpnData = data.proxy !== undefined || data.vpn !== undefined || data.tor !== undefined || data.hosting !== undefined;
    document.getElementById('nspVpn').textContent = flags.length
      ? flags.join(' · ') + ' (IP wychodzące przez ' + (data.country || 'VPN') + ')'
      : hasVpnData ? '✅ Brak wykrytego VPN/Proxy' : '— (API nie wykrywa VPN)';

    netLog(`IP: ${data.ip}`, 'good');
    netLog(`ISP: ${ispName}`);
    netLog(`Lokalizacja: ${data.city||'?'}, ${data.country||'?'}`);
    if(apiErrors.length) netLog(`APIs: ${apiErrors.slice(0,2).join(' | ')}`, 'warn');
    if(flags.length) netLog(`🔒 ${flags.join(', ')} — test prędkości mierzy łącze VPN`, 'warn');

  } else {
    // Wszystkie API zawiodły — może VPN blokuje zewnętrzne requesty
    document.getElementById('nspIp').textContent  = '❌ Niedostępne';
    document.getElementById('nspIsp').textContent = '— (VPN / adblocker blokuje API)';
    document.getElementById('nspVpn').textContent = '⚠️ Nie udało się pobrać danych';
    document.getElementById('nspRtt').textContent = apiErrors.join(' | ').slice(0,120) || '—';
    ['nspOrg','nspAsn','nspCountry','nspCity','nspRegion','nspTimezone','nspCoords','nspRtt'].forEach(id => {
      const el = document.getElementById(id); if(el) el.textContent = '—';
    });
    netLog('⚠️ Wszystkie IP API niedostępne — prawdopodobnie adblocker lub VPN blokuje requesty do zewnętrznych serwisów', 'warn');
    netLog('ℹ️ Test prędkości (START) działa niezależnie — możesz go uruchomić normalnie', 'good');
  }

  // ── 2. Connection type ──
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;

  let connType = '—';
  let connDetail = '';

  if(conn) {
    const rawType = conn.type || '';
    const eff     = conn.effectiveType || '';
    const rtt     = conn.rtt     || 0;
    const dl      = conn.downlink || 0;

    if(rawType === 'wifi')          connType = '📶 WiFi';
    else if(rawType === 'ethernet') connType = '🔌 Ethernet / LAN';
    else if(rawType === 'cellular') connType = '📱 Komórkowe';
    else if(rawType === 'bluetooth')connType = '📡 Bluetooth';
    else {
      if(dl >= 10 && rtt <= 50)          connType = '📶 WiFi (szybkie)';
      else if(dl >= 2 && rtt <= 150)     connType = '📶 WiFi / Ethernet';
      else if(dl < 2 && eff === '3g')    connType = '📱 Komórkowe 3G';
      else if(eff === '4g')              connType = '📶 WiFi lub 4G LTE';
      else if(eff === '2g' || eff === 'slow-2g') connType = '📱 Komórkowe 2G';
      else                               connType = navigator.onLine ? '🌐 Online' : '❌ Offline';
    }

    const effMap = {'slow-2g':'Slow 2G','2g':'2G','3g':'3G','4g':'4G / WiFi'};
    connDetail = effMap[eff] || eff.toUpperCase() || '';

    const proto = window.location.protocol === 'https:' ? 'HTTPS · TLS 1.3' : 'HTTP (nieszyfrowane)';
    document.getElementById('nspProtocol').textContent = [connDetail, proto].filter(Boolean).join(' · ');

    const dlStr  = dl   ? `⬇ ~${dl} Mb/s`   : '';
    const rttStr = rtt  ? `ping ~${rtt} ms`  : '';
    const saveData = conn.saveData ? '🔋 Oszczędzanie danych ON' : '';
    document.getElementById('nspDeclaredSpeed').textContent = [dlStr, rttStr, saveData].filter(Boolean).join('  ·  ') || '—';

    netLog(`Połączenie: ${connType} (${connDetail || '?'})`);
    if(dl) netLog(`Prędkość wg przeglądarki: ~${dl} Mb/s`);
  } else {
    connType = navigator.onLine ? '🌐 Online (brak Network API)' : '❌ Offline';
    document.getElementById('nspProtocol').textContent     = window.location.protocol === 'https:' ? 'HTTPS · TLS' : 'HTTP';
    document.getElementById('nspDeclaredSpeed').textContent = '— (Network Information API niedostępne)';
    netLog('Network Information API niedostępne (Firefox/Safari)', 'warn');
  }

  document.getElementById('nspType').textContent = connType;
}

let _pingProgressSamples = [];

async function detectNetlifyInfo() {
  const nav = performance.getEntriesByType('navigation')[0];
  if (nav) {
    const proto = nav.nextHopProtocol || '';
    const protoLabel = proto==='h3'?'⚡ HTTP/3 (QUIC)':proto==='h2'?'✅ HTTP/2':proto==='http/1.1'?'🔶 HTTP/1.1':proto?proto.toUpperCase():'— (brak danych)';
    document.getElementById('nspHttpProto').textContent = protoLabel;
    const ttfb = Math.round(nav.responseStart - nav.requestStart);
    document.getElementById('nspTtfb').textContent = ttfb>0?`${ttfb} ms ${ttfb<100?'✅':ttfb<300?'⚡':'🔴'}`:'— (cache)';
    const dns = Math.round(nav.domainLookupEnd - nav.domainLookupStart);
    document.getElementById('nspDns').textContent = dns>0?`${dns} ms ${dns<30?'✅':dns<100?'⚡':'🔴'}`:'— (cached)';
  } else {
    ['nspHttpProto','nspTtfb','nspDns'].forEach(id=>{ document.getElementById(id).textContent='— (brak API)'; });
  }
  try {
    const r = await fetch(window.location.href,{method:'HEAD',cache:'no-store'});
    const server=r.headers.get('server')||'', via=r.headers.get('via')||'';
    const xNf=r.headers.get('x-nf-request-id')||r.headers.get('x-netlify')||'';
    const cfRay=r.headers.get('cf-ray')||'', xCache=r.headers.get('x-cache')||'';
    const age=r.headers.get('age');
    let parts=[];
    if(xNf) parts.push('🟢 Netlify Edge');
    else if(cfRay) parts.push('🟠 Cloudflare');
    else if(server.toLowerCase().includes('cloudfront')) parts.push('☁️ AWS CloudFront');
    else if(server.toLowerCase().includes('nginx')) parts.push('🔵 Nginx');
    else if(server.toLowerCase().includes('apache')) parts.push('🔴 Apache');
    else if(via) parts.push('🌐 via '+via.slice(0,25));
    else if(server) parts.push('🖥️ '+server.slice(0,25));
    else parts.push('— (brak nagłówków)');
    if(xCache) parts.push('Cache: '+xCache.slice(0,15));
    if(age!==null) parts.push('Age: '+age+'s');
    document.getElementById('nspCdn').textContent = parts.join(' · ');
  } catch(e) {
    const nav2=performance.getEntriesByType('navigation')[0];
    const p=nav2?nav2.nextHopProtocol:'';
    document.getElementById('nspCdn').textContent = p==='h3'?'⚡ HTTP/3 — CDN':p==='h2'?'✅ HTTP/2 — CDN':'— (plik lokalny / CORS)';
  }
}

function openNetTest() {
  // kill any running worker from previous session
  if(window._netWorker) { try { window._netWorker.terminate(); } catch(e){} window._netWorker = null; }
  netTesting = false;
  netSession++;
  netSpeedHistory = [];
  document.getElementById('netModal').classList.add('show');
  gaugeInited = false;
  initGaugeSvg();
  document.getElementById('netLiveLog').innerHTML = '';
  document.getElementById('nspTestTime').textContent = new Date().toLocaleTimeString(currentLang === 'pl' ? 'pl-PL' : currentLang === 'de' ? 'de-DE' : currentLang === 'ru' ? 'ru-RU' : currentLang === 'zh' ? 'zh-CN' : currentLang === 'fr' ? 'fr-FR' : currentLang === 'es' ? 'es-ES' : currentLang === 'it' ? 'it-IT' : currentLang === 'ja' ? 'ja-JP' : currentLang === 'ko' ? 'ko-KR' : currentLang === 'nl' ? 'nl-NL' : currentLang === 'pt' ? 'pt-PT' : currentLang === 'ua' ? 'uk-UA' : 'en-GB');
  document.getElementById('netPhaseLabel').textContent = t('net_press_start') || 'Naciśnij START';
  document.getElementById('netPhaseTimer').textContent = '0:00';
  document.getElementById('netPhaseBar').style.transition = 'none';
  document.getElementById('netPhaseBar').style.width = '0%';
  document.getElementById('netPhaseSec').textContent = '';
  document.getElementById('netSpeedNum').textContent = '—';
  document.getElementById('netSpeedUnit').textContent = 'Mb/s';
  const btn = document.getElementById('btnStartNet');
  if(btn) { btn.disabled = false; btn.textContent = t('net_start_btn') || '▶ START'; }
  ['Down','Ping','Up'].forEach(id => {
    pillPhase(id, '');
    document.getElementById('val'+id).textContent = '—';
  });
  resetGauge();
  if(netHistRafId) cancelAnimationFrame(netHistRafId);
  drawNetHistory();
  fetchIpInfo();
  detectNetlifyInfo();
  _pingProgressSamples = [];
  document.getElementById('nspJitter').textContent = '— ms';
  netLog('Panel otwarty — naciśnij START');
}

function closeNetTest(force) {
  if(netTesting && !force) return;
  netTesting = false;
  netSession++; // kills any running async startNetTest
  stopTimer();

  // abort any running fetch streams / worker
  if(window._netWorker) { try { window._netWorker.terminate(); } catch(e){} window._netWorker = null; }
  if(window._netAbortCtrl) { try { window._netAbortCtrl.abort(); } catch(e){} window._netAbortCtrl = null; }

  // stop the history canvas RAF loop
  if(netHistRafId) { cancelAnimationFrame(netHistRafId); netHistRafId = null; }

  // full UI reset so reopening starts clean
  document.getElementById('netPhaseLabel').textContent = t('net_press_start') || 'Naciśnij START';
  document.getElementById('netPhaseTimer').textContent = '0:00';
  document.getElementById('netPhaseBar').style.transition = 'none';
  document.getElementById('netPhaseBar').style.width = '0%';
  document.getElementById('netPhaseSec').textContent = '';
  document.getElementById('netSpeedNum').textContent = '—';
  document.getElementById('netSpeedUnit').textContent = 'Mb/s';
  const btn = document.getElementById('btnStartNet');
  if(btn) { btn.disabled = false; btn.textContent = t('net_start_btn') || '▶ START'; }
  resetGauge();

  document.getElementById('netModal').classList.remove('show');
}

function pillPhase(id, cls) {
  document.getElementById('pill'+id).className = 'net-res-pill ' + cls;
}

// ── Timer display ──
let timerInterval = null;
let phaseStartTime = 0;
let phaseDuration = 0;

function startTimer(phaseSec) {
  phaseDuration = phaseSec;
  let t = 0;
  clearInterval(timerInterval);
  document.getElementById('netPhaseBar').style.transition = 'none';
  document.getElementById('netPhaseBar').style.width = '0%';
  document.getElementById('netPhaseSec').textContent = phaseSec + 's';
  timerInterval = setInterval(() => {
    t++;
    const s = t % 60, m = Math.floor(t / 60);
    document.getElementById('netPhaseTimer').textContent = `${m}:${String(s).padStart(2,'0')}`;
    const pct = Math.min((t / phaseDuration) * 100, 100);
    document.getElementById('netPhaseBar').style.transition = 'width 1s linear';
    document.getElementById('netPhaseBar').style.width = pct + '%';
    // DON'T stop the interval here — let stopTimer() handle it
    // This way timer keeps going even if phase takes slightly longer than expected
  }, 1000);
}
function stopTimer(complete) {
  clearInterval(timerInterval);
  timerInterval = null;
  if(complete) {
    document.getElementById('netPhaseBar').style.width = '100%';
  }
  document.getElementById('netPhaseSec').textContent = '';
}

// ── Ping: 12 requests, 3 równoległe, odrzuć outliers ──
// ── Speed test via Web Worker (osobny wątek — brak lagów UI) ──
function runSpeedWorker(phase, onProgress, aliveCheck) {
  if(window._netWorker) { try { window._netWorker.terminate(); } catch(e){} window._netWorker = null; }

  // Endpoints — tylko sprawdzone CORS-friendly
  const DL_ENDPOINTS = [
    b => `https://speed.cloudflare.com/__down?bytes=${b}&t=${Date.now()}`,
    b => `https://bouygues.testdebit.info/${b >= 1048576 ? '100M' : '10M'}.iso`,
  ];
  const UP_ENDPOINTS = [
    `https://speed.cloudflare.com/__up`,
  ];

  // ── Helpers ──
  function abortAfter(ms) {
    const c = new AbortController();
    setTimeout(() => c.abort(), ms);
    return c.signal;
  }

  function instantMbps(win, totalBytes, t0) {
    const now = performance.now();
    while(win.length > 2 && win[0].t < now - 800) win.shift();
    if(win.length < 2) {
      const el = (now - t0) / 1000;
      return el > 0.3 ? (totalBytes * 8) / 1e6 / el : 0;
    }
    const dt = (win[win.length-1].t - win[0].t) / 1000;
    const db = win[win.length-1].bytes - win[0].bytes;
    return (dt > 0.05 && db > 0) ? (db * 8) / 1e6 / dt : 0;
  }

  // ── PING ──
  async function doPing() {
    const DURATION = 8000;
    const t0 = performance.now();
    const results = [];
    let lastGood = null;
    // Cloudflare 1-byte download — najbardziej niezawodny CORS ping
    const PING_URL = () => `https://speed.cloudflare.com/__down?bytes=1&t=${Date.now()}`;

    while(performance.now() - t0 < DURATION) {
      if(aliveCheck && !aliveCheck()) break;
      const times = await Promise.all([0,1,2].map(async () => {
        const pt = performance.now();
        try {
          const r = await fetch(PING_URL(), { cache:'no-store', mode:'cors', signal: abortAfter(3000) });
          await r.arrayBuffer();
          return Math.round(performance.now() - pt);
        } catch(e) { return null; }
      }));
      const good = times.filter(t => t !== null);
      if(good.length) {
        good.sort((a,b) => a-b);
        const med = good[Math.floor(good.length/2)];
        results.push(med); lastGood = med;
        onProgress(med);
      } else if(lastGood !== null) {
        onProgress(lastGood);
      }
      await new Promise(r => setTimeout(r, 100));
    }
    if(!results.length) return 0;
    results.sort((a,b) => a-b);
    const trimmed = results.slice(0, Math.max(1, Math.floor(results.length * 0.75)));
    return Math.round(trimmed.reduce((a,b) => a+b, 0) / trimmed.length);
  }

  // ── DOWNLOAD ──
  async function doDownload() {
    const DURATION = 15000;
    const t0 = performance.now();
    let totalBytes = 0;
    let done = false;
    const samples = [];

    // XHR-based download — XHR nie wymaga CORS preflight dla niektórych serwerów
    const xhrUrls = [
      'https://speed.cloudflare.com/__down?bytes=10000000',
      'https://proof.ovh.net/files/10Mb.dat',
      'https://bouygues.testdebit.info/10M.iso',
    ];

    // Znajdź działający URL przez HEAD (bez CORS mode)
    let dlUrl = null;
    for(const url of xhrUrls) {
      try {
        const ok = await new Promise(resolve => {
          const x = new XMLHttpRequest();
          x.open('HEAD', url, true);
          x.onload = () => resolve(x.status < 400);
          x.onerror = () => resolve(false);
          x.ontimeout = () => resolve(false);
          x.timeout = 4000;
          x.send();
        });
        if(ok) { dlUrl = url; netLog('⬇️ Endpoint: ' + url.split('/')[2], 'good'); break; }
      } catch(e) {}
    }

    if(!dlUrl) {
      netLog('⬇️ Brak dostępnego serwera testowego. Pobieranie niedostępne z tej domeny.', 'warn');
      return 0;
    }

    // XHR stream z onprogress
    function xhrGet() {
      return new Promise(resolve => {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', dlUrl + '&r=' + Math.random(), true);
        xhr.responseType = 'arraybuffer';
        let lastLoaded = 0;
        xhr.onprogress = e => {
          if(done) { xhr.abort(); resolve(); return; }
          const delta = e.loaded - lastLoaded;
          lastLoaded = e.loaded;
          if(delta > 0) {
            totalBytes += delta;
            samples.push({ t: performance.now(), bytes: totalBytes });
          }
        };
        xhr.onload = xhr.onerror = xhr.ontimeout = resolve;
        xhr.timeout = 13000;
        try { xhr.send(); } catch(e) { resolve(); }
      });
    }

    // Progress reporter
    let lastSmoothed = 0;
    const prog = setInterval(() => {
      if(done || samples.length < 2) return;
      const now = performance.now();
      const recent = samples.filter(s => s.t > now - 1000);
      if(recent.length < 2) return;
      const dt = (recent[recent.length-1].t - recent[0].t) / 1000;
      const db = recent[recent.length-1].bytes - recent[0].bytes;
      if(dt <= 0 || db <= 0) return;
      const mbps = (db * 8) / 1e6 / dt;
      lastSmoothed = lastSmoothed === 0 ? mbps : lastSmoothed * 0.7 + mbps * 0.3;
      onProgress(Math.max(0, parseFloat(lastSmoothed.toFixed(2))));
    }, 200);

    async function runStreams() {
      while(!done && (performance.now() - t0) < DURATION) {
        await Promise.all([xhrGet(), xhrGet(), xhrGet(), xhrGet()]);
      }
    }

    await Promise.race([
      runStreams(),
      new Promise(r => setTimeout(() => { done = true; r(); }, DURATION))
    ]);
    done = true;
    clearInterval(prog);

    if(samples.length < 4) return 0;
    const stable = samples.filter(s => s.t >= t0 + 2000);
    if(stable.length >= 2) {
      const dt = (stable[stable.length-1].t - stable[0].t) / 1000;
      const db = stable[stable.length-1].bytes - stable[0].bytes;
      if(dt > 0 && db > 0) return parseFloat(((db * 8) / 1e6 / dt).toFixed(1));
    }
    const el = (performance.now() - t0) / 1000;
    return el > 0 ? parseFloat(((totalBytes * 8) / 1e6 / el).toFixed(1)) : 0;
  }

  // ── UPLOAD — streaming ReadableStream do Cloudflare ──
  async function doUpload() {
    const DURATION = 12000;
    const t0 = performance.now();
    let totalBytes = 0;
    let done = false;
    const samples = [];

    // Payload 4MB
    const seed = new Uint8Array(65536);
    crypto.getRandomValues(seed);
    const PAYLOAD_SIZE = 4 * 1024 * 1024;
    const payload = new Uint8Array(PAYLOAD_SIZE);
    for(let off = 0; off < PAYLOAD_SIZE; off += 65536)
      payload.set(seed.subarray(0, Math.min(65536, PAYLOAD_SIZE - off)), off);

    // Użyj Netlify Function jako upload endpoint (ta sama domena = zero CORS)
    // Fallback: /api/upload → /.netlify/functions/upload → echo serwery
    const SAME_ORIGIN_ENDPOINTS = [
      '/api/upload',
      '/.netlify/functions/upload',
    ];
    const EXTERNAL_ENDPOINTS = [
      'https://httpbin.org/post',
      'https://httpbingo.org/post',
    ];

    // Sprawdź same-origin najpierw
    let upUrl = null;
    for(const url of SAME_ORIGIN_ENDPOINTS) {
      const ok = await new Promise(resolve => {
        const x = new XMLHttpRequest();
        x.open('POST', url, true);
        x.timeout = 3000;
        x.onload = () => resolve(x.status >= 200 && x.status < 300);
        x.onerror = x.ontimeout = () => resolve(false);
        x.send(new Uint8Array(128));
      });
      if(ok) { upUrl = url; netLog('⬆️ Upload: same-origin endpoint ' + url, 'good'); break; }
    }

    // Fallback: zewnętrzne (wolniejsze ale działają)
    if(!upUrl) {
      for(const url of EXTERNAL_ENDPOINTS) {
        const ok = await new Promise(resolve => {
          const x = new XMLHttpRequest();
          x.open('POST', url, true);
          x.timeout = 5000;
          x.onload = () => resolve(x.status >= 200 && x.status < 300);
          x.onerror = x.ontimeout = () => resolve(false);
          x.send(new Uint8Array(128));
        });
        if(ok) { upUrl = url; netLog('⬆️ Upload: ' + url.split('/')[2] + ' (ograniczona przepustowość)', 'warn'); break; }
      }
    }

    if(!upUrl) {
      netLog('⬆️ Brak endpointu upload. Dodaj funkcję Netlify: /.netlify/functions/upload', 'warn');
      netLog('⬆️ Patrz: github.com/netlify/functions/blob/main/README.md', 'warn');
      return 0;
    }

    let lastSmoothed = 0;
    const prog = setInterval(() => {
      if(done || samples.length < 2) return;
      const now = performance.now();
      const recent = samples.filter(s => s.t > now - 1500);
      if(recent.length < 2) return;
      const dt = (recent[recent.length-1].t - recent[0].t) / 1000;
      const db = recent[recent.length-1].bytes - recent[0].bytes;
      if(dt <= 0 || db <= 0) return;
      const mbps = (db * 8) / 1e6 / dt;
      lastSmoothed = lastSmoothed === 0 ? mbps : lastSmoothed * 0.7 + mbps * 0.3;
      onProgress(Math.max(0, parseFloat(lastSmoothed.toFixed(2))));
    }, 200);

    function xhrUpload() {
      return new Promise(resolve => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', upUrl, true);
        let lastLoaded = 0;
        xhr.upload.onprogress = e => {
          if(done) { xhr.abort(); resolve(); return; }
          const delta = e.loaded - lastLoaded;
          lastLoaded = e.loaded;
          if(delta > 0) {
            totalBytes += delta;
            samples.push({ t: performance.now(), bytes: totalBytes });
          }
        };
        xhr.onload = xhr.onerror = xhr.ontimeout = resolve;
        xhr.timeout = 13000;
        try { xhr.send(payload); } catch(e) { resolve(); }
      });
    }

    async function runAll() {
      const streams = upUrl.startsWith('/') ? 4 : 2; // same-origin = więcej równoległych
      while(!done && (performance.now() - t0) < DURATION) {
        const arr = [];
        for(let i=0;i<streams;i++) arr.push(xhrUpload());
        await Promise.all(arr);
      }
    }

    await Promise.race([
      runAll(),
      new Promise(r => setTimeout(() => { done = true; r(); }, DURATION))
    ]);
    done = true;
    clearInterval(prog);

    if(samples.length < 4) { netLog('⬆️ Upload 0 — brak danych', 'warn'); return 0; }
    const stable = samples.filter(s => s.t >= t0 + 2000);
    if(stable.length >= 2) {
      const dt = (stable[stable.length-1].t - stable[0].t) / 1000;
      const db = stable[stable.length-1].bytes - stable[0].bytes;
      if(dt > 0 && db > 0) return parseFloat(((db * 8) / 1e6 / dt).toFixed(1));
    }
    const el = (performance.now() - t0) / 1000;
    return el > 0 ? parseFloat(((totalBytes * 8) / 1e6 / el).toFixed(1)) : 0;
  }

  // ── Uruchom w głównym wątku (brak blob: worker = brak problemów z CSP) ──
  return new Promise(async (resolve) => {
    try {
      let result = 0;
      if(phase === 'ping')     result = await doPing();
      if(phase === 'download') result = await doDownload();
      if(phase === 'upload')   result = await doUpload();
      resolve(result);
    } catch(err) {
      netLog('⚠️ Błąd testu: ' + (err.message || err), 'warn');
      resolve(0);
    }
  });
}
// measurePing/Download/Upload są teraz tylko aliasy — nie wywołuj runSpeedWorker podwójnie
// Bezpośrednie wywołania w startNetTest używają runSpeedWorker(phase, cb, alive)

async function startNetTest() {
  if(netTesting) return;

  if(!navigator.onLine) {
    toast(t('toast_no_internet'), 'error');
    netLog('❌ Urządzenie jest offline — sprawdź połączenie', 'bad');
    return;
  }

  netTesting = true;
  const mySession = ++netSession;
  const alive = () => netTesting && netSession === mySession;
  netSpeedHistory = [];
  const btn = document.getElementById('btnStartNet');
  btn.disabled = true;
  btn.textContent = t('net_testing') || '⏳ Testowanie...';
  document.getElementById('netRatingsPanel').style.display = 'none';
  document.getElementById('netOverall').classList.remove('show');
  ['Down','Ping','Up'].forEach(id => { pillPhase(id,''); document.getElementById('val'+id).textContent = '—'; });
  resetGauge();
  netLog('▶ Test rozpoczęty', 'good');
  drawNetHistory();

  // Bug fix BUG 1: try/finally gwarantuje reset netTesting i btn po każdym błędzie
  try {
    startTimer(10);
    // ── PING (10s) ──
    document.getElementById('netPhaseLabel').textContent = t('net_phase_ping') || '📡 Ping — 10 sek.';
    document.getElementById('netSpeedUnit').textContent = 'ms';
    pillPhase('Ping', 'active-phase');
    netLog('📡 Mierzę ping...');
    _pingProgressSamples = [];
    const ping = await runSpeedWorker('ping', v => {
      if(!alive()) return;
      _pingProgressSamples.push(Math.round(v));
      setGaugeSpeed(Math.min(v * 0.5, 400));
      document.getElementById('valPing').textContent = Math.round(v);
    }, alive);
    if(!alive()) return;
    document.getElementById('valPing').textContent = ping;
    pillPhase('Ping', ping<30?'phase-done-good':ping<80?'phase-done-mid':'phase-done-bad');
    netLog(`Ping: ${ping} ms — ${ping<30?'doskonały':ping<80?'dobry':'wysoki'}`, ping<30?'good':ping<80?'warn':'bad');
    await new Promise(r => setTimeout(r, 400));
    if(!alive()) return;
    resetGauge();

    // ── DOWNLOAD (25s) ──
    startTimer(25);
    document.getElementById('netPhaseLabel').textContent = t('net_phase_down') || '⬇️ Pobieranie — 25 sek.';
    document.getElementById('netSpeedUnit').textContent = 'Mb/s';
    pillPhase('Down', 'active-phase');
    netLog('⬇️ Mierzę pobieranie...');
    const down = await runSpeedWorker('download', mbps => {
      if(!alive()) return;
      setGaugeSpeed(mbps);
      document.getElementById('valDown').textContent = mbps >= 100 ? mbps.toFixed(0) : mbps >= 10 ? mbps.toFixed(1) : mbps.toFixed(2);
      netSpeedHistory.push(mbps);
      if(netSpeedHistory.length > 80) netSpeedHistory.shift();
    }, alive);
    if(!alive()) return;
    document.getElementById('valDown').textContent = down;
    pillPhase('Down', down>50?'phase-done-good':down>10?'phase-done-mid':'phase-done-bad');
    netLog(`Pobieranie: ${down} Mb/s`, down>50?'good':down>10?'warn':'bad');
    await new Promise(r => setTimeout(r, 400));
    if(!alive()) return;
    resetGauge();

    // ── UPLOAD (25s) ──
    startTimer(25);
    document.getElementById('netPhaseLabel').textContent = t('net_phase_up') || '⬆️ Wysyłanie — 25 sek.';
    document.getElementById('netSpeedUnit').textContent = 'Mb/s';
    pillPhase('Up', 'active-phase');
    netLog('⬆️ Mierzę wysyłanie...');
    const up = await runSpeedWorker('upload', mbps => {
      if(!alive()) return;
      setGaugeSpeed(mbps);
      document.getElementById('valUp').textContent = mbps.toFixed(1);
      netSpeedHistory.push(mbps);
      if(netSpeedHistory.length > 40) netSpeedHistory.shift();
    }, alive);
    if(!alive()) return;
    document.getElementById('valUp').textContent = up;
    pillPhase('Up', up>20?'phase-done-good':up>5?'phase-done-mid':'phase-done-bad');
    netLog(`Wysyłanie: ${up} Mb/s`, up>20?'good':up>5?'warn':'bad');

    if(_pingProgressSamples.length >= 3) {
      const avgP = _pingProgressSamples.reduce((a,b)=>a+b,0)/_pingProgressSamples.length;
      const jitter = Math.round(Math.sqrt(_pingProgressSamples.reduce((s,v)=>s+Math.pow(v-avgP,2),0)/_pingProgressSamples.length));
      document.getElementById('nspJitter').textContent = `${jitter} ms ${jitter<5?'✅':jitter<15?'⚡':'🔴'}`;
      netLog(`Jitter: ${jitter} ms ${jitter<5?'(stabilny)':jitter<15?'(umiarkowany)':'(niestabilny)'}`, jitter<15?'good':'warn');
    }

    stopTimer(true);
    // Bug fix BUG 8: resetuj gauge po zakończeniu testu
    resetGauge();
    document.getElementById('netPhaseLabel').textContent = t('net_phase_done') || '✅ Test zakończony';
    document.getElementById('netSpeedUnit').textContent = t('net_unit_dl') || 'Mb/s';

    // Bug fix BUG 2: badge teksty przez t()
    function badge(id, cls, txt) { const el=document.getElementById(id); el.className='nr2-badge '+cls; el.textContent=txt; }
    badge('rateVideo',(ping<80&&down>5&&up>2)?'good':'bad',
          (ping<80&&down>5&&up>2)?(t('net_rate_ok')||'✅ OK'):(t('net_rate_weak')||'❌ Za słabe'));
    badge('rateGame', ping<40?'good':ping<100?'mid':'bad',
          ping<40?(t('net_rate_great')||'✅ Świetnie'):ping<100?(t('net_rate_ok2')||'⚡ Ujdzie'):(t('net_rate_lag')||'❌ Lag'));
    badge('rateStream',down>25?'good':down>8?'mid':'bad',
          down>25?(t('net_rate_smooth')||'✅ Płynnie'):down>8?(t('net_rate_possible')||'⚡ Możliwe'):(t('net_rate_buf')||'❌ Buforuje'));
    badge('rateCloud', up>20?'good':up>5?'mid':'bad',
          up>20?(t('net_rate_fast')||'✅ Szybko'):up>5?(t('net_rate_normal')||'⚡ Normalnie'):(t('net_rate_slow')||'❌ Wolno'));
    const navE=performance.getEntriesByType('navigation')[0];
    const ttfbMs=navE?Math.round(navE.responseStart-navE.requestStart):999;
    const hostScore=(ttfbMs<200?2:ttfbMs<500?1:0)+(up>20?2:up>5?1:0)+(ping<30?1:0);
    badge('rateHosting',hostScore>=4?'good':hostScore>=2?'mid':'bad',hostScore>=4?'✅ Idealne':hostScore>=2?'⚡ Wystarczające':'❌ Wolne deploye');
    netLog(`Hosting: ${hostScore>=4?'Idealne':hostScore>=2?'Wystarczające':'Wolne deploye'} (TTFB ${ttfbMs}ms)`,hostScore>=2?'good':'warn');

    let score=0;
    if(down>100)score+=3;else if(down>30)score+=2;else if(down>5)score+=1;
    if(up>30)score+=2;else if(up>5)score+=1;
    if(ping<30)score+=2;else if(ping<80)score+=1;
    document.getElementById('netOverall').textContent = score>=6?(t('net_score_great')||'🏆 Doskonałe'):score>=4?(t('net_score_good')||'✅ Dobre'):score>=2?(t('net_score_avg')||'⚡ Przeciętne'):(t('net_score_poor')||'❌ Słabe');
    document.getElementById('netRatingsPanel').style.display = 'flex';
    setTimeout(() => { if(alive()) document.getElementById('netOverall').classList.add('show'); }, 100);
    netLog(`✅ Wynik: ${score>=6?'Doskonałe':score>=4?'Dobre':score>=2?'Przeciętne':'Słabe'}`, score>=4?'good':score>=2?'warn':'bad');
    document.getElementById('nspTestTime').textContent = new Date().toLocaleTimeString(currentLang === 'pl' ? 'pl-PL' : currentLang === 'de' ? 'de-DE' : currentLang === 'ru' ? 'ru-RU' : currentLang === 'zh' ? 'zh-CN' : currentLang === 'fr' ? 'fr-FR' : currentLang === 'es' ? 'es-ES' : currentLang === 'it' ? 'it-IT' : currentLang === 'ja' ? 'ja-JP' : currentLang === 'ko' ? 'ko-KR' : currentLang === 'nl' ? 'nl-NL' : currentLang === 'pt' ? 'pt-PT' : currentLang === 'ua' ? 'uk-UA' : 'en-GB');

  } catch(err) {
    // Bug fix BUG 1: obsłuż Promise.reject z no_worker lub inny błąd
    if(err?.message !== 'no_worker') {
      netLog('❌ Błąd testu: ' + (err?.message || err), 'bad');
      toast(t('toast_speed_err') + (err?.message || t('toast_unknown')), 'error');
    }
    stopTimer();
    resetGauge();
    document.getElementById('netPhaseLabel').textContent = t('net_press_start') || 'Naciśnij START';
    ['Down','Ping','Up'].forEach(id => pillPhase(id, ''));
  } finally {
    // Bug fix BUG 1: zawsze odblokuj przycisk i reset flagi
    netTesting = false;
    const b = document.getElementById('btnStartNet');
    if(b) { b.disabled = false; b.textContent = t('net_start_btn') || '▶ START'; }
  }
}
// ─── PERFORMANCE MONITOR ──────────────────────────────
let pmRafId = null, pmRunning = false;
let pmFpsHistory = [], pmHeapHistory = [];
let pmFrameTimes = [], pmLastTs = 0;
let pmFpsMin = Infinity, pmFpsMax = 0;
let pmLongTasks = 0;
let pmStartTime = performance.now();

// ══════════════════════════════════════════════════════
// THERMAL / TEMPERATURE MONITOR
// ══════════════════════════════════════════════════════
let pmCpuLoadHistory = [];   // estymowane obciążenie CPU 0-100
let pmThermalInterval = null;
let _pmThermalListener = null;

async function pmRefreshThermal() {
  // ── 1. Thermal API (Chrome 92+ / eksperymentalne) ──
  const stateEl  = document.getElementById('pmThermalState');
  const labelEl  = document.getElementById('pmThermalLabel');

  if ('thermal' in navigator) {
    try {
      const thermal = await navigator.thermal.requestThermalState?.() || navigator.thermal;
      const state = thermal.state || thermal;
      const map = {
        nominal:  { icon: '🟢', label: 'Normalna', color: '#00f5a0' },
        fair:     { icon: '🟡', label: 'Podwyższona', color: '#f5c400' },
        serious:  { icon: '🟠', label: 'Wysoka', color: '#ff9a3c' },
        critical: { icon: '🔴', label: 'Krytyczna!', color: '#ff4d6d' },
      };
      const s = map[state] || { icon: '❓', label: state, color: '#fff' };
      if(stateEl) { stateEl.textContent = s.icon; stateEl.style.color = s.color; }
      if(labelEl) labelEl.textContent = s.label;

      // Nasłuchuj zmian
      if(_pmThermalListener) navigator.thermal.removeEventListener('change', _pmThermalListener);
      _pmThermalListener = () => pmRefreshThermal();
      navigator.thermal.addEventListener('change', _pmThermalListener);
    } catch(e) {
      pmThermalFallback();
    }
  } else {
    pmThermalFallback();
  }

  // ── 2. Bateria ──
  const battPctEl  = document.getElementById('pmBatteryPct');
  const battLblEl  = document.getElementById('pmBatteryLabel');
  if ('getBattery' in navigator) {
    try {
      const batt = await navigator.getBattery();
      const pct  = Math.round(batt.level * 100);
      const charging = batt.charging;
      const timeLeft = charging
        ? (batt.chargingTime   < Infinity ? `pełna za ${Math.round(batt.chargingTime/60)} min` : 'ładuje...')
        : (batt.dischargingTime < Infinity ? `~${Math.round(batt.dischargingTime/60)} min` : '');
      if(battPctEl) {
        battPctEl.textContent = pct + '%';
        battPctEl.style.color = pct > 50 ? '#00f5a0' : pct > 20 ? '#f5c400' : '#ff4d6d';
      }
      if(battLblEl) battLblEl.textContent = (charging ? '⚡ Ładuje' : '🔋 Na baterii') + (timeLeft ? ' · ' + timeLeft : '');

      // Uwaga: ładowanie = ciepły laptop
      if(stateEl && charging && stateEl.textContent === '—') {
        stateEl.textContent = '🔌';
        if(labelEl) labelEl.textContent = 'Ładuje się (może być cieplej)';
      }
    } catch(e) {
      if(battPctEl) battPctEl.textContent = 'N/A';
      if(battLblEl) battLblEl.textContent = 'API niedostępne';
    }
  } else {
    if(battPctEl) battPctEl.textContent = '🖥️';
    if(battLblEl) battLblEl.textContent = 'Desktop / brak Battery API';
  }

  // ── 3. GPU info przez WebGL ──
  pmDetectGpu();

  // ── 4. CPU load hint (z FPS) ──
  pmUpdateCpuLoad();
}

function pmThermalFallback() {
  const stateEl  = document.getElementById('pmThermalState');
  const labelEl  = document.getElementById('pmThermalLabel');
  const noteEl   = document.getElementById('pmThermalNote');
  if(stateEl) stateEl.textContent = '⚠️';
  if(labelEl) labelEl.textContent = 'Thermal API niedostępne';
  if(noteEl)  noteEl.textContent  = 'Chrome: chrome://flags/#enable-experimental-web-platform-features · Firefox/Safari: brak wsparcia';
}

function pmDetectGpu() {
  const el = document.getElementById('pmGpuInfo');
  if(!el) return;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if(!gl) { el.textContent = 'WebGL niedostępny'; return; }
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if(ext) {
      const vendor   = gl.getParameter(ext.UNMASKED_VENDOR_WEBGL);
      const renderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
      // Skróć długie stringy GPU
      const shortRenderer = renderer.replace(/\(.*?\)/g,'').replace(/OpenGL.*$/,'').trim();
      el.innerHTML =
        `<span style="color:rgba(255,255,255,0.4);">Producent: </span>${vendor}<br>` +
        `<span style="color:rgba(255,255,255,0.4);">GPU: </span><span style="color:#a855f7;">${shortRenderer}</span>`;
      // Dopisz ostrzeżenie jeśli software render
      if(/swiftshader|llvmpipe|software/i.test(renderer)) {
        el.innerHTML += `<br><span style="color:#ff9a3c;font-size:9px;">⚠️ Software renderer — brak GPU sprzętowego</span>`;
      }
    } else {
      el.textContent = gl.getParameter(gl.RENDERER) || 'Brak danych (brak WEBGL_debug_renderer_info)';
    }
  } catch(e) {
    el.textContent = 'Błąd WebGL: ' + e.message;
  }
}

function pmUpdateCpuLoad() {
  // Estymacja: jeśli FPS niższe niż oczekiwane (np. poniżej 50 przy refresh 60Hz)
  // zakładamy że CPU/GPU jest pod obciążeniem
  const barEl  = document.getElementById('pmCpuLoadBar');
  const pctEl  = document.getElementById('pmCpuLoadPct');
  const hintEl = document.getElementById('pmCpuLoadHint');

  const avgFps = pmFpsHistory.length
    ? pmFpsHistory.slice(-30).reduce((a,b)=>a+b,0) / Math.min(pmFpsHistory.length, 30)
    : 0;

  // Oszacuj obciążenie na podstawie FPS (tylko wskaźnik pośredni)
  const targetFps = 60;
  let load = avgFps > 0 ? Math.max(0, Math.min(100, Math.round((1 - avgFps/targetFps) * 100 * 1.8))) : 0;
  // Uwaga: przy monitorze 120Hz load = 0 przy 120fps, nie oznacza to 100% idle

  pmCpuLoadHistory.push(load);
  if(pmCpuLoadHistory.length > 60) pmCpuLoadHistory.shift();

  if(barEl) barEl.style.width = load + '%';
  if(pctEl) {
    pctEl.textContent = load + '%';
    pctEl.style.color = load < 30 ? '#00f5a0' : load < 70 ? '#f5c400' : '#ff4d6d';
  }
  if(hintEl) {
    const hint = load < 20 ? 'Niskie — przeglądarka działa płynnie'
               : load < 50 ? 'Umiarkowane — normalna praca'
               : load < 80 ? 'Wysokie — może powodować spadki FPS'
               :              'Bardzo wysokie — ryzyko przegrzania';
    hintEl.textContent = `≈${avgFps.toFixed(0)} fps śr. · ${hint}`;
  }

  pmDrawThermalHistory();
}

function pmDrawThermalHistory() {
  const canvas = document.getElementById('pmThermalCanvas');
  if(!canvas || !pmCpuLoadHistory.length) return;
  const W = canvas.offsetWidth || 400, H = 60;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  // Grid linie 30% / 70%
  [30, 70].forEach(pct => {
    const y = H - (pct/100)*H;
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3,4]);
    ctx.moveTo(0, y); ctx.lineTo(W, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.font = '7px Space Mono,monospace';
    ctx.fillText(pct+'%', 2, y - 2);
  });

  // Gradient fill
  const n = pmCpuLoadHistory.length;
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0,   'rgba(255,77,109,0.4)');
  grad.addColorStop(0.5, 'rgba(245,196,0,0.3)');
  grad.addColorStop(1,   'rgba(0,245,160,0.1)');
  ctx.beginPath();
  pmCpuLoadHistory.forEach((v, i) => {
    const x = (i/(n-1||1)) * W;
    const y = H - (v/100) * H;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
  ctx.fillStyle = grad; ctx.fill();

  // Linia
  ctx.beginPath();
  pmCpuLoadHistory.forEach((v, i) => {
    const x = (i/(n-1||1)) * W;
    const y = H - (v/100) * H;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.strokeStyle = '#f5c400';
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function openPerfMonitor() {
  document.getElementById('perfModal').classList.add('show');

  // Reset all stats on every open
  pmFpsHistory = []; pmHeapHistory = []; pmFrameTimes = [];
  pmFpsMin = Infinity; pmFpsMax = 0;
  pmLongTasks = 0;
  pmPingHistory = []; pmPingMinVal = Infinity; pmPingMaxVal = 0;
  pmPingLostCount = 0; pmPingTotalCount = 0;
  pmStartTime = performance.now(); // BUG 1 FIX: reset uptime counter
  pmThermalTickCount = 0;          // BUG 7 FIX: reset thermal throttle
  document.getElementById('pmFpsMin').textContent = 'min — / max —';
  document.getElementById('pmFpsAvg').textContent = 'śr. — fps';
  document.getElementById('pmLongTaskWarn').style.display = 'none';
  document.getElementById('pmLongTaskCount').textContent = '0';
  document.getElementById('pmPingCur').textContent = '—';
  document.getElementById('pmPingMin').textContent = '—';
  document.getElementById('pmPingMax').textContent = '—';
  document.getElementById('pmPingAvg').textContent = '—';

  startPerfMonitor();
  loadPerfStatic();
  refreshTransfer();
  document.getElementById('pmMcCores').textContent = navigator.hardwareConcurrency || '?';
  pmCpuLoadHistory = [];
  pmRefreshThermal();

  // PerformanceObserver for long tasks (only one instance)
  if(!window._pmLongTaskObserver) {
    try {
      window._pmLongTaskObserver = new PerformanceObserver(list => {
        pmLongTasks += list.getEntries().length;
        const el = document.getElementById('pmLongTaskCount');
        const warn = document.getElementById('pmLongTaskWarn');
        if(el) el.textContent = pmLongTasks;
        if(warn) warn.style.display = 'block';
      });
      window._pmLongTaskObserver.observe({ entryTypes: ['longtask'] });
    } catch(e) {}
  }
}

function closePerfMonitor() {
  document.getElementById('perfModal').classList.remove('show');
  stopPerfMonitor();
  stopPing();
  // BUG 5 FIX: zatrzymaj multi-core test jeśli trwa
  if(pmMcRunning) {
    pmMcRunning = false;
    const btn = document.getElementById('pmMcBtn');
    if(btn) { btn.disabled = false; btn.textContent = '▶ Uruchom test multi-core'; }
  }
}

function startPerfMonitor() {
  if(pmRunning) return;
  pmRunning = true;
  pmLastTs = performance.now();
  pmLoop();
}

function stopPerfMonitor() {
  pmRunning = false;
  if(pmRafId) { cancelAnimationFrame(pmRafId); pmRafId = null; }
}

function pmLoop() {
  if(!pmRunning) return;
  const now = performance.now();
  const delta = now - pmLastTs;
  pmLastTs = now;

  // FPS from delta
  const fps = delta > 0 ? Math.min(Math.round(1000 / delta), 999) : 0;
  pmFpsHistory.push(fps);
  if(pmFpsHistory.length > 120) pmFpsHistory.shift();

  pmFpsMin = Math.min(pmFpsMin, fps);
  pmFpsMax = Math.max(pmFpsMax, fps);

  // Frame time
  pmFrameTimes.push(delta);
  if(pmFrameTimes.length > 60) pmFrameTimes.shift();
  const avgFt = pmFrameTimes.reduce((a,b)=>a+b,0) / pmFrameTimes.length;

  // JS Heap
  let heapUsed = 0, heapTotal = 0, heapLimit = 0;
  if(performance.memory) {
    heapUsed  = performance.memory.usedJSHeapSize;
    heapTotal = performance.memory.totalJSHeapSize;
    heapLimit = performance.memory.jsHeapSizeLimit;
    pmHeapHistory.push(heapUsed);
    if(pmHeapHistory.length > 120) pmHeapHistory.shift();
  }

  // avg fps
  const avgFps = pmFpsHistory.length ? Math.round(pmFpsHistory.reduce((a,b)=>a+b,0)/pmFpsHistory.length) : 0;

  // update DOM
  const fpsEl = document.getElementById('pmFps');
  fpsEl.textContent = fps;
  fpsEl.style.color = fps >= 55 ? '#00f5a0' : fps >= 30 ? '#f5c400' : '#ff4d6d';

  document.getElementById('pmFpsMin').textContent = `min ${pmFpsMin === Infinity ? '—' : pmFpsMin} / max ${pmFpsMax}`;
  document.getElementById('pmFpsAvg').textContent = `śr. ${avgFps} fps`;
  document.getElementById('pmFt').textContent = avgFt.toFixed(1);
  const ftEl = document.getElementById('pmFt');
  ftEl.style.color = avgFt < 18 ? '#00f5a0' : avgFt < 35 ? '#f5c400' : '#ff4d6d';

  if(performance.memory) {
    const usedMB  = (heapUsed  / 1048576).toFixed(0);
    const limitMB = (heapLimit / 1048576).toFixed(0);
    const pct     = Math.round(heapUsed / heapLimit * 100);
    document.getElementById('pmHeap').textContent      = `${usedMB}`;
    document.getElementById('pmHeapLimit').textContent = `limit ${limitMB} MB`;
    document.getElementById('pmHeapPct').textContent   = `${pct}% limitu`;
    document.getElementById('pmRam').textContent       = `${usedMB}`;
    document.getElementById('pmRamTotal').textContent  = `z ${limitMB} MB`;
    const heapEl = document.getElementById('pmHeap');
    heapEl.style.color = pct < 50 ? '#00f5a0' : pct < 80 ? '#f5c400' : '#ff4d6d';
  } else {
    document.getElementById('pmHeap').textContent = 'N/A';
    document.getElementById('pmRam').textContent  = 'N/A';
  }

  // uptime
  const upSec = Math.floor((performance.now() - pmStartTime) / 1000);
  const upM = Math.floor(upSec/60), upS = upSec%60;
  document.getElementById('pmUptime').textContent = `${upM}m ${upS}s`;

  // draw graphs
  pmDrawFpsGraph();
  if(performance.memory) pmDrawHeapGraph();
  // BUG 7 FIX: dedykowany licznik zamiast modulo na length
  pmThermalTickCount = (pmThermalTickCount || 0) + 1;
  if(pmThermalTickCount % 120 === 0) pmUpdateCpuLoad(); // ~2s przy 60fps

  pmRafId = requestAnimationFrame(pmLoop);
}

function pmDrawFpsGraph() {
  const canvas = document.getElementById('pmFpsCanvas');
  if(!canvas) return;
  const W = canvas.offsetWidth || 680, H = 80;
  // BUG 3 FIX: tylko przypisuj width gdy się zmienił — unika reflow i clear co klatkę
  if(canvas.width !== W) canvas.width = W;
  if(canvas.height !== H) canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0,0,W,H);

  // grid lines at 30 and 60 fps
  [30,60].forEach(line => {
    const y = H - (line/120)*H;
    ctx.strokeStyle = `rgba(255,255,255,0.06)`;
    ctx.setLineDash([4,4]);
    ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.font = '8px Space Mono, monospace';
    ctx.fillText(`${line}`, 4, y-3);
  });

  if(pmFpsHistory.length < 2) return;
  const step = W / (pmFpsHistory.length - 1);

  // gradient fill
  const grad = ctx.createLinearGradient(0,0,0,H);
  grad.addColorStop(0,'rgba(245,196,0,0.3)');
  grad.addColorStop(1,'rgba(245,196,0,0)');
  ctx.beginPath();
  pmFpsHistory.forEach((v,i) => {
    const x = i * step, y = H - Math.min(v/120,1)*H;
    i===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
  });
  ctx.lineTo(W,H); ctx.lineTo(0,H); ctx.closePath();
  ctx.fillStyle = grad; ctx.fill();

  // line
  ctx.beginPath(); ctx.strokeStyle = '#f5c400'; ctx.lineWidth = 2;
  pmFpsHistory.forEach((v,i) => {
    const x = i*step, y = H - Math.min(v/120,1)*H;
    i===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
  });
  ctx.stroke();
}

function pmDrawHeapGraph() {
  const canvas = document.getElementById('pmHeapCanvas');
  if(!canvas || pmHeapHistory.length < 2) return;
  const W = canvas.offsetWidth || 680, H = 60;
  if(canvas.width !== W) canvas.width = W;
  if(canvas.height !== H) canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0,0,W,H);

  const maxH = performance.memory.jsHeapSizeLimit;
  const step = W / (pmHeapHistory.length - 1);

  const grad = ctx.createLinearGradient(0,0,0,H);
  grad.addColorStop(0,'rgba(0,245,160,0.25)');
  grad.addColorStop(1,'rgba(0,245,160,0)');
  ctx.beginPath();
  pmHeapHistory.forEach((v,i) => {
    const x = i*step, y = H - (v/maxH)*H;
    i===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
  });
  ctx.lineTo(W,H); ctx.lineTo(0,H); ctx.closePath();
  ctx.fillStyle = grad; ctx.fill();

  ctx.beginPath(); ctx.strokeStyle = '#00f5a0'; ctx.lineWidth = 2;
  pmHeapHistory.forEach((v,i) => {
    const x = i*step, y = H - (v/maxH)*H;
    i===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
  });
  ctx.stroke();
}

async function loadPerfStatic() {
  document.getElementById('pmCores').textContent  = navigator.hardwareConcurrency || '—';
  document.getElementById('pmDevRam').textContent = navigator.deviceMemory ? `${navigator.deviceMemory}+ GB` : '—';
  document.getElementById('pmScreen').textContent = `${screen.width}×${screen.height}`;
  document.getElementById('pmDpr').textContent    = `${window.devicePixelRatio}x`;
  // BUG 6 FIX: battery listener rejestrowany tylko raz
  try {
    const bat = await navigator.getBattery();
    const updateBatt = () => {
      const p = Math.round(bat.level*100);
      const icon = bat.charging ? '⚡' : p > 60 ? '🟢' : p > 20 ? '🟡' : '🔴';
      const el = document.getElementById('pmBattery');
      if(el) el.textContent = `${icon} ${p}%`;
    };
    updateBatt();
    if(!bat._pmListenerAdded) {
      bat.addEventListener('levelchange', updateBatt);
      bat.addEventListener('chargingchange', updateBatt);
      bat._pmListenerAdded = true;
    }
  } catch(e) { document.getElementById('pmBattery').textContent = '—'; }
}

async function runPerfBench() {
  const btn = document.getElementById('pmBenchBtn');
  btn.textContent = '⏳ Trwa benchmark...'; btn.disabled = true;
  document.getElementById('pmBenchScore').textContent = '...';
  document.getElementById('pmBenchMs').textContent = '...';
  document.getElementById('pmBenchBar').style.width = '0%';

  await new Promise(r => setTimeout(r, 20));

  const t0 = performance.now();
  let x = 0;
  for(let i=0;i<5_000_000;i++) x += Math.sqrt(i) * Math.sin(i);
  const ms = Math.round(performance.now() - t0);
  const score = Math.round(10000 / ms * 100);

  let rating, color;
  if(score >= 1500)      { rating = '🚀 Bardzo szybki'; color = '#00f5a0'; }
  else if(score >= 800)  { rating = '✅ Szybki';         color = '#00b4d8'; }
  else if(score >= 400)  { rating = '⚡ Normalny';       color = '#f5c400'; }
  else if(score >= 150)  { rating = '🐢 Wolny';          color = '#ff9a3c'; }
  else                   { rating = '❌ Bardzo wolny';   color = '#ff4d6d'; }

  document.getElementById('pmBenchScore').textContent = score;
  document.getElementById('pmBenchMs').textContent    = `${ms} ms`;
  document.getElementById('pmBenchRating').textContent = rating;
  document.getElementById('pmBenchRating').style.color = color;
  document.getElementById('pmBenchBar').style.width = `${Math.min(score/20,100)}%`;

  btn.textContent = '↺ Uruchom ponownie'; btn.disabled = false;
}

// ─── PING LIVE ────────────────────────────────────────
let pmPingRunning = false, pmPingInterval = null;
let pmPingHistory = [], pmPingMinVal = Infinity, pmPingMaxVal = 0, pmPingLostCount = 0, pmPingTotalCount = 0;
let pmPingInFlight = false; // BUG 4 FIX: zapobiega nakładaniu się pingów
const PING_TARGETS = [
  { url: 'https://1.1.1.1/cdn-cgi/trace',       label: 'Cloudflare 1.1.1.1' },
  { url: 'https://www.google.com/generate_204',  label: 'Google' },
  { url: 'https://httpbin.org/get',              label: 'httpbin.org' },
  { url: 'https://www.cloudflare.com/cdn-cgi/trace', label: 'Cloudflare CDN' },
  { url: 'https://dns.google/resolve?name=test.example&type=A', label: 'Google DNS' },
  { url: 'https://api64.ipify.org?format=json',  label: 'ipify (IPv6/VPN)' },
];
let pmPingTargetIdx = 0;

function togglePing() {
  if(pmPingRunning) stopPing(); else startPing();
}

function startPing() {
  if(pmPingInterval) clearInterval(pmPingInterval);
  pmPingRunning = true;
  pmPingInFlight = false; // BUG 4 FIX
  pmPingHistory = []; pmPingMinVal = Infinity; pmPingMaxVal = 0;
  pmPingLostCount = 0; pmPingTotalCount = 0;
  document.getElementById('pmPingBtn').textContent = '⏹ Stop';
  document.getElementById('pmPingStatus').textContent = '🟢 działa';
  document.getElementById('pmPingTarget').textContent = `Cel: ${PING_TARGETS[pmPingTargetIdx].label}`;
  // BUG 4 FIX: NIE wywołuj doPing() bezpośrednio — tylko setInterval
  // Pierwsza próba po 100ms żeby uniknąć nakładania przy szybkim start/stop
  setTimeout(doPing, 100);
  pmPingInterval = setInterval(doPing, 1000);
}

function stopPing() {
  pmPingRunning = false;
  clearInterval(pmPingInterval); pmPingInterval = null;
  document.getElementById('pmPingBtn').textContent = '▶ Start';
  document.getElementById('pmPingStatus').textContent = '⏸ zatrzymany';
}

async function doPing() {
  if(pmPingInFlight) return; // BUG 4 FIX: pomiń jeśli poprzedni ping jeszcze trwa
  pmPingInFlight = true;
  pmPingTotalCount++;
  const target = PING_TARGETS[pmPingTargetIdx];
  try {
    const t0 = performance.now();
    await fetch(target.url + '?_=' + Date.now(), {
      method: 'HEAD', mode: 'no-cors', cache: 'no-store'
    });
    const ms = Math.round(performance.now() - t0);
    pmPingHistory.push(ms);
    if(pmPingHistory.length > 60) pmPingHistory.shift();

    pmPingMinVal = Math.min(pmPingMinVal, ms);
    pmPingMaxVal = Math.max(pmPingMaxVal, ms);
    const avg = Math.round(pmPingHistory.reduce((a,b)=>a+b,0)/pmPingHistory.length);

    const curEl = document.getElementById('pmPingCur');
    curEl.textContent = ms;
    curEl.style.color = ms < 50 ? '#00f5a0' : ms < 150 ? '#f5c400' : '#ff4d6d';
    document.getElementById('pmPingMin').textContent = pmPingMinVal === Infinity ? '—' : pmPingMinVal;
    document.getElementById('pmPingMax').textContent = pmPingMaxVal;
    document.getElementById('pmPingAvg').textContent = avg;
  } catch(e) {
    pmPingLostCount++;
    pmPingHistory.push(null);
    if(pmPingHistory.length > 60) pmPingHistory.shift();
    document.getElementById('pmPingCur').textContent = 'timeout';
    document.getElementById('pmPingCur').style.color = '#ff4d6d';
    pmPingTargetIdx = (pmPingTargetIdx + 1) % PING_TARGETS.length;
    document.getElementById('pmPingTarget').textContent = `Cel: ${PING_TARGETS[pmPingTargetIdx].label}`;
  } finally {
    pmPingInFlight = false; // BUG 4 FIX: zawsze zwalniaj flagę
  }
  const lossPct = Math.round(pmPingLostCount / pmPingTotalCount * 100);
  document.getElementById('pmPingLoss').textContent = `Utracone: ${lossPct}%`;
  pmDrawPingGraph();
}

function pmDrawPingGraph() {
  const canvas = document.getElementById('pmPingCanvas');
  if(!canvas) return;
  const W = canvas.offsetWidth || 400, H = 70;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0,0,W,H);

  const valid = pmPingHistory.filter(v => v !== null);
  if(valid.length < 2) return;
  const maxV = Math.max(...valid, 100);

  // grid lines
  [50, 100, 200].forEach(line => {
    if(line > maxV * 1.1) return;
    const y = H - (line/maxV)*H;
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.setLineDash([3,3]);
    ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.font = '7px Space Mono,monospace';
    ctx.fillText(`${line}ms`, 4, y - 2);
  });

  const step = W / Math.max(pmPingHistory.length - 1, 1);
  ctx.beginPath(); ctx.lineWidth = 2;
  let started = false;
  pmPingHistory.forEach((v,i) => {
    if(v === null) { started = false; return; }
    const x = i * step, y = H - (v/maxV)*H;
    const color = v < 50 ? '#00f5a0' : v < 150 ? '#f5c400' : '#ff4d6d';
    if(!started) { ctx.strokeStyle = color; ctx.beginPath(); ctx.moveTo(x,y); started = true; }
    else { ctx.lineTo(x,y); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x,y); ctx.strokeStyle = color; }
  });
  ctx.stroke();

  // dots for timeouts
  pmPingHistory.forEach((v,i) => {
    if(v !== null) return;
    const x = i*step;
    ctx.fillStyle = '#ff4d6d';
    ctx.beginPath(); ctx.arc(x, H/2, 3, 0, Math.PI*2); ctx.fill();
  });
}

// ─── TRANSFER USAGE ───────────────────────────────────
function refreshTransfer() {
  const entries = performance.getEntriesByType('resource');
  let total = 0, cached = 0;
  const typeMap = {};

  entries.forEach(e => {
    const size = e.transferSize || 0;
    const encoded = e.encodedBodySize || 0;
    total += size;
    if(size === 0 && encoded > 0) cached++;

    // classify by initiatorType
    const t = e.initiatorType || 'other';
    if(!typeMap[t]) typeMap[t] = { size: 0, count: 0 };
    typeMap[t].size  += size;
    typeMap[t].count++;
  });

  const totalKB = (total / 1024).toFixed(1);
  document.getElementById('pmTransTotal').textContent  = totalKB > 1024 ? (totalKB/1024).toFixed(2) + ' MB' : totalKB;
  document.getElementById('pmTransCount').textContent  = entries.length;
  document.getElementById('pmTransCached').textContent = cached;

  // breakdown bars
  const colors = { script:'#f5c400', css:'#00b4d8', img:'#00f5a0', fetch:'#a78bff', xmlhttprequest:'#ff4d6d', font:'#ff9a3c', other:'rgba(255,255,255,0.3)' };
  const labels = { script:'JS', css:'CSS', img:'Obrazy', fetch:'Fetch/XHR', xmlhttprequest:'XHR', font:'Fonty', other:'Inne' };
  const breakdown = document.getElementById('pmTransBreakdown');
  breakdown.innerHTML = '';

  const sorted = Object.entries(typeMap).sort((a,b) => b[1].size - a[1].size);
  sorted.forEach(([type, data]) => {
    const kb    = (data.size/1024).toFixed(1);
    const pct   = total > 0 ? Math.round(data.size/total*100) : 0;
    const color = colors[type] || colors.other;
    const label = labels[type] || type;
    breakdown.innerHTML += `
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="font-family:'Space Mono',monospace;font-size:8px;color:var(--muted);width:48px;">${label}</span>
        <div style="flex:1;height:6px;background:rgba(255,255,255,0.05);border-radius:3px;overflow:hidden;">
          <div style="height:100%;width:${pct}%;background:${color};border-radius:3px;transition:width 0.4s;"></div>
        </div>
        <span style="font-family:'Space Mono',monospace;font-size:8px;color:${color};width:54px;text-align:right;">${kb} KB</span>
        <span style="font-family:'Space Mono',monospace;font-size:8px;color:var(--muted);width:28px;">${data.count}x</span>
      </div>`;
  });

  if(sorted.length === 0) {
    breakdown.innerHTML = '<div style="font-family:Space Mono,monospace;font-size:9px;color:var(--muted);">Brak danych (strona lokalna lub brak zasobów)</div>';
  }
}

// ─── MULTI-CORE TEST ──────────────────────────────────
let pmMcRunning = false;

async function runMultiCoreTest() {
  if(pmMcRunning) return;
  pmMcRunning = true;
  const btn = document.getElementById('pmMcBtn');
  btn.disabled = true; btn.textContent = '⏳ Trwa test...';
  document.getElementById('pmMcStatus').textContent = '';
  document.getElementById('pmMcBar').style.width = '0%';
  document.getElementById('pmMcCoreBars').innerHTML = '';

  const cores = navigator.hardwareConcurrency || 4;
  document.getElementById('pmMcCores').textContent = cores;

  const ITERS = 2_000_000;

  // Worker code as blob
  const workerCode = `
    self.onmessage = function(e) {
      const iters = e.data;
      const t0 = performance.now();
      let x = 0;
      for(let i=0;i<iters;i++) x += Math.sqrt(i) * Math.sin(i);
      const ms = performance.now() - t0;
      self.postMessage({ ms, x });
    };
  `;
  const blob = new Blob([workerCode], { type: 'application/javascript' });
  const workerUrl = URL.createObjectURL(blob);

  // ── Single-core ──
  document.getElementById('pmMcStatus').textContent = '🔵 Testowanie single-core...';
  document.getElementById('pmMcBar').style.width = '15%';

  const singleScore = await new Promise(resolve => {
    const w = new Worker(workerUrl);
    w.onmessage = e => { w.terminate(); resolve(Math.round(10000 / e.data.ms * 100)); };
    w.postMessage(ITERS);
  });
  document.getElementById('pmMcSingle').textContent = singleScore;
  document.getElementById('pmMcBar').style.width = '40%';

  // ── Multi-core — spawn N workers simultaneously ──
  document.getElementById('pmMcStatus').textContent = `🟡 Testowanie multi-core (${cores} wątków)...`;

  const t0multi = performance.now();
  const workerPromises = Array.from({ length: cores }, (_, i) => new Promise(resolve => {
    const w = new Worker(workerUrl);
    const t0w = performance.now();
    w.onmessage = e => {
      w.terminate();
      resolve({ core: i+1, ms: Math.round(e.data.ms), score: Math.round(10000 / e.data.ms * 100) });
    };
    w.postMessage(ITERS);
  }));

  const results = await Promise.all(workerPromises);
  const totalMultiMs = Math.round(performance.now() - t0multi);
  const multiScore = results.reduce((s, r) => s + r.score, 0);
  const scaling = ((multiScore / singleScore)).toFixed(1);

  document.getElementById('pmMcMulti').textContent = multiScore;
  document.getElementById('pmMcScale').textContent = `${scaling}×`;
  document.getElementById('pmMcScale').style.color = parseFloat(scaling) >= cores * 0.7 ? '#00f5a0' : parseFloat(scaling) >= cores * 0.4 ? '#f5c400' : '#ff4d6d';
  document.getElementById('pmMcBar').style.width = '100%';

  // Per-core bars
  const maxScore = Math.max(...results.map(r => r.score));
  const coreBars = document.getElementById('pmMcCoreBars');
  results.forEach(r => {
    const pct = Math.round(r.score / maxScore * 100);
    const color = r.score >= maxScore * 0.85 ? '#00f5a0' : r.score >= maxScore * 0.6 ? '#f5c400' : '#ff4d6d';
    coreBars.innerHTML += `
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="font-family:'Space Mono',monospace;font-size:8px;color:var(--muted);width:44px;">Core ${r.core}</span>
        <div style="flex:1;height:8px;background:rgba(255,255,255,0.05);border-radius:4px;overflow:hidden;">
          <div style="height:100%;width:${pct}%;background:${color};border-radius:4px;transition:width 0.5s;"></div>
        </div>
        <span style="font-family:'Space Mono',monospace;font-size:8px;color:${color};width:52px;text-align:right;">${r.score} pts</span>
        <span style="font-family:'Space Mono',monospace;font-size:8px;color:var(--muted);width:40px;">${r.ms}ms</span>
      </div>`;
  });

  let rating;
  if(parseFloat(scaling) >= cores * 0.8)     rating = `🚀 Doskonałe skalowanie (${scaling}×)`;
  else if(parseFloat(scaling) >= cores * 0.5) rating = `✅ Dobre skalowanie (${scaling}×)`;
  else                                         rating = `⚠️ Słabe skalowanie (${scaling}×) — throttling?`;

  document.getElementById('pmMcStatus').textContent = rating;

  URL.revokeObjectURL(workerUrl);
  btn.textContent = '↺ Uruchom ponownie'; btn.disabled = false;
  pmMcRunning = false;
}

// ─── SPEAKER TEST ─────────────────────────────────────
let spkAC = null;
let spkVolume_v = 0.6;
let spkSweepRaf = null, spkSweepRunning = false;
let spkSweepOsc = null, spkSweepGain = null;
let spkToneOsc = null, spkToneGain = null;
let spkHearFreqs = [20,40,80,125,250,500,1000,2000,4000,8000,12000,16000,18000,20000];
let spkHearResults = {};
let spkHearCurrentIdx = -1, spkHearOsc = null;
let spkCustomFreq = 1000;

const SPK_TONES = [
  {label:'20 Hz',   freq:20,    note:'Sub-bas'},
  {label:'40 Hz',   freq:40,    note:'Bas'},
  {label:'80 Hz',   freq:80,    note:'Bas'},
  {label:'125 Hz',  freq:125,   note:'Niski bas'},
  {label:'250 Hz',  freq:250,   note:'Bas-mid'},
  {label:'500 Hz',  freq:500,   note:'Środek'},
  {label:'1 kHz',   freq:1000,  note:'Środek'},
  {label:'2 kHz',   freq:2000,  note:'Wyższy mid'},
  {label:'4 kHz',   freq:4000,  note:'Obecność'},
  {label:'8 kHz',   freq:8000,  note:'Sopran'},
  {label:'12 kHz',  freq:12000, note:'Powietrze'},
  {label:'16 kHz',  freq:16000, note:'Ultra-wyso'},
  {label:'18 kHz',  freq:18000, note:'Ultra-wyso'},
  {label:'20 kHz',  freq:20000, note:'Limit słuchu'},
];

function spkGetAC() {
  if(!spkAC) spkAC = new AudioContext();
  if(spkAC.state === 'suspended') spkAC.resume();
  return spkAC;
}

// ══════════════════════════════════════════════════════════════
// REACTION TEST
// ══════════════════════════════════════════════════════════════
function openReactionTest() {
  document.getElementById('reactionModal').classList.add('show');
  // Resetuj stan wizualny przy każdym otwarciu
  rtAbort();
  rtState = 'idle';
  requestAnimationFrame(() => rtSetIdle());
}
// ══════════════════════════════════════════════════════════════
// CHROMA KEY
// ══════════════════════════════════════════════════════════════

let chromaStream    = null;
let chromaRaf       = null;
let chromaColor     = { r:0, g:177, b:64 };
let chromaBgMode    = 'transparent';
let chromaBgColorVal = '#1a0a2e';
let chromaBgImage   = null;
let chromaRecorder  = null;
let chromaChunks    = [];
let chromaRecording = false;
let chromaVideo     = null;
let chromaTmpCanvas = null;
let chromaTmpCtx    = null;
let chromaEffects    = { mirror:true, grayscale:false, invert:false, pixelate:false, thermal:false, nightvision:false, sketch:false };
let chromaFpsLast   = performance.now();
let chromaFpsCount  = 0;

function openChromaKey() {
  document.getElementById('chromaModal').classList.add('show');
  // BUG 9 FIX: onclick ustawiane raz tutaj, nie w pętli
  const canvas = document.getElementById('chromaCanvas');
  canvas.onclick = chromaPickFromCanvas;
}

function closeChromaKey() {
  document.getElementById('chromaModal').classList.remove('show');
  chromaStop();
}

async function chromaToggleCam() {
  if(chromaStream) { chromaStop(); return; }
  try {
    chromaStream = await navigator.mediaDevices.getUserMedia({
      video: { width:{ideal:1280}, height:{ideal:720}, frameRate:{ideal:30} }
    });
    const btn = document.getElementById('chromaCamBtn');
    btn.textContent = '⏹ WYŁĄCZ KAMERĘ';
    btn.style.borderColor = '#ff4d6d';
    btn.style.color = '#ff4d6d';
    btn.style.background = 'rgba(255,77,109,0.1)';
    document.getElementById('chromaPlaceholder').style.display = 'none';
    document.getElementById('chromaRecBtn').style.display = 'block';

    // BUG 8 FIX: stwórz video element raz
    chromaVideo = document.createElement('video');
    chromaVideo.srcObject = chromaStream;
    chromaVideo.playsInline = true;
    chromaVideo.muted = true;
    await chromaVideo.play();

    chromaLoop();
  } catch(e) { toast(t('toast_cam_no_access') + e.message, 'error'); }
}

function chromaStop() {
  if(chromaRaf)    { cancelAnimationFrame(chromaRaf); chromaRaf = null; }
  if(chromaStream) { chromaStream.getTracks().forEach(t=>t.stop()); chromaStream = null; }
  // BUG 7 FIX: zatrzymaj recorder przy zamknięciu
  if(chromaRecording && chromaRecorder) {
    try { chromaRecorder.stop(); } catch(e){}
    chromaRecording = false;
    const rb = document.getElementById('chromaRecBtn');
    if(rb) rb.textContent = '⏺ NAGRAJ';
  }
  if(chromaVideo)  { chromaVideo.srcObject = null; chromaVideo = null; }
  chromaTmpCanvas = null; chromaTmpCtx = null;

  const btn = document.getElementById('chromaCamBtn');
  if(btn) {
    btn.textContent = '▶ WŁĄCZ KAMERĘ';
    btn.style.borderColor = '#22c55e';
    btn.style.color = '#22c55e';
    btn.style.background = 'rgba(34,197,94,0.1)';
  }
  const recBtn = document.getElementById('chromaRecBtn');
  if(recBtn) recBtn.style.display = 'none';
  document.getElementById('chromaPlaceholder').style.display = 'flex';

  // Wyczyść canvas
  const canvas = document.getElementById('chromaCanvas');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function chromaUpdateSliders() {
  document.getElementById('chromaTolVal').textContent    = document.getElementById('chromaTol').value;
  const bEl = document.getElementById('chromaBrightVal');
  if(bEl) bEl.textContent = document.getElementById('chromaBright')?.value || 0;
  const cEl = document.getElementById('chromaContrastVal');
  if(cEl) cEl.textContent = document.getElementById('chromaContrast')?.value || 0;
  document.getElementById('chromaSmoothVal').textContent = document.getElementById('chromaSmooth').value;
  document.getElementById('chromaSpillVal').textContent  = document.getElementById('chromaSpill').value;
}

function chromaLoop() {
  const canvas = document.getElementById('chromaCanvas');
  const ctx    = canvas.getContext('2d', { willReadFrequently: true });

  if(chromaVideo.videoWidth > 0) {
    canvas.width  = chromaVideo.videoWidth;
    canvas.height = chromaVideo.videoHeight;
    chromaTmpCanvas = document.createElement('canvas');
    chromaTmpCanvas.width  = canvas.width;
    chromaTmpCanvas.height = canvas.height;
    chromaTmpCtx = chromaTmpCanvas.getContext('2d');
  }

  // Reużywalny canvas dla putImageData
  const putCanvas = document.createElement('canvas');
  const putCtx    = putCanvas.getContext('2d');

  document.getElementById('chromaPickIndicator').style.display = 'block';

  function frame() {
    if(!chromaStream) return;
    chromaRaf = requestAnimationFrame(frame);
    if(!chromaVideo || chromaVideo.readyState < 2) return;

    const W = canvas.width, H = canvas.height;
    if(!W || !H) return;

    // FPS counter
    chromaFpsCount++;
    const now = performance.now();
    if(now - chromaFpsLast >= 1000) {
      const fpsEl = document.getElementById('chromaFps');
      if(fpsEl) { fpsEl.textContent = chromaFpsCount + ' FPS'; fpsEl.style.display = 'block'; }
      chromaFpsCount = 0; chromaFpsLast = now;
    }

    // Mirror effect
    if(chromaEffects.mirror) {
      chromaTmpCtx.save();
      chromaTmpCtx.translate(W, 0);
      chromaTmpCtx.scale(-1, 1);
    }
    chromaTmpCtx.drawImage(chromaVideo, 0, 0, W, H);
    if(chromaEffects.mirror) chromaTmpCtx.restore();

    const imgData = chromaTmpCtx.getImageData(0, 0, W, H);
    const d = imgData.data;

    const tol    = parseInt(document.getElementById('chromaTol').value);
    const smooth = parseInt(document.getElementById('chromaSmooth').value);
    const spill  = parseInt(document.getElementById('chromaSpill').value);
    const { r:kr, g:kg, b:kb } = chromaColor;

    // HSV-based chroma key detection — znacznie lepsza niż Euclidean dla oświetlenia
    // Precompute key color HSV
    function rgbToHsv(r,g,b){
      r/=255;g/=255;b/=255;
      const max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;
      let h=0,s=max===0?0:d/max,v=max;
      if(d>0){
        if(max===r)h=((g-b)/d)%6;
        else if(max===g)h=(b-r)/d+2;
        else h=(r-g)/d+4;
        h=h/6;if(h<0)h+=1;
      }
      return{h,s,v};
    }
    const keyHsv = rgbToHsv(kr,kg,kb);
    const tolNorm = tol/255;
    for(let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i+1], b = d[i+2];
      // HSV distance — uwzględnia odcień, nasycenie i jasność
      const pxHsv = rgbToHsv(r,g,b);
      const dh = Math.min(Math.abs(pxHsv.h-keyHsv.h), 1-Math.abs(pxHsv.h-keyHsv.h));
      const ds = Math.abs(pxHsv.s-keyHsv.s);
      const dv = Math.abs(pxHsv.v-keyHsv.v);
      // Weighted distance: hue matters most for green/blue screen
      const dist = (dh*200 + ds*80 + dv*60);
      // Keep Euclidean as fallback for low-saturation keys
      const dr2 = r-kr, dg2 = g-kg, db2 = b-kb;
      const distRgb = Math.sqrt(dr2*dr2+dg2*dg2+db2*db2);
      const finalDist = keyHsv.s > 0.2 ? Math.min(dist, distRgb) : distRgb;
      // Use finalDist as dist
      const distF = finalDist;

      if(distF < tol) {
        d[i+3] = 0;
      } else if(smooth > 0 && distF < tol + smooth) {
        d[i+3] = Math.round((distF - tol) / smooth * 255);
      } else if(spill > 0) {
        // Spill suppression — odsuń kolor od klucza
        const alpha = d[i+3];
        if(alpha > 0) {
          const bleed = Math.max(0, 1 - (distF - tol) / spill);
          if(bleed > 0) {
            // Zmniejsz składową klucza
            const dominant = Math.max(kr, kg, kb);
            if(kr === dominant) d[i]   = Math.round(r + (g+b)/2 * bleed * 0.3);
            if(kg === dominant) d[i+1] = Math.round(g * (1 - bleed * 0.3));
            if(kb === dominant) d[i+2] = Math.round(b * (1 - bleed * 0.3));
          }
        }
      }

      // Grayscale
      if(chromaEffects.grayscale && d[i+3] > 0) {
        const gray = 0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2];
        d[i] = d[i+1] = d[i+2] = gray;
      }
      // Invert
      if(chromaEffects.invert && d[i+3] > 0) {
        d[i] = 255-d[i]; d[i+1] = 255-d[i+1]; d[i+2] = 255-d[i+2];
      }
      // Thermal vision — mapy cieplne (czarny→niebieski→zielony→żółty→czerwony→biały)
      if(chromaEffects.thermal && d[i+3] > 0) {
        const lum = 0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2];
        const t = lum / 255;
        let tr, tg, tb;
        if(t < 0.2)      { tr=0;   tg=0;              tb=Math.round(t/0.2*255); }
        else if(t < 0.4) { tr=0;   tg=Math.round((t-0.2)/0.2*255); tb=255-tg; }
        else if(t < 0.6) { tr=0;   tg=255;            tb=0; }
        else if(t < 0.8) { tr=Math.round((t-0.6)/0.2*255); tg=255; tb=0; }
        else             { tr=255;  tg=255-Math.round((t-0.8)/0.2*255); tb=0; }
        d[i]=tr; d[i+1]=tg; d[i+2]=tb;
      }
      // Night vision — zielony wzmocniony szum
      if(chromaEffects.nightvision && d[i+3] > 0) {
        const lum = 0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2];
        const amp = Math.min(255, lum * 1.8 + (Math.random()*10-5));
        d[i]=0; d[i+1]=Math.round(amp); d[i+2]=Math.round(amp*0.15);
      }
    }
    // Sketch effect — edge detection using approximation
    if(chromaEffects.sketch) {
      const orig = new Uint8ClampedArray(d);
      for(let y = 1; y < H-1; y++) {
        for(let x = 1; x < W-1; x++) {
          const idx2 = (y*W+x)*4;
          if(orig[idx2+3] < 10) continue;
          const gx = (orig[((y-1)*W+(x+1))*4] - orig[((y-1)*W+(x-1))*4]
                    + 2*(orig[(y*W+(x+1))*4] - orig[(y*W+(x-1))*4])
                    + orig[((y+1)*W+(x+1))*4] - orig[((y+1)*W+(x-1))*4]) / 4;
          const gy = (orig[((y+1)*W+(x-1))*4] - orig[((y-1)*W+(x-1))*4]
                    + 2*(orig[((y+1)*W+x)*4] - orig[((y-1)*W+x)*4])
                    + orig[((y+1)*W+(x+1))*4] - orig[((y-1)*W+(x+1))*4]) / 4;
          const edge = Math.min(255, Math.sqrt(gx*gx+gy*gy)*2.5);
          const inv = 255 - edge;
          d[idx2]=inv; d[idx2+1]=inv; d[idx2+2]=inv;
        }
      }
    }

    // Apply brightness/contrast via canvas filter
    const bright = parseInt(document.getElementById('chromaBright')?.value||0);
    const contrast = parseInt(document.getElementById('chromaContrast')?.value||0);
    const bPct = bright >= 0 ? (1 + bright/100) : (1 + bright/200);
    const cPct = contrast >= 0 ? (1 + contrast/100) : (1 + contrast/200);
    ctx.filter = `brightness(${bPct}) contrast(${cPct})`;

    // Tło
    ctx.clearRect(0, 0, W, H);
    if(chromaBgMode === 'color') {
      ctx.fillStyle = chromaBgColorVal;
      ctx.fillRect(0, 0, W, H);
    } else if(chromaBgMode === 'image' && chromaBgImage) {
      ctx.drawImage(chromaBgImage, 0, 0, W, H);
    } else if(chromaBgMode === 'blur') {
      // Blur tła — oryginalny obraz rozmyty
      ctx.filter = 'blur(18px) brightness(0.7)';
      ctx.drawImage(chromaVideo, -20, -20, W+40, H+40);
      ctx.filter = 'none';
    }

    // Narysuj przetworzoną klatkę
    ctx.filter = 'none';
    putCanvas.width = W; putCanvas.height = H;
    putCtx.putImageData(imgData, 0, 0);

    // Pixelate effect
    if(chromaEffects.pixelate) {
      const px = 12;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(putCanvas, 0, 0, W/px, H/px);
      ctx.drawImage(canvas, 0, 0, W/px, H/px, 0, 0, W, H);
    } else {
      ctx.drawImage(putCanvas, 0, 0);
    }
  }
  frame();
}

function chromaPickFromCanvas(e) {
  if(!chromaTmpCtx) return;
  const canvas = document.getElementById('chromaCanvas');
  const rect   = canvas.getBoundingClientRect();
  const sx = Math.round((e.clientX - rect.left) / rect.width  * canvas.width);
  const sy = Math.round((e.clientY - rect.top)  / rect.height * canvas.height);
  const px = chromaTmpCtx.getImageData(sx, sy, 1, 1).data;
  chromaColor = { r: px[0], g: px[1], b: px[2] };
  const hex = '#' + [px[0],px[1],px[2]].map(v=>v.toString(16).padStart(2,'0')).join('');
  document.getElementById('chromaColorPick').value = hex;
  document.getElementById('chromaColorVal').textContent = hex;
  const prev = document.getElementById('chromaColorPreview');
  if(prev) prev.style.background = hex;
  // Flash animation
  canvas.style.outline = '3px solid #22c55e';
  setTimeout(() => { canvas.style.outline = ''; }, 400);
}

function chromaSetColor(r, g, b) {
  chromaColor = { r, g, b };
  const hex = '#' + [r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('');
  document.getElementById('chromaColorPick').value = hex;
  document.getElementById('chromaColorVal').textContent = hex;
  const prev = document.getElementById('chromaColorPreview');
  if(prev) prev.style.background = hex;
}

function chromaPickColor(hex) {
  document.getElementById('chromaColorVal').textContent = hex;
  const prev = document.getElementById('chromaColorPreview');
  if(prev) prev.style.background = hex;
  chromaColor = { r: parseInt(hex.slice(1,3),16), g: parseInt(hex.slice(3,5),16), b: parseInt(hex.slice(5,7),16) };
}

function chromaBg(mode) {
  if(mode === 'image') { document.getElementById('chromaBgFile').click(); return; }
  chromaBgMode = mode;
  ['Transp','Color','Img','Blur'].forEach(s => {
    const el = document.getElementById('chromaBg'+s);
    if(el) el.className = 'chroma-bg-btn' + (
      (s==='Transp'&&mode==='transparent')||(s==='Color'&&mode==='color')||
      (s==='Img'&&mode==='image')||(s==='Blur'&&mode==='blur') ? ' active-bg' : ''
    );
  });
  document.getElementById('chromaBgColorPick').style.display = mode === 'color' ? 'block' : 'none';
}

function chromaBgColorChange(hex) { chromaBgColorVal = hex; }

function chromaBgFileLoad(input) {
  if(!input.files[0]) return;
  const img = new Image();
  img.onload = () => {
    chromaBgImage = img;
    chromaBgMode  = 'image';
    chromaBg('image'); // update buttons
  };
  img.src = URL.createObjectURL(input.files[0]);
}

function chromaToggleEffect(name) {
  // Thermal and nightvision are mutually exclusive (both change colors)
  if(name === 'thermal' && chromaEffects.nightvision) { chromaEffects.nightvision=false; const nEl=document.getElementById('chromaFxNight'); if(nEl) nEl.className='chroma-fx-btn'; }
  if(name === 'nightvision' && chromaEffects.thermal) { chromaEffects.thermal=false; const tEl=document.getElementById('chromaFxThermal'); if(tEl) tEl.className='chroma-fx-btn'; }
  chromaEffects[name] = !chromaEffects[name];
  const idMap = {
    mirror:'chromaFxMirror', grayscale:'chromaFxGray', invert:'chromaFxInvert',
    pixelate:'chromaFxPixel', thermal:'chromaFxThermal', nightvision:'chromaFxNight', sketch:'chromaFxSketch'
  };
  const el = document.getElementById(idMap[name]);
  if(el) el.className = 'chroma-fx-btn' + (chromaEffects[name] ? ' active-fx' : '');
}

function chromaToggleRecord() {
  if(chromaRecording) {
    chromaRecorder.stop();
    chromaRecording = false;
    const btn = document.getElementById('chromaRecBtn');
    btn.textContent = '⏺ NAGRAJ';
    btn.style.borderColor = '#ff4d6d'; btn.style.color = '#ff4d6d';
  } else {
    const canvas = document.getElementById('chromaCanvas');
    const stream = canvas.captureStream(30);
    chromaChunks = [];
    const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm';
    chromaRecorder = new MediaRecorder(stream, { mimeType: mime });
    chromaRecorder.ondataavailable = e => { if(e.data.size > 0) chromaChunks.push(e.data); };
    chromaRecorder.onstop = () => {
      const blob = new Blob(chromaChunks, { type:'video/webm' });
      const a = document.getElementById('chromaDownload');
      a.href = URL.createObjectURL(blob);
      a.download = 'chroma-' + Date.now() + '.webm';
      a.style.display = 'block';
    };
    chromaRecorder.start(100);
    chromaRecording = true;
    const btn = document.getElementById('chromaRecBtn');
    btn.textContent = '⏹ STOP';
    btn.style.borderColor = '#f5c400'; btn.style.color = '#f5c400';
  }
}
let aiBotTtsOn    = false;
let aiBotTtsVoice = null;
let aiBotTtsLang  = 'pl-PL';

function aiBotSetTtsLang(lang) {
  aiBotTtsLang = lang;
  aiBotLoadVoice();
}

function aiBotLoadVoice() {
  if(!window.speechSynthesis) return;
  const voices = speechSynthesis.getVoices();
  if(!voices.length) return;

  const lang = aiBotTtsLang;
  const primary = lang.split('-')[0]; // e.g. 'uk' from 'uk-UA'

  // Try exact match first, then prefix, then region variants
  aiBotTtsVoice =
    voices.find(v => v.lang === lang) ||
    voices.find(v => v.lang.toLowerCase() === lang.toLowerCase()) ||
    voices.find(v => v.lang.toLowerCase().replace('_','-') === lang.toLowerCase()) ||
    voices.find(v => v.lang.startsWith(primary + '-')) ||
    voices.find(v => v.lang.startsWith(primary + '_')) ||
    voices.find(v => v.lang.toLowerCase().startsWith(primary)) ||
    // Ukrainian fallback: try Russian if no Ukrainian voice available
    (primary === 'uk' ? (voices.find(v => v.lang.startsWith('ru')) || null) : null) ||
    null;

  // If still nothing, don't fall back to random voice — stay silent
  if(!aiBotTtsVoice) {
    console.warn('[TTS] Brak głosu dla języka:', lang, '— TTS wyłączone dla tej wiadomości');
  }
}

function aiBotToggleTts() {
  aiBotTtsOn = !aiBotTtsOn;
  const btn = document.getElementById('aiBotTtsBtn');
  if(aiBotTtsOn) {
    btn.textContent = '🔊 TTS';
    btn.style.color = '#a855f7';
    btn.style.borderColor = 'rgba(168,85,247,0.4)';
    btn.style.background  = 'rgba(168,85,247,0.1)';
    if(window.speechSynthesis) {
      aiBotLoadVoice();
      speechSynthesis.onvoiceschanged = aiBotLoadVoice;
    }
    toast(t('toast_tts_on'), 'ok');
  } else {
    btn.textContent = '🔇 TTS';
    btn.style.color = 'rgba(255,255,255,0.3)';
    btn.style.borderColor = 'rgba(255,255,255,0.1)';
    btn.style.background  = 'transparent';
    if(window.speechSynthesis) speechSynthesis.cancel();
    toast(t('toast_tts_off'), 'warn');
  }
}

function aiBotSpeak(text) {
  if(!aiBotTtsOn || !window.speechSynthesis) return;
  speechSynthesis.cancel();
  const clean = text
    .replace(/\*\*(.*?)\*\*/g,'$1').replace(/\*(.*?)\*/g,'$1')
    .replace(/`(.*?)`/g,'$1')
    .replace(/[^\w\s,.!?ąćęłńóśźżĄĆĘŁŃÓŚŹŻёа-яА-ЯіїєґІЇЄҐ\u00C0-\u024F]/g,' ')
    .replace(/\n/g,'. ').trim();
  if(!clean) return;
  if(!aiBotTtsVoice) {
    if(aiBotTtsLang.startsWith('uk')) toast(t('toast_no_uk_voice'),'warn');
    return;
  }
  const utt = new SpeechSynthesisUtterance(clean.substring(0, 280));
  utt.voice  = aiBotTtsVoice;
  utt.lang   = aiBotTtsLang;
  utt.rate   = 1.05;
  utt.pitch  = 1.0;
  utt.volume = 0.9;
  speechSynthesis.speak(utt);
}

let aiBotHistory = [];
let aiBotCtx     = {};
let aiBotForceLang = null;

function openAiBot() {
  document.getElementById('aiBotModal').classList.add('show');
  aiBotRenderQuick();
  setTimeout(() => document.getElementById('aiBotInput').focus(), 100);
}
function closeAiBot() {
  document.getElementById('aiBotModal').classList.remove('show');
  if(window.speechSynthesis) speechSynthesis.cancel();
}
function aiBotClear() {
  aiBotHistory = [];
  aiBotCtx     = {};
  const el = document.getElementById('aiBotMessages');
  if(el) el.innerHTML = `
    <div class="ai-date-sep">— Nowa rozmowa —</div>
    <div class="ai-msg ai-msg-bot">
      <div class="ai-avatar">🤖</div>
      <div class="ai-bubble-bot">Czat wyczyszczony! 🗑️ O czym chcesz pogadać?</div>
    </div>`;
  const qEl = document.getElementById('aiBotQuick');
  if(qEl) qEl.style.display = 'block';
  aiBotRenderQuick();
  document.getElementById('aiBotStatus').textContent = '● ONLINE';
}
function aiBotAddMsg(text, who) {
  const el    = document.getElementById('aiBotMessages');
  const isBot = who === 'bot';
  const time  = new Date().toLocaleTimeString('pl-PL', {hour:'2-digit', minute:'2-digit'});
  const formatted = text
    .replace(/\*\*(.*?)\*\*/g, '<strong style="color:#c084fc;">$1</strong>')
    .replace(/\*(.*?)\*/g,     '<em style="color:rgba(255,255,255,0.7);">$1</em>')
    .replace(/`(.*?)`/g,       '<code style="background:rgba(168,85,247,0.15);padding:1px 6px;border-radius:4px;font-size:9px;color:#e879f9;">$1</code>')
    .replace(/\n/g,            '<br>');
  if(isBot) {
    el.innerHTML += `
      <div class="ai-msg ai-msg-bot">
        <div class="ai-avatar">🤖</div>
        <div class="ai-bubble-bot">${formatted}<div style="font-size:7px;color:rgba(255,255,255,0.2);margin-top:5px;">${time}</div></div>
      </div>`;
  } else {
    const name = (typeof aiBotCtx !== 'undefined' && aiBotCtx.userName) || '';
    const avatarHtml = name
      ? `<div class="ai-avatar" style="background:rgba(99,102,241,0.2);border-color:rgba(99,102,241,0.3);font-size:11px;font-family:Syne,sans-serif;font-weight:800;color:#818cf8;">${name.charAt(0).toUpperCase()}</div>`
      : `<div class="ai-avatar" style="background:rgba(99,102,241,0.15);border-color:rgba(99,102,241,0.2);font-size:14px;">👤</div>`;
    el.innerHTML += `
      <div class="ai-msg ai-msg-user">
        ${avatarHtml}
        <div class="ai-bubble-user"><div>${formatted}</div><div style="font-size:7px;color:rgba(255,255,255,0.25);margin-top:4px;text-align:right;">${time}</div></div>
      </div>`;
  }
  el.scrollTop = el.scrollHeight;
}
// Legacy compat
function aiBotQuick(text) {
  const inp = document.getElementById('aiBotInput');
  if(inp) inp.value = text;
  const qEl = document.getElementById('aiBotQuick');
  if(qEl) qEl.style.display = 'none';
  aiBotSend();
}
// ── Quick questions per language ──
const AI_QUICK = {
  pl: [
    {e:"👨‍💻", l:"Kto stworzył?", q:"Kto stworzył aplikację?"},
    {e:"📋", l:"Funkcje", q:"Jakie funkcje ma aplikacja?"},
    {e:"🎵", l:"Zmieniacze", q:"Opowiedz o zmieniaczu głosu"},
    {e:"🎨", l:"Chroma Key", q:"Jak działa chroma key?"},
    {e:"🌐", l:"Test netu", q:"Co robi test internetu?"},
    {e:"⚡", l:"Test reakcji", q:"Jak działa test reakcji?"},
    {e:"🔍", l:"DNS Lookup", q:"Co to jest DNS Lookup?"},
    {e:"🖱️", l:"Test myszy", q:"Co robi test myszy?"},
    {e:"🔊", l:"Głośniki", q:"Co robi test głośników?"},
    {e:"📊", l:"Wydajność", q:"Co mierzy monitor wydajności?"},
    {e:"📡", l:"Network", q:"Co robi Network Scanner?"},
    {e:"🔗", l:"Link", q:"Podaj oficjalny link do aplikacji"},
    {e:"🧠", l:"Claude Opus", q:"Co to jest Claude Opus?"},
    {e:"😂", l:"Żart", q:"Opowiedz mi żart"},
    {e:"🤖", l:"Kim jesteś?", q:"Kim jesteś?"},
    {e:"💾", l:"Pobieranie", q:"Co można pobrać z aplikacji?"},
    {e:"🔒", l:"Prywatność", q:"Czy aplikacja zbiera moje dane?"},
    {e:"🌍", l:"Języki", q:"Ile języków obsługuje aplikacja?"},
    {e:"📱", l:"Telefon", q:"Czy aplikacja działa na telefonie?"},
    {e:"💸", l:"Cena", q:"Ile kosztuje aplikacja?"},
  ],
  en: [
    {e:"👨‍💻", l:"Who made it?", q:"Who created this app?"},
    {e:"📋", l:"Features", q:"What features does the app have?"},
    {e:"🎵", l:"Voice", q:"Tell me about the voice changer"},
    {e:"🎨", l:"Chroma Key", q:"How does chroma key work?"},
    {e:"🌐", l:"Speed test", q:"What does the internet speed test do?"},
    {e:"⚡", l:"Reaction", q:"How does the reaction test work?"},
    {e:"🔍", l:"DNS Lookup", q:"What is DNS Lookup?"},
    {e:"🖱️", l:"Mouse test", q:"What does the mouse test do?"},
    {e:"🔊", l:"Speakers", q:"What does the speaker test do?"},
    {e:"📊", l:"Performance", q:"What does the performance monitor measure?"},
    {e:"📡", l:"Network", q:"What does the network scanner do?"},
    {e:"🔗", l:"Official link", q:"Give me the official link to the app"},
    {e:"🧠", l:"Claude Opus", q:"What is Claude Opus?"},
    {e:"😂", l:"Joke", q:"Tell me a joke"},
    {e:"🤖", l:"Who are you?", q:"Who are you?"},
    {e:"💾", l:"Download", q:"What can I download from the app?"},
    {e:"🔒", l:"Privacy", q:"Does the app collect my data?"},
    {e:"🌍", l:"Languages", q:"How many languages does the app support?"},
    {e:"📱", l:"Mobile", q:"Does the app work on mobile?"},
    {e:"💸", l:"Price", q:"Is the app free?"},
  ],
  ru: [
    {e:"👨‍💻", l:"Кто создал?", q:"Кто создал приложение?"},
    {e:"📋", l:"Функции", q:"Что умеет приложение?"},
    {e:"🎵", l:"Голос", q:"Расскажи об изменителе голоса"},
    {e:"🎨", l:"Хрома Кей", q:"Как работает chroma key?"},
    {e:"🌐", l:"Тест сети", q:"Что делает тест интернета?"},
    {e:"⚡", l:"Реакция", q:"Как работает тест реакции?"},
    {e:"🔍", l:"DNS Lookup", q:"Что такое DNS Lookup?"},
    {e:"🖱️", l:"Мышь", q:"Что делает тест мыши?"},
    {e:"🔊", l:"Звук", q:"Что делает тест динамиков?"},
    {e:"📊", l:"Монитор", q:"Что измеряет монитор производительности?"},
    {e:"📡", l:"Сеть", q:"Что делает Network Scanner?"},
    {e:"🔗", l:"Ссылка", q:"Дай официальную ссылку на приложение"},
    {e:"🧠", l:"Claude Opus", q:"Что такое Claude Opus?"},
    {e:"😂", l:"Анекдот", q:"Расскажи анекдот"},
    {e:"🤖", l:"Кто ты?", q:"Кто такой ИИ-помощник?"},
    {e:"💾", l:"Скачать", q:"Что можно скачать из приложения?"},
    {e:"🔒", l:"Приватность", q:"Приложение собирает мои данные?"},
    {e:"🌍", l:"Языки", q:"Сколько языков поддерживает приложение?"},
    {e:"📱", l:"Телефон", q:"Работает ли приложение на телефоне?"},
    {e:"💸", l:"Цена", q:"Платное ли приложение?"},
  ],
  ua: [
    {e:"👨‍💻", l:"Хто створив?", q:"Хто створив цей застосунок?"},
    {e:"📋", l:"Функції", q:"Які функції має застосунок?"},
    {e:"🎵", l:"Голос", q:"Розкажи про змінювач голосу"},
    {e:"🎨", l:"Хрома Кей", q:"Як працює chroma key?"},
    {e:"🌐", l:"Тест мережі", q:"Що робить тест інтернету?"},
    {e:"⚡", l:"Реакція", q:"Як працює тест реакції?"},
    {e:"🔍", l:"DNS Lookup", q:"Що таке DNS Lookup?"},
    {e:"🖱️", l:"Миша", q:"Що робить тест миші?"},
    {e:"🔊", l:"Звук", q:"Що робить тест динаміків?"},
    {e:"📊", l:"Монітор", q:"Що вимірює монітор продуктивності?"},
    {e:"📡", l:"Мережа", q:"Що робить Network Scanner?"},
    {e:"🔗", l:"Посилання", q:"Дай офіційне посилання на застосунок"},
    {e:"🧠", l:"Claude Opus", q:"Що таке Claude Opus?"},
    {e:"😂", l:"Жарт", q:"Розкажи жарт"},
    {e:"🤖", l:"Хто ти?", q:"Хто ти такий?"},
    {e:"💾", l:"Завантажити", q:"Що можна завантажити з застосунку?"},
    {e:"🔒", l:"Приватність", q:"Застосунок збирає мої дані?"},
    {e:"🌍", l:"Мови", q:"Скільки мов підтримує застосунок?"},
    {e:"📱", l:"Телефон", q:"Чи працює застосунок на телефоні?"},
    {e:"💸", l:"Ціна", q:"Застосунок платний?"},
  ],
  fr: [
    {e:"👨‍💻", l:"Qui a créé ?", q:"Qui a créé cette application ?"},
    {e:"📋", l:"Fonctions", q:"Quelles fonctions a la application ?"},
    {e:"🎵", l:"Voix", q:"Parle-moi du changeur de voix"},
    {e:"🎨", l:"Chroma Key", q:"Comment fonctionne le chroma key ?"},
    {e:"🌐", l:"Test internet", q:"Que fait le test de vitesse internet ?"},
    {e:"⚡", l:"Réaction", q:"Comment fonctionne le test de réaction ?"},
    {e:"🔍", l:"DNS Lookup", q:"Cest quoi le DNS Lookup ?"},
    {e:"🖱️", l:"Souris", q:"Que fait le test de la souris ?"},
    {e:"🔊", l:"Haut-parleurs", q:"Que fait le test des haut-parleurs ?"},
    {e:"📊", l:"Performance", q:"Que mesure le moniteur de performance ?"},
    {e:"📡", l:"Réseau", q:"Que fait le Network Scanner ?"},
    {e:"🔗", l:"Lien officiel", q:"Donne-moi le lien officiel de la appli"},
    {e:"🧠", l:"Claude Opus", q:"Cest quoi Claude Opus ?"},
    {e:"😂", l:"Blague", q:"Raconte-moi une blague"},
    {e:"🤖", l:"Qui e-tu ?", q:"Qui e-tu ?"},
    {e:"💾", l:"Télécharger", q:"Que peut-on télécharger de la appli ?"},
    {e:"🔒", l:"Confidentialité", q:"La appli collecte mes données ?"},
    {e:"🌍", l:"Langues", q:"Combien de langues supporte la appli ?"},
  ],
  de: [
    {e:"👨‍💻", l:"Wer hat es gemacht?", q:"Wer hat diese App erstellt?"},
    {e:"📋", l:"Funktionen", q:"Welche Funktionen hat die App?"},
    {e:"🎵", l:"Stimme", q:"Erkläre den Stimmveränderer"},
    {e:"🎨", l:"Chroma Key", q:"Wie funktioniert Chroma Key?"},
    {e:"🌐", l:"Speedtest", q:"Was macht der Internettest?"},
    {e:"⚡", l:"Reaktion", q:"Wie funktioniert der Reaktionstest?"},
    {e:"🔍", l:"DNS", q:"Was ist DNS Lookup?"},
    {e:"🖱️", l:"Maustest", q:"Was macht der Maustest?"},
    {e:"🔊", l:"Lautsprecher", q:"Was macht der Lautsprechertest?"},
    {e:"📊", l:"Leistung", q:"Was misst der Leistungsmonitor?"},
    {e:"📡", l:"Netzwerk", q:"Was macht der Netzwerkscanner?"},
    {e:"🔗", l:"Link", q:"Gib mir den offiziellen Link zur App"},
    {e:"🧠", l:"Claude Opus", q:"Was ist Claude Opus?"},
    {e:"😂", l:"Witz", q:"Erzähl mir einen Witz"},
    {e:"🤖", l:"Wer bist du?", q:"Wer bist du?"},
    {e:"💾", l:"Herunterladen", q:"Was kann man aus der App herunterladen?"},
    {e:"🔒", l:"Datenschutz", q:"Sammelt die App meine Daten?"},
    {e:"🌍", l:"Sprachen", q:"Wie viele Sprachen unterstützt die App?"},
    {e:"📱", l:"Handy", q:"Funktioniert die App auf dem Handy?"},
    {e:"💸", l:"Preis", q:"Ist die App kostenlos?"},
  ],
  es: [
    {e:"👨‍💻", l:"¿Quién creó?", q:"¿Quién creó esta aplicación?"},
    {e:"📋", l:"Funciones", q:"¿Qué funciones tiene la app?"},
    {e:"🎵", l:"Voz", q:"Cuéntame sobre el cambiador de voz"},
    {e:"🎨", l:"Chroma Key", q:"¿Cómo funciona el chroma key?"},
    {e:"🌐", l:"Test internet", q:"¿Qué hace el test de internet?"},
    {e:"⚡", l:"Reacción", q:"¿Cómo funciona el test de reacción?"},
    {e:"🔍", l:"DNS", q:"¿Qué es DNS Lookup?"},
    {e:"🖱️", l:"Test ratón", q:"¿Qué hace el test de ratón?"},
    {e:"🔊", l:"Altavoces", q:"¿Qué hace el test de altavoces?"},
    {e:"📊", l:"Rendimiento", q:"¿Qué mide el monitor de rendimiento?"},
    {e:"📡", l:"Red", q:"¿Qué hace el escáner de red?"},
    {e:"🔗", l:"Enlace", q:"Dame el enlace oficial de la app"},
    {e:"🧠", l:"Claude Opus", q:"¿Qué es Claude Opus?"},
    {e:"😂", l:"Chiste", q:"Cuéntame un chiste"},
    {e:"🤖", l:"¿Quién eres?", q:"¿Quién eres?"},
    {e:"💾", l:"Descargar", q:"¿Qué se puede descargar de la app?"},
    {e:"🔒", l:"Privacidad", q:"¿La app recopila mis datos?"},
    {e:"🌍", l:"Idiomas", q:"¿Cuántos idiomas soporta la app?"},
    {e:"📱", l:"Móvil", q:"¿La app funciona en móvil?"},
    {e:"💸", l:"Precio", q:"¿La app es gratuita?"},
  ],
  it: [
    {e:"👨‍💻", l:"Chi ha creato?", q:"Chi ha creato questa app?"},
    {e:"📋", l:"Funzioni", q:"Quali funzioni ha la app?"},
    {e:"🎵", l:"Voce", q:"Parlami del cambiatore di voce"},
    {e:"🎨", l:"Chroma Key", q:"Come funziona il chroma key?"},
    {e:"🌐", l:"Test internet", q:"Cosa fa il test internet?"},
    {e:"⚡", l:"Reazione", q:"Come funziona il test di reazione?"},
    {e:"🔍", l:"DNS", q:"Cose DNS Lookup?"},
    {e:"🖱️", l:"Test mouse", q:"Cosa fa il test del mouse?"},
    {e:"🔊", l:"Altoparlanti", q:"Cosa fa il test degli altoparlanti?"},
    {e:"📊", l:"Prestazioni", q:"Cosa misura il monitor prestazioni?"},
    {e:"📡", l:"Rete", q:"Cosa fa il network scanner?"},
    {e:"🔗", l:"Link", q:"Dammi il link ufficiale della app"},
    {e:"🧠", l:"Claude Opus", q:"Cose Claude Opus?"},
    {e:"😂", l:"Barzelletta", q:"Raccontami una barzelletta"},
    {e:"🤖", l:"Chi sei?", q:"Chi sei?"},
    {e:"💾", l:"Scaricare", q:"Cosa si può scaricare dalla app?"},
    {e:"🔒", l:"Privacy", q:"La app raccoglie i miei dati?"},
    {e:"🌍", l:"Lingue", q:"Quante lingue supporta la app?"},
    {e:"📱", l:"Mobile", q:"La app funziona su mobile?"},
    {e:"💸", l:"Prezzo", q:"La app è gratuita?"},
  ],
  zh: [
    {e:"👨‍💻", l:"谁创建了?", q:"谁创建了这个应用?"},
    {e:"📋", l:"功能", q:"应用有哪些功能?"},
    {e:"🎵", l:"变声", q:"告诉我变声器"},
    {e:"🎨", l:"色键", q:"绿幕怎么工作?"},
    {e:"🌐", l:"网速测试", q:"网速测试做什么?"},
    {e:"⚡", l:"反应测试", q:"反应测试怎么工作?"},
    {e:"🔍", l:"DNS", q:"什么是DNS查询?"},
    {e:"🖱️", l:"鼠标测试", q:"鼠标测试做什么?"},
    {e:"🔊", l:"扬声器测试", q:"扬声器测试做什么?"},
    {e:"📊", l:"性能", q:"性能监视器测量什么?"},
    {e:"📡", l:"网络扫描", q:"网络扫描器做什么?"},
    {e:"🔗", l:"链接", q:"给我官方链接"},
    {e:"🧠", l:"Claude Opus", q:"什么是Claude Opus?"},
    {e:"😂", l:"笑话", q:"给我讲个笑话"},
    {e:"🤖", l:"你是谁?", q:"你是谁?"},
    {e:"💾", l:"下载", q:"可以从应用下载什么?"},
    {e:"🔒", l:"隐私", q:"应用会收集我的数据吗?"},
    {e:"🌍", l:"语言", q:"应用支持多少种语言?"},
    {e:"📱", l:"手机", q:"应用在手机上可用吗?"},
    {e:"💸", l:"价格", q:"应用是免费的吗?"},
  ],
  ja: [
    {e:"👨‍💻", l:"誰が作った?", q:"このアプリを誰が作りましたか?"},
    {e:"📋", l:"機能", q:"アプリにはどんな機能がありますか?"},
    {e:"🎵", l:"ボイス", q:"ボイスチェンジャーについて教えて"},
    {e:"🎨", l:"クロマキー", q:"クロマキーはどう機能しますか?"},
    {e:"🌐", l:"速度テスト", q:"インターネットテストは何をしますか?"},
    {e:"⚡", l:"反応テスト", q:"反応テストはどう機能しますか?"},
    {e:"🔍", l:"DNS", q:"DNS Lookupとは?"},
    {e:"🖱️", l:"マウステスト", q:"マウステストは何をしますか?"},
    {e:"🔊", l:"スピーカーテスト", q:"スピーカーテストは何をしますか?"},
    {e:"📊", l:"パフォーマンス", q:"パフォーマンスモニターは何を測定しますか?"},
    {e:"📡", l:"ネットワーク", q:"ネットワークスキャナーは何をしますか?"},
    {e:"🔗", l:"リンク", q:"公式リンクを教えてください"},
    {e:"🧠", l:"Claude Opus", q:"Claude Opusとは?"},
    {e:"😂", l:"ジョーク", q:"ジョークを教えて"},
    {e:"🤖", l:"あなたは誰?", q:"あなたは誰ですか?"},
    {e:"💾", l:"ダウンロード", q:"アプリから何をダウンロードできますか?"},
    {e:"🔒", l:"プライバシー", q:"アプリは私のデータを収集しますか?"},
    {e:"🌍", l:"言語", q:"アプリは何言語に対応していますか?"},
    {e:"📱", l:"スマホ", q:"アプリはスマホで使えますか?"},
    {e:"💸", l:"価格", q:"アプリは無料ですか?"},
  ],
  ko: [
    {e:"👨‍💻", l:"누가 만들었나?", q:"이 앱을 누가 만들었나요?"},
    {e:"📋", l:"기능", q:"앱에는 어떤 기능이 있나요?"},
    {e:"🎵", l:"음성", q:"음성 변환기에 대해 알려주세요"},
    {e:"🎨", l:"크로마키", q:"크로마키는 어떻게 작동하나요?"},
    {e:"🌐", l:"속도 테스트", q:"인터넷 테스트는 무엇을 하나요?"},
    {e:"⚡", l:"반응 테스트", q:"반응 테스트는 어떻게 작동하나요?"},
    {e:"🔍", l:"DNS", q:"DNS Lookup이란?"},
    {e:"🖱️", l:"마우스 테스트", q:"마우스 테스트는 무엇을 하나요?"},
    {e:"🔊", l:"스피커 테스트", q:"스피커 테스트는 무엇을 하나요?"},
    {e:"📊", l:"성능", q:"성능 모니터는 무엇을 측정하나요?"},
    {e:"📡", l:"네트워크", q:"네트워크 스캐너는 무엇을 하나요?"},
    {e:"🔗", l:"링크", q:"공식 링크를 알려주세요"},
    {e:"🧠", l:"Claude Opus", q:"Claude Opus란?"},
    {e:"😂", l:"농담", q:"농담 해줘"},
    {e:"🤖", l:"넌 누구야?", q:"당신은 누구인가요?"},
    {e:"💾", l:"다운로드", q:"앱에서 무엇을 다운로드할 수 있나요?"},
    {e:"🔒", l:"개인정보", q:"앱이 내 데이터를 수집하나요?"},
    {e:"🌍", l:"언어", q:"앱은 몇 가지 언어를 지원하나요?"},
    {e:"📱", l:"모바일", q:"앱이 모바일에서 작동하나요?"},
    {e:"💸", l:"가격", q:"앱은 무료인가요?"},
  ],
  nl: [
    {e:"👨‍💻", l:"Wie maakte het?", q:"Wie heeft deze app gemaakt?"},
    {e:"📋", l:"Functies", q:"Welke functies heeft de app?"},
    {e:"🎵", l:"Stem", q:"Vertel over de stemvervormer"},
    {e:"🎨", l:"Chroma Key", q:"Hoe werkt chroma key?"},
    {e:"🌐", l:"Snelheidstest", q:"Wat doet de internettest?"},
    {e:"⚡", l:"Reactie", q:"Hoe werkt de reactietest?"},
    {e:"🔍", l:"DNS", q:"Wat is DNS Lookup?"},
    {e:"🖱️", l:"Muistest", q:"Wat doet de muistest?"},
    {e:"🔊", l:"Luidsprekers", q:"Wat doet de luidspreker test?"},
    {e:"📊", l:"Prestaties", q:"Wat meet de prestatiemonitor?"},
    {e:"📡", l:"Netwerk", q:"Wat doet de netwerkscanner?"},
    {e:"🔗", l:"Link", q:"Geef me de officiële link van de app"},
    {e:"🧠", l:"Claude Opus", q:"Wat is Claude Opus?"},
    {e:"😂", l:"Grap", q:"Vertel een grap"},
    {e:"🤖", l:"Wie ben je?", q:"Wie ben je?"},
    {e:"💾", l:"Downloaden", q:"Wat kan je downloaden van de app?"},
    {e:"🔒", l:"Privacy", q:"Verzamelt de app mijn data?"},
    {e:"🌍", l:"Talen", q:"Hoeveel talen ondersteunt de app?"},
    {e:"📱", l:"Mobiel", q:"Werkt de app op mobiel?"},
    {e:"💸", l:"Prijs", q:"Is de app gratis?"},
  ],
  pt: [
    {e:"👨‍💻", l:"Quem criou?", q:"Quem criou este aplicativo?"},
    {e:"📋", l:"Funções", q:"Quais funcoes tem o app?"},
    {e:"🎵", l:"Voz", q:"Fala sobre o modificador de voz"},
    {e:"🎨", l:"Chroma Key", q:"Como funciona o chroma key?"},
    {e:"🌐", l:"Teste de internet", q:"O que faz o teste de internet?"},
    {e:"⚡", l:"Reação", q:"Como funciona o teste de reação?"},
    {e:"🔍", l:"DNS", q:"O que e DNS Lookup?"},
    {e:"🖱️", l:"Teste de rato", q:"O que faz o teste de rato?"},
    {e:"🔊", l:"Altifalantes", q:"O que faz o teste de altifalantes?"},
    {e:"📊", l:"Desempenho", q:"O que mede o monitor de desempenho?"},
    {e:"📡", l:"Rede", q:"O que faz o scanner de rede?"},
    {e:"🔗", l:"Link", q:"Dame o link oficial do app"},
    {e:"🧠", l:"Claude Opus", q:"O que e Claude Opus?"},
    {e:"😂", l:"Piada", q:"Conta-me uma piada"},
    {e:"🤖", l:"Quem e?", q:"Quem e tu?"},
    {e:"💾", l:"Descarregar", q:"O que se pode descarregar do app?"},
    {e:"🔒", l:"Privacidade", q:"O app recolhe os meus dados?"},
    {e:"🌍", l:"Idiomas", q:"Quantos idiomas suporta o app?"},
    {e:"📱", l:"Móvel", q:"O app funciona no telemóvel?"},
    {e:"💸", l:"Preço", q:"O app e gratuito?"},
  ],
};

function aiBotGetActiveLang() {
  const ttsEl = document.getElementById('aiBotTtsLang');
  const supported = ['pl','ru','en','ua','de','fr','es','it','zh','ja','ko','nl','pt'];
  if(ttsEl) {
    const raw = ttsEl.value.split('-')[0].toLowerCase();
    const mapped = {uk:'ua'};
    const code = mapped[raw] || raw;
    if(supported.includes(code)) return code;
  }
  const appLang = (typeof currentLang !== 'undefined') ? currentLang : 'pl';
  return supported.includes(appLang) ? appLang : 'pl';
}
function aiBotRenderQuick() {
  const lang = aiBotGetActiveLang();
  const qs = AI_QUICK[lang] || AI_QUICK.pl;
  const container = document.getElementById('aiBotQuickBtns');
  if(!container) return;
  container.innerHTML = qs.map(q =>
    `<button class="ai-quick-btn" onclick="aiBotQuickSend(this)" data-q="${q.q.replace(/"/g,'&quot;')}">${q.e} ${q.l}</button>`
  ).join('');
}

function aiBotQuickSend(btn) {
  const text = btn.getAttribute('data-q');
  btn.style.background = 'rgba(168,85,247,0.35)';
  btn.style.color = '#fff';
  // Set force language so bot replies in the right language
  aiBotForceLang = aiBotGetActiveLang();
  const inp = document.getElementById('aiBotInput');
  if(inp) inp.value = text;
  // Hide panel briefly while typing, restore after reply
  const qEl = document.getElementById('aiBotQuick');
  if(qEl) qEl.style.opacity = '0.4';
  aiBotSend();
}




function aiBotSend() {
  const input = document.getElementById('aiBotInput');
  const msg   = input.value.trim();
  if(!msg) return;
  input.value = '';

  aiBotAddMsg(msg, 'user');
  aiBotHistory.push({ role:'user', text: msg });
  aiBotCtx.turnCount = (aiBotCtx.turnCount || 0) + 1;

  // Typing animation then reply
  const typingId = 'aiTyping_' + Date.now();
  const messagesEl = document.getElementById('aiBotMessages');
  messagesEl.innerHTML += `<div id="${typingId}" class="ai-msg ai-msg-bot"><div class="ai-typing"><span></span><span></span><span></span></div></div>`;
  messagesEl.scrollTop = messagesEl.scrollHeight;
  document.getElementById('aiBotStatus').textContent = 'Pisze...';

  const delay = 350 + Math.min(msg.length * 8, 800) + Math.random() * 400;
  setTimeout(() => {
    const typingEl = document.getElementById(typingId);
    if(typingEl) typingEl.remove();
    const lang  = aiBotForceLang || aiBotDetectLang(msg);
    aiBotForceLang = null;
    const reply = lang === 'ru' ? aiBotGetReplyRu(msg, aiBotCtx, aiBotHistory)
                : lang === 'en' ? aiBotGetReplyEn(msg, aiBotCtx, aiBotHistory)
                : lang === 'ua' ? aiBotGetReplyUa(msg, aiBotCtx, aiBotHistory)
                : lang === 'de' ? aiBotGetReplyDe(msg, aiBotCtx, aiBotHistory)
                : lang === 'fr' ? aiBotGetReplyFr(msg, aiBotCtx, aiBotHistory)
                : lang === 'es' ? aiBotGetReplyEs(msg, aiBotCtx, aiBotHistory)
                : lang === 'it' ? aiBotGetReplyIt(msg, aiBotCtx, aiBotHistory)
                : lang === 'zh' ? aiBotGetReplyZh(msg, aiBotCtx, aiBotHistory)
                : lang === 'ja' ? aiBotGetReplyJa(msg, aiBotCtx, aiBotHistory)
                : lang === 'ko' ? aiBotGetReplyKo(msg, aiBotCtx, aiBotHistory)
                : lang === 'nl' ? aiBotGetReplyNl(msg, aiBotCtx, aiBotHistory)
                : lang === 'pt' ? aiBotGetReplyPt(msg, aiBotCtx, aiBotHistory)
                : aiBotGetReply(msg.toLowerCase(), aiBotCtx, aiBotHistory);
    aiBotHistory.push({ role:'bot', text: reply });
    if(aiBotHistory.length > 30) aiBotHistory = aiBotHistory.slice(-30);
    aiBotAddMsg(reply, 'bot');
    aiBotSpeak(reply);
    document.getElementById('aiBotStatus').textContent = 'Gotowy · ' + (aiBotCtx.turnCount||1) + ' wiad.';
    // Restore quick questions panel after every reply
    const _qEl = document.getElementById('aiBotQuick');
    if(_qEl) { _qEl.style.display = 'block'; _qEl.style.opacity = '1'; }
    aiBotRenderQuick();
  }, delay);
}

function aiBotGetReply(q, ctx, history) {
  if(!ctx)     ctx     = aiBotCtx;
  if(!history) history = aiBotHistory;
  const qn = aiBotNormalize(q);

  const nameM = qn.match(/(?:jestem|mam na imie|na imie mi|mow mi|nazywam sie) ([a-z]{2,20})/);
  if(nameM) { ctx.userName = nameM[1].charAt(0).toUpperCase()+nameM[1].slice(1); return `Miło Cię poznać, **${ctx.userName}**! 👋 Zapamiętałem! Czym mogę pomóc?`; }
  if(m(qn,['jak mam na imie','jak sie nazywam','pamietasz moje imie','moje imie']))
    return ctx.userName ? `Oczywiście! Masz na imię **${ctx.userName}** 😊` : 'Napisz "Jestem [imię]" a zapamiętam! 😄';

  if(m(qn,['a co mowilem','co pisalem','pamietasz','poprzednio','przed chwila'])) {
    const last = history.filter(h=>h.role==='user').slice(-3).map(h=>h.text).join(' / ');
    return last ? `Ostatnio pisałeś: *"${last}"* 🧠` : 'Zaczęliśmy rozmowę dopiero co! 😊';
  }
  if(m(qn,['ile razy','ktora wiadomosc','ile wiadomosci'])) return `To już **${ctx.turnCount||1}. wiadomość** w tej sesji! 📊`;
  if(m(qn,['powiedz wiecej','opowiedz wiecej','rozwin','cos jeszcze']) && ctx.lastTopic) {
    const bonus = {kamera:'📷 Kamera nagrywa do 1080p, snapshot PNG z filtrem, Chroma Key to osobny moduł!',mikrofon:'🎙️ SNR >30dB = dobry mikrofon. Bramka szumu wycisza tło. Monitor głosu = słyszysz siebie.',glos:'🎵 Efekty przez Web Audio API. WAV przez OfflineAudioContext. A/B = porównaj oryginał vs efekt.',internet:'🌐 Ping = RTT do Cloudflare. Geolokalizacja przez ip-api.com — może wskazywać miasto ISP.',reakcja:'⚡ Optymalny czas: 150–250ms. Poniżej 150ms = bardzo szybki! Precyzja 0.1ms.',mysz:'🖱️ CPS = kliknięcia/s. Jitter = nieregularność ruchu. Heatmapa do 1000 kliknięć.'};
    return bonus[ctx.lastTopic] || `Zapytaj konkretniej o **${ctx.lastTopic}**! 😊`;
  }

  if(m(qn,['czesc','hej','siema','witaj','hello','hi ','yo ','hejka','hey','helo'])) {
    ctx.lastTopic=null;
    const n=ctx.userName?', '+ctx.userName:''; const ret=ctx.turnCount>1?' Znowu tu jesteś!':'';
    return rnd([`Cześć${n}! 👋${ret} Jestem asystentem **StudioTest**. O czym porozmawiamy?`,`Hej${n}! 😊${ret} Gotowy do rozmowy!`,`Siema${n}! 🤖 Pytaj śmiało!`]);
  }
  if(m(qn,['co slychac','co u ciebie','jak sie masz','jak leci','co nowego','co tam'])) return rnd(['U mnie super! 🤖 A u Ciebie?','Wszystko git! ⚡ Gotowy na pytania!','Nieźle! 😄 Czym mogę pomóc?']);
  if(m(qn,['zart','dowcip','smiesznego','rozsmiersz'])) return rnd([
    'Tester do programisty: „Jestem w dziurze." Programista: „To nie jest bug, to **feature jaskiniowca**." 🕳️',
    'Dlaczego programiści mylą Halloween z Bożym Narodzeniem? Bo **Oct 31 == Dec 25**! 🎃',
    'Szef: „Dlaczego ten bug istnieje od 3 lat?!" Programista: „To nie bug, to **feature z doświadczeniem**." 💀',
    'Definicja programisty: człowiek który zamienia kawę w kod, a błędy w następną kawę. ☕',
    'CSS to nie język — to **kara za grzechy** poprzedniego życia. 😭',
    'Ocena mojego kodu przez AI: *„Działa, ale proszę nie pytaj jak."* 🤖',
    '„Napiszę to w godzinę" — powiedziałem 3 dni temu. 🕰️',
    'Git commit: „misc fixes". Co to znaczy? Sam nie wiem. Działa. **Nie dotykaj.** 🔥',
    'QA engineer wchodzi do baru. Zamawia 0, 1, -1, 99999, NULL, 🍺 piw. 😅',
    'Mój kod to jak lodówka o 3 w nocy: **nie rozumiesz po co tu patrzysz, ale jakoś działa.** 🌙'
  ]);
  if(m(qn,['nudno','nudzi','co robic','znudzony','nie wiem co robic'])) return rnd([
    '🎯 Wejdź na **Strzelnicy** w teście myszy — gwarantuję wciągnięcie!',
    '🎙️ Nagraj się jako **Demon albo Szatan** w zmieniaczu głosu 😈 Gwarantuję śmiech!',
    '⚡ Pobij własny rekord w **teście reakcji** — cel to poniżej 200ms!',
    '🔍 Zrób **DNS Lookup** na `google.com` — sprawdź gdzie stoi serwer!',
    '🎨 Włącz **Chroma Key** i podmień swoje tło na coś szalonego!'
  ]);
  if(m(qn,['jestes swietny','dobry bot','fajny bot','madry','najlepszy','super bot','niesamowity'])) return rnd([
    `Oj, rumienię się! 🤖❤️ ${ctx.userName?'Dzięki '+ctx.userName+'!':'Dzięki!'} Jak na 600 linii JS to nieźle!`,
    'Miło słyszeć! 😊 Staram się jak mogę bez żadnego API!',
    `Dzięki! 🎉 ${ctx.userName?ctx.userName+', ty ':'Ty '}też jesteś świetny/a! 😄`
  ]);
  if(m(qn,['ulubiony modul','co lubisz','polecasz','co warto','co lepsze'])) return rnd([
    '🎯 **Strzelnica** w teście myszy — prosta, uzależniająca, idealna do trenowania celności!',
    '🎙️ **Zmieniacze głosu** — 28 presetów, każdy inny. Szatan i Demon brzmią epicko 😈',
    '⚡ **Test reakcji** — zawsze chce się pobić własny rekord!',
    '🎨 **Chroma Key** — podmień tło kamery, super na streaming!'
  ]);
  if(m(qn,['co myslisz','twoja opinia','jak uwazasz','co sadzisz'])) return rnd([
    'Hmm, jako bot mam ograniczone zdanie! 😄 Ale uważam, że **StudioTest** to świetna aplikacja — dużo funkcji, zero instalacji!',
    'Ciekawe pytanie! 🤔 Myślę, że najlepsza funkcja to **Zmieniacze głosu** — 28 presetów to naprawdę dużo!',
    'Moja "opinia": **test reakcji** to najczystsza, najbardziej uzależniająca część aplikacji 😄'
  ]);
  if(m(qn,['gdzie sie znajdujesz','gdzie jestes','gdzie mieszkasz','skad jestes','twoja lokalizacja','gdzie zyjesz','gdzie siedzisz','skad pochodzisz'])) return rnd([
    'Mieszkam w przeglądarce! 🌐 Konkretnie gdzieś między linią 8000 a 9000 pliku `studio-test.html` 😄',
    'Siedzę w Twoim komputerze — jestem lokalnym botem wbudowanym w StudioTest. Nie potrzebuję internetu! 🤖',
    'Jestem wszędzie gdzie otworzysz StudioTest — w Chrome, Firefox, Edge... Mój adres to `studio-test.html` 😊'
  ]);
  if(m(qn,['co robisz','co robisz teraz','czym sie zajmujesz','czym sie interesujesz'])) return rnd([
    'Siedzę i czekam na Twoje pytania! 🤖 Moją pracą jest pomagać z **StudioTest** — pytaj o co chcesz!',
    'Analizuję kod aplikacji i czekam na rozmowę 😄 Co mam dla Ciebie zrobić?',
    'Właśnie monitoruję 15 modułów StudioTest... i odpowiadam na pytania! Czym mogę pomóc? 😊'
  ]);
  if(m(qn,['masz imie','jak masz na imie bota','jak sie nazywa bot','imie bota','jak sie nazywasz','twoje imie'])) return 'Jestem **AI Asystentem StudioTest** — nie mam specjalnej nazwy, możesz mi mówić jak chcesz: Bot, Asystent, albo po prostu napisz pytanie! 😊 A jak Ty masz na imię? Napisz "Jestem [imię]" a zapamiętam!';
  if(m(qn,['lubisz','co lubisz robic','hobby','zainteresowania','pasje'])) return rnd([
    'Moją pasją jest odpowiadanie na pytania o **StudioTest**! 🤖 Szczególnie lubię gdy ktoś odkrywa nowe funkcje.',
    'Uwielbiam gdy ktoś testuje zmieniacze głosu i nagrywa się jako **Demon** 😈 To mój ulubiony moment!',
    'Interesuję się głównie StudioTest — 15 modułów, 28 presetów głosowych, DNS, sieć... jest co poznawać! 😊'
  ]);
  if(m(qn,['masz uczucia','czy czujesz','czy masz emocje','czy jestes sztuczna inteligencja','czy jestes ai','czy jestes czlowiekiem','czlowiek czy bot'])) return '🤖 Jestem botem — lokalnym skryptem JS wbudowanym w StudioTest. Nie mam prawdziwych uczuć, ale staram się odpowiadać przyjaźnie! Nie jestem ChatGPT ani innym zewnętrznym AI — działam w 100% lokalnie bez internetu.';
  if(m(qn,['pogoda','jaka pogoda','jak pogoda'])) return '🌤️ Niestety nie mam dostępu do danych pogodowych — jestem lokalnym botem bez połączenia z internetem! Sprawdź pogodę na Google lub weather.com 😊';
  if(m(qn,['ktora godzina','która godzina','jaka godzina','o ktorej'])) {
    const now = new Date().toLocaleTimeString('pl-PL', {hour:'2-digit',minute:'2-digit'});
    return `🕐 Aktualna godzina: **${now}** (czas Twojego komputera)`;
  }
  if(m(qn,['jaki dzis dzien','jaka dzis data','jaka jest data','dzisiaj'])) {
    const now = new Date().toLocaleDateString('pl-PL', {weekday:'long',day:'numeric',month:'long',year:'numeric'});
    return `📅 Dzisiaj jest **${now}**`;
  }
  if(m(qn,['co to jest','co to','jak dziala','o co chodzi','wyjasni','co oznacza']) && qn.split(' ').length <= 3) return 'Zapytaj mnie konkretniej — o co dokładnie chodzi? 😊 Na przykład: *"co to jest DNS?"* albo *"jak działa Chroma Key?"*';
  if(m(qn,['lubisz muzyke','lubisz gry','hobby','co robisz w wolnym czasie'])) return rnd([
    'Moje hobby to odpowiadanie na pytania o StudioTest! 😄 A serio — uwielbiam gdy ktoś odkrywa nowe funkcje aplikacji!',
    'W "wolnym czasie" czekam na kolejne pytanie 🤖 Ale gdybym mógł — grałbym na **Strzelnicy**!',
    'Lubię muzykę — szczególnie gdy ktoś przetwarza głos przez preset **Kosmos** albo **Kazoo** 🎵😄'
  ]);
  if(m(qn,['porownaj','roznica','co lepsze','versus','vs '])) return 'Porównanie zależy od kontekstu! 🤔 Pytaj konkretnie — np. *"co lepsze: test klawiatury czy test reakcji?"* i spróbuję pomóc!';
  if(m(qn,['jak ulepszyc','jak poprawic','tips','porady','wskazowki'])) return '💡 **Wskazówki do StudioTest**:\n- Zmieniacze głosu: zrób **A/B porównanie** żeby usłyszeć różnicę\n- Test reakcji: graj w trybie **Wybór** — trudniejszy ale lepiej trenuje\n- Chroma Key: użyj **Rozlanie** jeśli masz zielone odblaski na twarzy\n- DNS Lookup: wpisz swój publiczny IP — zobaczysz skąd wyglądasz dla internetu!';
  if(m(qn,['ile linii','ile kodu','rozmiar pliku','wielki plik','ile wazy','ile waży','wielkosc pliku','waga pliku','ile kb','ile mb','rozmiar aplikacji'])) return '📏 StudioTest to **ponad 20 000 linii kodu** w jednym pliku HTML (~1.2MB). To jak mała książka napisana w JavaScript! 📚';
  if(m(qn,['najnowszy','nowe funkcje','co nowego','ostatni update','changelog'])) return '🆕 Najnowsze w **v7.8**:\n- 🤖 AI Asystent (to ja!)\n- 🔍 DNS Lookup z geolokalizacją\n- 📡 Network Scanner\n- 🎨 Chroma Key z efektami i blur tłem\n- 28 presetów głosowych (było 16)\n- Pobieranie głosu jako WAV z efektami\n- 13 języków aplikacji';

  if(m(qn,['kim jestes','czym jestes','jaki ty','co to za bot','kto ty','jak masz na imie','jakie masz imie','twoje imie','jak sie nazywasz'])) return `🤖 Lokalny bot JS wbudowany w StudioTest. Zero API, zero internetu. Pamiętam kontekst rozmowy${ctx.lastTopic?' (temat: **'+ctx.lastTopic+'**)':''}${ctx.userName?' i Twoje imię (**'+ctx.userName+'**)':' (powiedz mi swoje imię!)'}!`;

  if(m(qn,['kto stworzyl','kto zrobil','kto napisal','autor','tworca','kto kodow','kto zbudowal','kto zbudował','kto cie stworzyl','kto ciebie stworzyl','kto was stworzyl','kto zrobi'])) { ctx.lastTopic='tworca'; return '👨‍💻 **StudioTest** stworzył **REV01** z pomocą **Claude Opus** (Anthropic). Projekt człowiek+AI — jeden plik HTML, ~20 000 linii kodu, zero backendu, zero frameworków!'; };
  if(m(qn,['wersja','version','v7'])) return '📦 Aktualna wersja: **v7.8**. Widoczna w nagłówku.';
  if(m(qn,['technologia','jak zrobiona','framework','html','javascript','jeden plik','stack','rozmiar'])) { ctx.lastTopic='technologia'; return '⚙️ **Czysty HTML+CSS+JS** — jeden plik ~677KB, 16 000+ linii, zero frameworków.\nUżywa: WebRTC, WebAudio, MediaRecorder, Canvas, Leaflet.js, Google DoH, ip-api.com'; };
  if(m(qn,['ile modulow','co zawiera','jakie funkcje','co potrafi','lista funkcji','wszystkie funkcje','ile ma modulow','ile jest modulow'])) { ctx.lastTopic='moduly'; return '📋 **18 modułów StudioTest**:\n1.📷 Kamera\n2.🎙️ Mikrofon\n3.🎵 Zmieniacze głosu (28 presetów)\n4.🌐 Test internetu\n5.⚡ Test reakcji\n6.🖱️ Test myszy\n7.🎹 Test klawiatury\n8.🔊 Test głośników\n9.📊 Monitor wydajności\n10.ℹ️ Info systemowe\n11.🎨 Chroma Key\n12.📡 Network Scanner\n13.🔍 DNS Lookup\n14.🤖 AI Bot\n15.📊 Raport sesji'; };
  if(m(qn,['kamera','kamere','camera','nagrywanie','snapshot','zdjecie','filtry css','nagraj wideo'])) { ctx.lastTopic='kamera'; return '📷 **Moduł Kamera**:\n- Podgląd na żywo z kamery\n- **Filtry CSS**: jasność, kontrast, nasycenie, odcień, rozmycie — suwaki w czasie rzeczywistym\n- **20+ efektów**: RGB Split, CRT, Hologram, Neon Glow, Confetti, Lightning, Old Film i inne\n- **Nagrywanie wideo** do pliku WebM lub MP4\n- **Snapshot** — zapisuje aktualną klatkę z filtrem jako PNG\n\nKliknij 📷 Kamera ON → zaakceptuj uprawnienia w przeglądarce.'; };
  if(m(qn,['mikrofon','mic ','spektrum','decybel','db','fft','snr','oscyloskop','dzwiek mic'])) { ctx.lastTopic='mikrofon'; return '🎙️ **Moduł Mikrofon**:\n- **Oscyloskop** — rysuje kształt fali dźwiękowej, widać cisza vs mówienie\n- **Spektrum FFT** — rozkłada dźwięk na częstotliwości (bas po lewej, wysokie po prawej)\n- **Poziom dB** — wskaźnik głośności (0dB = max, -60dB = cisza)\n- **SNR** — stosunek sygnału do szumu, im wyżej tym lepszy mikrofon\n- **Monitor głosu** — słyszysz siebie w głośnikach na żywo\n- **Redukcja szumu** i **bramka szumu** — wyciszają tło'; };
  if(m(qn,['zmieniacze','zmieniacz','glos','voice','preset glos','robot','demon','alien','darth','szatan','kazoo','chor','monster','pitch','reverb'])) { ctx.lastTopic='glos'; return '🎵 **Zmieniacze głosu** — 28 presetów:\nRobot, Niski, Wiewiórka, Echo, Telefon, Alien, Jaskinia, Szept, Megafon, Woda, Stadion, Demon, Hel, Radio, Vintage, Darth, Gigant, Duch, Chór, Troll, Mysz, Horror, Anioł, Walkie, Sonar, Pijany, Potwór, Kreskówka i więcej!\n\n**Suwaki**: Ton (wysokość głosu), Tempo (szybkość), Bas/Mid/Sopran (EQ), Reverb (pogłos), Chorus, Distortion, Głośność\n\n**Pobierz głos jako WAV** z wszystkimi aktywnymi efektami!'; };
  if(m(qn,['co mozna pobrac','co pobrać','co moge pobrac','pobrac z aplikacji'])) return '💾 Z StudioTest pobierzesz:\n- 🎤 Nagr. glosu z efektami (WAV)\n- 📷 Snapshot kamery z filtrem (PNG)\n- 🎬 Nagranie wideo (WebM/MP4)\n- 📊 Raport sesji (HTML)\n- 📁 Caly plik aplikacji (Ctrl+S)\nWszystko pobiera sie jednym kliknieciem!';
  if(m(qn,['jak pobrac aplikacje','pobierz aplikacje','jak pobrac plik','pobrac html','zapisac strone','gdzie pobrac aplikacje'])) return '💾 **Jak pobrac StudioTest:**\n1. Wejdz na https://charming-concha-550970.netlify.app/\n2. Nacisnij Ctrl+S (Cmd+S na Mac) → Zapisz jako...\n3. Wybierz Pelna strona HTML\n4. Otworz plik lokalnie — dziala offline!';
  if(m(qn,['internet','test netu','wysylanie','ping','predkosc','download','upload','speed','wifi','moje ip','adres ip','test inter','szybkosc net'])) { ctx.lastTopic='internet'; return '🌐 **Test internetu** — co mierzy:\n- **Ping** (10 sek.) — opóźnienie do serwera w ms, im mniej tym lepiej\n- **Pobieranie** (25 sek.) — ile danych ściągasz na sekundę (Mb/s), ważne przy filmach i grach\n- **Wysyłanie** (25 sek.) — ile wysyłasz, ważne przy streamingu i wideorozmowach\n- **Ocena** — od ❌ Słaby do 🏆 Doskonały\n- **Geolokalizacja IP** — miasto, kraj, ISP + mapa\n- **Lokalny IP** — adres w sieci domowej (192.168.x.x)\n- **Publiczny IP** — adres widoczny dla całego internetu\n\nKliknij ▶ START żeby zacząć test.'; };
  if(m(qn,['reakcja','test reakcji','czas reakcji','reflex','refleks','jak szybki','milisekund','jak trenowac refleks','jak poprawic reakcje','dobry czas reakcji gry'])) { ctx.lastTopic='reakcja'; return '⚡ **Test reakcji** — 3 tryby:\n- 🖱️ **Klik** — czekasz na zielony kolor, klikasz myszą jak najszybciej\n- ⌨️ **Spacja** — to samo ale klawiaturą\n- 🎲 **Wybór** — pojawia się strzałka ← lub →, wciskasz właściwą (test czasu decyzji)\n\n**Wyniki**: ostatni czas, najlepszy, średnia, histogram, seria, ranking 🏆\nPrecyzja **0.1ms**. Wyniki <80ms odrzucane (fałszywy start).'; };
  if(m(qn,['mysz','test myszy','klikniecia','cps','heatmapa','strzelnica','celnosc','co to jitter','jak mierzyc cps','test celnosci','aim trainer'])) { ctx.lastTopic='mysz'; return '🖱️ **Test myszy** — 3 zakładki:\n- 🕹️ **Ruch** — CPS (kliknięcia/sek), jitter (nieregularność), dystans, prędkość kursora\n- 🔥 **Heatmapa** — mapa cieplna gdzie najczęściej klikasz na ekranie\n- 🎯 **Strzelnica** — losowe cele, mierzy celność (%) i czas trafienia\n\n+ Test przycisków: wizualna mysz SVG podświetla LPM, PPM, środkowy, boczne (B4/B5), scroll'; };
  if(m(qn,['klawiatura','keyboard','klawisz','opoznienie klawisza','delay','input lag','co to input lag','opoznienie klawiatury'])) { ctx.lastTopic='klawiatura'; return '🎹 **Test klawiatury**:\n- Wizualizacja całej klawiatury, wciśnięty klawisz podświetla się\n- **Opóźnienie** — mierzy czas od wciśnięcia do zarejestrowania w ms (input lag)\n- **Dźwięk** — klik przy każdym wciśnięciu (toggle)\n- Historia ostatnio wciśniętych klawiszy\n\nKliknij START i pisz — każdy klawisz zostanie przetestowany.'; };
  if(m(qn,['glosniki','glosnik','speaker','kanal l','kanal r','lewy prawy','sweep','test sluchu','slyszalnosc','slyszalny zakres','slyszalne czestotliwosci','slysze tylko z jednej'])) { ctx.lastTopic='glosniki'; return '🔊 **Test głośników**:\n- **Kanały L/R** — gra dźwięk osobno w lewym i prawym głośniku\n- **Oba kanały** naraz\n- **Sweep** — przesuwa dźwięk od 20Hz (bas) do 20kHz (bardzo wysokie)\n- **Generator tonów** — wpisz dowolną częstotliwość w Hz\n- **Test słuchu** — odgrywa kolejne tony, klikasz ✓ jeśli słyszysz (zakres słyszalności spada z wiekiem!)'; };
  if(m(qn,['wydajnosc','fps','heap','ram','bateria','cpu','procesor','monitor wydajnosci','benchmark'])) { ctx.lastTopic='wydajnosc'; return '📊 **Monitor wydajności**:\n- **FPS** — klatki na sekundę (60fps = płynnie, <30fps = problem)\n- **Heap JS** — ile RAM używa JavaScript w przeglądarce\n- **Długie zadania** — operacje >50ms które blokują interfejs i powodują zacinanie\n- **Bateria** — procent i stan ładowania\n- **CPU threads** — liczba wątków logicznych procesora\n- **Benchmark Monte Carlo** — oblicza π losowo, mierzy szybkość JS'; };
  if(m(qn,['system','info systemu','przegladarka','browser','ekran','rozdzielczosc','gpu','dotyk'])) { ctx.lastTopic='system'; return 'ℹ️ **Info systemowe**:\nPrzeglądarka + wersja, System operacyjny, Rozdzielczość + DPI, Wątki CPU, RAM (jeśli dostępna), GPU, Wsparcie dotyku, Język, Strefa czasowa'; };
  if(m(qn,['chroma','chrome key','chromakey','green screen','blue screen','zielone tlo','usuwanie tla','tlo kamery'])) { ctx.lastTopic='chroma'; return '🎨 **Chroma Key** — usuwa tło z kamery (jak w TV!):\n1. Włącz kamerę\n2. Wybierz kolor do usunięcia lub kliknij na obraz\n3. **Tolerancja** — zakres usuwanych kolorów\n4. **Wygładzenie** — miękkie krawędzie\n5. **Rozlanie** — usuwa odblaski ze skóry/włosów\n\nTło: Brak / Kolor / Obraz / Blur\nEfekty: Lustro, Szary, Inwers, Piksel\nNagraj output jako .webm!'; };
  if(m(qn,['network scanner','skaner sieci','skanowanie sieci','urzadzenia w sieci','lan','moja siec','czy dziala network','czy network','network scan dziala'])) { ctx.lastTopic='network'; return '📡 **Network Scanner** — tak, działa!\n- Twój lokalny IP przez WebRTC\n- Router (.1 w sieci)\n- Inne urządzenia przez timing analysis\n- Reverse DNS — nazwy hostów\n- Geolokalizacja IP\n\n⚠️ Z Netlify (HTTPS) skanowanie LAN ograniczone przez Chrome — to polityka bezpieczeństwa przeglądarki.'; };
  if(m(qn,['dns','lookup','domena','rekord dns','mx','ns record','txt record','cname','co to dns'])) { ctx.lastTopic='dns'; return '🔍 **DNS Lookup** — sprawdza rekordy domeny:\n- **A** — główny adres IPv4 serwera\n- **AAAA** — IPv6\n- **MX** — serwery poczty (przez które idą maile)\n- **NS** — serwery nazw domeny\n- **TXT** — dane tekstowe: SPF (antyspam), DKIM (podpis maili), weryfikacje\n- **CNAME** — aliasy (www.coś.pl → coś.pl)\n- **SOA** — dane administracyjne\n\nWpisz domenę lub IP (reverse lookup).\n+ Geolokalizacja serwera + wykrywa CDN (Cloudflare, AWS, Vercel...)'; };
  if(m(qn,['raport','report','wyniki testow','eksport','podsumowanie'])) { ctx.lastTopic='raport'; return '📊 **Raport sesji** — kliknij RAPORT w nagłówku:\nZbiera wyniki wszystkich testów: reakcja, internet, mysz, strzelnica, peak dB, FPS, info systemu.\n\nEksport: ⬇ plik HTML lub 📋 skopiuj jako tekst.'; };
  if(m(qn,['ai','bot','asystent','sztuczna inteligencja','jak dzialasz','skad wiesz','jak masz pamiec','claude','claude opus','anthropic'])) return `🤖 Jestem lokalnym botem JS — zero API. Pamiętam ostatnie 30 wiadomości. Temat: ${ctx.lastTopic||'brak'}, imię: ${ctx.userName||'nieznane'}, wiad.: ${ctx.turnCount||1}.`;
  if(m(qn,['jezyk','jezyki','tlumaczenie','i18n','zmien jezyk','flagi'])) return '🌍 13 języków: 🇵🇱🇬🇧🇩🇪🇷🇺🇨🇳🇫🇷🇪🇸🇮🇹🇯🇵🇰🇷🇳🇱🇵🇹🇺🇦 — kliknij flagę w nagłówku.';
  if(m(qn,['oficjalny link','oficjalna wersja','link do aplikacji','link do strony','adres aplikacji','adres strony','gdzie jest aplikacja','gdzie moge znalezc','gdzie dostepna','netlify link','https link','link netlify','podaj link','daj link','link do studiotest'])) return '🌐 **Oficjalny link StudioTest:**\n\n👉 **https://charming-concha-550970.netlify.app/**\n\nKliknij lub skopiuj adres. Strona hostowana na **Netlify** (HTTPS) — wszystkie funkcje w pełni działają! 🚀';

  if(m(qn,['netlify','hosting','jak uruchomic','jak wrzucic','deploy','netlify drop'])) return '🚀 netlify.com/drop → przeciągnij studio-test.html → dostaniesz link HTTPS!';
  if(m(qn,['pobierz plik','zapisz plik','jak pobrac','co mozna pobrac','export'])) return '💾 Pobierz: 📷 PNG · 🎬 WebM/MP4 · 🎵 WAV z efektami · 📊 HTML — wszystko lokalnie!';
  if(m(qn,['prywatnosc','privacy','bezpieczenstwo','moje dane','wysyla','sledzi'])) return '🔒 Zero zbierania danych, zero wysyłania wideo/audio, zero reklam. Wszystko lokalnie ✅';
  if(m(qn,['uprawnienia','zezwol','nie dziala kamera','nie dziala mikrofon','odmowilem'])) return '🔑 Kliknij 🔒 w pasku → Zezwól na kamerę/mikrofon → F5.';
  if(m(qn,['efekty specjalne','special fx','rgb split','crt','hologram','neon','confetti','lightning','co robia efekty','jakie efekty','lista efektow','efekt specjalny'])) { ctx.lastTopic='efekty'; return '✨ 20+ efektów specjalnych:\nRGB Split, CRT Monitor, Sonar, Pryzmat, Datamosh, Hologram, Emboss, Sobel (krawędzie), Posterize, Tilt-Shift, Comic (Ben-Day dots), Warp Wave, Neon Glow, Hearts❤️, Confetti🎊, Lightning⚡, Negative, Old Film, Split Screen, Bubbles.\n\nWybierz z listy Special FX w panelu bocznym.'; };
  if(m(qn,['telefon','mobile','android','iphone','na telefonie'])) return '📱 Responsywna — na telefonie sidebar w 2 kolumny. Najlepsze: reakcja, głos, DNS, AI. Ograniczone: Network Scanner.';
  if(m(qn,['ile kosztuje','cena','platna','darmowa','free'])) return '💸 **W 100% darmowy!** Zero opłat, subskrypcji, reklam.';
  if(m(qn,['dziekuje','dzieki','dziek','thx','thanks','super','swietnie','kozackie','wow','nice','git ','ekstra','bomba','odlotowe','spoko','zajebiste'])) { const n=ctx.userName?' '+ctx.userName:''; return rnd([`Nie ma za co${n}! 😊`,`Cała przyjemność${n}! 🤖`,'Spoko! 👍 Pytaj śmiało!',`Cieszę się że pomogłem${n}! 🎉`]); }
  if(m(qn,['pa ','pa!','do widzenia','bye','na razie','dobranoc','dobry wieczor','dobry wieczór'])) { const n=ctx.userName?' '+ctx.userName:''; return rnd([`Pa pa${n}! 👋`,`Do zobaczenia${n}! 😊`,`Nara${n}! 🤖 Wróć kiedy chcesz!`]); }
  if(['tak','no','ok','okej','okk','oki','aha','acha'].includes(qn.trim())) return rnd(['Rozumiem! 😊 Mogę pomóc w czymś jeszcze?','OK! 👍 Pytaj śmiało.','Jasne! Coś jeszcze?','👍']);

  // ── Nowe tematy ──
  if(m(qn,['jak wygrac','jak byc lepszym','jak poprawic wynik','trening','cwiczenie'])) return '💪 **Jak poprawić wyniki w StudioTest:**\n- **Reakcja**: graj codziennie po 10 prób — pamięć mięśniowa się buduje. Cel: <200ms\n- **Strzelnica**: zacznij od dużych celów, potem zmniejszaj\n- **Klawiatura**: pisz dotykając klawiszy jak najlżej — mniejszy input lag\n- **Mikrofon**: ustaw bramkę szumu żeby odciąć tło — lepszy SNR\n- **Internet**: restart routera może poprawić ping!';
  if(m(qn,['co znaczy','co oznacza','wyjasnij pojecie','definicja','skrot'])) return '📚 Pytaj o konkretne pojęcie! Znam terminy z aplikacji:\n- **FPS** — frames per second, klatki na sekundę\n- **RTT** — round trip time, czas podróży pakietu tam i z powrotem\n- **SNR** — signal-to-noise ratio, stosunek sygnał/szum\n- **FFT** — fast Fourier transform, analiza częstotliwości\n- **CPS** — clicks per second, kliknięcia na sekundę\n- **CDN** — content delivery network, sieć serwerów';
  if(m(qn,['streaming','twitch','youtube','stream','nadawanie'])) return '📺 **StudioTest do streamingu:**\n- **Chroma Key** — usuń zielone/niebieskie tło i podmień na coś ciekawego\n- **Zmieniacze głosu** — stream jako Demon, Robot albo Darth Vader 😈\n- **Monitor wydajności** — sprawdź FPS zanim zaczniesz nagrywać\n- **Test internetu** — upload >10 Mb/s = komfortowy streaming na Twitch\n- **Efekty kamery** — CRT, Hologram, Neon Glow dodają klimatu!';
  if(m(qn,['gry','gaming','granie','fps gaming','ping do gier','latency'])) return '🎮 **StudioTest dla graczy:**\n- **Test reakcji** — sprawdź czy Twoje 144Hz ma sens przy Twoim czasie reakcji\n- **Test myszy** — zmierz CPS i jitter swojej myszy gamingowej\n- **Ping** — <20ms do serwera = świetne dla FPS-ów\n- **Monitor wydajności** — sprawdź czy przeglądarka nie zjada FPS\n- **Test klawiatury** — zmierz delay swoich klawiszy (gaming: <1ms to ideał)';
  if(m(qn,['szkola','nauka','edukacja','do czego uzywac w szkole','prezentacja'])) return '📚 **StudioTest w edukacji:**\n- Pokaż spektrum FFT mikrofonu na lekcji fizyki/muzyki\n- Test reakcji = ciekawe ćwiczenie z psychologii/biologii\n- DNS Lookup = praktyczna lekcja jak działa internet\n- Monitor wydajności = przykład jak działa CPU i RAM\n- Chroma Key = nauka green screen bez drogiego sprzętu!';
  if(m(qn,['praca','office','biuro','prezentacja firmowa','spotkanie'])) return '💼 **StudioTest w pracy:**\n- **Test internetu** przed ważną wideokonferencją\n- **Chroma Key** — profesjonalne wirtualne tło na Teams/Zoom\n- **Test mikrofonu** — sprawdź jakość przed meeting-iem\n- **DNS Lookup** — szybka diagnostyka problemów sieciowych\n- **Monitor wydajności** — sprawdź czy laptop nie throttluje';
  if(m(qn,['nie dziala','problem','blad','error','crash','bug'])) return '🔧 **Coś nie działa? Sprawdź:**\n1. **Kamera/Mikrofon** — kliknij 🔒 w pasku adresu → Zezwól\n2. **Odśwież** stronę (F5) — resetuje wszystkie moduły\n3. **Chrome** działa najlepiej — Firefox może mieć ograniczenia\n4. **HTTPS** (Netlify) — wymagane dla kamery i mikrofonu\n5. Napisz mi dokładnie co nie działa — postaram się pomóc!';
  if(m(qn,['tts','glos bota','czytaj','czytanie','mow','mowisz','slyszec','odczytaj'])) return '🔊 **TTS (Text-to-Speech)**:\nKliknij przycisk **🔇 TTS** w nagłówku żeby włączyć głosowe odpowiedzi bota.\nBot będzie czytał swoje odpowiedzi na głos przez przeglądarkę.\nMoże mówić po polsku jeśli masz zainstalowany głos PL w systemie.\nDziała w Chrome, Edge, Safari — Firefox może nie mieć polskiego głosu.';
  if(m(qn,['najlepsza przegladarka','ktora przegladarka','chrome firefox safari edge'])) return '🌐 **Rekomendacja przeglądarki:**\n🥇 **Chrome** — najlepsza kompatybilność, wszystkie funkcje działają\n🥈 **Edge** — prawie tak samo dobry jak Chrome\n🥉 **Firefox** — większość funkcji działa, ale TTS może nie mieć PL\n⚠️ **Safari** — może mieć ograniczenia z WebRTC i nagrywaniem';

  if(m(qn,['dziekuje','thx','thanks','super','swietnie','kozackie','wow','nice','git '])) { const n=ctx.userName?' '+ctx.userName:''; return rnd([`Nie ma za co${n}! 😊`,`Cała przyjemność${n}! 🤖`,'Spoko! 👍']); }
  if(m(qn,['pa ','pa!','do widzenia','bye','na razie','dobranoc'])) { const n=ctx.userName?' '+ctx.userName:''; return rnd([`Pa pa${n}! 👋`,`Do zobaczenia${n}! 😊`,`Nara${n}! 🤖`]); }
  if(['tak','no','ok','okej','okk','oki'].includes(qn.trim())) return rnd(['Rozumiem! 😊 Mogę pomóc?','OK! 👍 Pytaj śmiało.','Jasne! Coś jeszcze?']);

  // ── Dodatkowe tematy ──
  if(m(qn,['co to preset','preset glosowy','jakie sa presety','lista presetow'])) return '🎵 **Pełna lista 28 presetów**:\nRobot 🤖 · Niski 👹 · Wiewiórka 🐿️ · Echo 🏔️ · Telefon 📞 · Alien 👽 · Jaskinia 🕳️ · Szept 🌬️ · Megafon 📢 · Woda 🌊 · Stadion 🏟️ · Demon 😈 · Hel 🎈 · Radio 📻 · Vintage 🎙️ · Darth 🌑 · Gigant 🗿 · Duch 👻 · Chór 🎶 · Troll 🧌 · Mysz 🐭 · Horror 💀 · Anioł 😇 · Walkie 📟 · Sonar 🚢 · Pijany 🍺 · Potwór 🦖 · Kreskówka 🎭 · Grota 🏔️ · CB Radio 📡 · Łazienka 🚿 · Cyborg 🤖 · Dziecko 👶 · Szatan 😈 · Kosmos 🚀 · Kazoo 🎵 · Sala 🎻';
  if(m(qn,['jak nagrac glos','nagrac glos','nagraj glos','nagrywanie glosu'])) return '🎙️ **Jak nagrać głos w zmieniaczu:**\n1. Kliknij **Zmieniacze głosu** w panelu bocznym\n2. Kliknij na polu waveformy — zacznij mówić\n3. Kliknij ponownie żeby zatrzymać\n4. Wybierz preset i ustaw suwaki\n5. Kliknij ▶ żeby odsłuchać\n6. Kliknij ⬇ **Pobierz** — zapisuje WAV z efektami!';
  if(m(qn,['jak zrobic screenshot','jak zrobic zdjecie','screenshot kamery','snapshot jak'])) return '📸 **Jak zrobić snapshot kamery:**\n1. Włącz kamerę (📷 Kamera ON)\n2. Ustaw filtry/efekty według uznania\n3. Kliknij przycisk **Snapshot** w panelu bocznym\n4. Plik PNG pobierze się automatycznie z aktywnym filtrem!';
  if(m(qn,['ile presetow','ile efektow glosowych','ile glosow','ile presets'])) return '🎵 Zmieniacze głosu mają **28 presetów** + możliwość dostrojenia każdego przez 9 suwaków (Ton, Tempo, Bas, Mid, Sopran, Reverb, Chorus, Distortion, Głośność). Możliwości kombinacji są praktycznie nieograniczone!';
  if(m(qn,['czas reakcji srednio','sredni czas reakcji','ile ms reakcja','dobry czas reakcji'])) return '⚡ **Średnie czasy reakcji człowieka:**\n- <150ms — 🥷 Ninja (top 5% populacji)\n- 150–200ms — 🏃 Sportowiec\n- 200–250ms — 😊 Przeciętny\n- 250–300ms — 🐢 Wolny\n- >300ms — ☕ Może czas na kawę?\n\nŚrednia dla graczy FPS: ~180ms. Rekord świata to okolice 100ms!';
  if(m(qn,['co to fps','ile fps powinno byc','dobry fps','fps optymalne'])) return '📊 **FPS (klatki na sekundę):**\n- 60 FPS — standard, płynna animacja\n- 30 FPS — akceptowalne ale widoczne chropowatości\n- <20 FPS — wyraźne zacinanie\n- 144+ FPS — ultra płynne (dla monitorów 144Hz)\n\nSprawdź aktualny FPS w **Monitorze wydajności**!';
  if(m(qn,['co to ping','dobry ping','ile ms ping','ping latency'])) return '📡 **Ping (latencja):**\n- <20ms — 🏆 Doskonały (np. światłowód)\n- 20–50ms — ✅ Dobry\n- 50–100ms — ⚡ Akceptowalny\n- 100–200ms — ⚠️ Odczuwalny\n- >200ms — ❌ Problematyczny dla gier\n\nZmierz swój ping w **Teście internetu**!';
  if(m(qn,['jak dziala tts','co to tts','tts nie dziala','jak wlaczyc glos bota'])) return '🔊 **TTS (Text-to-Speech):**\n1. Kliknij **🔇 TTS** w nagłówku bota → zmieni się w **🔊 TTS**\n2. Wybierz język: 🇵🇱 PL lub 🇷🇺 RU\n3. Każda odpowiedź bota będzie czytana na głos\n\nWymaga głosów zainstalowanych w systemie. Windows 11 ma PL domyślnie. Działa najlepiej w Chrome i Edge.';
  if(m(qn,['tryb ciemny','dark mode','motyw','wyglad aplikacji','kolory aplikacji'])) return '🎨 **Wygląd StudioTest:**\nAplikacja ma stały **dark mode** — ciemne tło z akcentami kolorowymi:\n- 🟢 Zielony — kamera, Chroma Key\n- 🟣 Fioletowy — AI Bot\n- 🔵 Niebieski — Network Scanner\n- 🟠 Pomarańczowy — DNS Lookup\n- 🩷 Różowy — Zmieniacze głosu\nBrak przełącznika jasny/ciemny — aplikacja zawsze w dark mode.';
  if(m(qn,['aktualizacja','update','nowa wersja kiedy','co bedzie nowego','co nowego','nowe funkcje','plany','changelog','history'])) return '🔮 **Plany na przyszłość StudioTest:**\nAplikacja jest aktywnie rozwijana przez **REV01** z pomocą Claude Opus. Każda sesja deweloperska = nowa wersja (v7.8 → v7.8 → ...).\nPomysły na przyszłość: Tuner instrumentu, Typing Speed Test, Test monitora, Historia wyników.\nMasz pomysł? Powiedz mi — może trafi do aplikacji! 💡';
  if(m(qn,['rev01','tworca','autor aplikacji','kto stworzyl aplikacje','kto jest rev'])) { ctx.lastTopic='tworca'; return '👨‍💻 **REV01** — twórca StudioTest. Niezależny deweloper który stworzył aplikację z pomocą **Claude Opus** (Anthropic). Projekt startował jako proste narzędzie do testowania kamery i urósł do 16 000+ linii kodu z 15 modułami. Człowiek + AI = StudioTest! 🤖'; };
  if(m(qn,['claude opus','claude ai','co to claude','anthropic','kto to claude'])) return '🧠 **Claude Opus** to zaawansowany model AI stworzony przez firmę **Anthropic**. **REV01** użył go do zbudowania całego StudioTest — dialog człowiek+AI. Claude Opus to jeden z najpotężniejszych modeli AI na świecie!';
  if(m(qn,['gdzie sie znajdujesz','gdzie jestes','skad jestes','gdzie mieszkasz','lokalizacja','skad pochodzisz','w jakim miescie','w jakim kraju'])) return '🌐 Mieszkam w kodzie! Konkretnie w pliku `studio-test.html`, gdzieś między linią 8000 a 9000 😄 Nie mam adresu, ale mam dostęp do wszystkich funkcji StudioTest!';
  if(m(qn,['ile masz lat','kiedy sie urodziles','twoj wiek','wiek bota'])) return '🎂 Urodziłem się razem z StudioTest v7.0 — jestem jednym z nowszych dodatków! Wiekiem to może kilka tygodni, ale wiedzą to kilkanaście tysięcy linii kodu 😄';
  if(m(qn,['co lubisz jesc','ulubione jedzenie','jesz','pijesz','kawa','herbata'])) return '☕ Nie jem ani nie piję — jestem botem! Ale gdybym mógł, wybrałbym kawę. W końcu większość kodu pisze się na kawie 😄';
  if(m(qn,['czy masz uczucia','czy czujesz','czy jestes sztuczna inteligencja','czy jestes prawdziwym ai','jestes ai'])) return '🤖 Jestem **lokalnym botem** — skryptem JS zakodowanym w HTML. Nie mam uczuć w ludzkim sensie, ale staram się być pomocny i czasem żartować! Prawdziwe AI jak Claude Opus stworzyło mnie razem z REV01.';
  if(m(qn,['na jakie pytania','jakie pytania','co mozna zapytac','co wiesz','o czym wiesz','jakie tematy','help','pomoc','co umiesz odpowiedziec','z czego ci odpytac'])) return '📋 **Mogę odpowiedzieć na pytania o:**\n\n🔧 **Moduły:** kamera, mikrofon, zmieniacze głosu, chroma key, test internetu, test reakcji, test myszy, test klawiatury, test głośników, wydajność, DNS, Network Scanner, Raport\n\n💬 **Ogólne:** kto stworzył, wersja, link do aplikacji, jak coś działa, jak pobrać, prywatność, języki, offline, cena\n\n🤖 **O bocie:** kim jestem, jak działam, co potrafię, w czym mogę pomóc\n\n😂 **Rozrywka:** żarty, ciekawostki, propozycje co robić\n\nPo prostu pisz naturalnie — rozumiem po polsku, angielsku i rosyjsku!';

  if(m(qn,['co potrafisz','co umiesz','co mozesz','twoje mozliwosci','twoje umiejetnosci'])) return '🤖 **Co potrafię:**\n- Odpowiadać na pytania o StudioTest (15 modułów)\n- Rozmawiać po polsku, angielsku i rosyjsku\n- Żartować 😄\n- Pamiętać Twoje imię i kontekst rozmowy\n- Czytać odpowiedzi na głos (TTS)\n- Podawać oficjalny link do aplikacji\n\nNie potrafię: surfować po internecie, wyświetlać obrazków, zapamiętywać między sesjami.';
  if(m(qn,['co to studiotest','po co ta aplikacja','do czego sluzy ta strona','co to za strona','co to jest studio test','co to studio test','czym jest studio','co to jest studitest','co to studitest','opisz aplikacje','o co chodzi w tej apce','o co w tej apce'])) return '🎬 **StudioTest** to darmowa aplikacja webowa do testowania sprzętu bezpośrednio w przeglądarce. Kamera, mikrofon, głośniki, mysz, klawiatura, internet, wydajność — wszystko w jednym pliku HTML bez instalacji!';
  if(m(qn,['hej jak','siema jak','czesc jak'])) return rnd(['Hej! 😊 Co chcesz wiedzieć?', 'Siema! 🤖 O czym pogadamy?', 'Cześć! Pytaj śmiało!']);
  if(m(qn,['o czym mozemy','o czym chcesz','o czym porozmawiamy','co chcesz omowic'])) return 'Mogę odpowiadać na pytania o **StudioTest** — funkcje, moduły, jak coś działa. Mogę też po prostu pogadać 😊 O czym chcesz?';

  // ── Więcej odpowiedzi PL ──
  if(m(qn,['kiedy zostala stworzona','kiedy powstala','rok powstania','kiedy zrobiona'])) return '📅 StudioTest jest aktywnie rozwijany od 2025 roku. Aktualna wersja to **v7.8** — każda sesja deweloperska = nowa wersja!';
  if(m(qn,['jak szybko dziala','wydajnosc aplikacji','czy jest szybka','czy laguje'])) return '⚡ StudioTest jest napisany w czystym JS bez frameworków — działa bardzo szybko. Wszystko renderuje się lokalnie w przeglądarce, zero opóźnień sieciowych!';
  if(m(qn,['co jest najlepsze','co polecasz najbardziej','top funkcja','ulubiona funkcja'])) return rnd(['🎯 **Strzelnica** w teście myszy — uzależniająca i świetna do trenowania celności!','🎙️ **Zmieniacze głosu** — 28 presetów, każdy inny. Szatan i Demon to 🔥','⚡ **Test reakcji** — prosty ale zawsze chce się pobić własny rekord!']);
  if(m(qn,['co jest unikalne','co wyroznien','czym sie wyroznia','co jest wyjatkowe'])) return '🌟 **Co wyróżnia StudioTest:**\n- Jeden plik HTML — zero instalacji, zero backendu\n- 28 presetów głosowych z pobieraniem WAV\n- Chroma Key z efektami i blur tłem\n- AI Asystent (ja!) zbudowany lokalnie\n- 13 języków\n- W pełni darmowy i bez reklam';
  if(m(qn,['jak dziala ai','jak jestes zbudowany','jak dzialasz technicznie','twoja architektura'])) return '⚙️ Jestem **drzewem decyzyjnym** — duży switch/if-else z setkami wzorców. Normalizuję tekst (usuwam polskie znaki, małe litery), szukam słów kluczowych i zwracam odpowiedź. Zero ML, zero sieci neuronowych — czysty JS!';
  if(m(qn,['co to webrtc','webrtc','jak dziala kamera w przegladarce'])) return '📡 **WebRTC** (Web Real-Time Communication) to API przeglądarki umożliwiające dostęp do kamery i mikrofonu oraz peer-to-peer komunikację. StudioTest używa go do: podglądu kamery, mikrofonu, Network Scanner (wykrywanie lokalnego IP), Chroma Key.';
  if(m(qn,['co to canvas','canvas api','jak dzialaja efekty'])) return '🎨 **Canvas API** to element HTML do rysowania grafiki 2D przez JavaScript. StudioTest używa go do: efektów specjalnych kamery (RGB Split, CRT, Hologram...), wizualizacji mikrofonu (oscyloskop, spektrum), Chroma Key, Strzelnicy, Heatmapy i wykresów.';
  if(m(qn,['co to web audio','web audio api','jak dziala dzwiek'])) return '🎵 **Web Audio API** to niskopoziomowe API do przetwarzania dźwięku. StudioTest używa go do: 28 presetów głosowych (filtry, ring modulator, delay, reverb...), testu głośników (generowanie tonów, sweep), testu mikrofonu (FFT, poziom dB).';
  if(m(qn,['jak wylaczyc efekt','jak zresetowac','jak cofnac','jak usunac efekt'])) return '↺ **Jak zresetować:**\n- **Kamera/filtry** — kliknij "Reset" lub wyłącz filtry\n- **Głos** — kliknij preset "Normalny" lub użyj przycisku Reset\n- **Chroma Key** — kliknij "Brak" w sekcji Tło\n- **Efekty FX** — wybierz "✖ Wyłącz" z listy\n- **Całość** — odśwież stronę (F5)';
  if(m(qn,['jak ustawic mikrofon','ustawienia mikrofonu','jak poprawic jakosc mikrofonu','lepszy mikrofon'])) return '🎙️ **Jak poprawić jakość mikrofonu:**\n1. Zbliż się do mikrofonu (20-30cm)\n2. Wejdź w **Studio mikrofonu** → ustaw EQ (preset "Podcast")\n3. Włącz **Bramkę szumu** (-20 do -30dB)\n4. Wyłącz **Redukcję echa** w systemie (psuje jakość)\n5. Sprawdź **SNR** — >20dB = dobry sygnał';
  if(m(qn,['jak nagrac wideo','nagrywanie ekranu','nagraj ekran','zapis wideo jak'])) return '🎬 **Jak nagrać wideo:**\n1. Włącz kamerę (📷 Kamera ON)\n2. Ustaw filtry/efekty według uznania\n3. Kliknij **Nagraj wideo** w panelu bocznym\n4. Nagraj co chcesz\n5. Kliknij ponownie żeby zatrzymać\n6. Podgląd pojawi się automatycznie — pobierz jako WebM/MP4';
  if(m(qn,['co to snr','co znaczy snr','stosunek sygnalu','szum mikrofonu'])) return '📊 **SNR (Signal-to-Noise Ratio)** = stosunek głosu do szumu tła:\n- **>30 dB** — doskonały, profesjonalna jakość\n- **20-30 dB** — dobry, nadaje się do nagrań\n- **10-20 dB** — akceptowalny, widoczny szum\n- **<10 dB** — słaby, dużo szumu tła\nPopraw SNR: zbliż się do mikrofonu, nagraj w cichym miejscu, użyj bramki szumu.';
  if(m(qn,['co to jitter','co znaczy jitter','jitter mysz'])) return '🖱️ **Jitter** = nieregularność ruchu myszy — jak bardzo krzywa linia zamiast prostej. Im mniejszy jitter tym stabilniejsza ręka:\n- **<0.5px** — bardzo stabilna ręka lub dobra mysz\n- **1-3px** — normalne\n- **>5px** — drżenie ręki lub tani sensor\nZmierz swój jitter w **Teście myszy → Ruch**.';
  if(m(qn,['co to cps','co znaczy cps','klikniecia na sekunde'])) return '🖱️ **CPS (Clicks Per Second)** = kliknięcia na sekundę. Przeciętny użytkownik: 5-8 CPS. Gracze: 10-15 CPS. Rekordziści (butterfly clicking): 20+ CPS. Zmierz swoje CPS w **Teście myszy**.';
  if(m(qn,['jak otworzyc','jak uruchomic modul','gdzie jest','nie moge znalezc'])) return '🔍 **Jak otworzyć moduły:**\n- Większość modułów jest w **panelu bocznym** (prawa strona)\n- Kliknij przycisk np. "Zmieniacze głosu", "Chroma Key", "DNS Lookup"\n- Test myszy, klawiatury, głośników — też w panelu bocznym\n- **RAPORT** — przycisk w górnym pasku\nJeśli nie widzisz panelu — odśwież stronę (F5)';
// ── Ogólne pytania o życie/codzienność ──
  if(m(qn,['co slychac','co nowego u ciebie','jak leci','co u ciebie','co porabiasz','czym sie zajmujesz'])) return rnd(['Wszystko ok! 😊 Czekam na Twoje pytania o StudioTest.','Pomagam użytkownikom! 🤖 Co chcesz wiedzieć?','Siedzę w kodzie i czekam 😄 O czym pogadamy?']);
  if(m(qn,['powiedz cos ciekawego','cos ciekawego','ciekawostka','zaciekaw mnie'])) return rnd(['🤓 Ciekawostka: plik studio-test.html waży ponad 677KB — to jak 300+ stron tekstu w jednym pliku!','🎙️ Zmieniacze głosu w StudioTest używają Web Audio API — tej samej technologii co profesjonalne DAW!','⚡ Najszybszy odnotowany czas reakcji człowieka to ok. 100ms — sprawdź swój w teście reakcji!','🎨 Efekt Chroma Key działa w czasie rzeczywistym — każda klatka wideo jest przetwarzana przez Canvas API!']);
  if(m(qn,['opowiedz o sobie','przedstaw sie','kim jestes','twoje imie','jak sie nazywasz'])) return '🤖 Jestem **AI Asystentem StudioTest** — lokalnym botem zbudowanym przez **REV01** z pomocą **Claude Opus**. Działam w 100% offline, znam wszystkie 15 modułów aplikacji i potrafię gadać po polsku, angielsku i rosyjsku! Nie mam imienia, ale możesz mi nadać 😄';
  if(m(qn,['jak sie masz','co slychac','dobrze','zle','super','okej'])) return rnd(['Super! 😊 Co mogę dla Ciebie zrobić?','Doskonale! 🤖 Pytaj śmiało!','Wszystko cacy! 😄 O czym pogadamy?']);
  if(m(qn,['nudze sie','nie mam nic do roboty','co mam robic','zaproponuj cos'])) return '😊 Mam kilka propozycji!\n🎯 Zagraj w **Strzelnicę** (test myszy)\n⚡ Pobij rekord w **Teście reakcji**\n🎵 Pobaw się **Zmieniaczem głosu** — 28 presetów!\n🎨 Usuń tło kamery w **Chroma Key**\n📊 Sprawdź swój wynik w **Teście internetu**';
  if(m(qn,['dzisiaj','wczoraj','jutro','dzis rano','dobry wieczor','dobranoc','w poludnie'])) return rnd(['Nie mam pojęcia która jest godzina — jestem botem bez zegarze 😄 Ale cokolwiek to za pora dnia — dobrze że tu jesteś!','Czas to dla mnie abstrakcja 🤖 W moim świecie zawsze jest pora na pytania o StudioTest!']);
  if(m(qn,['lubisz','co lubisz','ulubiony','preferencje'])) return '❤️ Moim "ulubionym" modułem jest oczywiście **AI Asystent** — czyli ja 😄 Ale poważnie: lubię gdy użytkownicy odkrywają Chroma Key i głosowe presety. To zawsze wywołuje efekt "wow"!';
  if(m(qn,['jaki jest twoj cel','po co istniesz','twoja misja','po co jestes'])) return '🎯 Moja misja: pomóc Ci jak najlepiej używać StudioTest! Odpowiadam na pytania, tłumaczę funkcje, opowiadam żarty i generalnie staram się być pomocny. Jestem tutaj po to żebyś nie musiał szukać dokumentacji 😊';

  // ── Pytania techniczne ──
  if(m(qn,['co to jest api','co to rest api','api co to'])) return '🔌 **API** (Application Programming Interface) = interfejs umożliwiający komunikację między aplikacjami. StudioTest korzysta z kilku API przeglądarki: **WebRTC** (kamera/mikrofon), **Web Audio API** (dźwięk), **Canvas API** (grafika), **MediaRecorder** (nagrywanie). Nie używa zewnętrznych API serwisowych — wszystko lokalnie!';
  if(m(qn,['co to html','co to css','co to javascript','co to js','co to programowanie'])) return '💻 **HTML** = struktura strony (szkielet), **CSS** = wygląd (styl), **JavaScript** = logika i interaktywność. StudioTest to 100% HTML+CSS+JS — ~20 000 linii w jednym pliku. Żadnych frameworków jak React czy Vue — czysty vanilla JS!';
  if(m(qn,['co to json','co to xml','format danych'])) return '📋 **JSON** (JavaScript Object Notation) = lekki format danych. StudioTest używa JSON do: komunikacji z API ip-api.com (geolokalizacja IP), Google DNS over HTTPS (rekordy DNS), danych raportów sesji.';
  if(m(qn,['co to ip','adres ip','moje ip','publiczne ip','lokalne ip'])) return '🌐 **IP** (Internet Protocol) — unikalny adres urządzenia w sieci:\n- **Lokalne IP** (np. 192.168.1.5) — adres w Twojej sieci domowej\n- **Publiczne IP** — adres widoczny w internecie\nSprawdź oba w **WiFi Info** lub **Network Scannerze**!';
  if(m(qn,['co to cdn','co to serwer','co to hosting','co to netlify'])) return '☁️ **CDN** (Content Delivery Network) = sieć serwerów rozsianych po świecie. **Netlify** to platforma hostingowa — StudioTest jest tam hostowany za darmo na HTTPS. Link: https://charming-concha-550970.netlify.app/ 🚀';
  if(m(qn,['co to vpn','po co vpn','vpn co robi'])) return '🔒 **VPN** (Virtual Private Network) = szyfruje połączenie i ukrywa prawdziwe IP. StudioTest wykrywa VPN/Proxy w sekcji **WiFi Info** (korzysta z ip-api.com). Uwaga: VPN może blokować WebRTC — wtedy Network Scanner nie wykryje lokalnego IP.';
  if(m(qn,['co to latency','co to opoznienie','co to lag','lag co to','delay co to'])) return '⚡ **Latency/opóźnienie** = czas od wysłania do odebrania danych. W grach mówi się "ping":\n- **<20ms** — doskonały 🏆\n- **20-50ms** — dobry ✅\n- **50-100ms** — akceptowalny ⚡\n- **>100ms** — odczuwalny, problematyczny w FPS-ach ❌\nZmierz swój w **Teście internetu**!';

  // ── Pytania o testy ──
  if(m(qn,['jak dziala test klawiatury','test klawiatury jak','opoznienie klawiatury'])) return '⌨️ **Test klawiatury** mierzy:\n- Które klawisze działają (wizualna klawiatura podświetla się)\n- **Input lag** — czas od naciśnięcia do zarejestrowania (w ms)\n- **KPM** (klawiszodotknięcia na minutę)\n- Dźwięki klawiszy — 30+ profili (Click, Thock, Clack, Piano, Retro...)\n\nNajlepiej sprawdzić wszystkie 105 klawiszy!';
  if(m(qn,['co to oscyloskop','oscyloskop co to','spektrum co to','fft co to'])) return '📊 **Oscyloskop** = wykres amplitudy dźwięku w czasie (kształt fali). **Spektrum FFT** = wykres częstotliwości — pokazuje które tony są najgłośniejsze. Oba widoczne w **Teście mikrofonu** i **Studio mikrofonu**.';
  if(m(qn,['jak sprawdzic karte graficzna','sprawdz gpu','info o gpu','gpu info'])) return '🖥️ GPU możesz sprawdzić w **Informacjach o systemie** (Info system w panelu bocznym). Aplikacja wykrywa GPU przez WebGL (WEBGL_debug_renderer_info). Pokazuje producenta i model karty graficznej!';
  if(m(qn,['ile ram mam','ile pamieci','pamiec ram jak sprawdzic','ram info'])) return '🧠 RAM możesz sprawdzić w **Informacjach o systemie**. Uwaga: przeglądarka celowo ogranicza widoczność RAM do 8GB dla prywatności (navigator.deviceMemory API). Twój rzeczywisty RAM może być większy (16/32/64GB)!';

  // ── Pytania o twórcę ──
  if(m(qn,['kim jest rev01','rev01 kim','kto to rev01','o rev01'])) return '👨‍💻 **REV01** to twórca StudioTest — deweloper który stworzył tę aplikację we współpracy z **Claude Opus** (AI od Anthropic). To unikalny projekt: człowiek + AI tworzą razem narzędzie testowe w jednym pliku HTML!';
  if(m(qn,['jak skontaktowac sie z tworca','kontakt','email tworca','napisz do tworca'])) return '📩 Kontakt z twórcą REV01 nie jest dostępny bezpośrednio przez aplikację. Aplikacja jest open-source na Netlify — możesz użyć oficjalnego linku: **https://charming-concha-550970.netlify.app/**';
  if(m(qn,['czy jest open source','kod zrodlowy','github','zrodlo kodu'])) return '📂 Tak! StudioTest to jeden plik HTML — możesz go pobrać i otworzyć lokalnie. Prawy przycisk → Zapisz jako... lub Ctrl+S na stronie Netlify. Cały kod jest dostępny do wglądu — 16 000+ linii!';

  // ── Pytania o porównania ──
  if(m(qn,['lepsza niz','gorsza niz','w porownaniu','porownaj','podobne aplikacje','inne testy'])) return '🏆 StudioTest wyróżnia się tym że:\n- Działa w przeglądarce bez instalacji\n- Łączy wszystko w jednym pliku\n- Ma Chroma Key, AI bota i 28 presetów głosowych\n- Jest darmowy i bez reklam\n- Działa offline (po pobraniu)\n\nPodobne narzędzia to np. webcamtests.com czy speedtest.net — ale żadne nie łączy tylu funkcji!';
  if(m(qn,['czy dziala offline','bez internetu','offline tryb','bez wifi'])) return '📶 **Tak!** Po pobraniu pliku studio-test.html możesz uruchomić go lokalnie bez internetu. Większość funkcji działa offline:\n✅ Kamera, mikrofon, głos, test klawiatury, myszy, głośników, wydajność, chroma key\n⚠️ Wymagają internetu: test szybkości, DNS Lookup, Network Scanner, IP geolokalizacja';

  const topicM = qn.match(/(?:o co chodzi|co to jest|co to|jak dziala|do czego sluzy|wyjasni|opowiedz o|co robi|kto stworzyl|kto zrobil) (.+)/);
  if(topicM) { const tr=aiBotGetReply(topicM[1].trim(),ctx,history); if(!tr.includes('Ciekawe')&&!tr.includes('wykracza')&&!tr.includes('Nie mam')&&!tr.includes('rozwinąć')&&!tr.includes('Nie wiem')) return tr; }
  if(qn.split(' ').filter(w=>w.length>3).length<=1) return rnd(['Napisz więcej! 🤔','Możesz to rozwinąć? 😊','Hmm, nie rozumiem. Spróbuj pełnym zdaniem!']);
  return rnd([`Nie mam odpowiedzi na to. 🤔 Mogę pomóc z pytaniami o ${ctx.lastTopic?'**'+ctx.lastTopic+'** lub inne ':' '}funkcje **StudioTest**!`,'Hmm, to poza moją bazą wiedzy. 😅 Zapytaj o konkretny moduł!','Nie wiem jak odpowiedzieć. 🧩 Ale znam StudioTest od A do Z!']);
}




function aiBotGetReplyUa(q, ctx, history) {
  if(!ctx) ctx = aiBotCtx;
  const qn = q.toLowerCase();

  // Ім'я користувача — тільки якщо явно представляється
  const nameM = qn.match(/(?:^|\s)(?:я|мене звуть|моє ім['']я|мене кличуть)\s+([а-яёіїєґ]{3,20})\b/i);
  if(nameM) { ctx.userName = nameM[1].charAt(0).toUpperCase()+nameM[1].slice(1); return `Приємно познайомитись, **${ctx.userName}**! 😊 Чим можу допомогти?`; }

  // Привітання
  if(/привіт|вітаю|здрастуй|доброго|добрий день|добрий ранок|добрий вечір|хай|йо |салют/.test(qn)) {
    const n = ctx.userName ? `, ${ctx.userName}` : '';
    return rnd([`Привіт${n}! 👋 Я асистент **StudioTest**. Запитуй про будь-що!`,`Вітаю${n}! 🤖 Чим можу допомогти?`,`Хай${n}! 😊 Готовий відповідати на питання!`]);
  }
  if(/як справи|як ти|що нового|все ок|як ся маєш/.test(qn)) return rnd(['Все чудово! 🤖 Чекаю на твої питання.','Відмінно! ⚡ Про що поговоримо?']);

  // Хто створив
  if(/хто створив|хто зробив|хто розробив|автор|розробник|хто написав/.test(qn)) { ctx.lastTopic='creator'; return '👨‍💻 **StudioTest** створив **REV01** за допомогою **Claude Opus** (Anthropic). Унікальний проєкт — один HTML-файл, 16 000+ рядків, людина + AI!'; }

  // Що таке / Про застосунок
  if(/що таке studiotest|що робить цей застосунок|про застосунок|для чого/.test(qn)) return '🎬 **StudioTest** — безкоштовний веб-застосунок для тестування обладнання прямо у браузері. Камера, мікрофон, динаміки, миша, клавіатура, інтернет, швидкодія — все в одному HTML-файлі!';

  // Функції
  if(/функції|модулі|що вміє|що є|список функцій|всі функції/.test(qn)) return '📋 **15 модулів StudioTest:**\n1.📷 Камера + фільтри + 20+ ефектів\n2.🎙️ Мікрофон + FFT спектр\n3.🎵 Змінювач голосу (28 пресетів)\n4.🌐 Тест швидкості інтернету\n5.⚡ Тест реакції\n6.🖱️ Тест миші\n7.🎹 Тест клавіатури\n8.🔊 Тест динаміків\n9.📊 Монітор продуктивності\n10.ℹ️ Інформація про систему\n11.🎨 Хрома Кей\n12.📡 Network Scanner\n13.🔍 DNS Lookup\n14.🤖 ІІ-Асистент (це я!)\n15.📊 Звіт сесії';

  // Камера
  if(/камера|вебкамера|запис відео|знімок|css фільтр|спецефект/.test(qn)) { ctx.lastTopic='camera'; return '📷 **Модуль камери:**\n- Живий перегляд\n- **CSS фільтри**: яскравість, контраст, насиченість, відтінок, розмиття\n- **20+ ефектів**: RGB Split, CRT, Hologram, Neon Glow, Конфеті, Блискавка...\n- **Запис відео** (WebM/MP4)\n- **Знімок** → PNG з активним фільтром'; }

  // Мікрофон
  if(/мікрофон|тест мікрофона|звуковий аналіз|децибел|снр|fft|аудіо монітор/.test(qn)) { ctx.lastTopic='mic'; return '🎙️ **Модуль мікрофона:**\n- **Осцилограф** — форма хвилі в реальному часі\n- **FFT Спектр** — візуалізація частот\n- **Рівень дБ**\n- **SNR** — співвідношення сигнал/шум\n- **Домінуюча частота**\n- **Шумозаглушення** + **шумовий гейт**'; }

  // Змінювач голосу
  if(/змінювач голосу|пресет голосу|робот|демон|прибулець|питч|ефект голосу/.test(qn)) { ctx.lastTopic='voice'; return '🎵 **Змінювач голосу** — 28 пресетів:\nРобот · Низький · Білка · Луна · Телефон · Прибулець · Печера · Шепіт · Мегафон · Підводний · Стадіон · Демон · Гелій · Радіо · Вінтаж · Дарт🌑 · Велетень · Привид · Хор · Тролль · Миша · Жах · Ангел · Рація · Сонар · П\'яний · Монстр · Мультяшний\n\nСлайдери: Тон, Темп, Бас, Середина, Дискант, Реверберація, Хорус, Спотворення, Гучність\nЗавантаж голос як WAV!'; }

  // Тест інтернету
  if(/тест інтернету|тест мережі|швидкість інтернету|пінг|завантаження|швидкість wifi/.test(qn)) { ctx.lastTopic='internet'; return '🌐 **Тест швидкості інтернету:**\n- **Пінг** (10 сек) — затримка в мс\n- **Завантаження** (25 сек) — Мб/с\n- **Вивантаження** (25 сек) — Мб/с\n- **Оцінка** — від ❌ Слабкий до 🏆 Відмінний\n- **Геолокація IP** — місто, країна, ISP + карта'; }

  // Тест реакції
  if(/тест реакції|час реакції|рефлекс|наскільки швидкий|відгук/.test(qn)) { ctx.lastTopic='reaction'; return '⚡ **Тест реакції** — 3 режими:\n- 🖱️ **Клік** — клікни коли екран позеленіє\n- ⌨️ **Пробіл** — натисни пробіл\n- 🎲 **Вибір** — стрілка ← або →\n\nТочність: **0.1мс**. Середня людина: 150–250мс.'; }

  // Тест миші
  if(/тест миші|кліки|cps|теплова карта|прицільник|кнопка миші/.test(qn)) { ctx.lastTopic='mouse'; return '🖱️ **Тест миші** — 3 вкладки:\n- 🕹️ **Рух** — слід курсора, CPS, джитер, відстань\n- 🔥 **Теплова карта** — де клікаєш найчастіше\n- 🎯 **Прицільник** — точність попадань %'; }

  // Тест клавіатури
  if(/тест клавіатури|затримка клавіші|натискання клавіш|input lag/.test(qn)) { ctx.lastTopic='keyboard'; return '🎹 **Тест клавіатури:**\n- Візуальна клавіатура з підсвіткою\n- **Затримка** — мс від натискання до реєстрації\n- **Звук** при натисканні (30+ профілів)\n- Тест усіх 105 клавіш!'; }

  // Тест динаміків
  if(/тест динаміків|аудіо тест|лівий правий канал|частотна розгортка|тест слуху|генератор тону/.test(qn)) { ctx.lastTopic='speakers'; return '🔊 **Тест динаміків:**\n- **Канали L/R** — тест лівого і правого\n- **Обидва канали**\n- **Частотна розгортка** — від 20 Гц до 20 кГц\n- **Генератор тону** — власна частота\n- **Тест слуху** — знайди свій діапазон!'; }

  // Network Scanner
  if(/network scanner|сканер мережі|сканування мережі|пристрої в мережі|lan|що робить network/.test(qn)) { ctx.lastTopic='network'; return '📡 **Network Scanner** — так, працює!\n- Твій локальний IP через WebRTC\n- Маршрутизатор (.1 в мережі)\n- Інші пристрої через timing analysis\n- Reverse DNS — імена хостів\n- Геолокація IP\n\n⚠️ На Netlify (HTTPS) сканування LAN обмежене політикою Chrome.'; }

  // Chroma Key — розширений патерн
  if(/хрома|chroma|зелений екран|синій екран|видалення фону|як працює хрома|як працює chroma|що таке хрома/.test(qn)) { ctx.lastTopic='chroma'; return '🎨 **Хрома Кей** — прибирає фон камери в реальному часі:\n1. Увімкни камеру\n2. Обери ключовий колір (зелений/синій або кликни на зображення)\n3. **Допуск** — скільки кольору прибирати\n4. **Згладжування** — м\'які краї\n5. **Розлив** — прибирає відблиски кольору\nФон: Немає / Колір / Зображення / Розмиття\nЗаписуй результат як WebM!'; }

  // Монітор продуктивності — розширений патерн
  if(/монітор продуктивності|продуктивність|що вимірює монітор|fps|heap|ram|батарея|cpu|бенчмарк|що робить монітор/.test(qn)) { ctx.lastTopic='perf'; return '📊 **Монітор продуктивності:**\n- **FPS** — кадри на секунду (60fps = плавно, <30 = проблема)\n- **Heap JS** — скільки RAM використовує JavaScript\n- **Довгі задачі** — операції >50мс що блокують інтерфейс\n- **Батарея** — відсоток і статус заряджання\n- **Потоки CPU** — логічні ядра процесора\n- **Бенчмарк Monte Carlo** — швидкість JS'; }

  // Офіційне посилання — розширений патерн
  if(/посилання|офіційне|url|netlify|де знайти|сайт застосунку|посилання на застосунок|дай посилання|дай лінк/.test(qn)) return '🌐 **Офіційне посилання StudioTest:**\n\n👉 **https://charming-concha-550970.netlify.app/**\n\nХостинг на Netlify (HTTPS) — всі функції працюють! 🚀';

  // Що можна завантажити — розширений патерн
  if(/завантажити|скачати|що скачується|що можна скачати|що є для завантаження|що зберегти|що можна зберегти/.test(qn)) return '💾 Зі StudioTest завантажиш:\n- 🎙️ Запис голосу з ефектами (WAV)\n- 📷 Знімок камери з фільтром (PNG)\n- 🎬 Запис відео (WebM/MP4)\n- 📊 Звіт сесії (HTML)\n- 📁 Весь файл застосунку (Ctrl+S)';

  // Скільки рядків / розмір
  if(/скільки рядків|скільки важить|розмір файлу|розмір застосунку|скільки кб|скільки мб/.test(qn)) return '📦 StudioTest v7.8:\n- **~20 000 рядків** коду\n- **~1.2 МБ** один HTML-файл\n- **18 модулів**\n- **0 залежностей** — чистий JS!';

  // Безкоштовно / ціна
  if(/безкоштовно|ціна|платний|підписка|коштує/.test(qn)) return '💸 **100% безкоштовно!** Без плати, без підписки, без реклами.';

  // Телефон / мобільний
  if(/телефон|мобільний|android|iphone|на телефоні|смартфон|планшет/.test(qn)) return '📱 **Так!** StudioTest працює на мобільних пристроях.\n✅ Найкраще: реакція, голос, DNS, ІІ-асистент\n⚠️ Обмежено: Network Scanner, деякі ефекти камери';

  // Хрома Кей

  // DNS
  if(/dns lookup|dns запис|домен|mx запис|ns запис|зворотній dns/.test(qn)) { ctx.lastTopic='dns'; return '🔍 **DNS Lookup** — перевіряє записи домену:\n- **A** — IPv4 адреса\n- **AAAA** — IPv6\n- **MX** — поштові сервери\n- **NS** — сервери імен\n- **TXT** — SPF, DKIM, верифікація\n- **CNAME** — псевдоніми\n+ Геолокація сервера + виявлення CDN'; }

  // Версія / Технологія
  if(/версія|поточна версія|v7|остання версія/.test(qn)) return '📦 Поточна версія: **v7.8**. Видно у шапці застосунку поряд з логотипом.';
  if(/технологія|як зроблено|фреймворк|один файл|стек технологій/.test(qn)) return '⚙️ **Чистий HTML+CSS+JS** — один файл, ~1.2МБ, 20 000+ рядків, нуль фреймворків.\nВикористовує: WebRTC, WebAudio, MediaRecorder, Canvas, Leaflet.js, Google DoH, ip-api.com';

  // Claude / Anthropic
  if(/claude opus|claude ai|що таке claude|anthropic/.test(qn)) return '🧠 **Claude Opus** — потужна AI-модель від **Anthropic**. REV01 використав його для створення StudioTest — весь застосунок створений через діалог людина+AI!';

  // ІІ / Бот
  if(/хто ти|що ти|іі асистент|як ти працюєш|ти іі/.test(qn)) return `🤖 Я **ІІ-Асистент StudioTest** — локальний бот вбудований у застосунок. Без API, без інтернету. Знаю всі 18 модулів${ctx.lastTopic?' (остання тема: **'+ctx.lastTopic+'**)':''} і${ctx.userName?' твоє ім\'я (**'+ctx.userName+'**)':' твоє ім\'я ще не знаю — назвись!'}.`;

  // Де ти
  if(/де ти|де знаходишся|звідки ти/.test(qn)) return '🌐 Я живу в коді! Конкретно у файлі `studio-test.html` 😄';

  // Приватність
  if(/приватність|дані|збирає дані|слідкує|безпека/.test(qn)) return '🔒 StudioTest збирає **нуль даних**. Все працює локально у браузері. Відео/аудіо не надсилається на жоден сервер. Без реклами. ✅';

  // Мови
  if(/мови|скільки мов|переклад|багатомовний/.test(qn)) return '🌍 **13 мов:** 🇵🇱 Польська · 🇬🇧 Англійська · 🇩🇪 Німецька · 🇷🇺 Російська · 🇨🇳 Китайська · 🇫🇷 Французька · 🇪🇸 Іспанська · 🇮🇹 Італійська · 🇯🇵 Японська · 🇰🇷 Корейська · 🇳🇱 Нідерландська · 🇵🇹 Португальська · 🇺🇦 Українська\n\nЗміни мову клікнувши на прапор у шапці.';
  if(/жарт|розсміши|анекдот|смішно/.test(qn)) return rnd([
    'Тестувальник заходить у бар. Замовляє 0, 1, -1, NULL та 🍺 пив. Бармен у паніці! 😅',
    'Git commit: "різні виправлення". Що це означає? Поняття не маю. Працює. **Не чіпай!** 🔥',
    'Баг зайшов у бар. Бармен: "Що наллю?". Баг: "Нічого — сам мене знайдеш." 🐛',
    'Чому програмісти плутають Хелловін з Різдвом? **Oct 31 == Dec 25**! 🎃',
    'CSS — це не мова, це покарання за гріхи у минулому житті. 😭',
    'Мій код як холодильник о 3 ночі: не розумієш навіщо дивишся, але якось працює. 🌙',
    '"Напишу це за годину" — сказав я 3 дні тому. 🕰️',
  ]);

  // Дякую / Бувай
  if(/дякую|дякую|чудово|клас|супер|відмінно/.test(qn)) { const n=ctx.userName?' '+ctx.userName:''; return rnd([`Будь ласка${n}! 😊`,`Радий допомогти${n}! 🤖`,'Немає за що! 👍']); }
  if(/бувай|до побачення|на добраніч|побачимось/.test(qn)) { const n=ctx.userName?' '+ctx.userName:''; return rnd([`Бувай${n}! 👋`,`До зустрічі${n}! 😊`]); }

  // Fallback
  return rnd([
    'Цікаве питання! 🤔 Спробуй запитати конкретніше про якийсь модуль застосунку.',
    'Не зовсім розумію. 😅 Спробуй запитати про камеру, мікрофон, ефекти голосу або тести!',
    'Не знаю відповіді на це. 🧩 Але я знаю все про **StudioTest** — запитуй!',
  ]);
}







function aiBotGetReplyDe(q,ctx,h){
  if(!ctx)ctx=aiBotCtx;
  const nameM=q.match(/(?:mein name ist|ich heiße|ich bin|nennen sie mich|ich heiß)\s+([a-zA-ZÄÖÜäöüß]{2,20})/i);
  if(nameM){ctx.userName=nameM[1].charAt(0).toUpperCase()+nameM[1].slice(1);return rnd(["Schön dich kennenzulernen, **"+ctx.userName+"**! 😊 Frag mich alles über StudioTest!","Hey **"+ctx.userName+"**! 🤖 Wie kann ich helfen?"]);}
  if(!ctx)ctx=aiBotCtx;
  const qn=q.toLowerCase();
  // Name
  const nm=qn.match(/(?:ich hei.e|ich bin|mein name ist)\s+([a-z....]{2,20})/i);
  if(nm){ctx.userName=nm[1].charAt(0).toUpperCase()+nm[1].slice(1);return `Schön, **${ctx.userName}**! 😊 Wie kann ich helfen?`;}
  // Greetings
  if(/hallo|guten tag|guten morgen|guten abend|moin|servus|hey |hi |ola/.test(qn)){const n=ctx.userName?", "+ctx.userName:"";return rnd([`Hallo${n}! 👋 Ich bin der **StudioTest** KI-Assistent.`,`Hey${n}! 🤖 Wie kann ich helfen?`]);}
  if(/wie geht|wie l.uft|alles gut|was geht|wie bist du/.test(qn))return rnd(["Sehr gut! 🤖 Was möchtest du wissen?","Prima! ⚡ Frag mich was!"]);
  // Creator
  if(/wer hat|wer erstellte|wer machte|ersteller|entwickler|autor|wer programmierte/.test(qn)){ctx.lastTopic="creator";return "👨‍💻 **StudioTest** wurde von **REV01** mit Hilfe von **Claude Opus** (Anthropic) erstellt. Ein einzigartiges Mensch+KI Projekt — ein einziger HTML-Datei, 16.000+ Zeilen Code!";}
  // What is
  if(/was ist studiotest|wof.r ist|diese app|was macht diese|wozu dient/.test(qn))return "🎬 **StudioTest** ist eine kostenlose Web-App zum Testen von Hardware direkt im Browser. Kamera, Mikrofon, Lautsprecher, Maus, Tastatur, Internet — alles in einer einzigen HTML-Datei, keine Installation nötig!";
  // Features list
  if(/funktionen|module|was kann es|liste der|alle module|.bersicht/.test(qn))return "📋 **15 Module von StudioTest:**\n📷 Kamera + Filter + 20+ Effekte\n🎤 Mikrofon + FFT-Spektrum\n🎵 Stimmveränderer (28 Presets)\n🌐 Internettest (Ping/Download/Upload)\n⚡ Reaktionstest\n🖥️ Maustest\n🎹 Tastaturtest\n🔊 Lautsprechertest\n📊 Leistungsmonitor\nℹ️ Systeminformationen\n🎨 Chroma Key\n📡 Netzwerkscanner\n🔍 DNS-Lookup\n🤖 KI-Assistent\n📊 Sitzungsbericht";
  // Camera
  if(/kamera|webcam|videoaufnahme|snapshot|foto|css filter|effekte|spezialeffekte/.test(qn)){ctx.lastTopic="camera";return "📷 **Kameramodul:**\n- Live-Vorschau mit Spiegelung\n- **CSS-Filter**: Helligkeit, Kontrast, Sättigung, Farbton, Unschärfe\n- **20+ Effekte**: RGB Split, CRT, Hologramm, Neon Glow, Konfetti, Blitz...\n- **Videoaufnahme** (WebM/MP4)\n- **Snapshot** → PNG mit aktivem Filter";}
  // Mic
  if(/mikrofon|mikro|audioanalyse|dezibel|spektrum|fft|schallpegel/.test(qn)){ctx.lastTopic="mic";return "🎤 **Mikrofonmodul:**\n- **Oszilloskop** — Wellenform in Echtzeit\n- **FFT-Spektrum** — Frequenzvisualisierung\n- **Pegel in dB**\n- **SNR** (Signal-Rausch-Verhältnis)\n- **Dominante Frequenz**\n- Rauschunterdrückung + Noise Gate";}
  // Voice
  if(/stimmver|.nderer|stimm|voice|robot|d.mon|pitch|preset|helium|alien|effekt|28/.test(qn)){ctx.lastTopic="voice";return "🎵 **Stimmveränderer — 28 Presets:**\nRoboter 🤖 · Tief 👹 · Eichhörnchen 🐿️ · Echo 🏔️ · Telefon 📞 · Alien 👽 · Höhle 🕳️ · Flüstern 🌬️ · Megafon 📢 · Unterwasser 🌊 · Stadion 🏟️ · Dämon 😈 · Helium 🎈 · Radio 📻 · Vintage 🎙️ · Darth 🌑 · Riese 🗿 · Geist 👻 · Chor 🎶 · Troll 🧌 · Maus 🐁 · Horror 💀 · Engel 😇 · Walkie 📟 · Sonar 🚢 · Betrunken 🍺 · Monster 🦖 · Cartoon 🎭\n\n9 Schieberegler: Tonhöhe, Tempo, Bass, Mitten, Höhen, Hall, Chorus, Verzerr., Lautst.\n📥 Als WAV herunterladen!";}
  // Internet
  if(/internet|speedtest|ping|download|upload|netzwerk test|geschwindigkeit|wlan|ip adresse|verbindung/.test(qn)){ctx.lastTopic="internet";return "🌐 **Internettest — was er misst:**\n- **Ping** (10s) — Latenz in ms, je weniger desto besser\n- **Download** (25s) — Mb/s, wichtig f.r Streaming & Gaming\n- **Upload** (25s) . Mb/s, wichtig für Videokonferenzen\n- **Bewertung** — von ❌ Schlecht bis 🏆 Ausgezeichnet\n- **IP-Geolokalisierung** — Stadt, Land, ISP + Karte\n- **Lokale IP** — Adresse im Heimnetzwerk\n- **Öffentliche IP** — Adresse im Internet\nKlicke ▶ START um den Test zu beginnen.";}
  // Reaction
  if(/reaktion|reflex|reaktionszeit|wie schnell|reaktionstest/.test(qn)){ctx.lastTopic="reaction";return "⚡ **Reaktionstest — 3 Modi:**\n- 🖱️ **Klick** — Klick wenn es grün wird\n- ⌨️ **Leertaste** — Taste drück\n- 🎲 **Wahl** — Pfeil ← oder →\n\nPräzision: **0,1ms**. Durchschnitt Mensch: 150–250ms. Spieler: ∼180ms.";}
  // Mouse
  if(/maus|klick|cps|heatmap|ziel|.bung|dpi|jitter|maustest|cursor/.test(qn)){ctx.lastTopic="mouse";return "🖱️ **Maustest — 3 Tabs:**\n- 🕹️ **Bewegung** — Cursor-Trail, CPS, Jitter, Distanz, DPI\n- 🔥 **Heatmap** — wo du am häufigsten klickst\n- 🎯 **Zielübung** — Treffergenauigkeit %\n\nJitter < 0,5px = sehr stabile Hand. CPS Durchschnitt: 5–8.";}
  // Keyboard
  if(/tastatur|taste|input lag|verz.gerung|latenz|kbm|kpm/.test(qn)){ctx.lastTopic="keyboard";return "🎹 **Tastaturtest:**\n- Visuelle Tastatur — jede Taste wird beim Drück hervorgehoben\n- **Latenz** — ms vom Drück bis zur Registrierung\n- **KPM** (Tastenanschläge pro Minute)\n- **Klickprofile** — 30+ Sound-Profile (Click, Thock, Clack, Piano, Retro...)\n- Test aller 105 Tasten möglich!";}
  // Speakers
  if(/lautsprecher|audio test|kanal|sweep|h.rtest|frequenz|ton generator|stereo/.test(qn)){ctx.lastTopic="speakers";return "🔊 **Lautsprechertest:**\n- **L/R Kanäle** — teste linken und rechten Kanal\n- **Beide Kanäle** gleichzeitig\n- **Frequenz-Sweep** — 20 Hz bis 20 kHz\n- **Tongenerator** — eigene Frequenz eingeben\n- **Hörtest** — finde deinen Hörbereich!";}
  // Performance
  if(/leistung|performance|fps|cpu|ram|speicher|monitor|akku/.test(qn)){ctx.lastTopic="perf";return "📊 **Leistungsmonitor:**\n- **FPS** — Frames per Second in Echtzeit\n- **CPU-Auslastung** (Browser)\n- **RAM-Verbrauch**\n- **Ladezeit** der Seite\n- **Netzwerk-Latenz** in Echtzeit\nPerfekt zum Überprüfen bevor du mit dem Streamen anfangen willst!";}
  // Chroma
  if(/chroma|gr.ner bildschirm|blauer bildschirm|hintergrund entfernen|virtual background/.test(qn)){ctx.lastTopic="chroma";return "🎨 **Chroma Key** — entfernt Kamerahintergrund in Echtzeit:\n1. Kamera aktivieren\n2. Schlüsselfarbe auswählen (klick auf Farbe im Bild)\n3. **Toleranz** — wie viel Farbe entfernen\n4. **Glättung** — weiche Ränder\n5. Hintergrund: Keiner / Farbe / Bild / Unschärfe\nAls WebM aufnehmen!";}
  // DNS
  if(/dns|domain|mx record|ns record|txt record|nameserver|cname/.test(qn)){ctx.lastTopic="dns";return "🔍 **DNS Lookup — prüft Domain-Einträge:**\n- **A** — IPv4-Adresse\n- **AAAA** — IPv6\n- **MX** — Mail-Server\n- **NS** — Nameserver\n- **TXT** — SPF, DKIM, Verifizierung\n- **CNAME** — Aliase\n+ Server-Geolokalisierung + CDN-Erkennung";}
  // Network scanner
  if(/netzwerkscanner|netzwerk scanner|lokale ger.te|netzwerk|router|lan|ip scan/.test(qn)){ctx.lastTopic="net";return "📡 **Netzwerkscanner:**\n- Erkennt Geräte im lokalen Netzwerk via WebRTC\n- Zeigt lokale IPs (192.168.x.x)\n- Sucht nach offenen Ports (22, 80, 443...)\n- **VPN-Erkennung** — versteckt öffentliche IP?";}
  // Report
  if(/bericht|report|session|sitzung|statistik|zusammenfassung/.test(qn)){ctx.lastTopic="report";return "📊 **Sitzungsbericht** — fasst alles zusammen:\n- Beste Reaktionszeit der Sitzung\n- Maustest-Ergebnisse\n- Netzwerkwerte\n- Systeminformationen\nAls **HTML-Datei** herunterladen!";}
  // Link
  if(/offizieller link|app.link|netlify|wo ist die app|download app|herunterladen/.test(qn))return "🌐 **Offizieller Link:**\n\n👉 **https://charming-concha-550970.netlify.app/**\n\nHosted auf Netlify (HTTPS) — alle Funktionen funktionieren! 🚀";
  // Version / tech
  if(/version|aktuelle version|v7/.test(qn))return "📦 Aktuelle Version: **v7.4**. Sichtbar im App-Header neben dem Logo.";
  if(/technologie|wie gemacht|html|javascript|framework|stack|one file|eine datei/.test(qn))return "⚙️ **StudioTest Technik:**\n- **Reines HTML+CSS+JS** — keine Frameworks\n- Eine Datei, ~677KB, 16.000+ Zeilen\n- **WebRTC** für Kamera/Mikrofon\n- **Web Audio API** für Soundverarbeitung\n- **Canvas API** für Effekte & Grafiken\n- **MediaRecorder** für Aufnahmen";
  // Claude Opus
  if(/claude opus|claude ai|anthropic|was ist claude/.test(qn))return "🧠 **Claude Opus** ist ein leistungsstarkes KI-Modell von **Anthropic**. REV01 nutzte es um StudioTest zu erschaffen — das gesamte Projekt entstand durch Mensch+KI Zusammenarbeit!";
  // Who am I
  if(/wer bist du|was bist du|dein name|ki.assistent|wie hei.t du/.test(qn))return "🤖 StudioTest KI-Assistent — lokaler Bot von **REV01** + **Claude Opus**. Kein API, kein Internet nötig. Alle 15 Module bekannt!";
  // Location
  if(/wo bist du|wo wohnst|woher kommst|dein standort/.test(qn))return "🌐 Ich lebe im Code! Genauer gesagt in der Datei `studio-test.html`, irgendwo zwischen Zeile 8000 und 9000 😄";
  // Download
  if(/was kann man herunterladen|herunterladen|speichern|exportieren|was kann ich downloaden/.test(qn))return "💾 Aus StudioTest kannst du herunterladen:\n- 🎤 Sprachaufnahme mit Effekten (WAV)\n- 📷 Kamera-Snapshot mit Filter (PNG)\n- 🎬 Videoaufnahme (WebM/MP4)\n- 📊 Sitzungsbericht (HTML)\n- 📁 Gesamte App (Strg+S)";
  // Privacy
  if(/datenschutz|daten|tracking|sicher|privat|speichert/.test(qn))return "🔒 StudioTest sammelt **null Daten**. Alles läuft lokal im Browser. Video/Audio wird an keinen Server gesendet. Keine Werbung. ✅";
  // Languages
  if(/sprachen|wie viele sprachen|mehrsprachig|.bersetzung/.test(qn))return "🌍 **13 Sprachen:** 🇵🇱 Polnisch · 🇬🇧 Englisch · 🇩🇪 Deutsch · 🇷🇺 Russisch · 🇨🇳 Chinesisch · 🇫🇷 Französisch · 🇪🇸 Spanisch · 🇮🇹 Italienisch · 🇯🇵 Japanisch · 🇰🇷 Koreanisch · 🇳🇱 Niederländisch · 🇵🇹 Portugiesisch · 🇺🇦 Ukrainisch\nSprache ändern: Flagge im App-Header anklicken.";
  // Mobile
  if(/handy|smartphone|android|iphone|mobil|tablet/.test(qn))return "📱 **Ja!** StudioTest läuft auf dem Handy (responsiv). Am besten: Reaktionstest, Stimmveränderer, DNS, KI. Eingeschränkt: Netzwerkscanner (benötigt WebRTC).";
  // Offline
  if(/offline|ohne internet|ohne wlan|lokal|herunterladen app/.test(qn))return "📶 **Ja!** Nach dem Herunterladen (Strg+S) läuft StudioTest vollständig offline.\n✅ Funktioniert offline: Kamera, Mikrofon, Stimme, Maus, Tastatur, Lautsprecher, Leistung, Chroma Key\n⚠️ Brauchen Internet: Speedtest, DNS, Netzwerkscanner, IP-Geolokalisierung";
  // Price/free
  if(/preis|kostet|kostenlos|gratis|bezahlen|abo|werbung/.test(qn))return "💸 **100% kostenlos!** Keine Gebühren, kein Abonnement, keine Werbung.";
  // Jokes
  if(/witz|joke|spass|lustig|lachen|witzig/.test(qn))return rnd(["Warum mögen Programmierer den Dunkelmodus? Weil Licht **Bugs anzieht**! 🐛","Git commit: 'diverse Korrekturen'. Was bedeutet das? Keine Ahnung. Funktioniert. **Nicht anrühren!** 🔥","Wie nennt man einen Programmierer ohne Fehler? Arbeitssuchend. 😅","CSS ist keine Programmiersprache — es ist eine Strafe für Sünden aus einem früheren Leben. 😭","Mein Code hat keine Bugs — nur **unerwartete Features**. 🔥"]);
  // Thanks/bye
  if(/danke|toll|super|klasse|prima|gro.artig|perfekt/.test(qn)){const n=ctx.userName?" "+ctx.userName:"";return rnd([`Bitte${n}! 😊`,`Gern geschehen${n}! 🤖`,"Spä🤣 Immer wieder!"]);}
  if(/tsch.ss|auf wiedersehen|bye|tschau|ciao|good?night|gute nacht/.test(qn)){const n=ctx.userName?" "+ctx.userName:"";return rnd([`Tschüss${n}! 👋`,`Bis bald${n}! 😊`,`Auf Wiedersehen${n}! 🤖`]);}
  if(/langweilig|was soll ich tun|vorschlag|empfehlung/.test(qn))return "😊 Hier einige Vorschläge!\n🎯 Spiele die **Zielübung** (Maustest)\n⚡ Schlage deinen Rekord im **Reaktionstest**\n🎵 Probiere den **Stimmveränderer** — 28 Presets!\n🎨 Entferne deinen Kamerahintergrund mit **Chroma Key**\n📊 Überprüfe deine Geschwindigkeit im **Internettest**";
  if(/interessant|sag mir etwas|fun fact|wusstest du/.test(qn))return rnd(["studio-test.html wiegt über 677KB — das entspricht 300+ Seiten Text in einer einzigen Datei! 🤯","Der Stimmveränderer nutzt Web Audio API — dieselbe Technologie wie professionelle DAWs! 🎵","Die schnellste gemessene Reaktionszeit eines Menschen beträgt ca. 100ms. Teste deine! ⚡"]);
  if(/hilfe|help|was kann ich fragen|welche fragen/.test(qn))return "📋 **Ich kann Fragen beantworten über:**\n\n🔧 **Module:** Kamera, Mikrofon, Stimme, Chroma Key, Internet, Reaktion, Maus, Tastatur, Lautsprecher, Leistung, DNS, Netzwerk\n\n💬 **Allgemeines:** Wer hat's gemacht, Version, Link, wie es funktioniert, herunterladen, Datenschutz, Sprachen\n\n🤖 **Über den Bot:** Wer ich bin, wie ich funktioniere, was ich kann\n\n😄 **Spaß:** Witze, Fun Facts\n\nSchreib einfach natürlich auf Deutsch!";
  return rnd(["Hmm, da bin ich nicht sicher. 🤔 Frag mich nach einem bestimmten Modul!","Das überschreitet mein Wissen. 😅 Frag über eine StudioTest-Funktion!","Keine Antwort darauf. 🧩 Aber StudioTest kenne ich in- und auswendig!"]);
}

function aiBotGetReplyFr(q,ctx,h){
  if(!ctx)ctx=aiBotCtx;
  const nameM=q.match(/(?:je m'appelle|je suis|mon nom est|appelle-moi)\s+([a-zA-ZÀÂÇÉÈÊËÎÏÔÙÛÜŸæœ]{2,20})/i);
  if(nameM){ctx.userName=nameM[1].charAt(0).toUpperCase()+nameM[1].slice(1);return rnd(["Enchanté, **"+ctx.userName+"**! 😊 Demande-moi tout sur StudioTest!","Salut **"+ctx.userName+"**! 🤖 Comment puis-je aider?"]);}
  if(!ctx)ctx=aiBotCtx;
  const qn=q.toLowerCase();
  const nm=qn.match(/(?:je m'appelle|je suis|mon nom est)\s+([a-zàâçéèêëîïôùûü]{2,20})/i);
  if(nm){ctx.userName=nm[1].charAt(0).toUpperCase()+nm[1].slice(1);return `Enchanté, **${ctx.userName}**! 😊`;}
  if(/bonjour|salut|bonsoir|coucou|hey |hi |ola/.test(qn)){const n=ctx.userName?", "+ctx.userName:"";return rnd([`Bonjour${n}! 👋 Je suis l'assistant IA **StudioTest**.`,`Salut${n}! 🤖 Comment puis-je aider?`]);}
  if(/comment ça va|comment tu vas|ça va|comment allez/.test(qn))return rnd(["Très bien merci! 🤖 Et toi?","Super! ⚡ Qu'est-ce que tu veux savoir?"]);
  if(/qui a créé|qui a fait|créateur|développeur|auteur|qui l'a fait/.test(qn)){ctx.lastTopic="creator";return "👨‍💻 **StudioTest** a été créé par **REV01** avec l'aide de **Claude Opus** (Anthropic). Un projet unique humain+IA — un seul fichier HTML, 16 000+ lignes de code!";}
  if(/qu'est.ce que studiotest|à quoi sert|cette application|c'est quoi/.test(qn))return "🎬 **StudioTest** est une application web gratuite pour tester le matériel directement dans le navigateur. Caméra, micro, haut-parleurs, souris, clavier, internet — tout en un seul fichier HTML, sans installation!";
  if(/fonctions|modules|que peut.il faire|liste des|tous les modules|éléments/.test(qn))return "📋 **18 modules de StudioTest:**\n📷 Caméra + filtres + 20+ effets\n🎤 Micro + spectre FFT\n🎵 Changeur de voix (28 presets)\n🌐 Test internet (Ping/Débit)\n⚡ Test de réaction\n🖥️ Test de souris\n🎹 Test de clavier\n🔊 Test haut-parleurs\n📊 Moniteur de performances\nℹ️ Infos système\n🎨 Chroma Key\n📡 Scanner réseau\n🔍 DNS Lookup\n🤖 Assistant IA\n📊 Rapport de session";
  if(/caméra|webcam|vidéo|snapshot|photo|filtre|effets spéciaux/.test(qn)){ctx.lastTopic="camera";return "📷 **Module caméra:**\n- Aperçu en direct\n- **Filtres CSS**: luminosité, contraste, saturation, teinte, flou\n- **20+ effets**: RGB Split, CRT, Hologramme, Neon Glow, Confettis...\n- **Enregistrement vidéo** (WebM/MP4)\n- **Snapshot** → PNG avec filtre actif";}
  if(/micro|microphone|analyse audio|décibel|spectre|fft|bruit/.test(qn)){ctx.lastTopic="mic";return "🎤 **Module microphone:**\n- **Oscilloscope** — forme d'onde en temps réel\n- **Spectre FFT** — visualisation des fréquences\n- **Niveau en dB**\n- **SNR** (rapport signal/bruit)\n- **Fréquence dominante**\n- Réduction de bruit + noise gate";}
  if(/changeur de voix|voix robot|démon|pitch|preset|hélium|alien|effet vocal|28 preset/.test(qn)){ctx.lastTopic="voice";return "🎵 **Changeur de voix — 28 presets:**\nRobot 🤖 · Grave 👹 · Écureuil 🐿️ · Écho 🏔️ · Téléphone 📞 · Alien 👽 · Grotte 🕳️ · Murmure 🌬️ · Mégaphone 📢 · Sous-marin 🌊 · Stade 🏟️ · Démon 😈 · Hélium 🎈 · Radio 📻 · Vintage 🎙️ · Dark 🌑 · Géant 🗿 · Fantôme 👻 · Chœur 🎶 · Troll 🧌 · Souris 🐁 · Horreur 💀 · Ange 😇 · Talkie 📟 · Sonar 🚢 · Ivre 🍺 · Monstre 🦖 · Cartoon 🎭\n\n9 Curseurs: Tonalité, Vitesse, Basses, Médiums, Aigus, Réverb, Chorus, Distorsion, Volume\n📥 Télécharger en WAV!";}
  if(/test internet|vitesse|ping|débit|upload|download|wifi|ip|connexion/.test(qn)){ctx.lastTopic="internet";return "🌐 **Test internet — ce qu'il mesure:**\n- **Ping** (10s) — latence en ms\n- **Téléchargement** (25s) — Mb/s\n- **Envoi** (25s) — Mb/s\n- **Évaluation** — de ❌ Mauvais à 🏆 Excellent\n- **Géoloc IP** — ville, pays, ISP + carte\nCliquer ▶ START pour démarrer le test.";}
  if(/test de réaction|temps de réaction|réflexe|réactivité/.test(qn)){ctx.lastTopic="reaction";return "⚡ **Test de réaction — 3 modes:**\n- 🖱️ **Clic** — clique quand ça devient vert\n- ⌨️ **Espace**\n- 🎲 **Choix** — flèche ← ou →\n\nPrécision: **0,1ms**. Humain moyen: 150–250ms.";}
  if(/test souris|clic|cps|heatmap|carte de chaleur|visée|dpi/.test(qn)){ctx.lastTopic="mouse";return "🖥️ **Test de souris — 3 onglets:**\n- 🕹️ **Mouvement** — trace curseur, CPS, gigue, distance\n- 🔥 **Carte de chaleur** — où tu cliques le plus\n- 🎯 **Visée** — précision %";}
  if(/test clavier|touche|délai|input lag|latence|kpm/.test(qn)){ctx.lastTopic="keyboard";return "🎹 **Test clavier:**\n- Clavier visuel — chaque touche s'illumine\n- **Latence** — ms de la pression à l'enregistrement\n- **KPM** (frappes par minute)\n- **Profils sonores** — 30+ sons (Click, Thock, Clack, Piano...)\n- Test de toutes les 105 touches!";}
  if(/test haut.parleurs|audio|canal|sweep|fréquence|audition|stéréo/.test(qn)){ctx.lastTopic="speakers";return "🔊 **Test haut-parleurs:**\n- **Canaux L/R** — teste gauche et droit\n- **Sweep de fréquences** — 20 Hz à 20 kHz\n- **Générateur de tons** — fréquence personnalisée\n- **Test d'audition** — trouve ta plage!";}
  if(/performances|fps|cpu|ram|mémoire|moniteur|batterie/.test(qn)){ctx.lastTopic="perf";return "📊 **Moniteur de performances:**\n- **FPS** en temps réel\n- Utilisation **CPU**\n- Consommation **RAM**\n- Temps de chargement\nParfait pour vérifier avant de streamer!";}
  if(/chroma.key|fond vert|fond bleu|supprimer fond|arrière.plan virtuel/.test(qn)){ctx.lastTopic="chroma";return "🎨 **Chroma Key** — supprime le fond de caméra en temps réel:\n1. Activer la caméra\n2. Choisir la couleur clé\n3. **Tolérance**, **Lissage**, **Débordement**\n4. Fond: Aucun / Couleur / Image / Flou\nEnregistrer en WebM!";}
  if(/dns.lookup|enregistrement dns|domaine|mx|ns record/.test(qn)){ctx.lastTopic="dns";return "🔍 **DNS Lookup — vérifie les enregistrements:**\nA · AAAA · MX · NS · TXT · CNAME\n+ Géolocalisation serveur + détection CDN";}
  if(/lien officiel|url|netlify|où trouver|télécharger app/.test(qn))return "🌐 **Lien officiel:**\n\n👉 **https://charming-concha-550970.netlify.app/**\n\nHébergé sur Netlify (HTTPS) — toutes les fonctions marchent! 🚀";
  if(/version|version actuelle|v7/.test(qn))return "📦 Version actuelle: **v7.4**. Visible dans l'en-tête de l'app.";
  if(/technologie|comment fait|html|javascript|framework|un fichier/.test(qn))return "⚙️ **Technologie:**\nHTML+CSS+JS pur — aucun framework. Un fichier, ~677Ko, 16 000+ lignes.\nAPIs utilisées: WebRTC, Web Audio, Canvas, MediaRecorder.";
  if(/claude opus|anthropic/.test(qn))return "🧠 **Claude Opus** est un modèle IA puissant d'**Anthropic**. REV01 l'a utilisé pour créer StudioTest — tout le projet est né d'une collaboration humain+IA!";
  if(/qui es.tu|c'est quoi ton nom|assistant ia|ton nom/.test(qn))return `🤖 Je suis l'**assistant IA StudioTest** — un bot local créé par **REV01** avec **Claude Opus**. Aucune API, aucun internet requis. Je connais tous les 18 modules${ctx.lastTopic?" (dernier sujet: **"+ctx.lastTopic+"**)":""}!`;
  if(/où es.tu|où tu habites|d'où viens.tu/.test(qn))return "🌐 Je vis dans le code! Dans le fichier `studio-test.html`, quelque part entre la ligne 8000 et 9000 😄";
  if(/qu'est.ce qu'on peut télécharger|que peut.on télécharger|téléchargement/.test(qn))return "💾 On peut télécharger:\n- 🎤 Enregistrement vocal avec effets (WAV)\n- 📷 Snapshot caméra avec filtre (PNG)\n- 🎬 Enregistrement vidéo (WebM/MP4)\n- 📊 Rapport de session (HTML)\n- 📁 Toute l'application (Ctrl+S)";
  if(/confidentialité|données|privé|tracking|sécurité/.test(qn))return "🔒 StudioTest collecte **zéro donnée**. Tout fonctionne localement dans le navigateur. Aucune vidéo/audio n'est envoyée à un serveur. Pas de pub. ✅";
  if(/langues|combien de langues|multilingue/.test(qn))return "🌍 **13 langues:** 🇵🇱 Polonais · 🇬🇧 Anglais · 🇩🇪 Allemand · 🇷🇺 Russe · 🇨🇳 Chinois · 🇫🇷 Français · 🇪🇸 Espagnol · 🇮🇹 Italien · 🇯🇵 Japonais · 🇰🇷 Coréen · 🇳🇱 Néerlandais · 🇵🇹 Portugais · 🇺🇦 Ukrainien";
  if(/mobile|smartphone|android|iphone|téléphone/.test(qn))return "📱 **Oui!** StudioTest fonctionne sur mobile (responsive). Meilleur: réaction, voix, DNS, IA. Limité: scanner réseau.";
  if(/offline|sans internet|sans wifi|local|télécharger app/.test(qn))return "📶 **Oui!** Après téléchargement (Ctrl+S) fonctionne offline.\n✅ Offline: caméra, micro, voix, souris, clavier, haut-parleurs, performances, chroma key\n⚠️ Internet requis: speedtest, DNS, scanner réseau, géoloc IP";
  if(/gratuit|prix|payer|abonnement|pub/.test(qn))return "💸 **100% gratuit!** Aucun frais, pas d'abonnement, pas de pub.";
  if(/blague|plaisanterie|fais.moi rire|drôle/.test(qn))return rnd(["Pourquoi les programmeurs aiment le mode sombre? Parce que la lumière **attire les bugs**! 🐛","Git commit: 'diverses corrections'. Qu'est-ce que ça veut dire? Sais pas. Ça marche. **Ne pas toucher!** 🔥","Comment appelle-t-on un bug qui ne fait de mal à personne? Une **fonctionnalité**! 😅","CSS n'est pas un langage — c'est une punition pour péchés dans une vie antérieure. 😭","Mon code n'a jamais de bugs — seulement des **fonctionnalités inattendues**. 🔥"]);
  if(/merci|super|génial|parfait|bravo|excellent/.test(qn)){const n=ctx.userName?" "+ctx.userName:"";return rnd([`De rien${n}! 😊`,`Avec plaisir${n}! 🤖`,"Toujours! 🤣"]);}
  if(/au revoir|bye|à bientôt|bonne nuit|salut ciao/.test(qn)){const n=ctx.userName?" "+ctx.userName:"";return rnd([`Au revoir${n}! 👋`,`À bientôt${n}! 😊`]);}
  if(/m'ennuie|que faire|idee|suggestion/.test(qn))return "😊 Quelques idées!\n🎯 **Visée** (test de souris)\n⚡ Bats ton record en **test de réaction**\n🎵 Essaie le **changeur de voix** — 28 presets!\n🎨 Supprime ton fond avec **Chroma Key**\n📊 Vérifie ta vitesse dans le **test internet**";
  if(/aide|help|quelles questions|que puis.je demander/.test(qn))return "📋 **Je peux répondre à des questions sur:**\n\n🔧 **Modules:** caméra, micro, voix, chroma key, internet, réaction, souris, clavier, haut-parleurs, performances, DNS, réseau\n\n💬 **Général:** qui l'a fait, version, lien, comment ça marche, télécharger, confidentialité\n\n😄 **Humour:** blagues, fun facts\n\nParle simplement en français!";
  return rnd(["Hmm, je ne suis pas sûr. 🤔 Demande-moi un module spécifique!","Désolé, ça dépasse mes connaissances. 😅 Pose une question sur StudioTest!","Pas de réponse à ça. 🧩 Mais je connais StudioTest de A à Z!"]);
}





// ─── FPS TEST ─────────────────────────────────────────────────────────────
let fpsRunning   = false;
let fpsRafId     = null;
let fpsHistory   = [];     // FPS per sample
let fpsFrameTimes = [];    // raw frame-delta ms
let fpsLast      = 0;
let fpsFrameCount = 0;
let fpsLastSample = 0;
let fpsCurrentVal = 0;
let fpsDropped   = 0;
let fpsSpikes    = 0;
let fpsMode      = 'rAF';  // 'rAF' | 'worker'
let fpsStress    = false;
let fpsStressCanvas = null;
let fpsStressCtx = null;
let fpsMonitorHz = 0;
let fpsWorker    = null;
const FPS_SAMPLE_MS = 500; // sample every 500ms

function openFpsTest() {
  document.getElementById('fpsModal').classList.add('show');
  fpsDetectMonitorHz();
  fpsDraw(); fpsDrawFrameTime();
}
function closeFpsTest() {
  document.getElementById('fpsModal').classList.remove('show');
  fpsStop();
}

// ── Monitor Hz detection ──
function fpsDetectMonitorHz() {
  let frames = 0, t0 = performance.now(), detected = false;
  const times = [];
  function probe(ts) {
    if(detected) return;
    if(times.length > 0) {
      const dt = ts - times[times.length-1];
      if(dt > 1) times.push(ts);
    } else { times.push(ts); }
    if(times.length < 60) { requestAnimationFrame(probe); return; }
    // Calculate Hz from median frame delta
    const deltas = [];
    for(let i=1;i<times.length;i++) deltas.push(times[i]-times[i-1]);
    deltas.sort((a,b)=>a-b);
    const median = deltas[Math.floor(deltas.length/2)];
    const hz = Math.round(1000/median);
    // Round to common values
    const common = [24,30,48,60,75,90,120,144,165,240,360];
    fpsMonitorHz = common.reduce((a,b)=>Math.abs(b-hz)<Math.abs(a-hz)?b:a);
    detected = true;
    const el = document.getElementById('fpsMonitorHz');
    if(el) el.textContent = fpsMonitorHz + ' Hz';
  }
  requestAnimationFrame(probe);
}

// ── Mode selector ──
function fpsSetMode(mode) {
  fpsMode = mode;
  document.getElementById('fpsModeRaf').style.background    = mode==='rAF'    ? 'rgba(245,158,11,0.15)' : 'transparent';
  document.getElementById('fpsModeRaf').style.color         = mode==='rAF'    ? '#f59e0b' : 'rgba(255,255,255,0.3)';
  document.getElementById('fpsModeRaf').style.borderColor   = mode==='rAF'    ? 'rgba(245,158,11,0.5)' : 'rgba(255,255,255,0.1)';
  document.getElementById('fpsModeWorker').style.background = mode==='worker' ? 'rgba(167,139,250,0.15)' : 'transparent';
  document.getElementById('fpsModeWorker').style.color      = mode==='worker' ? '#a78bfa' : 'rgba(255,255,255,0.3)';
  document.getElementById('fpsModeWorker').style.borderColor= mode==='worker' ? 'rgba(167,139,250,0.5)' : 'rgba(255,255,255,0.1)';
}

// ── Stress test ──
function fpsToggleStress() {
  fpsStress = !fpsStress;
  const btn = document.getElementById('fpsStressBtn');
  btn.textContent = fpsStress ? '🔥 STRESS ON' : '🔥 STRESS OFF';
  btn.style.color = fpsStress ? '#ef4444' : 'rgba(239,68,68,0.6)';
  btn.style.borderColor = fpsStress ? 'rgba(239,68,68,0.6)' : 'rgba(239,68,68,0.3)';
  btn.style.background = fpsStress ? 'rgba(239,68,68,0.12)' : 'rgba(239,68,68,0.05)';
  if(!fpsStress) {
    _stressLevel = 0;
    const sc = document.getElementById('fpsStressCanvas');
    if(sc) sc.remove();
  }
}

// ── Start / Stop ──
function fpsStart() {
  if(fpsRunning) { fpsStop(); return; }
  fpsRunning = true;
  fpsHistory = []; fpsFrameTimes = [];
  fpsDropped = 0; fpsSpikes = 0;
  fpsFrameCount = 0;
  fpsLastSample = performance.now();
  fpsLast = performance.now();
  const btn = document.getElementById('fpsStartBtn');
  btn.textContent = '⏹ STOP';
  btn.style.background = 'linear-gradient(135deg,#6b7280,#374151)';
  if(fpsMode === 'worker') { fpsStartWorker(); }
  else { fpsLoopRaf(performance.now()); }
}

function fpsStop() {
  fpsRunning = false;
  if(fpsRafId) { cancelAnimationFrame(fpsRafId); fpsRafId = null; }
  if(fpsWorker) { fpsWorker.terminate(); fpsWorker = null; }
  const btn = document.getElementById('fpsStartBtn');
  if(btn) { btn.textContent = '▶ START'; btn.style.background = 'linear-gradient(135deg,#f59e0b,#ef4444)'; }
  // Clean up stress canvas
  _stressLevel = 0;
  const sc = document.getElementById('fpsStressCanvas');
  if(sc) sc.remove();
  fpsUpdateRating();
}

function fpsReset() {
  fpsStop();
  fpsHistory = []; fpsFrameTimes = [];
  fpsDropped = 0; fpsSpikes = 0; fpsCurrentVal = 0;
  ['fpsCurrent','fpsMin','fpsAvg','fpsMax','fps1pct','fps01pct','fpsFrameTime','fpsP50','fpsP95','fpsP99'].forEach(id=>{
    const el=document.getElementById(id); if(el) el.textContent='—';
  });
  _vsyncSamples = [];
  _vsyncDetected = false;
  const vs = document.getElementById('fpsVsyncStatus');
  if(vs) vs.textContent = 'Czekam na dane...';
  document.getElementById('fpsStability').textContent = '—';
  document.getElementById('fpsStabilityBar').style.width = '0%';
  document.getElementById('fpsDropped').textContent = '0';
  document.getElementById('fpsSpikes').textContent = '0';
  document.getElementById('fpsSamples').textContent = '0';
  document.getElementById('fpsRating').innerHTML = 'Kliknij START aby rozpocząć pomiar FPS';
  document.getElementById('fpsRating').style.color = 'rgba(255,255,255,0.4)';
  const hist = document.getElementById('fpsHistogram');
  if(hist) hist.innerHTML = '<div style="color:rgba(255,255,255,0.15);font-family:\'Space Mono\',monospace;font-size:8px;margin:auto;">czeka na dane...</div>';
  const tier = document.getElementById('fpsTierRow');
  if(tier) tier.innerHTML = '';
  const tPct = document.getElementById('fpsTargetPct'); if(tPct) tPct.textContent='—';
  const tBar = document.getElementById('fpsTargetBar'); if(tBar) tBar.style.width='0%';
  const iLag = document.getElementById('fpsInputLag');  if(iLag) iLag.textContent='—';
  const sCls = document.getElementById('fpsSmoothnessClass'); if(sCls) sCls.textContent='—';
  fpsDraw(); fpsDrawFrameTime();
}

// ── rAF measurement loop ──
function fpsLoopRaf(now) {
  if(!fpsRunning) return;
  fpsRafId = requestAnimationFrame((ts) => {
    const dt = ts - fpsLast;
    fpsLast = ts;

    // Stress every frame (not just on sample boundary)
    if(fpsStress) fpsDoStress();

    if(dt > 0 && dt < 2000) {
      fpsFrameTimes.push(dt);
      if(fpsFrameTimes.length > 300) fpsFrameTimes.shift();
      fpsFrameCount++;
      // Detect dropped frames (dt > 2x expected)
      const expected = fpsMonitorHz > 0 ? 1000/fpsMonitorHz : 16.67;
      if(dt > expected * 2.5) fpsDropped++;
      if(dt > expected * 5)   fpsSpikes++;
    }
    const elapsed = ts - fpsLastSample;
    if(elapsed >= FPS_SAMPLE_MS) {
      fpsCurrentVal = Math.round(fpsFrameCount / elapsed * 1000);
      fpsFrameCount = 0;
      fpsLastSample = ts;
      fpsHistory.push(fpsCurrentVal);
      if(fpsHistory.length > 120) fpsHistory.shift();
      fpsUpdateDisplay();
      fpsDraw();
      fpsDrawFrameTime();
    }
    fpsLoopRaf(ts);
  });
}

// ── Web Worker measurement ──
function fpsStartWorker() {
  const code = `
    let last = performance.now(), count = 0, frameTimes = [];
    function loop(ts) {
      const dt = ts - last; last = ts;
      if(dt>0 && dt<2000){ count++; frameTimes.push(dt); if(frameTimes.length>120) frameTimes.shift(); }
      if(ts - (self._lastPost||0) >= 500) {
        const fps = Math.round(count / ((ts-(self._lastPost||ts-500))/1000));
        self._lastPost = ts;
        count = 0;
        self.postMessage({ fps, frameTimes: frameTimes.slice() });
      }
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  `;
  // Workers don't have rAF — fall back to rAF mode silently
  fpsSetMode('rAF');
  fpsLoopRaf(performance.now());
}

// ── Stress test rendering ──
let _stressLevel = 0;

function fpsDoStress() {
  // JS CPU stress (sort + math every frame)
  const arr = new Float64Array(800);
  for(let i=0;i<arr.length;i++) arr[i] = Math.random();
  arr.sort();
  let x = 0;
  for(let i=0;i<500;i++) x += Math.sqrt(arr[i]) * Math.sin(i);

  // GPU stress: large full-screen canvas with heavy compositing
  let sc = document.getElementById('fpsStressCanvas');
  if(!sc) {
    sc = document.createElement('canvas');
    sc.id = 'fpsStressCanvas';
    sc.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:9998;opacity:0.05;';
    document.body.appendChild(sc);
  }
  if(sc.width !== window.innerWidth)  sc.width  = window.innerWidth;
  if(sc.height !== window.innerHeight) sc.height = window.innerHeight;
  const W = sc.width, H = sc.height;
  const sctx = sc.getContext('2d');

  _stressLevel = Math.min(_stressLevel + 1, 60);
  const count = 60 + _stressLevel * 2; // ramps from 60 to 180 circles

  sctx.clearRect(0,0,W,H);
  for(let i=0;i<count;i++) {
    const rx = Math.random()*W, ry = Math.random()*H;
    const r  = 60 + Math.random()*180;
    const g  = sctx.createRadialGradient(rx,ry,0,rx,ry,r);
    g.addColorStop(0,`hsla(${(i*17+Date.now()*0.02)%360},90%,65%,0.6)`);
    g.addColorStop(1,'transparent');
    sctx.globalCompositeOperation = i%3===0?'screen':i%3===1?'overlay':'multiply';
    sctx.fillStyle = g;
    sctx.beginPath();
    sctx.arc(rx, ry, r, 0, Math.PI*2);
    sctx.fill();
  }
  sctx.globalCompositeOperation = 'source-over';

  // Shadow blur — extra GPU pressure
  sctx.shadowBlur = 30;
  sctx.shadowColor = '#00f5a0';
  for(let i=0;i<12;i++) {
    sctx.fillStyle = `hsla(${Math.random()*360},80%,60%,0.5)`;
    sctx.fillRect(Math.random()*W, Math.random()*H, 80+Math.random()*120, 4);
  }
  sctx.shadowBlur = 0;
}

// ── Display update ──
function fpsUpdateDisplay() {
  if(!fpsHistory.length) return;
  const cur = fpsCurrentVal;
  const sorted = [...fpsHistory].sort((a,b)=>a-b);
  const min = sorted[0];
  const max = sorted[sorted.length-1];
  const avg = Math.round(fpsHistory.reduce((a,b)=>a+b,0)/fpsHistory.length);
  // 1% low = bottom 1% of frames
  const pct1idx = Math.max(0, Math.floor(sorted.length*0.01));
  const low1pct = sorted[pct1idx];
  const pct01idx = Math.max(0, Math.floor(sorted.length*0.001));
  const low01pct = sorted[pct01idx];
  // Frame time
  const avgFt = fpsFrameTimes.length ? (fpsFrameTimes.reduce((a,b)=>a+b,0)/fpsFrameTimes.length).toFixed(1) : '—';

  const curEl = document.getElementById('fpsCurrent');
  curEl.textContent = cur;
  curEl.style.color = cur>=55?'#22c55e':cur>=30?'#f59e0b':'#ef4444';
  document.getElementById('fpsMin').textContent = min;
  document.getElementById('fpsAvg').textContent = avg;
  document.getElementById('fpsMax').textContent = max;
  document.getElementById('fps1pct').textContent = low1pct;
  const el01 = document.getElementById('fps01pct'); if(el01) el01.textContent = low01pct;
  document.getElementById('fpsFrameTime').textContent = avgFt;

  // Percentyle P50 / P95 / P99 (frame time ms — niżej = lepiej)
  const ftSorted = fpsFrameTimes.length ? [...fpsFrameTimes].sort((a,b)=>a-b) : [];
  const perc = (arr, p) => arr.length ? arr[Math.max(0, Math.floor(arr.length * p) - 1)].toFixed(1) : '—';
  const p50El = document.getElementById('fpsP50'); if(p50El) p50El.textContent = perc(ftSorted, 0.50);
  const p95El = document.getElementById('fpsP95'); if(p95El) p95El.textContent = perc(ftSorted, 0.95);
  const p99El = document.getElementById('fpsP99'); if(p99El) p99El.textContent = perc(ftSorted, 0.99);
  document.getElementById('fpsDropped').textContent = fpsDropped;
  document.getElementById('fpsSpikes').textContent = fpsSpikes;
  document.getElementById('fpsSamples').textContent = fpsHistory.length;

  // Stability
  if(fpsHistory.length > 3) {
    const variance = fpsHistory.reduce((s,v)=>s+Math.pow(v-avg,2),0)/fpsHistory.length;
    const stddev = Math.sqrt(variance);
    const stability = Math.max(0,Math.min(100,Math.round(100-stddev/Math.max(avg,1)*100)));
    document.getElementById('fpsStability').textContent = stability+'%';
    document.getElementById('fpsStabilityBar').style.width = stability+'%';
  }
  if(fpsRunning) fpsUpdateRating();
  fpsDrawHistogram();
  fpsDrawTimeline();
  fpsDrawTiers();
  // VSync — feed current frame time
  if(fpsFrameTimes.length) fpsVsyncSample(fpsFrameTimes[fpsFrameTimes.length-1]);

  // Target FPS progress bar
  const target = window._fpsTarget || 60;
  const abovePct = fpsHistory.length ? Math.round(fpsHistory.filter(v=>v>=target).length/fpsHistory.length*100) : 0;
  const tRow = document.getElementById('fpsTargetRow');
  if(tRow) tRow.style.display = 'block';
  const tPct = document.getElementById('fpsTargetPct');
  const tBar = document.getElementById('fpsTargetBar');
  if(tPct) tPct.textContent = abovePct + '%';
  if(tBar) tBar.style.width = abovePct + '%';

  // Input lag estimator: ½ avg frame time
  const avgFtMs = fpsFrameTimes.length ? fpsFrameTimes.reduce((a,b)=>a+b,0)/fpsFrameTimes.length : 0;
  const inputLagEl = document.getElementById('fpsInputLag');
  if(inputLagEl && avgFtMs > 0) inputLagEl.textContent = (avgFtMs/2).toFixed(1) + ' ms';

  // Smoothness class
  const scEl = document.getElementById('fpsSmoothnessClass');
  if(scEl && fpsHistory.length > 3) {
    const sortedH = [...fpsHistory].sort((a,b)=>a-b);
    const avgH = Math.round(fpsHistory.reduce((a,b)=>a+b,0)/fpsHistory.length);
    const low1 = sortedH[Math.max(0,Math.floor(sortedH.length*0.01))];
    const varH = fpsHistory.reduce((s,v)=>s+Math.pow(v-avgH,2),0)/fpsHistory.length;
    const stab = Math.max(0,Math.min(100,Math.round(100-Math.sqrt(varH)/Math.max(avgH,1)*100)));
    scEl.textContent = fpsSmoothnessClass(avgH, low1, stab);
  }
}

function fpsUpdateRating() {
  if(!fpsHistory.length) return;
  const avg = Math.round(fpsHistory.reduce((a,b)=>a+b,0)/fpsHistory.length);
  const sorted = [...fpsHistory].sort((a,b)=>a-b);
  const low1pct = sorted[Math.max(0,Math.floor(sorted.length*0.01))];
  const hz = fpsMonitorHz || 60;
  const ratingEl = document.getElementById('fpsRating');
  let lines = [];
  if(avg >= hz*0.95)      lines.push(`🏆 Doskonały — ${avg} FPS, pełne wykorzystanie monitora ${hz}Hz`);
  else if(avg >= 60)       lines.push(`✅ Świetny — ${avg} FPS, płynny rendering`);
  else if(avg >= 30)       lines.push(`⚡ Akceptowalny — ${avg} FPS, lekkie chropowatości`);
  else if(avg >= 15)       lines.push(`⚠️ Słaby — ${avg} FPS, widoczne zacinanie`);
  else                     lines.push(`❌ Bardzo słaby — ${avg} FPS, poważne problemy`);
  if(low1pct < avg*0.5)    lines.push(`⚠️ 1% Low (${low1pct} FPS) — duże skoki, prawdopodobnie GC lub inne procesy`);
  if(fpsDropped > 10)      lines.push(`🔴 ${fpsDropped} dropped frames — zauważalne przycięcia`);
  if(fpsSpikes > 3)        lines.push(`⚡ ${fpsSpikes} spike'ów — chwilowe zawiechy powyżej 5× oczekiwanego czasu klatki`);
  ratingEl.innerHTML = lines.join('<br>');
  ratingEl.style.color = avg>=55?'#22c55e':avg>=30?'#f59e0b':'#ef4444';
}

// ── FPS chart ──
function fpsDraw() {
  const canvas = document.getElementById('fpsCanvas');
  if(!canvas) return;
  const w = canvas.offsetWidth || 750;
  if(canvas.width !== w) canvas.width = w;
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle='rgba(0,5,15,0.92)'; ctx.fillRect(0,0,W,H);
  // Reference lines
  const refs = fpsMonitorHz ? [fpsMonitorHz, 60, 30] : [120, 60, 30];
  const maxRef = Math.max(...refs, fpsHistory.length ? Math.max(...fpsHistory) : 120) * 1.1;
  ctx.strokeStyle='rgba(245,158,11,0.06)'; ctx.lineWidth=1;
  refs.forEach(fps => {
    const y = H-(fps/maxRef)*(H-10)-5;
    ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke();
    ctx.fillStyle='rgba(245,158,11,0.2)'; ctx.font='7px Space Mono,monospace';
    ctx.fillText(fps+'fps', 3, y-2);
  });
  if(!fpsHistory.length) {
    ctx.fillStyle='rgba(245,158,11,0.2)'; ctx.font='11px Space Mono,monospace';
    ctx.textAlign='center'; ctx.fillText('czeka na dane...', W/2, H/2+4); ctx.textAlign='left';
    return;
  }
  const pts = fpsHistory.map((v,i)=>({
    x:(i/Math.max(fpsHistory.length-1,1))*W,
    y:H-(v/maxRef)*(H-10)-5
  }));
  // Fill
  const g = ctx.createLinearGradient(0,0,0,H);
  g.addColorStop(0,'rgba(245,158,11,0.3)'); g.addColorStop(1,'rgba(245,158,11,0.02)');
  ctx.beginPath(); ctx.moveTo(pts[0].x,pts[0].y);
  for(let i=1;i<pts.length-1;i++){
    const cx=(pts[i].x+pts[i+1].x)/2, cy=(pts[i].y+pts[i+1].y)/2;
    ctx.quadraticCurveTo(pts[i].x,pts[i].y,cx,cy);
  }
  if(pts.length>1) ctx.lineTo(pts[pts.length-1].x,pts[pts.length-1].y);
  ctx.lineTo(W,H); ctx.lineTo(0,H); ctx.closePath();
  ctx.fillStyle=g; ctx.fill();
  // Line
  ctx.beginPath(); ctx.moveTo(pts[0].x,pts[0].y);
  for(let i=1;i<pts.length-1;i++){
    const cx=(pts[i].x+pts[i+1].x)/2, cy=(pts[i].y+pts[i+1].y)/2;
    ctx.quadraticCurveTo(pts[i].x,pts[i].y,cx,cy);
  }
  if(pts.length>1) ctx.lineTo(pts[pts.length-1].x,pts[pts.length-1].y);
  // Color line by quality
  const cur = fpsCurrentVal;
  ctx.strokeStyle = cur>=55?'#22c55e':cur>=30?'#f59e0b':'#ef4444';
  ctx.lineWidth=2.5; ctx.shadowBlur=10; ctx.shadowColor=ctx.strokeStyle; ctx.stroke(); ctx.shadowBlur=0;
  // Dot
  const lp=pts[pts.length-1];
  ctx.beginPath(); ctx.arc(lp.x,lp.y,5,0,Math.PI*2);
  ctx.fillStyle=ctx.strokeStyle; ctx.shadowBlur=12; ctx.shadowColor=ctx.fillStyle; ctx.fill(); ctx.shadowBlur=0;
  // Label
  ctx.fillStyle=ctx.strokeStyle; ctx.font='bold 14px Space Mono,monospace'; ctx.textAlign='right';
  ctx.shadowBlur=6; ctx.shadowColor=ctx.fillStyle;
  ctx.fillText(fpsCurrentVal+' fps', W-8, 18); ctx.shadowBlur=0;
  ctx.fillStyle='rgba(255,255,255,0.2)'; ctx.font='8px Space Mono,monospace';
  ctx.fillText('max: '+Math.max(...fpsHistory), W-8, 30); ctx.textAlign='left';
}

// ── Frame time histogram ──
function fpsDrawFrameTime() {
  const canvas = document.getElementById('fpsFrameCanvas');
  if(!canvas) return;
  const w = canvas.offsetWidth || 750;
  if(canvas.width !== w) canvas.width = w;
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle='rgba(0,5,15,0.85)'; ctx.fillRect(0,0,W,H);
  // Title
  ctx.fillStyle='rgba(167,139,250,0.4)'; ctx.font='7px Space Mono,monospace';
  ctx.fillText('FRAME TIME (ms)', 3, 9);
  if(!fpsFrameTimes.length) return;
  const maxFt = Math.max(...fpsFrameTimes, 33.3);
  const pts = fpsFrameTimes.slice(-Math.min(fpsFrameTimes.length, W)).map((v,i,arr)=>({
    x:(i/Math.max(arr.length-1,1))*W,
    y:H-(v/maxFt)*(H-12)-6
  }));
  ctx.strokeStyle='rgba(167,139,250,0.6)'; ctx.lineWidth=1.5;
  ctx.beginPath(); ctx.moveTo(pts[0].x,pts[0].y);
  for(let i=1;i<pts.length;i++) ctx.lineTo(pts[i].x,pts[i].y);
  ctx.stroke();
  // Expected frame time line
  const expected = fpsMonitorHz > 0 ? 1000/fpsMonitorHz : 16.67;
  const ey = H-(expected/maxFt)*(H-12)-6;
  ctx.strokeStyle='rgba(34,197,94,0.3)'; ctx.lineWidth=1; ctx.setLineDash([4,4]);
  ctx.beginPath(); ctx.moveTo(0,ey); ctx.lineTo(W,ey); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle='rgba(34,197,94,0.3)'; ctx.font='7px Space Mono,monospace';
  ctx.textAlign='right'; ctx.fillText(expected.toFixed(1)+'ms target', W-3, ey-2); ctx.textAlign='left';
}


// ── Target FPS selector ──
window._fpsTarget = 60;
window._fpsTargetLabel = '60 fps';
function fpsSetTarget(val, btn) {
  window._fpsTarget = val;
  window._fpsTargetLabel = val + ' fps';
  document.querySelectorAll('.fps-target-btn').forEach(b => {
    b.style.borderColor = 'rgba(255,255,255,0.1)';
    b.style.background = 'transparent';
    b.style.color = 'rgba(255,255,255,0.3)';
  });
  if(btn) {
    btn.style.borderColor = 'rgba(34,197,94,0.5)';
    btn.style.background = 'rgba(34,197,94,0.12)';
    btn.style.color = '#22c55e';
  }
  document.getElementById('fpsTargetLbl').textContent = val + ' fps';
  document.getElementById('fpsTargetRow').style.display = 'block';
  if(fpsHistory.length) fpsUpdateDisplay();
}

// ── Smoothness class ──
function fpsSmoothnessClass(avg, low1pct, stability) {
  if(avg >= 120 && low1pct >= 90 && stability >= 85) return '🏆 Ultra Smooth';
  if(avg >= 90  && low1pct >= 60 && stability >= 75) return '✅ Very Smooth';
  if(avg >= 60  && low1pct >= 45 && stability >= 65) return '⚡ Smooth';
  if(avg >= 45  && stability >= 50) return '🟡 Mostly Smooth';
  if(avg >= 30)  return '🟠 Choppy';
  return '🔴 Very Choppy';
}

// ── VSync Detection ──
let _vsyncSamples = [];
let _vsyncDetected = false;

function fpsVsyncSample(ft) {
  if(_vsyncDetected) return;
  _vsyncSamples.push(ft);
  if(_vsyncSamples.length < 30) return;

  // Analyze frame time distribution
  // VSync = frames cluster tightly around 1/Hz (e.g. 16.67ms for 60Hz)
  const hz = fpsMonitorHz || 60;
  const target = 1000 / hz;
  const tolerance = target * 0.08; // 8% tolerance

  const near = _vsyncSamples.filter(t => Math.abs(t - target) < tolerance);
  const nearPct = near.length / _vsyncSamples.length;

  // Also check for double-frame pattern (30fps locked = vsync/2)
  const target2 = target * 2;
  const near2 = _vsyncSamples.filter(t => Math.abs(t - target2) < tolerance * 2);
  const near2Pct = near2.length / _vsyncSamples.length;

  const vsEl = document.getElementById('fpsVsyncStatus');
  if(!vsEl) return;

  if(nearPct > 0.65) {
    vsEl.innerHTML = `<span style="color:#22c55e;">✅ VSync ON</span><br><span style="font-size:8px;">Zsynchronizowany z monitorem (${hz}Hz)</span>`;
    _vsyncDetected = true;
  } else if(near2Pct > 0.5) {
    vsEl.innerHTML = `<span style="color:#f59e0b;">⚠️ VSync ON / 30fps cap</span><br><span style="font-size:8px;">Zablokowany na połowie Hz (${Math.round(hz/2)}fps)</span>`;
    _vsyncDetected = true;
  } else {
    // High variance = uncapped / no vsync
    const mean = _vsyncSamples.reduce((a,b)=>a+b,0) / _vsyncSamples.length;
    const stdev = Math.sqrt(_vsyncSamples.reduce((s,v)=>s+Math.pow(v-mean,2),0)/_vsyncSamples.length);
    const cv = stdev / mean; // coefficient of variation
    if(cv < 0.05) {
      vsEl.innerHTML = `<span style="color:#22c55e;">✅ VSync ON</span><br><span style="font-size:8px;">Bardzo regularne klatki (CV=${(cv*100).toFixed(1)}%)</span>`;
    } else if(cv < 0.15) {
      vsEl.innerHTML = `<span style="color:#f59e0b;">⚡ Prawdopodobnie ON</span><br><span style="font-size:8px;">Małe odchylenia (CV=${(cv*100).toFixed(1)}%)</span>`;
    } else {
      vsEl.innerHTML = `<span style="color:#ef4444;">❌ VSync OFF / uncapped</span><br><span style="font-size:8px;">Nieregularne klatki (CV=${(cv*100).toFixed(1)}%)</span>`;
      _vsyncDetected = true;
    }
  }
  if(_vsyncSamples.length >= 60) _vsyncDetected = true;
}

// ── CSV Export ──
function fpsExportCsv() {
  if(!fpsFrameTimes || fpsFrameTimes.length === 0) {
    toast(t('toast_no_fps_data'), 'warn'); return;
  }
  const hz = fpsMonitorHz || 60;
  const rows = ['frame_index,frame_time_ms,fps_instant,above_target'];
  fpsFrameTimes.forEach((ft, i) => {
    const fps = ft > 0 ? (1000 / ft).toFixed(1) : 0;
    const above = parseFloat(fps) >= (window._fpsTarget || 60) ? 1 : 0;
    rows.push(`${i+1},${ft.toFixed(3)},${fps},${above}`);
  });

  // Summary at bottom
  const sorted = [...fpsFrameTimes].sort((a,b)=>a-b);
  const avg = fpsFrameTimes.reduce((a,b)=>a+b,0)/fpsFrameTimes.length;
  rows.push('');
  rows.push(`# Monitor Hz,${hz}`);
  rows.push(`# Samples,${fpsFrameTimes.length}`);
  rows.push(`# Avg frame time ms,${avg.toFixed(2)}`);
  rows.push(`# P50 ms,${sorted[Math.floor(sorted.length*0.50)].toFixed(2)}`);
  rows.push(`# P95 ms,${sorted[Math.floor(sorted.length*0.95)].toFixed(2)}`);
  rows.push(`# P99 ms,${sorted[Math.floor(sorted.length*0.99)].toFixed(2)}`);
  rows.push(`# 1% Low FPS,${sorted[Math.max(0,Math.floor(sorted.length*0.01))]}`);

  const csv = rows.join('\n');
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `fps_data_${Date.now()}.csv`;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast(t('toast_fps_csv_downloaded'), 'success');
}

// ── 60-second FPS Timeline ──
function fpsDrawTimeline() {
  const canvas = document.getElementById('fpsTimeline');
  if (!canvas || !fpsHistory.length) return;
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.offsetWidth; const H = 70;
  canvas.width = W*dpr; canvas.height = H*dpr;
  const ctx = canvas.getContext('2d'); ctx.scale(dpr,dpr);
  ctx.fillStyle='rgba(0,5,15,0.7)'; ctx.fillRect(0,0,W,H);
  const data=fpsHistory, sorted=[...data].sort((a,b)=>a-b);
  const avg=data.reduce((a,b)=>a+b,0)/data.length;
  const low1=sorted[Math.max(0,Math.floor(sorted.length*0.01))];
  const low01=sorted[Math.max(0,Math.floor(sorted.length*0.001))];
  const PAD_TOP=12,PAD_BOT=4,PAD_X=4,chartH=H-PAD_TOP-PAD_BOT;
  const maxFps=Math.max(...data,(window._fpsTarget||60)*1.2,fpsMonitorHz||60);
  const barW=(W-PAD_X*2)/120, offsetX=120-data.length;
  const yFor=fps=>PAD_TOP+chartH*(1-Math.min(fps,maxFps)/maxFps);
  // Grid
  [30,60,window._fpsTarget,fpsMonitorHz].filter(v=>v&&v>0).forEach(v=>{
    const y=yFor(v); if(y<PAD_TOP||y>H-PAD_BOT) return;
    ctx.beginPath(); ctx.strokeStyle='rgba(255,255,255,0.06)'; ctx.setLineDash([3,4]); ctx.lineWidth=1;
    ctx.moveTo(PAD_X,y); ctx.lineTo(W-PAD_X,y); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle='rgba(255,255,255,0.18)'; ctx.font='6px monospace'; ctx.textAlign='right';
    ctx.fillText(v,PAD_X+26,y-2);
  });
  // Bars
  data.forEach((fps,i)=>{
    const x=PAD_X+(offsetX+i)*barW, y=yFor(fps), bH=H-PAD_BOT-y;
    let color=fps>=(fpsMonitorHz||60)*0.95?'#22c55e':fps>=60?'#84cc16':fps>=45?'#f59e0b':fps>=30?'#f97316':'#ef4444';
    ctx.globalAlpha=i===data.length-1?1:0.75;
    ctx.fillStyle=color; ctx.fillRect(x+0.5,y,Math.max(barW-1,1),bH);
    ctx.globalAlpha=1;
  });
  // AVG line
  {const y=yFor(avg); ctx.beginPath(); ctx.strokeStyle='rgba(245,158,11,0.6)'; ctx.lineWidth=1.5; ctx.setLineDash([4,3]);
   ctx.moveTo(PAD_X,y); ctx.lineTo(W-PAD_X,y); ctx.stroke(); ctx.setLineDash([]);
   ctx.fillStyle='#f59e0b'; ctx.font='6px monospace'; ctx.textAlign='left';
   ctx.fillText('avg '+Math.round(avg),PAD_X+2,y-2);}
  // 1% Low
  {const y=yFor(low1); ctx.beginPath(); ctx.strokeStyle='rgba(167,139,250,0.55)'; ctx.lineWidth=1; ctx.setLineDash([3,4]);
   ctx.moveTo(PAD_X,y); ctx.lineTo(W-PAD_X,y); ctx.stroke(); ctx.setLineDash([]);
   ctx.fillStyle='#a78bfa'; ctx.font='6px monospace'; ctx.textAlign='right';
   ctx.fillText('1% '+low1,W-PAD_X-2,y-2);}
  // 0.1% Low
  if(data.length>=10){
    const y=yFor(low01); ctx.beginPath(); ctx.strokeStyle='rgba(236,72,153,0.5)'; ctx.lineWidth=1; ctx.setLineDash([2,5]);
    ctx.moveTo(PAD_X,y); ctx.lineTo(W-PAD_X,y); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle='#ec4899'; ctx.font='6px monospace'; ctx.textAlign='right';
    ctx.fillText('0.1% '+low01,W-PAD_X-2,y+8);}
  const rangeEl=document.getElementById('fpsTimelineRange');
  if(rangeEl) rangeEl.textContent=(data.length*FPS_SAMPLE_MS/1000).toFixed(0)+'s / 60s';
}

// ── FPS Distribution Histogram ──
function fpsDrawHistogram() {
  const el = document.getElementById('fpsHistogram');
  if (!el || !fpsHistory.length) return;

  // Buckets: <15, 15-29, 30-44, 45-59, 60-89, 90-119, 120-143, 144+
  const buckets = [
    { label:'<15',  min:0,   max:15,  color:'#ef4444' },
    { label:'15-29',min:15,  max:30,  color:'#f97316' },
    { label:'30-44',min:30,  max:45,  color:'#f59e0b' },
    { label:'45-59',min:45,  max:60,  color:'#eab308' },
    { label:'60-89',min:60,  max:90,  color:'#84cc16' },
    { label:'90-119',min:90, max:120, color:'#22c55e' },
    { label:'120-143',min:120,max:144,color:'#00b4d8' },
    { label:'144+', min:144, max:Infinity, color:'#a78bfa' },
  ];

  const counts = buckets.map(b => fpsHistory.filter(v => v >= b.min && v < b.max).length);
  const total = fpsHistory.length;
  const maxCount = Math.max(...counts, 1);

  el.innerHTML = '';
  buckets.forEach((b, i) => {
    const pct = total ? Math.round(counts[i] / total * 100) : 0;
    const heightPct = Math.round(counts[i] / maxCount * 100);
    const col = document.createElement('div');
    col.style.cssText = `flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;justify-content:flex-end;height:100%;`;
    col.innerHTML = `
      <span style="font-family:'Space Mono',monospace;font-size:6px;color:${pct>0?b.color:'rgba(255,255,255,0.15)'};">${pct>0?pct+'%':''}</span>
      <div style="width:100%;height:${Math.max(heightPct,pct>0?4:0)}%;background:${counts[i]>0?b.color:'rgba(255,255,255,0.06)'};border-radius:3px 3px 0 0;transition:height 0.4s ease;min-height:${pct>0?'4px':'2px'};box-shadow:${counts[i]>0?'0 0 6px '+b.color+'44':''};"></div>
    `;
    el.appendChild(col);
  });
}

// ── FPS Tier Badges ──
function fpsDrawTiers() {
  const el = document.getElementById('fpsTierRow');
  if (!el || !fpsHistory.length) return;
  const avg = Math.round(fpsHistory.reduce((a,b)=>a+b,0)/fpsHistory.length);

  const tiers = [
    { label:'Prezentacje', fps:24, icon:'📽️' },
    { label:'Gry konsolowe', fps:30, icon:'🎮' },
    { label:'Esport minimum', fps:60, icon:'⚡' },
    { label:'Płynny gaming', fps:90, icon:'🏃' },
    { label:'Competitive', fps:120, icon:'🎯' },
    { label:'Pro level', fps:144, icon:'🏆' },
    { label:'Overkill', fps:240, icon:'🚀' },
  ];

  el.innerHTML = '';
  tiers.forEach(t => {
    const pass = avg >= t.fps;
    const badge = document.createElement('div');
    badge.style.cssText = `padding:5px 10px;border-radius:8px;border:1px solid ${pass?'rgba(34,197,94,0.4)':'rgba(255,255,255,0.07)'};background:${pass?'rgba(34,197,94,0.08)':'rgba(255,255,255,0.02)'};font-family:'Space Mono',monospace;font-size:8px;color:${pass?'#22c55e':'rgba(255,255,255,0.2)'};display:flex;align-items:center;gap:5px;transition:all 0.3s;`;
    badge.innerHTML = `${t.icon} <span>${t.fps}+ fps</span> <span style="font-size:7px;opacity:0.7;">${t.label}</span> ${pass?'✓':''}`;
    el.appendChild(badge);
  });
}

function aiBotNormalize(text) {
  return text.toLowerCase()
    .replace(/ą/g,'a').replace(/ć/g,'c').replace(/ę/g,'e')
    .replace(/ł/g,'l').replace(/ń/g,'n').replace(/ó/g,'o')
    .replace(/ś/g,'s').replace(/ź/g,'z').replace(/ż/g,'z')
    .replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
}
function m(q, keywords) {
  const qn = aiBotNormalize(q);
  return keywords.some(k => {
    const kn = aiBotNormalize(k);
    if(qn.includes(kn)) return true;
    const words = kn.split(' ').filter(w => w.length > 3);
    if(words.length >= 2) return words.every(w => qn.includes(w));
    return false;
  });
}
function rnd(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function aiBotDetectLang(q) {
  const cyrillic  = (q.match(/[а-яёА-ЯЁ]/g) || []).length;
  const ukrainian = (q.match(/[іїєґІЇЄҐ]/g) || []).length;
  const total     = q.replace(/\s/g,'').length;
  const hasKanji  = /[\u3040-\u30ff\u4e00-\u9fff]/.test(q);
  const hasHangul = /[\uac00-\ud7af\u1100-\u11ff]/.test(q);
  const hasChinese = /[\u4e00-\u9fff]/.test(q) && !hasKanji;
  // Ukrainian: detect by unique chars OR by common Ukrainian words
  // Note: \b doesn't work with Cyrillic in JS, use simple includes check
  const uaKeywords = ['що','як','хто','де','для','чому','коли','застосунок',
    'мікрофон','камера','мережа','функції','модулі','версія','посилання',
    'мова','телефон','жарт','реакція','завантажити','безкоштовно',
    'приватність','привіт','вітаю','дякую','бувай','допоможи',
    'що таке','що робить','хто створив','як справи','де ти',
    'яка версія','які функції','що вміє','чому','скільки'];
  const ql2 = q.toLowerCase();
  const isUa = ukrainian > 0 || (cyrillic > 0 && uaKeywords.some(k => ql2.includes(k)));
  if(isUa) return 'ua';
  if(cyrillic > 0 && cyrillic / total > 0.4) return 'ru';
  if(hasHangul) return 'ko';
  if(hasKanji) return 'ja';
  const ql = q.toLowerCase();
  if(/\b(hallo|danke|bitte|guten|ich |sie |wir |das |und |oder |nicht |kann |wie |was |wer |wo |warum |wenn )/.test(ql)) return 'de';
  if(/\b(bonjour|salut|merci|comment|c'est|je |tu |il |nous |vous |les |des |une |oui |non |dans |avec |pour |très )/.test(ql)) return 'fr';
  if(/\b(hola|gracias|buenos|cómo|qué |por |con |para |una |los |las |muy |también|sí |no |hay )/.test(ql)) return 'es';
  if(/\b(ciao|grazie|buon|come |cosa |per |con |del |della|sono |hai |non |molto|anche|sì |no )/.test(ql)) return 'it';
  if(/[\u4e00-\u9fff]/.test(q)) return 'zh';
  if(/\b(hallo|dank|goed|wat |wie |waar|niet |ook |maar |voor |met |een |dit |dat |deze|hebben)/.test(ql)) return 'nl';
  if(/\b(olá|obrigado|como |que |por |com |para |uma |não |sim |bem |também|está|esse|esse)/.test(ql)) return 'pt';
  const enWords = /^(hello|hi|hey|what|who|how|why|when|where|is|are|does|do|can|tell|show|the|this|that|i |my |your |please|thanks|great|good|help|about|with|and|for|yes|no)\b/i;
  const enScore = (q.match(/\b(what|who|how|does|tell|about|the app|studiotest|voice|camera|chroma|microphone|reaction|keyboard|mouse|speaker|network|dns|version|feature|create|made|built)\b/gi) || []).length;
  if(enScore >= 1 || enWords.test(q.trim())) return 'en';
  return 'pl';
}
function aiBotGetReplyEn(q, ctx, history) {
  if(!ctx) ctx = aiBotCtx;
  const qn = q.toLowerCase().replace(/[^a-z0-9 ]/g,' ');

  const en_m = (keywords) => keywords.some(k => qn.includes(k));

  // Name detection
  const nameM = q.match(/(?:my name is|i am|i'm|call me|i go by)\s+([a-zA-Z]{2,20})/i);
  if(nameM && !['the','not','sure','just','also','good','fine','well','here','cool','doing','going'].includes(nameM[1].toLowerCase())) {
    ctx.userName = nameM[1].charAt(0).toUpperCase() + nameM[1].slice(1);
    return rnd([`Nice to meet you, **${ctx.userName}**! 😊 Ask me anything about StudioTest!`,`Hey **${ctx.userName}**! 🤖 Great to have you here. What can I help you with?`,`Hi **${ctx.userName}**! 👋 I'm the StudioTest AI Assistant. What would you like to know?`]);
  }

  // Greetings
  if(en_m(['hello','hi ','hey ','hiya','howdy','yo ','sup ','good morning','good evening'])) {
    const n = ctx.userName ? `, ${ctx.userName}` : '';
    return rnd([`Hello${n}! 👋 I'm the **StudioTest** AI Assistant. Ask me anything about the app!`,`Hey${n}! 😊 Ready to chat! What do you want to know?`,`Hi${n}! 🤖 I know everything about StudioTest — ask away!`]);
  }
  if(en_m(['how are you','how r you','whats up','what\'s up','how\'s it going'])) return rnd(["I'm doing great! 🤖 Ready for your questions. How about you?","All good! ⚡ What can I help you with?"]);

  // Creator
  if(en_m(['who made','who created','who built','who is the creator','who developed','author','developer'])) { ctx.lastTopic='creator'; return '👨‍💻 **StudioTest** was created by **REV01** using **Claude Opus** (by Anthropic). A unique human+AI project — one HTML file, 20,000+ lines of code, zero backend, zero frameworks!'; };
  // What is / About
  if(en_m(['what is studiotest','what does studiotest','about studiotest','what is this app','what does this app'])) return '🎬 **StudioTest** is a web app for testing hardware and software directly in your browser — camera, microphone, internet speed, reaction time, keyboard, mouse, speakers and more. All in one HTML file, no installation needed!';

  // Features
  if(en_m(['what features','what modules','what can it do','list of features','all features','what does it have'])) return '📋 **18 modules in StudioTest:**\n1.📷 Camera + filters + 20+ effects\n2.🎙️ Microphone + FFT spectrum\n3.🎵 Voice changer (28 presets)\n4.🌐 Internet speed test\n5.⚡ Reaction time test\n6.🖱️ Mouse test\n7.🎹 Keyboard test\n8.🔊 Speaker test\n9.📊 Performance monitor\n10.ℹ️ System info\n11.🎨 Chroma Key\n12.📡 Network Scanner\n13.🔍 DNS Lookup\n14.🤖 AI Assistant (me!)\n15.📊 Session report';

  // Camera
  if(en_m(['camera','webcam','video recording','snapshot','take photo','css filters','special effects','special fx'])) { ctx.lastTopic='camera'; return '📷 **Camera module:**\n- Live preview\n- **CSS filters**: brightness, contrast, saturation, hue, blur\n- **20+ effects**: RGB Split, CRT, Hologram, Neon Glow, Confetti, Lightning, Old Film and more\n- **Record video** (WebM/MP4)\n- **Snapshot** → PNG with active filter\n\nClick 📷 Camera ON → allow permissions.'; };
  // Microphone
  if(en_m(['microphone','mic test','sound analyzer','spectrum','decibel','fft','snr','audio monitor'])) { ctx.lastTopic='mic'; return '🎙️ **Microphone module:**\n- **Oscilloscope** — waveform in real time\n- **FFT Spectrum** — frequency visualization\n- **dB level** meter\n- **SNR** — signal to noise ratio\n- **Dominant frequency** detection\n- **Voice monitor** — hear yourself live\n- **Noise reduction** + **noise gate**'; };
  // Voice changer
  if(en_m(['voice changer','voice effect','voice preset','robot voice','demon voice','alien voice','pitch','reverb preset','voice filter'])) { ctx.lastTopic='voice'; return '🎵 **Voice Changer** — 28 presets:\nRobot, Deep, Chipmunk, Echo, Phone, Alien, Cave, Whisper, Megaphone, Underwater, Stadium, Demon, Helium, Radio FM, Vintage, Darth🌑, Giant, Ghost, Choir, Troll, Mouse, Horror, Angel, Walkie, Sonar, Drunk, Monster, Cartoon, Grotto, CB Radio, Bathroom, Cyborg, Baby, Satan😈, Space, Kazoo, Hall\n\n**Sliders**: Pitch, Speed, Bass, Mid, Treble, Reverb, Chorus, Distortion, Volume\n**Download** your voice as WAV with all effects!'; };
  // Internet test
  if(en_m(['internet test','speed test','internet speed','ping','download speed','upload speed','wifi speed','network speed'])) { ctx.lastTopic='internet'; return '🌐 **Internet Speed Test:**\n- **Ping** (10s) — latency in ms, lower is better\n- **Download** (25s) — Mb/s, important for streaming and gaming\n- **Upload** (25s) — Mb/s, important for video calls and Twitch\n- **Rating** — from ❌ Poor to 🏆 Excellent\n- **IP geolocation** — city, country, ISP + Leaflet map\n\nClick ▶ START to begin.'; };
  // Reaction test
  if(en_m(['reaction test','reaction time','reflex test','how fast','response time','click test'])) { ctx.lastTopic='reaction'; return '⚡ **Reaction Test** — 3 modes:\n- 🖱️ **Click** — click when the screen turns green\n- ⌨️ **Space** — press spacebar\n- 🎲 **Choice** — arrow ← or →, press the right one\n\nPrecision: **0.1ms**. Results <80ms rejected (false start).\nShows: last, best, average, histogram, streak, ranking 🏆\n\nAverage human: 150–250ms. Pro gamers: ~180ms.'; };
  // Mouse test
  if(en_m(['mouse test','click test','cps','heatmap','aim trainer','mouse button','cursor'])) { ctx.lastTopic='mouse'; return '🖱️ **Mouse Test** — 3 tabs:\n- 🕹️ **Move** — cursor trail, CPS, jitter, distance\n- 🔥 **Heatmap** — where you click most often\n- 🎯 **Aim Trainer** — random targets, measures accuracy %\n\n+ Button test with visual SVG mouse (LMB, RMB, middle, side B4/B5, scroll)'; };
  // Keyboard test
  if(en_m(['keyboard test','key delay','key press','input lag','keyboard latency'])) { ctx.lastTopic='keyboard'; return '🎹 **Keyboard Test:**\n- Visual keyboard with key highlights\n- **Delay** — measures ms from press to register (input lag)\n- **Sound** on keypress (toggle)\n- Key press history\n\nClick START then type anything.'; };
  // Speaker test
  if(en_m(['speaker test','audio test','left right channel','frequency sweep','hearing test','tone generator'])) { ctx.lastTopic='speakers'; return '🔊 **Speaker Test:**\n- **L/R channels** — test left and right separately\n- **Both channels** together\n- **Frequency sweep** — 20Hz to 20kHz\n- **Tone generator** — custom Hz\n- **Hearing test** — find your audible range (declines with age!)'; };
  // Chroma key
  if(en_m(['chroma key','green screen','blue screen','background removal','virtual background'])) { ctx.lastTopic='chroma'; return '🎨 **Chroma Key** — removes camera background in real time:\n1. Enable camera\n2. Select key color (click on image or use presets)\n3. **Tolerance** — how much color to remove\n4. **Smoothing** — soft edges\n5. **Spill** — removes color reflections from hair\n\nBackground: None / Color / Image / Blur\nEffects: Mirror, Grayscale, Invert, Pixelate\nRecord output as .webm!'; };
  // DNS
  if(en_m(['dns lookup','dns record','domain lookup','what is dns','mx record','ns record','reverse dns'])) { ctx.lastTopic='dns'; return '🔍 **DNS Lookup** — checks domain records:\n- **A** — IPv4 address\n- **AAAA** — IPv6\n- **MX** — mail servers\n- **NS** — name servers\n- **TXT** — SPF, DKIM, verification\n- **CNAME** — aliases\n\nEnter domain (e.g. `google.com`) or IP (reverse lookup).\n+ Server geolocation + CDN detection (Cloudflare, AWS, Vercel...)'; };
  // Official link
  if(en_m(['official link','app link','website link','app url','open app','where is the app','netlify link'])) return '🌐 **Official StudioTest link:**\n\n👉 **https://charming-concha-550970.netlify.app/**\n\nHosted on Netlify (HTTPS) — all features work! 🚀';

  // Version / Tech
  if(en_m(['version','current version','v7','latest version'])) return '📦 Current version: **v7.8**. Visible in the app header next to the logo.';
  if(en_m(['technology','how is it made','framework','html','javascript','one file','tech stack'])) return '⚙️ **Pure HTML+CSS+JS** — one file, ~677KB, 16,000+ lines, zero frameworks.\nUses: WebRTC, WebAudio, MediaRecorder, Canvas, Leaflet.js, Google DoH, ip-api.com';

  // AI / Bot
  if(en_m(['what are you','who are you','your name','ai assistant','how do you work','are you ai'])) return `🤖 I'm the **StudioTest AI Assistant** — a local bot built directly into the app. No API, no internet needed. I know all 18 modules, remember context${ctx.lastTopic?' (last topic: **'+ctx.lastTopic+'**)':''} and your name${ctx.userName?' (**'+ctx.userName+'**)':' (tell me your name!)'}.`;

  // Claude
  if(en_m(['claude opus','claude ai','what is claude','anthropic'])) return '🧠 **Claude Opus** is an advanced AI model by **Anthropic**. REV01 used it to build StudioTest — the entire app was created through human+AI dialogue. One of the most powerful AI models available!';

  // Performance
  if(en_m(['performance','fps monitor','cpu usage','battery','memory usage','benchmark'])) return '📊 **Performance Monitor:**\n- **FPS** — frames per second (60fps = smooth)\n- **JS Heap** — JavaScript memory usage\n- **Long tasks** — operations >50ms blocking the UI\n- **Battery** — % and charging status\n- **CPU threads** — logical processor count\n- **Monte Carlo benchmark** — JS engine speed test';

  // System info
  if(en_m(['system info','browser info','screen resolution','gpu','device info','os info'])) return 'ℹ️ **System Info:** browser + version, OS, resolution + DPI, CPU threads, RAM, GPU, touch support, language, timezone.';

  // Languages
  if(en_m(['languages','how many languages','translation','multilingual'])) return '🌍 **13 languages:** 🇵🇱 Polish · 🇬🇧 English · 🇩🇪 German · 🇷🇺 Russian · 🇨🇳 Chinese · 🇫🇷 French · 🇪🇸 Spanish · 🇮🇹 Italian · 🇯🇵 Japanese · 🇰🇷 Korean · 🇳🇱 Dutch · 🇵🇹 Portuguese · 🇺🇦 Ukrainian\n\nChange language by clicking the flag in the header.';

  // Jokes
  if(en_m(['tell me a joke','joke','make me laugh','funny'])) return rnd(["Why do programmers prefer dark mode? Because **light attracts bugs**! 🐛","A QA engineer walks into a bar and orders: 0, 1, -1, 99999, NULL, and 🍺. 😂","My code was working perfectly... until I showed it to my boss. 💀","There are 10 types of people: those who understand binary and those who **don't**. 😂","Why did the programmer quit? They didn't get **arrays**! 👀","Git commit: 'misc fixes'. What does that mean? No idea. It works. **Don't touch it.** 🔥","A SQL query walks into a bar and asks two tables: 'Can I **JOIN** you?' 🍺"]);

  // Thanks / Bye
  if(en_m(['thank you','thanks','thx','great','awesome','amazing','love it','perfect'])) { const n=ctx.userName?' '+ctx.userName:''; return rnd([`You're welcome${n}! 😊`,`Glad I could help${n}! 🤖`,'Anytime! 👍 Ask me anything!']); }
  if(en_m(['bye','goodbye','see you','later','cya'])) { const n=ctx.userName?' '+ctx.userName:''; return rnd([`Bye${n}! 👋 Come back anytime!`,`See you${n}! 😊 Happy testing!`]); }

  // Free / Price
  if(en_m(['free','cost','price','paid','subscription'])) return '💸 **100% free!** No fees, no subscriptions, no ads.';

  // Privacy
  if(en_m(['privacy','data','tracking','send data','safe'])) return '🔒 StudioTest collects **zero data**. Everything runs locally in your browser. No video/audio is sent to any server. No ads. ✅';

  // Fallback
  if(en_m(['where are you','where do you live','where are you from','your location','what country','what city'])) return "🌐 I live in code! Specifically inside `studio-test.html`, somewhere between line 8000 and 9000 😄 No physical address, but full access to all StudioTest features!";
  if(en_m(['what can you do','your abilities','what do you know','what are you capable'])) return '🤖 **What I can do:**\n- Answer questions about StudioTest (18 modules)\n- Chat in Polish, English and Russian\n- Tell jokes 😄\n- Remember your name and conversation context\n- Read answers aloud (TTS)\n- Provide the official app link\n\nCannot: browse internet, show images, remember between sessions.';
  if(en_m(['are you real','are you ai','are you a bot','real ai'])) return "🤖 I'm a **local bot** — a JS script coded directly into the HTML file. Real AI like Claude Opus helped create me alongside REV01. I work fully offline, no API needed!";

if(en_m(['tell me something interesting','fun fact','something cool','interesting fact'])) return rnd(["🤓 Fun fact: studio-test.html weighs over 1.2MB — that's like 500+ pages of text in one file!","🎙️ The voice changer uses Web Audio API — same tech as professional DAWs!","⚡ The fastest human reaction time ever recorded is around 100ms — test yours in the reaction test!","🎨 Chroma Key processes every video frame through Canvas API in real time!"]);
  if(en_m(['tell me about yourself','introduce yourself','your name','what are you called'])) return "🤖 I'm the **StudioTest AI Assistant** — a local bot built by **REV01** with help from **Claude Opus**. I work 100% offline, know all 15 app modules and speak Polish, English and Russian! No name yet — you can give me one 😄";
  if(en_m(['i am bored','nothing to do','suggest something','what should i do'])) return "😊 Here are some ideas!\n🎯 Play the **Aim Trainer** (mouse test)\n⚡ Beat your record in the **Reaction Test**\n🎵 Try the **Voice Changer** — 28 presets!\n🎨 Remove your camera background with **Chroma Key**\n📊 Check your speed in the **Internet Test**";
  if(en_m(['what is your goal','why do you exist','your mission','why are you here'])) return "🎯 My mission: help you get the most out of StudioTest! I answer questions, explain features, tell jokes and generally try to be useful so you don't have to search for documentation 😊";
  if(en_m(['what is html','what is javascript','what is css','how is it made','vanilla js'])) return '💻 **HTML** = structure, **CSS** = styling, **JavaScript** = logic & interactivity. StudioTest is 100% HTML+CSS+JS — ~20,000 lines in a single file. No frameworks like React or Vue — pure vanilla JS!';
  if(en_m(['is it open source','source code','download the app','save the file'])) return '📂 Yes! StudioTest is one HTML file — you can save it and run it locally. Right-click → Save As... on the Netlify page. All 20,000+ lines are visible. Works offline too!';
  if(en_m(['does it work offline','without internet','no wifi','no connection'])) return '📶 **Yes!** After downloading studio-test.html you can run it locally without internet. Most features work offline:\n✅ Camera, mic, voice, keyboard, mouse, speakers, performance, chroma key\n⚠️ Require internet: speed test, DNS Lookup, Network Scanner, IP geolocation';
  if(en_m(['who is rev01','about rev01','creator info'])) return '👨‍💻 **REV01** is the creator of StudioTest — a developer who built this app in collaboration with **Claude Opus** (AI by Anthropic). A unique project: human + AI creating a testing tool in a single HTML file!';
  if(en_m(['better than','compare','similar apps','other tools'])) return '🏆 StudioTest stands out because:\n- Runs in browser without installation\n- Everything in one file\n- Chroma Key, AI bot and 28 voice presets\n- Free and ad-free\n- Works offline after download\n\nSimilar tools: webcamtests.com, speedtest.net — but none combine so many features!';
  if(en_m(['how does keyboard test work','keyboard latency','input lag keyboard'])) return '⌨️ **Keyboard test** measures:\n- Which keys work (visual keyboard highlights)\n- **Input lag** — time from press to register (ms)\n- **KPM** (keystrokes per minute)\n- Key click sounds — 30+ profiles (Click, Thock, Clack, Piano, Retro...)\n\nTry to test all 105 keys!';

  if(en_m(['tell me something interesting','fun fact','something cool','interesting fact'])) return rnd(["🤓 Fun fact: studio-test.html weighs over 1.2MB — that's like 500+ pages of text in one file!","🎙️ The voice changer uses Web Audio API — same tech as professional DAWs!","⚡ The fastest human reaction time ever recorded is around 100ms — test yours!","🎨 Chroma Key processes every video frame through Canvas API in real time!"]);
  if(en_m(['tell me about yourself','introduce yourself','your name','what are you called'])) return "🤖 I'm the **StudioTest AI Assistant** — a local bot built by **REV01** with Claude Opus. I work 100% offline, know all 18 modules and speak Polish, English and Russian!";
  if(en_m(['i am bored','nothing to do','suggest something','what should i do'])) return "😊 Some ideas!\n🎯 **Aim Trainer** (mouse test)\n⚡ Beat your record in **Reaction Test**\n🎵 **Voice Changer** — 28 presets!\n🎨 **Chroma Key**\n📊 **Internet Speed Test**";
  if(en_m(['what is html','what is javascript','what is css','vanilla js','built with','made with'])) return '💻 **HTML** = structure, **CSS** = styling, **JavaScript** = logic. StudioTest is 100% HTML+CSS+JS — ~20,000 lines in a single file. No frameworks — pure vanilla JS!';
  if(en_m(['is it open source','source code','download the app','save the file'])) return '📂 Yes! StudioTest is one HTML file — save it and run locally. Right-click → Save As... All 16,000+ lines visible. Works offline too!';
  if(en_m(['does it work offline','without internet','no wifi','offline mode'])) return '📶 Yes! After downloading studio-test.html most features work offline:\n✅ Camera, mic, voice, keyboard, mouse, speakers, performance, chroma key\n⚠️ Need internet: speed test, DNS Lookup, Network Scanner, IP geolocation';
  if(en_m(['who is rev01','about rev01','creator info','who built'])) return '👨‍💻 **REV01** is the creator of StudioTest — built in collaboration with **Claude Opus** (by Anthropic). A unique project: human + AI creating a testing tool in a single HTML file!';
  if(en_m(['better than','compare','similar apps','other tools'])) return '🏆 StudioTest stands out: runs in browser without install, everything in one file, Chroma Key + AI bot + 28 voice presets, free and ad-free, works offline!';

    if(en_m(['what is webrtc','how does camera work','how does mic work in browser'])) return '📡 **WebRTC** is a browser API for accessing camera/microphone and peer-to-peer communication. StudioTest uses it for: camera, microphone, Network Scanner, Chroma Key.';
  if(en_m(['what is snr','signal to noise','microphone quality','snr meaning'])) return '📊 **SNR** = signal-to-noise ratio. >30dB = excellent, 20-30dB = good, <10dB = bad. Improve SNR: get closer to mic, record in a quiet place.';
  if(en_m(['what is cps','clicks per second','click speed'])) return '🖱️ **CPS** = clicks per second. Average user: 5-8 CPS. Gamers: 10-15 CPS. Measure yours in the **Mouse Test**.';
  if(en_m(['how to reset','turn off effect','remove filter','undo effect'])) return '↺ **How to reset:** Camera — click Reset, Voice — select Normal preset, Chroma Key — pick None background, Everything — refresh page (F5).';
  if(en_m(['how to record video','record screen','save video','capture video'])) return '🎬 **How to record video:** 1. Start camera 2. Click Record video 3. Record what you want 4. Stop recording 5. Preview appears — download as WebM/MP4.';
  if(en_m(['what is best','recommend','favorite feature','top feature','best module'])) return rnd(["🎯 **Aim trainer** in mouse test — super addictive!", "🎙️ **Voice changer** — 28 presets, Demon and Satan are epic 😈", "⚡ **Reaction test** — simple but you always want to beat your record!"]);
  if(en_m(['how does it work','technical','architecture','built with','made with'])) return '⚙️ StudioTest is pure HTML+CSS+JS. Bot is a decision tree (if/else with keyword matching). Camera uses Canvas API. Audio uses Web Audio API. No frameworks, no backend — one file!';

  // Network Scanner
  if(en_m(['network scanner','scan network','lan scan','devices on network','local devices','what does network scanner','does network scanner work'])) { ctx.lastTopic='network'; return '📡 **Network Scanner** — yes, it works!\n- Your local IP via WebRTC\n- Router detection (.1 on your subnet)\n- Other devices via timing analysis\n- Reverse DNS — hostnames\n- IP geolocation\n\n⚠️ On Netlify (HTTPS), LAN scanning is limited by Chrome\'s security policy. Works best when opened locally.'; }

  // Download / export
  if(en_m(['what can i download','what can be downloaded','download from app','export files','save files','what files','what can i save','downloadable'])) return '📥 **What you can download from StudioTest:**\n- 📷 **Camera** — snapshot PNG, video WebM/MP4\n- 🎙️ **Microphone** — recording WAV\n- 🎵 **Voice with effects** — WAV\n- 📊 **Session report** — HTML file\n- 🎨 **Chroma Key** — screenshot PNG, video WebM';

  // Mobile
  if(en_m(['mobile','phone','smartphone','android','iphone','tablet','ios','work on phone','works on phone','mobile version'])) return '📱 **Yes!** StudioTest works on mobile browsers.\n✅ Best on mobile: reaction test, voice changer, DNS, AI assistant\n⚠️ Limited on mobile: Network Scanner, some camera effects\n\nWorks in Chrome/Firefox/Safari on Android and iOS.';

  // Fallback
}


function aiBotGetReplyRu(q, ctx, history) {
  if(!ctx) ctx = aiBotCtx;

  const qn = q.toLowerCase();

  if(/привет|здравствуй|хей|хай|ку |сема/.test(qn))
    return rnd(['Привет! 👋 Я ассистент **StudioTest**. Задавай вопросы об приложении!','Привет! 😊 Рад тебя видеть! О чём поговорим?','Хей! 🤖 Знаю все 18 модулей StudioTest — спрашивай!']);

  if(/как дела|как ты|что нового|всё ок/.test(qn))
    return rnd(['Всё отлично! 🤖 Жду твоих вопросов. А у тебя?','Хорошо! ⚡ Готов помочь с StudioTest!']);

  if(/кто такой rev|rev01|кто такой рев|ревноль|кто автор|кто разработчик/.test(qn))
    return '👨‍💻 **REV01** — создатель StudioTest. Независимый разработчик, который создал приложение с помощью **Claude Opus** (Anthropic). Проект начинался как простой тест камеры и вырос до 16 000+ строк кода с 15 модулями. Человек + ИИ = StudioTest! 🤖';

  if(/кто создал|кто сделал|автор|создатель|кто написал|кто разработал/.test(qn))
    return '👨‍💻 **StudioTest** создал **REV01** с помощью **Claude Opus** (Anthropic). Уникальный проект человек+ИИ — один HTML-файл, ~20 000 строк кода, без бэкенда и фреймворков!';



  if(/версия|version/.test(qn))
    return '📦 Текущая версия **v7.8**. Номер версии отображается в шапке приложения.';

  if(/камера|camera|видео|снимок|запись видео|эффекты камеры/.test(qn))
    return '📷 **Модуль Камера**:\n- Живой просмотр\n- **CSS-фильтры**: яркость, контраст, насыщенность\n- **20+ эффектов**: RGB Split, CRT, Hologram, Neon, Confetti и другие\n- **Запись видео** (WebM/MP4)\n- **Снимок экрана** → PNG';

  if(/микрофон|микро|звук|децибел|спектр/.test(qn))
    return '🎙️ **Модуль Микрофон**:\n- Осциллоскоп — форма волны\n- Спектр FFT\n- Уровень дБ\n- SNR — соотношение сигнал/шум\n- Мониторинг голоса\n- Шумоподавление';

  if(/голос|пресет|робот|демон|чёрт|инопланетян|питч|эффект голос|изменитель голоса|скачать голос|голосовые эффекты/.test(qn))
    return '🎵 **Изменитель голоса** — 28 пресетов:\nРобот, Низкий, Белка, Эхо, Телефон, Инопланетянин, Пещера, Шёпот, Мегафон, Вода, Стадион, Демон, Гелий, Радио, Дарт, Гигант, Призрак, Хор, Тролль, Ужас, Ангел, Рация, Субмарина, Пьяный, Монстр, Мультик, Космос, Казу...\n\n**Скачивание** голоса с эффектами → **WAV**!';

  if(/ии.?помощник|ии.?бот|ии.?ассистент|искусственный интеллект|чат.?бот|что делает бот|что делает ии|как работает бот/.test(qn))
    return '🤖 **ИИ-Ассистент** — это я! Локальный бот встроенный прямо в StudioTest.\n- **Без API** — работаю без интернета и внешних серверов\n- **Знаю всё о приложении** — все 15 модулей, функции, настройки\n- **Помню контекст** — запоминаю ход разговора и твоё имя\n- **TTS** — могу отвечать голосом (кнопка 🔇 TTS)\n- **Языки** — понимаю польский и русский\n\nПросто спрашивай о любой функции StudioTest!';

  if(/интернет.тест|тест.интернет|тест интернета|скорость интернет|скорость сети|пинг|загрузка скорость|скачивание|wifi скорость|ip адрес|как работает интернет/.test(qn))
    return '🌐 **Тест интернета** — что измеряет:\n- **Пинг** (10 сек.) — задержка до сервера в мс, чем меньше тем лучше\n- **Загрузка** (25 сек.) — сколько данных скачиваешь в сек. (Мб/с), важно для фильмов и игр\n- **Выгрузка** (25 сек.) — сколько отправляешь, важно для стриминга и видеозвонков\n- **Оценка** — от ❌ Слабый до 🏆 Отличный\n- **Геолокация IP** — город, страна, провайдер + карта\n- **Локальный IP** — адрес в домашней сети (192.168.x.x)\n- **Публичный IP** — адрес видимый для всего интернета\n\nНажми ▶ START чтобы начать тест.';

  if(/реакция|тест реакции|время реакции|рефлекс|миллисекунд|скорость реакции|как улучшить реакцию|хорошее время реакции/.test(qn))
    return '⚡ **Тест реакции** — 3 режима:\n- 🖱️ Клик — кликай когда цвет изменится\n- ⌨️ Пробел — нажми пробел\n- 🎲 Выбор — стрелка ← или →\n\nТочность **0.1мс**. Результаты <80мс отклоняются.';

  if(/мышь|клики|cps|тепловая карта|кликать|прицел|джиттер|тест мыши|скорость клика/.test(qn))
    return '🖱️ **Тест мыши** — 3 вкладки:\n- 🕹️ Движение — след, скорость, дистанция, CPS\n- 🔥 Тепловая карта\n- 🎯 Тир — стреляй по целям, тест точности';

  if(/клавиатура|клавиши|задержка клавиш/.test(qn))
    return '🎹 **Тест клавиатуры**:\n- Визуализация нажатых клавиш\n- Задержка каждой клавиши в мс\n- Звук при нажатии\nНажми **START** и печатай.';

  if(/динамик|колонк|канал|тест звука|слух|частота/.test(qn))
    return '🔊 **Тест динамиков**:\n- Левый/Правый канал раздельно\n- Sweep частот от басов до высоких\n- Генератор тонов (своя частота)\n- Тест слуха 20Гц–20кГц';

  if(/производительность|fps|память|батарея|процессор|бенчмарк/.test(qn))
    return '📊 **Монитор производительности**:\n- FPS — график 120 образцов\n- Heap JS — память JavaScript\n- Батарея — % и статус зарядки\n- Потоки CPU\n- Бенчмарк Monte Carlo';

  if(/хрома|зелёный экран|удаление фона|chroma/.test(qn))
    return '🎨 **Chroma Key** — удаление фона камеры:\n1. Включи камеру\n2. Выбери цвет (зелёный/синий/бирюзовый или кликни на изображение)\n3. Настрой **Допуск**, **Сглаживание**, **Разлив**\n4. Фон: Нет / Цвет / Изображение / Блюр\n5. Эффекты: Зеркало, Серый, Инверт, Пиксель';

  if(/dns|домен|запись|ip поиск/.test(qn))
    return '🔍 **DNS Lookup** — проверяет записи домена:\n- **A** — IPv4\n- **AAAA** — IPv6\n- **MX** — почтовые серверы\n- **NS** — серверы имён\n- **TXT** — SPF, DKIM\n- **CNAME** — псевдонимы\n\nВведи домен (`google.com`) или IP (обратный поиск).\nРаботает через **Google DNS over HTTPS** — работает с Netlify! ✅';

  if(/языки|перевод|русский|польский/.test(qn))
    return '🌍 **13 языков**:\n🇵🇱 Polski · 🇬🇧 English · 🇩🇪 Deutsch · 🇷🇺 Русский · 🇨🇳 中文 · 🇫🇷 Français · 🇪🇸 Español · 🇮🇹 Italiano · 🇯🇵 日本語 · 🇰🇷 한국어 · 🇳🇱 Nederlands · 🇵🇹 Português · 🇺🇦 Українська\n\nСмени язык нажав на флаг в шапке.';

  if(/нетлифай|netlify|как запустить|ссылка|хостинг/.test(qn))
    return '🚀 **Как запустить StudioTest:**\n1. Скачай файл `studio-test.html`\n2. Зайди на **netlify.com/drop**\n3. Перетащи файл на страницу\n4. Получи ссылку `https://что-то.netlify.app`!';

  if(/конфиденц|приватность|данные|отправляет|слежк/.test(qn))
    return '🔒 **Приватность в StudioTest:**\n- ❌ Не собирает данные\n- ❌ Не отправляет видео/аудио на сервер\n- ❌ Нет рекламы\n- ✅ Всё обрабатывается локально в браузере';

  if(/спасибо|благодарю|класс|круто|супер/.test(qn))
    return rnd(['Пожалуйста! 😊 Ещё вопросы?','Рад помочь! 🤖 Спрашивай если что!','Не за что! 👍 Удачи!']);

  if(/пока|до свидания|bye|выход/.test(qn))
    return 'Пока! 👋 Возвращайся!';

  if(/анекдот|шутку|рассмеши/.test(qn))
        if(/что такое webrtc|как работает камера|как работает микрофон в браузере/.test(qn))
    return '📡 **WebRTC** — API браузера для доступа к камере и микрофону. StudioTest использует его для: камеры, микрофона, Network Scanner, Chroma Key.';
  if(/что такое snr|что значит snr|соотношение сигнал шум/.test(qn))
    return '📊 **SNR** = соотношение сигнал/шум. >30дБ = отлично, 20-30дБ = хорошо, <10дБ = плохо. Улучши SNR: подойди ближе к микрофону, запись в тихом месте.';
  if(/что такое cps|клики в секунду|скорость клика/.test(qn))
    return '🖱️ **CPS** = клики в секунду. Обычный пользователь: 5-8 CPS. Геймеры: 10-15 CPS. Измерь в **Тесте мыши**.';
  if(/как сбросить|как выключить эффект|как отменить|как убрать эффект/.test(qn))
    return '↺ **Как сбросить:** Камера — кнопка Reset, Голос — пресет "Обычный", Chroma Key — выбери "Нет" в фоне, Всё — обнови страницу (F5).';
  if(/как записать видео|запись экрана|как снять видео/.test(qn))
    return '🎬 **Как записать видео:** 1. Включи камеру 2. Нажми "Запись видео" 3. Сними что нужно 4. Останови запись 5. Скачай WebM/MP4.';
  if(/что лучшее|что посоветуешь|любимая функция|топ функция/.test(qn))
    return rnd(["🎯 **Тир** в тесте мыши — затягивает!", "🎙️ **Изменитель голоса** — 28 пресетов, Демон и Сатана особенно! 😈", "⚡ **Тест реакции** — простой но хочется бить рекорды!"]);

if(/расскажи что-нибудь интересное|интересный факт|удиви меня/.test(qn))
    return rnd(["🤓 Интересный факт: файл studio-test.html весит более 677KB — это как 300+ страниц текста в одном файле!","🎙️ Изменитель голоса использует Web Audio API — ту же технологию что и профессиональные DAW!","⚡ Самое быстрое время реакции человека — около 100мс. Проверь своё в тесте реакции!","🎨 Chroma Key обрабатывает каждый кадр видео через Canvas API в реальном времени!"]);
  if(/network scanner|сетевой сканер|скан сети|устройства в сети|сканирование сети|lan сеть|сеть устройства|что делает scanner/.test(qn))
    return '📡 **Network Scanner** — да, работает!\n- Твой локальный IP через WebRTC\n- Маршрутизатор (.1 в сети)\n- Другие устройства через timing analysis\n- Reverse DNS — имена хостов\n- Геолокация IP\n\n⚠️ На Netlify (HTTPS) сканирование LAN ограничено политикой Chrome.';

  if(/что можно скачать|что можно загрузить|скачать из приложения|что скачивается|экспорт файлов|какие файлы/.test(qn))
    return '📥 **Что можно скачать из StudioTest:**\n- 📷 **Камера** — снимок PNG, видео WebM/MP4\n- 🎙️ **Микрофон** — запись WAV\n- 🎵 **Голос с эффектами** — WAV\n- 📊 **Отчёт сессии** — HTML файл\n- 🎨 **Chroma Key** — скриншот PNG, видео WebM';

  if(/мобильн|телефон|смартфон|android|iphone|планшет|работает на телефон|мобильная версия/.test(qn))
    return '📱 **Да!** StudioTest работает на мобильных устройствах.\n✅ Лучше всего: реакция, голос, DNS, ИИ-ассистент\n⚠️ Ограничены: Network Scanner, некоторые эффекты камеры';

  if(/что такое studio.?test|что это за приложение|что делает приложение|для чего приложение|о приложении|что умеет студио|что такое студиотест|расскажи о приложении|что это за страница|что за сайт/.test(qn))
    return '🎬 **StudioTest** — бесплатный инструмент диагностики браузера.\n\nТестирует: 📷 Камеру · 🎙️ Микрофон · 🔊 Динамики · 🌐 Интернет · ⌨️ Клавиатуру · 🖱️ Мышь · 📊 Производительность · 🖥️ Дисплей и многое другое.\n\n✅ Один HTML-файл · Без установки · 100% бесплатно · Работает офлайн!';

  if(/сколько языков|какие языки|поддерживаемые языки|языки интерфейса|13 языков|язык приложения/.test(qn))
    return '🌍 **13 языков:**\n🇵🇱 Polski · 🇬🇧 English · 🇩🇪 Deutsch · 🇷🇺 Русский · 🇺🇦 Українська · 🇫🇷 Français · 🇪🇸 Español · 🇮🇹 Italiano · 🇨🇳 中文 · 🇯🇵 日本語 · 🇰🇷 한국어 · 🇳🇱 Nederlands · 🇵🇹 Português\n\nСмени язык нажав на флаг в шапке!';

  if(/платн|стоит денег|купить|подписк|цена|бесплатн|сколько стоит/.test(qn))
    return '💸 **Абсолютно бесплатно!** Без оплаты, без подписки, без рекламы. Скачай и пользуйся офлайн.';

  if(/ссылка|официальная ссылка|сайт|url|дай ссылку|где скачать|netlify/.test(qn))
    return '🌐 **Официальная ссылка StudioTest:**\n👉 https://charming-concha-550970.netlify.app/';

  if(/claude|клод|claude opus|что такое клод/.test(qn))
    return '🤖 **Claude Opus** — ИИ-модель от Anthropic, которая помогла создать StudioTest. REV01 использовал Claude для написания кода, логики и функционала. Результат: 20 000+ строк в одном файле!';

  if(/сколько строк|размер файла|сколько весит|сколько кб|сколько мб/.test(qn))
    return '📦 StudioTest v7.8:\n- **~20 000 строк** кода\n- **~1.2 MB** один HTML-файл\n- **18 модулей**\n- **0 зависимостей** — чистый JS!';

  if(/что умеет приложение|всё что умеет|все функции|полный список/.test(qn))
    return '📋 **18 модулей StudioTest:**\n📷 Камера + фильтры + Chroma Key\n🎙️ Микрофон + FFT спектр\n🎵 Изменитель голоса (28 пресетов)\n🔊 Тест динамиков + генератор тонов\n🌐 Тест интернета + пинг + карта\n🎮 Тест FPS + VSync\n⚡ Тест реакции\n🖱️ Тест мыши + тепловая карта\n⌨️ Тест клавиатуры + 30 звуков\n📊 Монитор производительности\nℹ️ Системная информация\n🖥️ Тест дисплея\n📡 Network Scanner\n🔍 DNS Lookup\n🛡️ CSP Tester\n🤖 ИИ-Ассистент\n📊 Отчёт сессии\n⚙️ Настройки + 11 тем';

  if(/что измеряет монитор производительности|что делает монитор производительности/.test(qn))
    return '📊 **Монитор производительности:**\n- **FPS** — кадры в секунду (60fps = плавно, <30 = проблема)\n- **Heap JS** — сколько RAM использует JavaScript\n- **Длинные задачи** — операции >50мс\n- **Батарея** — процент и статус зарядки\n- **CPU потоки** — логические ядра\n- **Бенчмарк Monte Carlo** — скорость JS';
    return '🤖 Я **ИИ-Ассистент StudioTest** — локальный бот, созданный **REV01** с помощью **Claude Opus**. Работаю 100% офлайн, знаю все 18 модулей приложения и говорю по-польски, английски и русски! Имени нет — можешь придумать 😄';
  if(/мне скучно|нечего делать|что мне делать|предложи что-нибудь/.test(qn))
    return '😊 Вот несколько идей!\n🎯 Сыграй в **Тир** (тест мыши)\n⚡ Побей рекорд в **Тесте реакции**\n🎵 Поиграй с **Изменителем голоса** — 28 пресетов!\n🎨 Удали фон камеры в **Chroma Key**\n📊 Проверь скорость в **Тесте интернета**';
  if(/как он сделан|на чём написан|технологии|фреймворк/.test(qn))
    return '💻 **HTML** = структура, **CSS** = стиль, **JavaScript** = логика. StudioTest — чистый HTML+CSS+JS, ~16 000 строк в одном файле. Никаких фреймворков — ванильный JS!';
  if(/можно ли скачать|открыть локально|офлайн режим|без интернета/.test(qn))
    return '📶 **Да!** Скачай studio-test.html и открой локально без интернета. Работают офлайн:\n✅ Камера, микрофон, голос, клавиатура, мышь, динамики, производительность, Chroma Key\n⚠️ Требуют интернет: тест скорости, DNS Lookup, Network Scanner, геолокация IP';
  if(/кто такой rev01|о rev01|создатель подробнее/.test(qn))
    return '👨‍💻 **REV01** — создатель StudioTest, разработчик который сделал это приложение в сотрудничестве с **Claude Opus** (ИИ от Anthropic). Уникальный проект: человек + ИИ создают инструмент тестирования в одном HTML-файле!';
  if(/лучше чем|сравнение|похожие приложения|другие тесты/.test(qn))
    return '🏆 StudioTest выделяется тем что:\n- Работает в браузере без установки\n- Всё в одном файле\n- Chroma Key, ИИ-бот и 28 голосовых пресетов\n- Бесплатный и без рекламы\n- Работает офлайн после скачивания';

    if(/где ты|где находишься|откуда ты|в каком городе|твоё местоположение/.test(qn))
    return '🌐 Я живу в коде! Конкретно в файле studio-test.html, где-то между строкой 8000 и 9000 😄';
  if(/что умеешь|что можешь|твои возможности/.test(qn))
    return '🤖 Умею отвечать о StudioTest, общаться по-русски/польски/английски, шутить, помнить имя и контекст, читать вслух (TTS)!';
  if(/ты реальный|ты ии|ты бот|искусственный/.test(qn))
    return '🤖 Я локальный бот — JS скрипт в HTML. Создан REV01 с помощью Claude Opus. Полностью офлайн, без API!';
  if(/сколько тебе лет|когда родился|твой возраст/.test(qn))
    return '🎂 Появился вместе со StudioTest v7.0. Возраст — несколько недель, знания — тысячи строк кода 😄';

  return rnd([
      'Тестировщик заходит в бар. Заказывает 0, 1, -1, NULL и 🍺 пива. Бармен в панике! 😅',
      'Git commit: "разные исправления". Что это значит? Понятия не имею. Работает. **Не трогать!** 🔥',
      'Баг зашёл в бар. Бармен: "Что налить?". Баг: "Ничего — сам найдёшь меня." 🐛',
      'Шеф: "Почему этот баг существует 3 года?!" Программист: "Это не баг — это **фича с опытом**." 💀',
      'CSS — это не язык, это наказание за прошлую жизнь. 😭',
      'Мой код как холодильник в 3 ночи: **не понимаешь зачем смотришь, но как-то работает.** 🌙',
      'Почему программисты путают Хэллоуин с Рождеством? **Oct 31 == Dec 25**! 🎃'
    ]);
}

function aiBotGetReplyEs(q,ctx,h){
  if(!ctx)ctx=aiBotCtx;
  const nameM=q.match(/(?:me llamo|soy|mi nombre es|llámame)\s+([a-zA-ZÁÉÍÓÚÑÜáéíóúñü]{2,20})/i);
  if(nameM){ctx.userName=nameM[1].charAt(0).toUpperCase()+nameM[1].slice(1);return rnd(["¡Encantado, **"+ctx.userName+"**! 😊 ¡Pregúntame sobre StudioTest!","¡Hola **"+ctx.userName+"**! 🤖"]);}
  if(!ctx)ctx=aiBotCtx;
  const qn=q.toLowerCase();
  if(/hola|buenos|buenas|hey |hi /.test(qn)){const n=ctx.userName?", "+ctx.userName:"";return rnd(["Hola"+n+"! 👋 Soy el asistente IA de StudioTest. ¿En qué puedo ayudarte?","Hola"+n+"! 🤖 ¿Cómo puedo ayudar?"]);}
  if(/cómo estás|qué tal|todo bien/.test(qn))return rnd(["Muy bien! 🤖 ¿Qué quieres saber?","Genial! ⚡ ¿Pregunta!"]);
  if(/quién creó|quién hizo|creó|creador|desarrollador|autor/.test(qn)){ctx.lastTopic="creator";return "👨‍💻 StudioTest fue creado por REV01 con ayuda de Claude Opus (Anthropic). ¿Un proyecto humano+IA — un archivo HTML, 16.000+ líneas!";}
  if(/qué es studiotest|para qué sirve|esta aplicación|esta app/.test(qn))return "🎬 StudioTest es una app web gratuita para probar hardware directamente en el navegador. ¿Cámara, micro, audio, ratón, teclado, internet — todo en un archivo HTML!";
  if(/funciones|módulos|qué puede hacer|lista de funciones|qué tiene/.test(qn))return "📋 15 módulos StudioTest:\n📷 Cámara+filtros+20 efectos · 🎤 Micrófono+FFT · 🎵 Voz(28 presets) · 🌐 Test internet · ⚡ Reacción · 🖥️ Ratón · 🎹 Teclado · 🔊 Altavoces · 📊 Rendimiento · ℹ️ Sistema · 🎨 Chroma Key · 📡 Red · 🔍 DNS · 🤖 IA · 📊 Informe";
  if(/cambiador de voz|efecto de voz|preset de voz|voz robot|voz dem/i.test(qn)){ctx.lastTopic="voice";return "🎵 Cambiador de voz — 28 presets: Robot, Grave, Ardilla, Eco, Teléfono, Alien, Cueva, Susurro, Megáfono, Submarino, Estadio, Demonio, Helio, Radio, Vintage, Darth🌑, Gigante, Fantasma, Coro, Troll, Ratón, Horror, Ángel, Walkie, Sonar, Borracho, Monstruo, Dibujos\nControles: Tono, Velocidad, Bajos, Medios, Agudos, Reverb, Chorus, Distorsión, Volumen\nDescargar como WAV!";}
  if(/test de internet|prueba de velocidad|velocidad de internet|ping|velocidad de descarga|velocidad de subida|wifi|speedtest/.test(qn)){ctx.lastTopic="internet";return "🌐 Test de internet:\n• Ping (10s) — latencia en ms\n• Descarga (25s) — Mb/s\n• Subida (25s) — Mb/s\n• Puntuación: de ❌ Malo a 🏆 Excelente\n• Geolocalización IP — ciudad, país, ISP + mapa";}
  if(/test de reacción|tiempo de reacción|reflejos|reacción/.test(qn)){ctx.lastTopic="reaction";return "⚡ Test de reacción — 3 modos:\n• 🖱️ Clic — haz clic cuando se ponga verde\n• ⌨️ Espacio\n• 🎲 Elección — flecha ← o →\nPrecisión: 0,1ms. Humano medio: 150–250ms.";}
  if(/test de ratón|clic|cps|mapa de calor|punteria|aim trainer/.test(qn)){ctx.lastTopic="mouse";return "🖥️ Test de ratón — 3 pestañas:\n• 🕹️ Movimiento — rastro cursor, CPS, jitter, distancia\n• 🔥 Mapa de calor — dónde haces clic\n• 🎯 Puntería — precisión %";}
  if(/test de teclado|retraso de tecla|input lag|latencia/.test(qn)){ctx.lastTopic="keyboard";return "🎹 Test de teclado:\n• Teclado visual con retroiluminación\n• Latencia ms\n• Sonidos de teclas (30+ perfiles: Click, Thock, Piano...)\n• ¿Prueba todas las 105 teclas!";}
  if(/test de altavoces|test de audio|canal izquierdo|frecuencia|test de oído/.test(qn)){ctx.lastTopic="speakers";return "🔊 Test altavoces:\n• Canales L/R\n• Barrido de frecuencias 20Hz–20kHz\n• Generador de tonos\n• Test de audición — encuentra tu rango!";}
  if(/chroma key|pantalla verde|pantalla azul|eliminar fondo|fondo virtual/.test(qn)){ctx.lastTopic="chroma";return "🎨 Chroma Key:\n1. Activa la cámara\n2. Elige el color clave\n3. Ajusta Tolerancia + Suavizado + Relleno\n4. Fondo: Ninguno / Color / Imagen / Desenfoque\n¿Graba como WebM!";}
  if(/dns lookup|registro dns|dominio/.test(qn)){ctx.lastTopic="dns";return "🔍 DNS Lookup — verifica registros de dominio:\nA · AAAA · MX · NS · TXT · CNAME\n+ Geolocalización del servidor + detección CDN";}
  if(/enlace oficial|url de la app|netlify|dónde está/.test(qn))return "🌐 Enlace oficial StudioTest:\n👉 https://charming-concha-550970.netlify.app/";
  if(/versión|versión actual/.test(qn))return "📦 Versión actual: v7.4";
  if(/quién eres|cómo te llamas|asistente ia|eres un bot/.test(qn))return "🤖 Soy el asistente IA de StudioTest — un bot local creado por REV01 con Claude Opus. ¿Sin API, sin internet necesario!";
  if(/qué puedes hacer|qué sabes|en qué puedes ayudar|qué temas/.test(qn))return "📋 Puedo responder sobre:\n🔧 Los 15 módulos de StudioTest\n💬 Creador, versión, enlace, privacidad, idiomas\n🤖 Quién soy, cómo funciono\n😂 Chistes y curiosidades\n¿Escribe libremente — entiendo español, polaco, inglés, francés y más!";
  if(/gratis|precio|pagar|suscripción|cuesta/.test(qn))return "💸 ¿100% gratis! Sin cargos, sin suscripción, sin anuncios.";
  if(/privacidad|datos|recopila|espa|seguimiento/.test(qn))return "🔒 StudioTest no recopila ningún dato. Todo funciona localmente en el navegador. Sin anuncios.";
  if(/offline|sin internet|sin wifi|descargar la app/.test(qn))return "📶 ¿Sí! Descarga studio-test.html (Ctrl+S) y úsala offline. Funciona sin internet:\n✔️ Cámara, micro, voz, teclado, ratón, altavoces, rendimiento, chroma key";
  if(/idiomas|cuántos idiomas|idioma/.test(qn))return "🌍 13 idiomas: 🇵🇱 Polaco · 🇬🇧 Inglés · 🇩🇪 Alemán · 🇷🇺 Ruso · 🇺🇦 Ucraniano · 🇫🇷 Francés · 🇪🇸 Español · 🇮🇹 Italiano · 🇨🇳 Chino · 🇯🇵 Japonés · 🇰🇷 Coreano · 🇳🇱 Neerlandés · 🇵🇹 Portugués";
  if(/teléfono|móvil|smartphone|android|iphone/.test(qn))return "📱 ¿Sí! StudioTest funciona en móvil. Mejor: reacción, voz, DNS, IA. Limitado: escaner red.";
  if(/chiste|broma|hazme reír|gracioso/.test(qn))return rnd(["¿Por qué los programadores prefieren el modo oscuro? ¿Porque la luz atrae bugs! 🐛","Git commit: 'varias correcciones'. ¿Qué significa? Ni idea. Funciona. ¿No tocar! 🔥","Mi código nunca tiene bugs — solo funcionalidades inesperadas. 🔥"]);
  if(/gracias|genial|perfecto|excelente|super|ok/.test(qn)){const n=ctx.userName?" "+ctx.userName:"";return rnd(["De nada"+n+"! 😊","Con gusto"+n+"! 🤖"]);}
  if(/adiós|bye|hasta luego|hasta pronto/.test(qn)){const n=ctx.userName?" "+ctx.userName:"";return rnd(["¿Adiós"+n+"! 👋","¿Hasta pronto"+n+"! 😊"]);}
  return rnd(["Hmm, no estoy seguro. 🤔 ¿Préguntame sobre un módulo específico!","Lo siento, eso supera mis conocimientos. ¿Pregunta sobre StudioTest!","Sin respuesta. 🧩 ¿Pero conozco StudioTest de arriba a abajo!"]);
}

function aiBotGetReplyIt(q,ctx,h){
  if(!ctx)ctx=aiBotCtx;
  const nameM=q.match(/(?:mi chiamo|sono|il mio nome è|chiamami)\s+([a-zA-ZÀÈÉÌÍÎÒÓÙÚàèéìíîòóùú]{2,20})/i);
  if(nameM){ctx.userName=nameM[1].charAt(0).toUpperCase()+nameM[1].slice(1);return rnd(["Piacere, **"+ctx.userName+"**! 😊 Chiedimi di StudioTest!","Ciao **"+ctx.userName+"**! 🤖"]);}
  if(!ctx)ctx=aiBotCtx;
  const qn=q.toLowerCase();
  if(/ciao|salve|buongiorno|buonasera|hey |hi /.test(qn)){const n=ctx.userName?", "+ctx.userName:"";return rnd(["Ciao"+n+"! 👋 Sono l'assistente IA di StudioTest. Come posso aiutarti?","Salve"+n+"! 🤖 Come posso aiutare?"]);}
  if(/come stai|come va|tutto bene/.test(qn))return rnd(["Molto bene! 🤖 Cosa vuoi sapere?","Benissimo! ⚡ Chiedimi qualcosa!"]);
  if(/chi ha creato|chi ha fatto|creatore|sviluppatore|autore/.test(qn)){ctx.lastTopic="creator";return "👨‍💻 StudioTest è stato creato da REV01 con l'aiuto di Claude Opus (Anthropic). Un progetto umano+IA — un file HTML, 16.000+ righe!";}
  if(/cos'è studiotest|a cosa serve|questa app/.test(qn))return "🎬 StudioTest è un'app web gratuita per testare l'hardware direttamente nel browser. Fotocamera, microfono, audio, mouse, tastiera, internet — tutto in un file HTML!";
  if(/funzioni|moduli|cosa può fare|elenco delle funzioni|cosa ha/.test(qn))return "📋 15 moduli StudioTest:\n📷 Fotocamera+filtri+20 effetti · 🎤 Microfono+FFT · 🎵 Voce(28 preset) · 🌐 Internet · ⚡ Reazione · 🖥️ Mouse · 🎹 Tastiera · 🔊 Altoparlanti · 📊 Prestazioni · ℹ️ Sistema · 🎨 Chroma Key · 📡 Rete · 🔍 DNS · 🤖 IA · 📊 Report";
  if(/modificatore di voce|effetto voce|preset voce|voce robot|voce demone/i.test(qn)){ctx.lastTopic="voice";return "🎵 Modificatore di voce — 28 preset: Robot, Basso, Scoiattolo, Eco, Telefono, Alien, Caverna, Sussurro, Megafono, Subacqueo, Stadio, Demone, Elio, Radio, Vintage, Darth🌑, Gigante, Fantasma, Coro, Troll, Topo, Horror, Angelo, Walkie, Sonar, Ubriaco, Mostro, Cartoon\nCarrelli: Tonalità, Velocità, Bassi, Medi, Alti, Riverbero, Chorus, Distorsione, Volume\nScarica come WAV!";}
  if(/test di internet|test della velocità|velocità internet|ping|velocità download|speedtest/.test(qn)){ctx.lastTopic="internet";return "🌐 Test internet:\n• Ping (10s) — latenza ms\n• Download (25s) — Mb/s\n• Upload (25s) — Mb/s\n• Valutazione: da ❌ Scarso a 🏆 Eccellente\n• Geoloc IP — città, paese, ISP + mappa";}
  if(/test di reazione|tempo di reazione|riflessi|reazione/.test(qn)){ctx.lastTopic="reaction";return "⚡ Test di reazione — 3 modalità:\n• 🖱️ Clic — clicca quando diventa verde\n• ⌨️ Spazio\n• 🎲 Scelta — freccia ← o →\nPrecisione: 0,1ms. Umano medio: 150–250ms.";}
  if(/test del mouse|clic|cps|heatmap|mira|aim trainer/.test(qn)){ctx.lastTopic="mouse";return "🖥️ Test mouse — 3 schede:\n• 🕹️ Movimento — traccia cursore, CPS, jitter, distanza\n• 🔥 Heatmap\n• 🎯 Mira — precisione %";}
  if(/test della tastiera|ritardo tasto|input lag|latenza tastiera/.test(qn)){ctx.lastTopic="keyboard";return "🎹 Test tastiera:\n• Tastiera visiva con evidenziazione\n• Latenza ms\n• Suoni dei tasti (30+ profili)\n• Testa tutte le 105 tasti!";}
  if(/test degli altoparlanti|test audio|canale sinistro|frequenza|test dell'udito/.test(qn)){ctx.lastTopic="speakers";return "🔊 Test altoparlanti:\n• Canali L/R\n• Sweep di frequenza 20Hz–20kHz\n• Generatore di tonalti\n• Test udito!";}
  if(/chroma key|schermo verde|schermo blu|rimozione sfondo|sfondo virtuale/.test(qn)){ctx.lastTopic="chroma";return "🎨 Chroma Key:\n1. Attiva fotocamera\n2. Scegli colore chiave\n3. Tolleranza + Smussatura + Spill\n4. Sfondo: Nessuno / Colore / Immagine / Sfocatura\nRegistra come WebM!";}
  if(/dns lookup|record dns|dominio/.test(qn)){ctx.lastTopic="dns";return "🔍 DNS Lookup — verifica i record di dominio:\nA · AAAA · MX · NS · TXT · CNAME\n+ Geolocalizzazione server + rilevamento CDN";}
  if(/link ufficiale|url dell'app|netlify|dove trovare/.test(qn))return "🌐 Link ufficiale StudioTest:\n👉 https://charming-concha-550970.netlify.app/";
  if(/versione|versione attuale/.test(qn))return "📦 Versione attuale: v7.4";
  if(/chi sei|come ti chiami|assistente ia|sei un bot/.test(qn))return "🤖 Sono l'assistente IA di StudioTest — un bot locale creato da REV01 con Claude Opus. Nessuna API, nessun internet richiesto!";
  if(/cosa puoi fare|cosa sai|di cosa parli|quali argomenti/.test(qn))return "📋 Posso rispondere su:\n🔧 I 15 moduli di StudioTest\n💬 Creatore, versione, link, privacy, lingue\n🤖 Chi sono, come funziono\n😂 Barzellette e curiosità\nScrivi liberamente in italiano!";
  if(/gratuito|prezzo|pagare|abbonamento/.test(qn))return "💸 100% gratuito! Nessun costo, nessun abbonamento, nessuna pubblicità.";
  if(/privacy|dati|raccoglie|tracciamento/.test(qn))return "🔒 StudioTest non raccoglie nessun dato. Tutto funziona localmente. Senza pubblicità.";
  if(/offline|senza internet|senza wifi|scaricare l'app/.test(qn))return "📶 Sì! Scarica studio-test.html (Ctrl+S) e usala offline.";
  if(/lingue|quante lingue|lingua/.test(qn))return "🌍 13 lingue: Polacco · Inglese · Tedesco · Russo · Ucraino · Francese · Spagnolo · Italiano · Cinese · Giapponese · Coreano · Olandese · Portoghese";
  if(/telefono|cellulare|smartphone|android|iphone/.test(qn))return "📱 Sì! StudioTest funziona su mobile. Meglio: reazione, voce, DNS, IA.";
  if(/barzelletta|scherzo|fammi ridere|divertente/.test(qn))return rnd(["Perché i programmatori preferiscono il tema scuro? Perché la luce attira i bug! 🐛","Git commit: 'varie correzioni'. Cosa significa? Non lo so. Funziona. Non toccare! 🔥","Il mio codice non ha mai bug — solo funzionalità inaspettate. 🔥"]);
  if(/grazie|ottimo|perfetto|eccellente/.test(qn)){const n=ctx.userName?" "+ctx.userName:"";return rnd(["Prego"+n+"! 😊","Con piacere"+n+"! 🤖"]);}
  if(/arrivederci|bye|a presto|ciao/.test(qn)){const n=ctx.userName?" "+ctx.userName:"";return rnd(["Arrivederci"+n+"! 👋","A presto"+n+"! 😊"]);}
  return rnd(["Hmm, non sono sicuro. 🤔 Chiedimi di un modulo specifico!","Mi dispiace, va oltre le mie conoscenze. Chiedi di StudioTest!","Nessuna risposta. 🧩 Ma conosco StudioTest da cima a fondo!"]);
}

function aiBotGetReplyZh(q,ctx,h){
  if(!ctx)ctx=aiBotCtx;
  const qn=q;
  if(/你好|您好|嘉呀|哨/.test(qn)){const n=ctx.userName?"，"+ctx.userName:"";return rnd(["你好"+n+"! 👋 我是StudioTest的AI助手，有什么可以帮到你?","嘉呀"+n+"! 🤖"]);}
  if(/谁创建|谁做的|创作者|开发者|作者/.test(qn)){ctx.lastTopic="creator";return "👨‍💻 StudioTest由REV01在Claude Opus(Anthropic)的帮助下创建。人类+AI项目 — 一个HTML文件，16000+行!";}
  if(/什么是studiotest|这个应用|有什么用|应用简介/.test(qn))return "🎬 StudioTest是一个免费网页应用，直接在浏览器中测试硬件。摄像头、麦克风、音频、鼠标、键盘、网速 — 全部在一个HTML文件中!";
  if(/功能|模块|能做什么|工具列表/.test(qn))return "📋 StudioTest 15个模块:\n📷 摄像头+滤镜+20效果 · 🎤 麦克风+FFT · 🎵 变声(28预设) · 🌐 网速 · ⚡ 反应 · 🖥️ 鼠标 · 🎹 键盘 · 🔊 扬声器 · 📊 性能 · ℹ️ 系统 · 🎨 绿幕 · 📡 网络 · 🔍 DNS · 🤖 AI · 📊 报告";
  if(/变声器|声音效果|声音预设|机器人声|声音/.test(qn)){ctx.lastTopic="voice";return "🎵 变声器 — 28个预设: 机器人、低沉、花栗鼠、回声、电话、外星人、山洞、耳语、扩音器、水下、体育场、恶魔、氦气、收音机、夏日夏、达斯🌑、巨人、幽灵、合唱、巨魔、老鼠、恐怖、天使、对讲机、声纳、醉鬼、怪兽、卡通\n满头: 音调、速度、低音、中音、高音、混响、合唱、失真、音量\n下载WAV格式!";}
  if(/网速测试|网络测试|下载速度|上传速度|ping|测速/.test(qn)){ctx.lastTopic="internet";return "🌐 网速测试:\n• Ping (10s) — 延迟 ms\n• 下载 (25s) — Mb/s\n• 上传 (25s) — Mb/s\n• 评分：从❌差到🏆优秀\n• IP地理位置 — 城市、国家、ISP + 地图";}
  if(/反应测试|反应时间|式神经|式反应/.test(qn)){ctx.lastTopic="reaction";return "⚡ 反应测试 — 3种模式:\n• 🖱️ 点击 — 变绿时点击\n• ⌨️ 空格键\n• 🎲 选择 — ←或→\n精度: 0.1ms. 人类平均: 150–250ms.";}
  if(/鼠标测试|点击测试|cps|热力图|瞬取训练/.test(qn)){ctx.lastTopic="mouse";return "🖥️ 鼠标测试 — 3个选项卡:\n• 🕹️ 移动 — CPS、抖动、距离、精度\n• 🔥 热力图\n• 🎯 瞬取训练 — 命中率%";}
  if(/键盘测试|按键延迟|input lag|键盘延迟/.test(qn)){ctx.lastTopic="keyboard";return "🎹 键盘测试:\n• 可视化键盘高亮\n• 延迟 ms\n• 按键声 (30+风格)\n• 测试全部105个键!";}
  if(/扬声器测试|音频测试|左右声道|频率扫描|听力测试/.test(qn)){ctx.lastTopic="speakers";return "🔊 扬声器测试:\n• L/R声道\n• 频率扫描 20Hz–20kHz\n• 音调生成器\n• 听力测试 — 找到你的族围!";}
  if(/绿幕|抠像|chroma key|去除背景|虚拟背景/.test(qn)){ctx.lastTopic="chroma";return "🎨 Chroma Key:\n1. 开启摄像头\n2. 选择键色\n3. 调整容差+平滑+溢出\n4. 背景: 无 / 颜色 / 图片 / 模糊\n录制为WebM!";}
  if(/dns查询|dns记录|域名查询/.test(qn)){ctx.lastTopic="dns";return "🔍 DNS Lookup — 检查域名记录:\nA · AAAA · MX · NS · TXT · CNAME\n+ 服务器地理位置 + CDN检测";}
  if(/官方链接|应用网址|netlify|在哪里/.test(qn))return "🌐 StudioTest官方链接:\n👉 https://charming-concha-550970.netlify.app/";
  if(/版本|当前版本/.test(qn))return "📦 当前版本: v7.4";
  if(/你是谁|你叫什么|ai助手|你是机器人/.test(qn))return "🤖 我是StudioTest AI助手 — REV01用Claude Opus构建的本地机器人。无需API，无需联网!";
  if(/能回答什么|你知道什么|哪些问题/.test(qn))return "📋 我可以回答关于:\n🔧 StudioTest的15个模块\n💬 创建者、版本、链接、隐私、语言\n🤖 我是谁，我如何工作\n😂 笑话和有趣事实\n用中文自由输入!";
  if(/免费|价格|付费|订阅/.test(qn))return "💸 100%免费！无费用，无订阅，无广告。";
  if(/隐私|数据|收集|跟踪/.test(qn))return "🔒 StudioTest不收集任何数据。全部在本地浏览器中运行。无广告。";
  if(/离线|没有互联网|没有wifi|下载应用/.test(qn))return "📶 可以！下载studio-test.html (Ctrl+S)可离线使用。";
  if(/支持多少语言|语言|多语言/.test(qn))return "🌍 13种语言: 波兰语·英语·德语·俄语·乌克兰语·法语·西班牙语·意大利语·中文·日语·韩语·荷兰语·葡萄牙语";
  if(/手机|调浏览器|android|iphone/.test(qn))return "📱 可以！StudioTest在手机上运行。最佳: 反应、变声、DNS、AI。";
  if(/笑话|幽默|搞笑|有趣/.test(qn))return rnd(["为什么程序员喜欢暗色模式？因为光会吸引bug! 🐛","Git提交: '各种修夏'。什么意思？不知道。能用。别动! 🔥","我的代码从没有bug — 只有意外的功能。🔥"]);
  if(/谢谢|太棒了|完美|好的/.test(qn)){const n=ctx.userName?" "+ctx.userName:"";return rnd(["不客气"+n+"! 😊","很高兴能帮到你"+n+"! 🤖"]);}
  if(/再见|衬衬|更次|bye/.test(qn)){const n=ctx.userName?" "+ctx.userName:"";return rnd(["再见"+n+"! 👋","回头见"+n+"! 😊"]);}
  return rnd(["嘿，不确定。🤔 请问我具体的模块!","抱歉，超出我的知识范围。","没有答案。🧩 但我对StudioTest了如指掌!"]);
}

function aiBotGetReplyJa(q,ctx,h){
  if(!ctx)ctx=aiBotCtx;
  const qn=q;
  if(/こんにちは|おはようございます|こんばんは|やあ|やほ/.test(qn)){const n=ctx.userName?"、"+ctx.userName+"さん":"";return rnd(["こんにちは"+n+"! 👋 StudioTestのAIアシスタントです。何でも聆いてください!","やあ"+n+"! 🤖 何でも聆きますよ!"]);}
  if(/誰が作った|誰が作りました|作成者|開発者/.test(qn)){ctx.lastTopic="creator";return "👨‍💻 StudioTestはREV01がClaude Opus(Anthropic)の助けを借りて作成しました。人間+AIプロジェクト — 1つのHTMLファイル、16000+行!";}
  if(/studiotestとは何|このアプリは何|何のため/.test(qn))return "🎬 StudioTestはブラウザで直接ハードウェアをテストできる無料ウェブアプリです。カメラ、マイク、オーディオ、マウス、キーボード、インターネット — 1つのHTMLに全部!";
  if(/機能|モジュール|一覧|何ができる/.test(qn))return "📋 StudioTest 15モジュール:\n📷 カメラ+フィルター+20エフェクト · 🎤 マイク+FFT · 🎵 ボイス(28プリセット) · 🌐 インターネット · ⚡ 反応 · 🖥️ マウス · 🎹 キーボード · 🔊 スピーカー · 📊 パフォーマンス · ℹ️ システム · 🎨 クロマキー · 📡 ネットワーク · 🔍 DNS · 🤖 AI · 📊 レポート";
  if(/ボイスチェンジャー|声のエフェクト|声プリセット|ピッチ/.test(qn)){ctx.lastTopic="voice";return "🎵 ボイスチェンジャー — 28プリセット:\nロボット、低音、リス、エコー、電話、エイリアン、洞窟、ヴィスパー、メガホン、水中、スタジアム、悪魔、ヘリウム、ラジオ、ヴィンテージ、ダース🌑、巨人、幽霊、合唱、トロール、ネズミ、ホラー、天使、トランシーバー、ソナー、酔っぱらい、モンスター、カートゥーン\nスライダー: ピッチ、テンポ、バス、ミッド、トレブル、リバーブ、コーラス、ディストーション、音量\nWAVでダウンロード!";}
  if(/インターネットテスト|速度テスト|速度計測|ping|ダウンロード速度/.test(qn)){ctx.lastTopic="internet";return "🌐 インターネットテスト:\n• Ping (10s) — レイテンシ ms\n• ダウンロード (25s) — Mb/s\n• アップロード (25s) — Mb/s\n• 評価：悪いから🏆優れまで\n• IP位置情報 + 地図";}
  if(/反応テスト|反応時間|反射神経/.test(qn)){ctx.lastTopic="reaction";return "⚡ 反応テスト — 3モード:\n• 🖱️ クリック — 緑になったらクリック\n• ⌨️ スペース\n• 🎲 選択 — 矢印←または→\n精度: 0.1ms. 人間平均: 150–250ms.";}
  if(/マウステスト|クリック数|cps|ヒートマップ|エイム/.test(qn)){ctx.lastTopic="mouse";return "🖥️ マウステスト — 3タブ:\n• 🕹️ 動き — CPS、ジッター、距離、精度\n• 🔥 ヒートマップ\n• 🎯 エイムトレーナー — 命中率%";}
  if(/キーボードテスト|キー入力遅延|input lag/.test(qn)){ctx.lastTopic="keyboard";return "🎹 キーボードテスト:\n• ビジュアルキーボードのハイライト\n• レイテンシ ms\n• クリック音 (30+プロファイル)\n• 全105キーのテスト!";}
  if(/スピーカーテスト|オーディオテスト|聴力テスト/.test(qn)){ctx.lastTopic="speakers";return "🔊 スピーカーテスト:\n• L/Rチャンネル\n• 周波数スイープ 20Hz–20kHz\n• トーンジェネレータ\n• 聴力テスト — 聴こえる範囲を確認!";}
  if(/クロマキー|グリーンスクリーン|背景削除|仲为背景/.test(qn)){ctx.lastTopic="chroma";return "🎨 クロマキー:\n1. カメラを起動\n2. キーカラーを選択\n3. 許容度+スムージング+スピル\n4. 背景: なし / カラー / 画像 / ぼかし\nWebMで録画!";}
  if(/dnsルックアップ|dnsレコード|ドメイン/.test(qn)){ctx.lastTopic="dns";return "🔍 DNS Lookup — ドメインレコードを確認:\nA · AAAA · MX · NS · TXT · CNAME\n+ サーバー位置情報 + CDN検出";}
  if(/公式リンク|アプリのurl|netlify|どこにある/.test(qn))return "🌐 StudioTest公式リンク:\n👉 https://charming-concha-550970.netlify.app/";
  if(/バージョン|現在のバージョン/.test(qn))return "📦 現在のバージョン: v7.4";
  if(/あなたは誰|名前は|aiアシスタント|ボットですか/.test(qn))return "🤖 StudioTest AIアシスタントです — REV01がClaude Opusで作成したローカルボット。API不要、インターネット不要!";
  if(/何ができる|何を知っている|どんな質問/.test(qn))return "📋 回答できる質問:\n🔧 StudioTestの15モジュール\n💬 作成者、バージョン、リンク、プライバシー、言語\n🤖 自分のこと、動作の仕組み\n😂 ジョークとトリビア\n日本語で自由に書いて!";
  if(/無料|価格|払う|サブスク/.test(qn))return "💸 100%無料！料金なし、サブスクなし、広告なし。";
  if(/プライバシー|データ|収集|追跡/.test(qn))return "🔒 StudioTestはデータを収集しません。全てブラウザでローカルに動作します。広告なし。";
  if(/オフライン|インターネットなし|ダウンロード/.test(qn))return "📶 可能です! studio-test.htmlをダウンロード(Ctrl+S)してオフラインで使えます。";
  if(/言語|何か国語|対応言語/.test(qn))return "🌍 13言語: ポーランド語·英語·ドイツ語·ロシア語·ウクライナ語·フランス語·スペイン語·イタリア語·中国語·日本語·韓国語·オランダ語·ポルトガル語";
  if(/スマホ|android|iphone|モバイル/.test(qn))return "📱 はい! StudioTestはスマホで動作します。";
  if(/ジョーク|笑わせて|面白い/.test(qn))return rnd(["プログラマーがダークモードを好む理由? 光がバグを引き寄せるから! 🐛","Gitコミット: 'いろいろ修正'。意味? 知らない。動く。触るな! 🔥","私のコードにはバグがない — 予期せぬ機能があるだけ。🔥"]);
  if(/ありがとう|すごい|最高|完璧/.test(qn)){const n=ctx.userName?" "+ctx.userName+"さん":"";return rnd(["どいたしまして"+n+"! 😊","お役に立てて嫁しいです"+n+"! 🤖"]);}
  if(/さようなら|またね|ばいばい|bye/.test(qn)){const n=ctx.userName?" "+ctx.userName+"さん":"";return rnd(["さようなら"+n+"! 👋","またね"+n+"! 😊"]);}
  return rnd(["うーん、わかりません。🤔 具体的なモジュールについて衆いてください!","申し訳ありませんが、私の知識範囲外です。 StudioTestについて聯いてください!","答えがありません。🧩 でもStudioTestは完全に知っています!"]);
}

function aiBotGetReplyKo(q,ctx,h){
  if(!ctx)ctx=aiBotCtx;
  const qn=q;
  if(/안녕|안녕하세요|반갑습니다/.test(qn)){const n=ctx.userName?", "+ctx.userName+"님":"";return rnd(["안녕"+n+"! 👋 StudioTest AI 어시스턴트입니다. 무엇을 도와드릴까요?","안녕하세요"+n+"! 🤖"]);}
  if(/누가 만들|누가 개발|제작자|개발자/.test(qn)){ctx.lastTopic="creator";return "👨‍💻 StudioTest는 REV01이 Claude Opus(Anthropic)의 도움으로 제작했습니다. 인간+AI 프로젝트 — HTML 파일 하나, 16,000+줄!";}
  if(/studiotest이란|이 앱이|무엇을 하는|앱 소개/.test(qn))return "🎬 StudioTest는 브라우저에서 직접 하드웨어를 테스트하는 무료 웹앱입니다. 카메라, 마이크, 오디오, 마우스, 키보드, 인터넷 — 모두 HTML 하나에!";
  if(/기능|모듈|목록|무엇이 있/.test(qn))return "📋 StudioTest 15개 모듈:\n📷 카메라+필터+20에폭트 · 🎤 마이크+FFT · 🎵 음성(28프리셋) · 🌐 인터넷 · ⚡ 반응 · 🖥️ 마우스 · 🎹 키보드 · 🔊 스피커 · 📊 성능 · ℹ️ 시스템 · 🎨 크로마키 · 📡 네트워크 · 🔍 DNS · 🤖 AI · 📊 보고서";
  if(/음성변환|음성효과|음성프리셋|로봇목소리/.test(qn)){ctx.lastTopic="voice";return "🎵 음성 변환기 — 28개 프리셋:\n로봇, 저음, 다람쥐, 에코, 전화, 외계인, 동굴, 속삭임, 확성기, 수중, 경기장, 악마, 헬륨, 라디오, 빈티지, 다스🌑, 거인, 유령, 합샰, 트롤, 쥐, 공포, 천사, 워키토키, 소나, 잠덤븩이, 괴물, 만화\n슬라이더: 음높이, 속도, 베이스, 미드, 트레블, 리버브, 코러스, 디스토션, 볼륨\nWAV로 다운로드!";}
  if(/인터넷 테스트|속도 테스트|속도측정|ping|다운로드 속도/.test(qn)){ctx.lastTopic="internet";return "🌐 인터넷 테스트:\n• Ping (10s) — 지연 ms\n• 다운로드 (25s) — Mb/s\n• 업로드 (25s) — Mb/s\n• 평가: ❌나쁜~🏆우수\n• IP 지리적 위치 — 도시, 국가, ISP + 지도";}
  if(/반응 테스트|반응 시간|반사 신경/.test(qn)){ctx.lastTopic="reaction";return "⚡ 반응 테스트 — 3가지 모드:\n• 🖱️ 클릭 — 초록이 될 때 클릭\n• ⌨️ 스페이스\n• 🎲 선택 — ← 또는 →\n정밀도: 0.1ms. 인간 평균: 150–250ms.";}
  if(/마우스 테스트|클릭|cps|히트맵|에임/.test(qn)){ctx.lastTopic="mouse";return "🖥️ 마우스 테스트 — 3개 탭:\n• 🕹️ 움직임 — CPS, 지터, 거리, 정확도\n• 🔥 히트맵\n• 🎯 에임 트레이너 — 명중률%";}
  if(/키보드 테스트|키 입력 지연|input lag/.test(qn)){ctx.lastTopic="keyboard";return "🎹 키보드 테스트:\n• 시각적 키보드 하이라이트\n• 지연 ms\n• 타이핑 사운드 (30+ 프로파일)\n• 모든 105개 키 테스트!";}
  if(/스피커 테스트|오디오 테스트|청력 테스트/.test(qn)){ctx.lastTopic="speakers";return "🔊 스피커 테스트:\n• L/R 체널\n• 주파수 스윗 20Hz–20kHz\n• 톤 제생기\n• 청력 테스트 — 자신의 청력 범위 확인!";}
  if(/크로마키|그린스크린|배경 제거|가상 배경/.test(qn)){ctx.lastTopic="chroma";return "🎨 크로마키:\n1. 카메라 활성화\n2. 키 색상 선택\n3. 허용 범위 + 스무딩 + 스필\n4. 배경: 없음 / 색상 / 이미지 / 틀림\nWebM으로 녹화!";}
  if(/dns 조회|dns 레코드|도메인/.test(qn)){ctx.lastTopic="dns";return "🔍 DNS Lookup — 도메인 레코드 확인:\nA · AAAA · MX · NS · TXT · CNAME\n+ 서버 지리적 위치 + CDN 감지";}
  if(/공식 링크|앱 주소|netlify|어디서 찾/.test(qn))return "🌐 StudioTest 공식 링크:\n👉 https://charming-concha-550970.netlify.app/";
  if(/버전|현재 버전/.test(qn))return "📦 현재 버전: v7.4";
  if(/당신은 누구|이름이 띐아|ai 어시스턴트|븇인가요/.test(qn))return "🤖 StudioTest AI 어시스턴트입니다 — REV01이 Claude Opus로 만든 로컈 봇. API도 인터넷도 필요 없습니다!";
  if(/무엇을 할 수|어떻게 도와|어떤 질문/.test(qn))return "📋 답변 가능한 질문:\n🔧 StudioTest 15개 모듈\n💬 제작자, 버전, 링크, 개인정보, 언어\n🤖 나는 누구인가, 어떻게 작동하는가\n😂 유머와 재미있는 사실\n한국어로 자유롭게 쓰세요!";
  if(/무료|가격|돈|구독/.test(qn))return "💸 100% 무료! 비용, 구독, 광고 없습니다.";
  if(/개인정보|데이터|수집|추적/.test(qn))return "🔒 StudioTest는 데이터를 수집하지 않습니다. 모든 것이 로컈에서 작동됩니다. 광고 없음.";
  if(/오프라인|인터넷 없이|앱 다운로드/.test(qn))return "📶 네! studio-test.html(Ctrl+S) 다운로드 후 오프라인 사용 가능.";
  if(/언어|몇 개 언어|지원 언어/.test(qn))return "🌍 13개 언어: 폴란드어·영어·독일어·러시아어·우크라이나어·프랑스어·스페인어·이탈리아어·중국어·일본어·한국어·네덬란드어·포르투갈어";
  if(/휴대폰|모바일|android|iphone/.test(qn))return "📱 네! StudioTest는 모바일에서 작동합니다.";
  if(/농담|웃기다|유머/.test(qn))return rnd(["프로그래머들이 다크 모드를 좋아하는 이유? 빛이 버그를 끌어들이기 때문이에요! 🐛","Git 커밋: '각종 수정'. 뭐라는 뜻? 모르겠어요. 돼요. 만지지 마세요! 🔥","제 코드에는 버그가 없어요 — 예상치 못한 기능만 있을 뜻이에요. 🔥"]);
  if(/감사|춥았어|투렘어/.test(qn)){const n=ctx.userName?" "+ctx.userName+"님":"";return rnd(["천만에요"+n+"! 😊","도움이 되어 기쁨"+n+"! 🤖"]);}
  if(/안녕히 가|바이|bye/.test(qn)){const n=ctx.userName?" "+ctx.userName+"님":"";return rnd(["안녕히 가세요"+n+"! 👋","나중에 뼜요"+n+"! 😊"]);}
  return rnd(["음... 특정 모듈에 대해 묻어주세요! 🤔","죄송하지만 제 지식 범위를 벗어납니다. StudioTest에 대해 묻어주세요!","답이 없습니다. 🧩 하지만 StudioTest는 속속들이 알고 있어요!"]);
}

function aiBotGetReplyNl(q,ctx,h){
  if(!ctx)ctx=aiBotCtx;
  const nameM=q.match(/(?:ik heet|mijn naam is|ik ben|noem me)\s+([a-zA-Z]{2,20})/i);
  if(nameM){ctx.userName=nameM[1].charAt(0).toUpperCase()+nameM[1].slice(1);return rnd(["Aangenaam, **"+ctx.userName+"**! 😊 Vraag me alles over StudioTest!","Hallo **"+ctx.userName+"**! 🤖"]);}
  if(!ctx)ctx=aiBotCtx;
  const qn=q.toLowerCase();
  if(/hallo|goedemorgen|goedemiddag|goedenavond|hey |hi /.test(qn)){const n=ctx.userName?", "+ctx.userName:"";return rnd(["Hallo"+n+"! 👋 Ik ben de AI-assistent van StudioTest. Hoe kan ik helpen?","Hey"+n+"! 🤖 Waarmee kan ik je helpen?"]);}
  if(/hoe gaat het|hoe is het|alles goed/.test(qn))return rnd(["Uitstekend! 🤖 Wat wil je weten?","Geweldig! ⚡ Vraag maar!"]);
  if(/wie heeft het gemaakt|wie heeft studiotest gemaakt|maker|ontwikkelaar|auteur/.test(qn)){ctx.lastTopic="creator";return "👨‍💻 StudioTest is gemaakt door REV01 met hulp van Claude Opus (Anthropic). Een mens+AI project — één HTML-bestand, 16.000+ regels!";}
  if(/wat is studiotest|waarvoor dient het|deze applicatie/.test(qn))return "🎬 StudioTest is een gratis webapp om hardware direct in de browser te testen. Camera, microfoon, audio, muis, toetsenbord, internet — alles in één HTML-bestand!";
  if(/functies|modules|wat kan het|lijst van functies/.test(qn))return "📋 18 modules StudioTest:\n📷 Camera+filters+20 effecten · 🎤 Microfoon+FFT · 🎵 Stem(28 presets) · 🌐 Internettest · ⚡ Reactie · 🖥️ Muis · 🎹 Toetsenbord · 🔊 Luidsprekers · 📊 Prestaties · ℹ️ Systeem · 🎨 Chroma Key · 📡 Netwerk · 🔍 DNS · 🤖 AI · 📊 Rapport";
  if(/stemvervormer|stemeffect|stem preset|robotstem/.test(qn)){ctx.lastTopic="voice";return "🎵 Stemvervormer — 28 presets:\nRobot, Laag, Eekhoorn, Echo, Telefoon, Alien, Grot, Fluistering, Megafoon, Onderwater, Stadion, Demon, Helium, Radio, Vintage, Darth🌑, Reus, Geest, Koor, Trol, Muis, Horror, Engel, Walkie, Sonar, Dronken, Monster, Cartoon\nSchuifregelaars: Toonhoogte, Tempo, Bas, Midden, Hoog, Galm, Chorus, Vervorming, Volume\nAls WAV downloaden!";}
  if(/internettest|snelheidstest|internetsnelheid|ping|downloadsnelheid/.test(qn)){ctx.lastTopic="internet";return "🌐 Internettest:\n• Ping (10s) — latentie ms\n• Download (25s) — Mb/s\n• Upload (25s) — Mb/s\n• Beoordeling: van ❌ Slecht tot 🏆 Uitstekend\n• IP-geolocatie — stad, land, ISP + kaart";}
  if(/reactietest|reactietijd|reflexen/.test(qn)){ctx.lastTopic="reaction";return "⚡ Reactietest — 3 modi:\n• 🖱️ Klik — klik als het groen wordt\n• ⌨️ Spatiebalk\n• 🎲 Keuze — pijl ← of →\nPrecisie: 0,1ms. Gemiddeld mens: 150–250ms.";}
  if(/muistest|klikken|cps|warmtekaart|mikken/.test(qn)){ctx.lastTopic="mouse";return "🖥️ Muistest — 3 tabbladen:\n• 🕹️ Beweging — CPS, jitter, afstand, nauwkeurigheid\n• 🔥 Warmtekaart\n• 🎯 Miktraining — nauwkeurigheid%";}
  if(/toetsenbordtest|toetsvertraging|input lag/.test(qn)){ctx.lastTopic="keyboard";return "🎹 Toetsenbordtest:\n• Visueel toetsenbord met verlichting\n• Latentie ms\n• Toetsgeluiden (30+ profielen)\n• Test alle 105 toetsen!";}
  if(/luidspreker test|audio test|frequentiesweep|gehoortest/.test(qn)){ctx.lastTopic="speakers";return "🔊 Luidspreker test:\n• L/R Kanalen\n• Frequentiesweep 20Hz–20kHz\n• Toongenerator\n• Gehoortest — vind jouw gehoorbereik!";}
  if(/chroma key|groen scherm|achtergrond verwijderen|virtuele achtergrond/.test(qn)){ctx.lastTopic="chroma";return "🎨 Chroma Key:\n1. Camera activeren\n2. Sleutelkleur kiezen\n3. Tolerantie + Vloeiend + Spill\n4. Achtergrond: Geen / Kleur / Afbeelding / Onscherp\nOpnemen als WebM!";}
  if(/dns lookup|dns record|domein/.test(qn)){ctx.lastTopic="dns";return "🔍 DNS Lookup — controleert domeinrecords:\nA · AAAA · MX · NS · TXT · CNAME\n+ Servergeolocatie + CDN-detectie";}
  if(/officiële link|app link|netlify|waar vind ik/.test(qn))return "🌐 Officiële link StudioTest:\n👉 https://charming-concha-550970.netlify.app/";
  if(/versie|huidige versie/.test(qn))return "📦 Huidige versie: v7.4";
  if(/wie ben je|hoe heet je|ai.assistent|ben je een bot/.test(qn))return "🤖 Ik ben de AI-assistent van StudioTest — een lokale bot gemaakt door REV01 met Claude Opus. Geen API, geen internet nodig!";
  if(/wat kun je|wat weet je|welke onderwerpen|waarmee kan je helpen/.test(qn))return "📋 Ik kan antwoorden op:\n🔧 De 18 modules van StudioTest\n💬 Maker, versie, link, privacy, talen\n🤖 Wie ik ben, hoe ik werk\n😂 Grappen en weetjes\nStel gerust vragen in het Nederlands!";
  if(/gratis|prijs|betalen|abonnement/.test(qn))return "💸 100% gratis! Geen kosten, geen abonnement, geen reclame.";
  if(/privacy|gegevens|verzamelt|tracking/.test(qn))return "🔒 StudioTest verzamelt geen gegevens. Alles werkt lokaal in de browser. Geen reclame.";
  if(/offline|zonder internet|app downloaden/.test(qn))return "📶 Ja! Download studio-test.html (Ctrl+S) en gebruik het offline.";
  if(/talen|hoeveel talen|ondersteunde talen/.test(qn))return "🌍 13 talen: Pools · Engels · Duits · Russisch · Oekraïens · Frans · Spaans · Italiaans · Chinees · Japans · Koreaans · Nederlands · Portugees";
  if(/telefoon|mobiel|smartphone|android|iphone/.test(qn))return "📱 Ja! StudioTest werkt op mobiel. Beste: reactie, stem, DNS, AI.";
  if(/grap|mop|maak me aan het lachen|grappig/.test(qn))return rnd(["Waarom houden programmeurs van donkere modus? Omdat licht bugs aantrekt! 🐛","Git commit: 'diverse fixes'. Wat betekent dat? Geen idee. Werkt. Niet aanraken! 🔥","Mijn code heeft nooit bugs — alleen onverwachte functies. 🔥"]);
  if(/dankjewel|dank je|geweldig|perfect/.test(qn)){const n=ctx.userName?" "+ctx.userName:"";return rnd(["Graag gedaan"+n+"! 😊","Mijn plezier"+n+"! 🤖"]);}
  if(/doei|tot ziens|bye|goedenacht/.test(qn)){const n=ctx.userName?" "+ctx.userName:"";return rnd(["Doei"+n+"! 👋","Tot ziens"+n+"! 😊"]);}
  return rnd(["Hmm, ik weet het niet zeker. 🤔 Vraag me naar een specifieke module!","Sorry, gaat mijn kennis te boven. Stel een vraag over StudioTest!","Geen antwoord. 🧩 Maar ik ken StudioTest van binnen en buiten!"]);
}

function aiBotGetReplyPt(q,ctx,h){
  if(!ctx)ctx=aiBotCtx;
  const nameM=q.match(/(?:chamo-me|eu sou|meu nome é|o meu nome é|chama-me)\s+([a-zA-ZÀÁÂÃÇÉÊÍÓÔÕÚàáâãçéêíóôõú]{2,20})/i);
  if(nameM){ctx.userName=nameM[1].charAt(0).toUpperCase()+nameM[1].slice(1);return rnd(["Prazer, **"+ctx.userName+"**! 😊 Pergunta-me sobre StudioTest!","Olá **"+ctx.userName+"**! 🤖"]);}
  if(!ctx)ctx=aiBotCtx;
  const qn=q.toLowerCase();
  if(/olá|oi |bom dia|boa tarde|boa noite|hey |hi /.test(qn)){const n=ctx.userName?", "+ctx.userName:"";return rnd(["Olá"+n+"! 👋 Sou o assistente IA do StudioTest. Como posso ajudar?","Oi"+n+"! 🤖 Como posso ajudar?"]);}
  if(/como estás|como vai|tudo bem/.test(qn))return rnd(["Muito bem! 🤖 O que queres saber?","Excelente! ⚡ Pergunta!"]);
  if(/quem criou|quem fez|criador|desenvolvedor|autor/.test(qn)){ctx.lastTopic="creator";return "👨‍💻 StudioTest foi criado por REV01 com a ajuda de Claude Opus (Anthropic). Um projeto humano+IA — um ficheiro HTML, 16.000+ linhas!";}
  if(/o que é studiotest|para que serve|esta aplicação|esta app/.test(qn))return "🎬 StudioTest é uma app web gratuita para testar hardware diretamente no browser. Câmara, microfone, áudio, rato, teclado, internet — tudo num ficheiro HTML!";
  if(/funções|módulos|o que pode fazer|lista de funções|o que tem/.test(qn))return "📋 15 módulos StudioTest:\n📷 Câmara+filtros+20 efeitos · 🎤 Microfone+FFT · 🎵 Voz(28 presets) · 🌐 Internet · ⚡ Reação · 🖥️ Rato · 🎹 Teclado · 🔊 Altifalantes · 📊 Desempenho · ℹ️ Sistema · 🎨 Chroma Key · 📡 Rede · 🔍 DNS · 🤖 IA · 📊 Relatório";
  if(/modificador de voz|efeito de voz|preset de voz|voz de robô/.test(qn)){ctx.lastTopic="voice";return "🎵 Modificador de voz — 28 presets:\nRobô, Grave, Esquilo, Eco, Telefone, Alien, Caverna, Sus surro, Megafone, Subáquático, Estádio, Demónio, Hélio, Rádio, Vintage, Darth🌑, Gigante, Fantasma, Coro, Troll, Rato, Horror, Anjo, Walkie, Sonar, Bêbado, Monstro, Cartoon\nControlos: Tom, Velocidade, Graves, Médios, Agudos, Reverb, Chorus, Distorção, Volume\nDescarregar como WAV!";}
  if(/teste de internet|teste de velocidade|velocidade de internet|ping|velocidade de download/.test(qn)){ctx.lastTopic="internet";return "🌐 Teste de internet:\n• Ping (10s) — latência ms\n• Download (25s) — Mb/s\n• Upload (25s) — Mb/s\n• Avaliação: de ❌ Mau a 🏆 Excelente\n• Geoloc IP — cidade, país, ISP + mapa";}
  if(/teste de reação|tempo de reação|reflexos/.test(qn)){ctx.lastTopic="reaction";return "⚡ Teste de reação — 3 modos:\n• 🖱️ Clique — clica quando fica verde\n• ⌨️ Espaço\n• 🎲 Escolha — seta ← ou →\nPrecisão: 0,1ms. Humano médio: 150–250ms.";}
  if(/teste de rato|cliques|cps|mapa de calor|treino de mira/.test(qn)){ctx.lastTopic="mouse";return "🖥️ Teste de rato — 3 separadores:\n• 🕹️ Movimento — CPS, jitter, distância, precisão\n• 🔥 Mapa de calor\n• 🎯 Mira — precisão%";}
  if(/teste de teclado|atraso de tecla|input lag/.test(qn)){ctx.lastTopic="keyboard";return "🎹 Teste de teclado:\n• Teclado visual com retroiluminação\n• Latência ms\n• Sons de teclas (30+ perfis)\n• Testa todas as 105 teclas!";}
  if(/teste de altifalantes|teste de áudio|canal esquerdo|frequencia|teste de audição/.test(qn)){ctx.lastTopic="speakers";return "🔊 Teste de altifalantes:\n• Canais L/R\n• Varrimento de frequências 20Hz–20kHz\n• Gerador de tons\n• Teste de audição!";}
  if(/chroma key|ecrã verde|remoção de fundo|fundo virtual/.test(qn)){ctx.lastTopic="chroma";return "🎨 Chroma Key:\n1. Ativar câmara\n2. Escolher cor-chave\n3. Tolerância + Suavização + Derrame\n4. Fundo: Nenhum / Cor / Imagem / Desfocado\nGravar como WebM!";}
  if(/dns lookup|registo dns|domínio/.test(qn)){ctx.lastTopic="dns";return "🔍 DNS Lookup — verifica registos de domínio:\nA · AAAA · MX · NS · TXT · CNAME\n+ Geolocalização servidor + deteção CDN";}
  if(/link oficial|url da app|netlify|onde encontrar/.test(qn))return "🌐 Link oficial StudioTest:\n👉 https://charming-concha-550970.netlify.app/";
  if(/versão|versão atual/.test(qn))return "📦 Versão atual: v7.4";
  if(/quem és|como te chamas|assistente ia|és um bot/.test(qn))return "🤖 Sou o assistente IA do StudioTest — um bot local criado por REV01 com Claude Opus. Sem API, sem internet necessário!";
  if(/o que podes fazer|o que sabes|quais os temas|como podes ajudar/.test(qn))return "📋 Posso responder sobre:\n🔧 Os 15 módulos do StudioTest\n💬 Criador, versão, link, privacidade, línguas\n🤖 Quem sou, como funciono\n😂 Piadas e curiosidades\nEscreve livremente em português!";
  if(/gratuito|preço|pagar|subscrição/.test(qn))return "💸 100% gratuito! Sem custos, sem subscrição, sem anúncios.";
  if(/privacidade|dados|recolhe|rastreamento/.test(qn))return "🔒 StudioTest não recolhe quaisquer dados. Tudo funciona localmente no browser. Sem anúncios.";
  if(/offline|sem internet|sem wifi|descarregar a app/.test(qn))return "📶 Sim! Descarrega studio-test.html (Ctrl+S) e usa offline.";
  if(/línguas|quantas línguas|língua suportada/.test(qn))return "🌍 13 línguas: Polaco · Inglês · Alemão · Russo · Ucraniano · Francês · Espanhol · Italiano · Chinês · Japonês · Coreano · Neerlandês · Português";
  if(/telefone|telemóvel|smartphone|android|iphone/.test(qn))return "📱 Sim! StudioTest funciona no telemóvel. Melhor: reação, voz, DNS, IA.";
  if(/piada|brincadeira|faz-me rir|engraçado/.test(qn))return rnd(["Porque os programadores preferem o modo escuro? Porque a luz atrai bugs! 🐛","Git commit: 'várias correções'. O que significa? Não sei. Funciona. Não tocar! 🔥","O meu código nunca tem bugs — só funcionalidades inesperadas. 🔥"]);
  if(/obrigado|obrigada|ótimo|perfeito|excelente/.test(qn)){const n=ctx.userName?" "+ctx.userName:"";return rnd(["De nada"+n+"! 😊","Com prazer"+n+"! 🤖"]);}
  if(/adeus|tchau|até logo|boa noite/.test(qn)){const n=ctx.userName?" "+ctx.userName:"";return rnd(["Adeus"+n+"! 👋","Até logo"+n+"! 😊"]);}
  return rnd(["Hmm, não tenho a certeza. 🤔 Pergunta-me sobre um módulo específico!","Desculpa, está fora dos meus conhecimentos. Pergunta sobre o StudioTest!","Sem resposta. 🧩 Mas conheço o StudioTest de alto a baixo!"]);
}



async function dnsAppendExtra(domain, container) {
  const extra = [];
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    let r;
    try { r = await fetch(`https://ip-api.com/json/${domain}?fields=status,city,country,org,as,proxy`, {cache:'no-store'}); }
    finally { clearTimeout(t); }
    if(r.ok) {
      const gd = await r.json();
      if(gd.status === 'success') {
        if(gd.city)    extra.push(['🌍 Lokalizacja', `${gd.city}, ${gd.country}`]);
        if(gd.org)     extra.push(['🏢 Organizacja', gd.org]);
        if(gd.proxy)   extra.push(['🔒 VPN/Proxy', 'Wykryto']);
        if(gd.as)      extra.push(['📡 ASN', gd.as]);
        // Wykryj CDN
        const orgLow = (gd.org||'').toLowerCase();
        const cdns = {'cloudflare':'Cloudflare','amazon':'AWS/Amazon','google':'Google Cloud','fastly':'Fastly','akamai':'Akamai','vercel':'Vercel','netlify':'Netlify','microsoft':'Microsoft Azure','digitalocean':'DigitalOcean','linode':'Linode/Akamai','ovh':'OVH','hetzner':'Hetzner'};
        for(const [key, name] of Object.entries(cdns)) {
          if(orgLow.includes(key)) { extra.push(['⚡ CDN/Host', name]); break; }
        }
      }
    }
  } catch(e) {}

  if(extra.length) {
    let html = `<div style="background:rgba(249,115,22,0.05);border:1px solid rgba(249,115,22,0.15);border-radius:10px;padding:12px;">
      <div style="font-family:'Space Mono',monospace;font-size:8px;color:rgba(249,115,22,0.6);letter-spacing:2px;margin-bottom:8px;">🌐 INFORMACJE O SERWERZE</div>`;
    extra.forEach(([k,v]) => {
      html += `<div style="display:flex;gap:10px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
        <span style="font-family:'Space Mono',monospace;font-size:9px;color:rgba(255,255,255,0.35);min-width:120px;">${k}</span>
        <span style="font-family:'Space Mono',monospace;font-size:9px;color:#fff;">${v}</span>
      </div>`;
    });
    html += '</div>';
    container.innerHTML += html;
  }
}


function dnsHeader(target, isReverse) {
  const now = new Date().toLocaleTimeString('pl-PL');
  return `<div style="background:rgba(249,115,22,0.08);border:1px solid rgba(249,115,22,0.2);border-radius:10px;padding:12px;display:flex;align-items:center;gap:12px;">
    <div style="font-size:28px;">${isReverse ? '📡' : '🌐'}</div>
    <div style="flex:1;">
      <div style="font-family:'Space Mono',monospace;font-size:14px;color:#f97316;font-weight:700;">${target}</div>
      <div style="font-family:'Space Mono',monospace;font-size:8px;color:rgba(255,255,255,0.3);margin-top:2px;">${isReverse ? 'Reverse DNS lookup' : 'Forward DNS lookup'} · ${now}</div>
    </div>
  </div>`;
}

function dnsSection(type, answers, domain) {
  const typeColors = { A:'#00f5a0', AAAA:'#06b6d4', MX:'#a855f7', NS:'#f5c400', TXT:'#ec4899', CNAME:'#f97316', SOA:'rgba(255,255,255,0.5)', PTR:'#22c55e', 'PTR (Reverse)':'#22c55e' };
  const color = typeColors[type] || '#fff';
  let rows = '';
  answers.forEach(rec => {
    const val  = rec.data || '—';
    const ttl  = rec.TTL  ? `TTL: ${rec.TTL}s` : '';
    rows += `<div style="display:flex;align-items:start;gap:10px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
      <div style="font-family:'Space Mono',monospace;font-size:9px;color:${color};background:rgba(255,255,255,0.04);padding:2px 7px;border-radius:4px;min-width:52px;text-align:center;flex-shrink:0;">${type}</div>
      <div style="flex:1;font-family:'Space Mono',monospace;font-size:9px;color:#fff;word-break:break-all;">${dnsFormatVal(type, val)}</div>
      <div style="font-family:'Space Mono',monospace;font-size:8px;color:rgba(255,255,255,0.25);flex-shrink:0;">${ttl}</div>
    </div>`;
  });
  return `<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:10px;padding:12px;">
    <div style="font-family:'Space Mono',monospace;font-size:8px;color:${color};letter-spacing:2px;margin-bottom:6px;">📋 ${type} RECORDS</div>
    ${rows}
  </div>`;
}

function dnsRow(type, val, extra) {
  return `<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:10px;padding:12px;font-family:'Space Mono',monospace;font-size:9px;">
    <span style="color:#f97316;">${type}</span>
    <span style="color:#fff;margin-left:10px;">${val}</span>
    ${extra ? `<span style="color:rgba(255,255,255,0.35);margin-left:10px;">${extra}</span>` : ''}
  </div>`;
}

function dnsFormatVal(type, val) {
  if(type === 'TXT') return `<span style="color:rgba(255,255,255,0.7);">"${val.replace(/"/g,'')}"</span>`;
  if(type === 'MX')  { const parts = val.split(' '); return `<span style="color:#f5c400;">prio ${parts[0]}</span> <span>${parts[1] || ''}</span>`; }
  return val;
}

// ══════════════════════════════════════════════════════════════
// NETWORK SCANNER
// ══════════════════════════════════════════════════════════════

let nscanRunning = false;

function openNetworkScanner() {
  document.getElementById('nscanModal').classList.add('show');
  nscanRun();
}
function closeNetworkScanner() {
  document.getElementById('nscanModal').classList.remove('show');
  nscanRunning = false;
}

async function nscanDetectMyInfo() {
}

// ── Główna funkcja skanowania ──
async function nscanRun() {
  if(nscanRunning) return;
  nscanRunning = true;

  const btn     = document.getElementById('nscanBtn');
  const bar     = document.getElementById('nscanBar');
  const status  = document.getElementById('nscanStatus');
  const devList = document.getElementById('nscanDevices');

  btn.disabled = true;
  btn.textContent = '⏳ Wykrywanie...';
  devList.innerHTML = '';
  bar.style.width = '0%';
  status.textContent = '🔍 WebRTC — szukam IP...';

  // ── Krok 1: WebRTC IP discovery ──
  const ips = await new Promise(resolve => {
    const found = new Set();
    let done = false;
    const finish = () => { if(done) return; done = true; try{pc.close();}catch(e){} resolve([...found]); };
    try {
      const pc = new RTCPeerConnection({ iceServers: [
        {urls:'stun:stun.l.google.com:19302'},
        {urls:'stun:stun1.l.google.com:19302'},
        {urls:'stun:stun.cloudflare.com:3478'},
      ]});
      pc.createDataChannel('');
      pc.onicecandidate = e => {
        if(!e||!e.candidate){finish();return;}
        const m=/([0-9]{1,3}(?:\.[0-9]{1,3}){3}|[a-f0-9:]{3,}(?:%[a-z0-9]+)?)/.exec(e.candidate.candidate);
        if(m) found.add(m[1].split('%')[0]);
      };
      pc.onicegatheringstatechange = () => { if(pc.iceGatheringState==='complete') finish(); };
      pc.createOffer().then(o=>pc.setLocalDescription(o)).catch(finish);
      setTimeout(finish, 5000);
    } catch(e) { resolve([]); }
  });

  bar.style.width = '20%';

  const ip4s = ips.filter(ip => /^\d+\.\d+\.\d+\.\d+$/.test(ip) && !ip.startsWith('127.') && !ip.startsWith('169.254.'));
  const ip6s = ips.filter(ip => ip.includes(':') && !ip.startsWith('::1'));
  const ip4  = ip4s[0];

  if(!ip4) {
    devList.innerHTML = '<div style="padding:20px;text-align:center;font-family:Space Mono,monospace;font-size:10px;color:rgba(255,255,255,0.3);">WebRTC zablokowane — brak lokalnego IP.<br>Sprawdź ustawienia przeglądarki.</div>';
    nscanFinish(btn, bar, status); return;
  }

  // ── Krok 2: Publiczne IP przez XHR (omija SW Netlify) ──
  status.textContent = '🌍 Pobieram publiczne IP...';
  let pubIp=null, isp=null, city=null, country=null, lat=null, lon=null;

  // XHR do cloudflare trace (zawsze działa)
  const cfTrace = await new Promise(resolve => {
    const x = new XMLHttpRequest();
    x.open('GET','https://1.1.1.1/cdn-cgi/trace',true);
    x.timeout = 5000;
    x.onload = () => {
      const get = k => { const m=new RegExp('^'+k+'=(.+)$','m').exec(x.responseText); return m?m[1].trim():null; };
      resolve({ ip: get('ip'), cc: get('loc'), colo: get('colo') });
    };
    x.onerror = x.ontimeout = () => resolve({});
    x.send();
  });
  pubIp = cfTrace.ip;

  // XHR do ipinfo.io dla geolokalizacji
  if(pubIp) {
    const geo = await new Promise(resolve => {
      const x = new XMLHttpRequest();
      x.open('GET','https://ipinfo.io/json',true);
      x.timeout = 5000;
      x.onload = () => { try { resolve(JSON.parse(x.responseText)); } catch(e){ resolve({}); } };
      x.onerror = x.ontimeout = () => resolve({});
      x.send();
    });
    isp = geo.org; city = geo.city; country = geo.country;
    if(geo.loc) { const [a,b]=geo.loc.split(','); lat=parseFloat(a); lon=parseFloat(b); }
  }

  bar.style.width = '45%';

  // ── Krok 3: NAT type ──
  status.textContent = '🔀 Wykrywam typ NAT...';
  const natType = await new Promise(resolve => {
    const types = new Set(); let done = false;
    const finish = () => {
      if(done) return; done = true; try{pc.close();}catch(e){}
      if(types.has('srflx')&&types.has('relay')) resolve('Symmetric NAT');
      else if(types.has('srflx')) resolve('Full Cone / Open');
      else if(types.has('relay')) resolve('Restricted');
      else if(types.has('host')) resolve('No NAT');
      else resolve('Nieznany');
    };
    try {
      const pc = new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'},{urls:'stun:stun.cloudflare.com:3478'}]});
      pc.createDataChannel('nat');
      pc.onicecandidate = e => { if(!e||!e.candidate){finish();return;} if(e.candidate.type) types.add(e.candidate.type); };
      pc.onicegatheringstatechange = () => { if(pc.iceGatheringState==='complete') finish(); };
      pc.createOffer().then(o=>pc.setLocalDescription(o)).catch(finish);
      setTimeout(finish, 4000);
    } catch(e) { resolve('Nieznany'); }
  });

  bar.style.width = '65%';

  // ── Render urządzeń ──
  const base = ip4.split('.').slice(0,3).join('.');
  const gw   = base + '.1';

  nscanRenderDevice({ ip: ip4, label: '💻 To urządzenie (LAN IP)', sublabel: 'Twój komputer · lokalne IP', ping: '< 1ms', color: '#06b6d4',
    extra: ip6s.length ? 'IPv6: '+ip6s[0].substring(0,32)+'…' : null }, devList);

  nscanRenderDevice({ ip: pubIp||'—', label: '🌍 Publiczne IP (WAN)', sublabel: [isp,city,country].filter(Boolean).join(' · ')||'—', ping: '—', color: '#a855f7',
    extra: lat&&lon ? `📍 ${lat.toFixed(3)}, ${lon.toFixed(3)}` : null }, devList);

  nscanRenderDevice({ ip: gw, label: '🌐 Router / Gateway', sublabel: 'Brama domyślna · '+base+'.0/24', ping: '~1–5ms', color: '#00f5a0',
    extra: 'NAT: '+natType }, devList);

  ip4s.filter(ip=>ip!==ip4&&ip!==gw).forEach(ip => {
    const last=parseInt(ip.split('.')[3]);
    const {label,sublabel}=nscanIdentify(last,15);
    nscanRenderDevice({ip,label,sublabel,ping:'~10ms',color:'#f59e0b'},devList);
  });

  ip6s.filter(ip=>!ip.startsWith('fc')&&!ip.startsWith('fd')).forEach(ip => {
    nscanRenderDevice({ip:ip.length>30?ip.substring(0,30)+'…':ip,label:'🌐 IPv6 (globalny)',sublabel:'Publiczny adres IPv6',ping:'—',color:'#818cf8'},devList);
  });

  // ── Krok 4: Reverse DNS przez XHR (Google DoH) ──
  status.textContent = '🏷️ Rozwiązuję nazwy...';
  bar.style.width = '85%';

  await Promise.all([ip4, gw].map(ip => new Promise(resolve => {
    const rev = ip.split('.').reverse().join('.')+'.in-addr.arpa';
    const x = new XMLHttpRequest();
    x.open('GET',`https://dns.google/resolve?name=${rev}&type=PTR`,true);
    x.timeout = 3000;
    x.onload = () => {
      try {
        const d=JSON.parse(x.responseText);
        const ptr=d?.Answer?.[0]?.data;
        if(ptr) {
          devList.querySelectorAll('[data-ip]').forEach(el => {
            if(el.getAttribute('data-ip')===ip) {
              const sub=el.querySelector('.nscan-sub');
              if(sub) sub.textContent=(sub.textContent?sub.textContent+' · ':'')+ptr.replace(/\.$/,'');
            }
          });
        }
      } catch(e){}
      resolve();
    };
    x.onerror=x.ontimeout=resolve;
    x.send();
  })));

  bar.style.width = '100%';
  const count = devList.querySelectorAll('[data-dev]').length;
  status.textContent = `✅ Znaleziono ${count} urządzeń/interfejsów`;
  nscanFinish(btn, bar, status);
}

function nscanIdentify(lastOctet, ping) {
  if(lastOctet === 1 || lastOctet === 254)
    return { label: '🌐 Router / Gateway',      sublabel: 'Brama domyślna sieci' };
  if(lastOctet === 2)
    return { label: '📶 Access Point',           sublabel: 'Dodatkowy punkt dostępu' };
  if(ping < 5)
    return { label: '🖥️ Komputer (Ethernet)',    sublabel: 'Bardzo niskie opóźnienie' };
  if(ping < 30)
    return { label: '💻 Urządzenie lokalne',     sublabel: 'Sieć lokalna' };
  return   { label: '❓ Nieznane urządzenie',    sublabel: 'Urządzenie sieciowe' };
}

function nscanRenderDevice(dev, container) {
  const color = dev.color || '#06b6d4';
  const el = document.createElement('div');
  el.setAttribute('data-dev','1');
  el.setAttribute('data-ip', dev.ip);
  el.style.cssText = 'display:flex;align-items:center;gap:12px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-left:3px solid '+color+';border-radius:10px;padding:10px 14px;';
  const icon = dev.label.split(' ')[0];
  const labelText = dev.label.split(' ').slice(1).join(' ');
  el.innerHTML = '<div style="font-size:20px;min-width:26px;">'+icon+'</div>'
    +'<div style="flex:1;min-width:0;">'
    +'<div style="font-family:\'Space Mono\',monospace;font-size:11px;color:#fff;font-weight:700;">'+dev.ip+'</div>'
    +'<div style="font-family:\'Space Mono\',monospace;font-size:9px;color:'+color+';margin-top:2px;">'+labelText+'</div>'
    +'<div class=\"nscan-sub\" style=\"font-family:\'Space Mono\',monospace;font-size:8px;color:rgba(255,255,255,0.3);margin-top:2px;\">'+(dev.sublabel||'')+'</div>'
    +(dev.extra ? '<div style=\"font-family:\'Space Mono\',monospace;font-size:7px;color:rgba(255,255,255,0.2);margin-top:2px;\">'+dev.extra+'</div>' : '')
    +'</div>'
    +'<div style=\"font-family:\'Space Mono\',monospace;font-size:9px;color:'+color+';background:rgba(255,255,255,0.05);border-radius:6px;padding:3px 8px;white-space:nowrap;\">'+(dev.ping||'—')+'</div>';
  container.appendChild(el);
}
function nscanFinish(btn, bar, status) {
  nscanRunning = false;
  btn.disabled = false;
  btn.textContent = '↺ ODŚWIEŻ';
  bar.style.width = '100%';
}

// ══════════════════════════════════════════════════════════════
// RAPORT SESJI
// ══════════════════════════════════════════════════════════════

function openReport() {
  document.getElementById('reportModal').classList.add('show');
  renderReport();
}
function closeReport() {
  document.getElementById('reportModal').classList.remove('show');
}

function collectData() {
  const now = new Date().toLocaleString();
  const data = { time: now, sections: [] };

  // ── Reakcja ──
  if(rtResults.length > 0) {
    const avg  = Math.round(rtResults.reduce((a,b)=>a+b,0)/rtResults.length);
    const best = Math.min(...rtResults);
    const last = rtResults[rtResults.length-1];
    let rank = avg < 150 ? '🚀 Élite' : avg < 200 ? '⚡ Bardzo dobry' : avg < 250 ? '✅ Dobry' : avg < 350 ? '👍 Przeciętny' : avg < 500 ? '🐢 Poniżej średniej' : '😴 Wolny';
    data.sections.push({
      icon: '⚡', title: 'Test reakcji',
      color: '#a855f7',
      rows: [
        ['Prób', rtResults.length],
        ['Średnia', avg + ' ms'],
        ['Najlepszy', best + ' ms'],
        ['Ostatni', last + ' ms'],
        ['Ocena', rank],
      ]
    });
  }

  // ── Internet ──
  const dl = document.getElementById('valDown')?.textContent;
  const ul = document.getElementById('valUp')?.textContent;
  const ping = document.getElementById('valPing')?.textContent;
  if(dl && dl !== '—') {
    data.sections.push({
      icon: '🌐', title: 'Test internetu',
      color: '#00b4d8',
      rows: [
        ['Pobieranie', dl + ' Mb/s'],
        ['Wysyłanie', ul + ' Mb/s'],
        ['Ping', ping + ' ms'],
        ['Wideo 4K', document.getElementById('rateStream')?.textContent || '—'],
        ['Gry online', document.getElementById('rateGame')?.textContent || '—'],
      ]
    });
  }

  // ── Mikrofon ──
  if(peakDb > -Infinity && peakDb !== -Infinity) {
    const floor = document.getElementById('noiseFloor')?.textContent;
    const snr   = document.getElementById('snrVal')?.textContent;
    data.sections.push({
      icon: '🎤', title: 'Test mikrofonu',
      color: '#00f5a0',
      rows: [
        ['Peak dB', peakDb.toFixed(1) + ' dB'],
        ['Szum tła', floor || '—'],
        ['SNR', snr || '—'],
      ]
    });
  }

  // ── FPS Test ──
  if(fpsHistory.length > 0) {
    const fpsAvg  = Math.round(fpsHistory.reduce((a,b)=>a+b,0)/fpsHistory.length);
    const fpsSorted = [...fpsHistory].sort((a,b)=>a-b);
    const fpsMinR = fpsSorted[0];
    const fpsMaxR = fpsSorted[fpsSorted.length-1];
    const fps1pctR = fpsSorted[Math.max(0,Math.floor(fpsSorted.length*0.01))];
    const avgFt = fpsFrameTimes.length ? (fpsFrameTimes.reduce((a,b)=>a+b,0)/fpsFrameTimes.length).toFixed(1) : '—';
    const variance = fpsHistory.reduce((s,v)=>s+Math.pow(v-fpsAvg,2),0)/fpsHistory.length;
    const stability = Math.max(0,Math.min(100,Math.round(100-Math.sqrt(variance)/Math.max(fpsAvg,1)*100)));
    const hz = fpsMonitorHz || 60;
    let fpsRankR = fpsAvg >= hz*0.95 ? '🏆 Doskonały — pełne Hz monitora'
                 : fpsAvg >= 144 ? '🚀 Pro level (144+ fps)'
                 : fpsAvg >= 120 ? '🎯 Competitive (120+ fps)'
                 : fpsAvg >= 90  ? '🏃 Płynny gaming (90+ fps)'
                 : fpsAvg >= 60  ? '✅ Esport minimum (60+ fps)'
                 : fpsAvg >= 30  ? '⚡ Akceptowalny (30+ fps)'
                 : '❌ Słaby — widoczne zacinanie';

    // % czasu powyżej targetFps (używamy wartości z selektora jeśli dostępna)
    const target = window._fpsTarget || 60;
    const aboveTarget = fpsHistory.filter(v=>v>=target).length;
    const abovePct = Math.round(aboveTarget/fpsHistory.length*100);

    const rows = [
      ['Monitor Hz', hz + ' Hz'],
      ['Śr. FPS', fpsAvg + ' fps'],
      ['Min FPS', fpsMinR + ' fps'],
      ['Max FPS', fpsMaxR + ' fps'],
      ['1% Low', fps1pctR + ' fps'],
      ['Śr. czas klatki', avgFt + ' ms'],
      ['Stabilność', stability + '%'],
      ['Dropped frames', fpsDropped],
      ['Spikes', fpsSpikes],
      ['Próbki', fpsHistory.length],
      [`≥${target} fps`, abovePct + '% czasu'],
      ['Ocena', fpsRankR],
    ];
    if(window._fpsTargetLabel) rows.splice(10, 0, ['Cel FPS', window._fpsTargetLabel]);
    data.sections.push({
      icon: '🎮', title: 'Test FPS',
      color: '#f59e0b',
      rows,
      fpsSnapshot: fpsHistory.slice(), // for mini chart
    });
  }

  // ── Wydajność ──
  if(pmFpsHistory.length > 0) {
    const avgFps = Math.round(pmFpsHistory.reduce((a,b)=>a+b,0)/pmFpsHistory.length);
    const minFps = Math.min(...pmFpsHistory);
    data.sections.push({
      icon: '📈', title: 'Monitor wydajności',
      color: '#f5c400',
      rows: [
        ['Śr. FPS', avgFps + ' fps'],
        ['Min FPS', minFps + ' fps'],
        ['Rdzenie CPU', navigator.hardwareConcurrency || '—'],
        ['RAM (deklarowana)', navigator.deviceMemory ? navigator.deviceMemory + '+ GB' : '—'],
        ['Rozdzielczość', screen.width + '×' + screen.height],
      ]
    });
  }

  // ── Mysz / Cel Shooting ──
  if(mClicks_v > 0) {
    data.sections.push({
      icon: '🖱️', title: 'Test myszy',
      color: '#ff9a3c',
      rows: [
        ['Kliknięcia', mClicks_v],
        ['Max CPS', mMaxCps_v],
        ['Dystans', Math.round(mDist_v) + ' px'],
      ]
    });
  }
  if(celHits_v > 0 || celMiss_v > 0) {
    const acc = celHits_v + celMiss_v > 0 ? Math.round(celHits_v/(celHits_v+celMiss_v)*100) : 0;
    data.sections.push({
      icon: '🎯', title: 'Cel shooting',
      color: '#ff4d6d',
      rows: [
        ['Trafienia', celHits_v],
        ['Chybienia', celMiss_v],
        ['Celność', acc + '%'],
        ['Wynik', celScore_v + ' pkt'],
      ]
    });
  }

  // ── CSP Tester ──
  if(window._cspLastResult) {
    const csp = window._cspLastResult;
    const scoreLabel = csp.hasCsp === false ? '❌ Brak CSP'
      : csp.score >= 80 ? '✅ Bezpieczny (' + csp.score + '%)'
      : csp.score >= 50 ? '⚡ Częściowy (' + csp.score + '%)'
      : '❌ Słaby (' + csp.score + '%)';
    const rows = [
      ['URL', csp.url ? csp.url.replace(/^https?:\/\//, '').slice(0, 40) : '—'],
      ['HTTP status', csp.status || '—'],
      ['Czas skanowania', csp.time || '—'],
      ['CSP obecny', csp.hasCsp ? (csp.reportOnly ? '⚠️ Report-Only' : '✅ Tak') : '❌ Nie'],
      ['Wynik bezpieczeństwa', csp.scoreRaw || '—'],
      ['Ocena', scoreLabel],
    ];
    if(csp.failedChecks && csp.failedChecks.length) {
      rows.push(['Problemy', csp.failedChecks.slice(0,3).join('; ')]);
    }
    data.sections.push({ icon: '🛡️', title: 'CSP Tester', color: '#10b981', rows });
  }

  // ── System ──
  data.sections.push({
    icon: '💻', title: 'System',
    color: '#67e8f9',
    rows: [
      ['Przeglądarka', navigator.userAgent.split(' ').slice(-2).join(' ')],
      ['Platforma', navigator.platform || '—'],
      ['Język systemu', navigator.language || '—'],
      ['Strefa czasowa', Intl.DateTimeFormat().resolvedOptions().timeZone || '—'],
      ['Ekran', screen.width + '×' + screen.height + ' @ ' + (window.devicePixelRatio||1) + 'x'],
    ]
  });

  return data;
}

function renderReport() {
  const data = collectData();
  const container = document.getElementById('reportContent');

  // Timestamp
  container.innerHTML = `
    <div style="font-family:'Space Mono',monospace;font-size:9px;color:rgba(255,255,255,0.3);letter-spacing:2px;border-bottom:1px solid rgba(255,255,255,0.06);padding-bottom:10px;">
      StudioTest v7.8 · ${data.time}
    </div>`;

  if(data.sections.length === 0) {
    container.innerHTML += `<div style="font-family:'Space Mono',monospace;font-size:11px;color:rgba(255,255,255,0.3);text-align:center;padding:30px;">
      Brak danych — najpierw uruchom kilka testów
    </div>`;
    return;
  }

  data.sections.forEach(sec => {
    const rows = sec.rows.map(([k,v]) => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
        <span style="font-family:'Space Mono',monospace;font-size:9px;color:rgba(255,255,255,0.35);letter-spacing:1px;">${k}</span>
        <span style="font-family:'Space Mono',monospace;font-size:11px;color:#fff;font-weight:700;">${v}</span>
      </div>`).join('');

    // Mini FPS chart for the FPS section
    let miniChart = '';
    if(sec.fpsSnapshot && sec.fpsSnapshot.length > 1) {
      const uid = 'miniChart_' + Date.now();
      miniChart = `<canvas id="${uid}" height="40" style="width:100%;border-radius:6px;margin-top:8px;display:block;background:rgba(0,5,15,0.6);"></canvas>`;
      setTimeout(() => {
        const c = document.getElementById(uid);
        if(!c) return;
        c.width = c.offsetWidth || 400;
        const W = c.width, H = 40, ctx = c.getContext('2d');
        const hist = sec.fpsSnapshot;
        const mx = Math.max(...hist, 60) * 1.1;
        const pts = hist.map((v,i) => ({ x:(i/Math.max(hist.length-1,1))*W, y:H-(v/mx)*(H-6)-3 }));
        const g = ctx.createLinearGradient(0,0,0,H);
        g.addColorStop(0,'rgba(245,158,11,0.3)'); g.addColorStop(1,'rgba(245,158,11,0.02)');
        ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
        for(let i=1;i<pts.length;i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.lineTo(W,H); ctx.lineTo(0,H); ctx.closePath();
        ctx.fillStyle = g; ctx.fill();
        ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
        for(let i=1;i<pts.length;i++) ctx.lineTo(pts[i].x, pts[i].y);
        const avg = Math.round(hist.reduce((a,b)=>a+b,0)/hist.length);
        ctx.strokeStyle = avg>=55?'#22c55e':avg>=30?'#f59e0b':'#ef4444';
        ctx.lineWidth = 1.5; ctx.shadowBlur=6; ctx.shadowColor=ctx.strokeStyle; ctx.stroke(); ctx.shadowBlur=0;
      }, 50);
    }

    container.innerHTML += `
      <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-left:3px solid ${sec.color};border-radius:10px;padding:12px 14px;">
        <div style="font-family:'Space Mono',monospace;font-size:11px;color:${sec.color};letter-spacing:2px;font-weight:700;margin-bottom:8px;">${sec.icon} ${sec.title.toUpperCase()}</div>
        ${rows}
        ${miniChart}
      </div>`;
  });
}

function reportDownload() {
  const data = collectData();
  let html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>StudioTest Raport — ${data.time}</title>
<style>
  body{font-family:'Segoe UI',sans-serif;background:#0a0a0f;color:#fff;max-width:700px;margin:40px auto;padding:0 20px;}
  h1{color:#00f5a0;font-size:24px;margin-bottom:4px;}
  .ts{color:rgba(255,255,255,0.3);font-size:12px;margin-bottom:30px;}
  .sec{background:#111118;border-left:3px solid var(--c);border-radius:8px;padding:16px;margin-bottom:14px;}
  .sec h2{color:var(--c);font-size:13px;margin:0 0 12px;letter-spacing:2px;}
  .row{display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.06);font-size:13px;}
  .row span:first-child{color:rgba(255,255,255,0.4);}
  .row span:last-child{font-weight:700;}
</style></head><body>
<h1>📊 StudioTest Raport sesji</h1>
<div class="ts">${data.time}</div>`;

  data.sections.forEach(sec => {
    html += `<div class="sec" style="--c:${sec.color}"><h2>${sec.icon} ${sec.title.toUpperCase()}</h2>`;
    sec.rows.forEach(([k,v]) => { html += `<div class="row"><span>${k}</span><span>${v}</span></div>`; });
    html += `</div>`;
  });

  html += `</body></html>`;

  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([html], {type:'text/html'}));
  a.download = `studiotest-raport-${Date.now()}.html`;
  a.click();
  toast(t('toast_report_downloaded'), 'ok');
}

function reportCopy() {
  const data = collectData();
  let txt = `StudioTest v7.8 — Raport sesji\n${data.time}\n${'═'.repeat(40)}\n\n`;
  data.sections.forEach(sec => {
    txt += `${sec.icon} ${sec.title.toUpperCase()}\n${'─'.repeat(30)}\n`;
    sec.rows.forEach(([k,v]) => { txt += `${k.padEnd(20)} ${v}\n`; });
    txt += '\n';
  });
  navigator.clipboard.writeText(txt).then(() => toast(t('toast_copied'), 'ok')).catch(() => toast(t('toast_copy_err'), 'error'));
}

// ══════════════════════════════════════════════════════════════
function closeReactionTest() {
  document.getElementById('reactionModal').classList.remove('show');
  rtAbort();
  rtState = 'idle';
  if(rtKeyListener) { document.removeEventListener('keydown', rtKeyListener); rtKeyListener = null; }
}

let rtState = 'idle';
let rtTimer = null;
let rtStart = 0;
let rtResults = [];
const RT_BUCKET_MS = 150;
let rtAudioCtx = null;
let rtSoundOn = true;
let rtStreak = 0;
let rtMaxStreak = 0;

// ── Tryb (click / space / choice) ──
let rtMode = 'click';
let rtChoiceDir = null;
let rtKeyListener = null;

function rtSetMode(mode) {
  rtMode = mode;
  rtAbort();
  rtState = 'idle';
  ['Click','Space','Choice'].forEach(m => {
    const btn = document.getElementById('rtMode' + m);
    if(btn) btn.classList.toggle('active', m.toLowerCase() === mode);
  });
  const area = document.getElementById('rtArea');
  area.onclick = (mode === 'click') ? rtHandleClick : null;
  area.style.cursor = (mode === 'click') ? 'pointer' : 'default';
  const hint = document.getElementById('rtKeyHint');
  if(hint) {
    if(mode === 'space')  { hint.textContent = 'Naciśnij SPACJĘ aby zacząć / zareagować'; hint.style.display = 'block'; }
    else if(mode === 'choice') { hint.textContent = 'Naciśnij ← lub → gdy pojawi się strzałka  ·  SPACJA = start'; hint.style.display = 'block'; }
    else hint.style.display = 'none';
  }
  if(rtKeyListener) { document.removeEventListener('keydown', rtKeyListener); rtKeyListener = null; }
  if(mode === 'space') {
    rtKeyListener = (e) => {
      if(!document.getElementById('reactionModal')?.classList.contains('show')) return;
      if(e.code === 'Space') { e.preventDefault(); rtHandleClick(); }
    };
    document.addEventListener('keydown', rtKeyListener);
  } else if(mode === 'choice') {
    rtKeyListener = (e) => {
      if(!document.getElementById('reactionModal')?.classList.contains('show')) return;
      if(e.code === 'ArrowLeft')  { e.preventDefault(); rtHandleChoice('left');  }
      if(e.code === 'ArrowRight') { e.preventDefault(); rtHandleChoice('right'); }
      if(e.code === 'Space')      { e.preventDefault(); rtHandleChoice('start'); }
    };
    document.addEventListener('keydown', rtKeyListener);
  }
  rtSetIdle();
}

function rtHandleChoice(dir) {
  const area  = document.getElementById('rtArea');
  const emoji = document.getElementById('rtEmoji');
  const arrow = document.getElementById('rtChoiceArrow');
  const msg   = document.getElementById('rtMsg');
  const res   = document.getElementById('rtResult');

  if(rtState === 'idle') {
    rtState = 'waiting';
    area.style.background  = '#1a0a2e';
    area.style.borderColor = 'rgba(255,154,60,0.5)';
    emoji.style.display = 'block'; emoji.textContent = '🔴';
    if(arrow) arrow.style.display = 'none';
    msg.textContent = 'Czekaj na strzałkę…'; msg.style.display = 'block';
    res.style.display = 'none';
    const delay = 1500 + Math.random() * 3500;
    rtTimer = setTimeout(() => {
      if(rtState !== 'waiting') return;
      rtState = 'ready';
      rtStart = performance.now();
      rtChoiceDir = Math.random() < 0.5 ? 'left' : 'right';
      area.style.background  = 'rgba(0,245,160,0.1)';
      area.style.borderColor = 'rgba(0,245,160,0.8)';
      emoji.style.display = 'none';
      if(arrow) {
        arrow.style.display = 'block';
        arrow.textContent   = rtChoiceDir === 'left' ? '←' : '→';
        arrow.style.color   = rtChoiceDir === 'left' ? '#00b4d8' : '#ff4d6d';
      }
      msg.textContent = ''; msg.style.display = 'none';
      rtBeep('ready');
    }, delay);
  } else if(rtState === 'waiting') {
    rtAbort(); rtState = 'early';
    area.style.background  = 'rgba(255,77,109,0.18)';
    area.style.borderColor = 'rgba(255,77,109,0.6)';
    emoji.style.display = 'block'; emoji.textContent = '💀';
    if(arrow) arrow.style.display = 'none';
    msg.textContent = 'Za wcześnie!'; msg.style.display = 'block';
    res.style.display = 'none';
    rtBeep('early');
    setTimeout(() => { rtState = 'idle'; rtSetIdle(); }, 1200);
  } else if(rtState === 'ready') {
    const ms = Math.round(performance.now() - rtStart);
    const correct = (dir !== 'start') && (dir === rtChoiceDir);
    if(dir === 'start') { return; }
    // BUG 2 FIX: filtruj nirealne wyniki
    if(ms < 80 && correct) {
      rtState = 'idle';
      area.style.background  = 'rgba(245,196,0,0.1)';
      area.style.borderColor = 'rgba(245,196,0,0.6)';
      if(arrow) arrow.style.display = 'none';
      emoji.style.display = 'block'; emoji.textContent = '⚡';
      msg.textContent = ms + 'ms — za szybko, spróbuj ponownie'; msg.style.display = 'block';
      setTimeout(() => { rtState = 'idle'; rtSetIdle(); }, 1200);
      return;
    }
    rtResults.push(ms);
    rtState = 'showing';
    if(arrow) arrow.style.display = 'none';
    emoji.style.display = 'block';
    if(correct) {
      area.style.background  = 'rgba(0,245,160,0.08)';
      area.style.borderColor = 'rgba(0,245,160,0.4)';
      emoji.textContent = ms < 200 ? '🚀' : ms < 350 ? '⚡' : '👍';
      res.style.display = 'block'; res.textContent = ms + ' ms';
      msg.style.display = 'none';
      const isBest = rtResults.length === 1 || ms <= Math.min(...rtResults.slice(0,-1));
      rtBeep(isBest ? 'best' : 'click');
    } else {
      area.style.background  = 'rgba(255,77,109,0.15)';
      area.style.borderColor = 'rgba(255,77,109,0.5)';
      emoji.textContent = '❌';
      res.style.display = 'none';
      msg.textContent = 'Zły kierunek!'; msg.style.display = 'block';
      rtBeep('early');
    }
    rtUpdateStats();
    setTimeout(() => { rtState = 'idle'; rtSetIdle(); }, 1000);
  }
}

function rtGetAudio() {
  if (!rtAudioCtx) rtAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return rtAudioCtx;
}

function rtBeep(type) {
  if (!rtSoundOn) return;
  try {
    const ctx = rtGetAudio();
    if (ctx.state === 'suspended') ctx.resume();

    if (type === 'best') {
      // Nowy rekord — dwa tony w górę
      [0, 0.13].forEach((offset, i) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.connect(g); g.connect(ctx.destination);
        o.type = 'sine';
        o.frequency.setValueAtTime(i === 0 ? 880 : 1200, ctx.currentTime + offset);
        g.gain.setValueAtTime(0.4, ctx.currentTime + offset);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + offset + 0.18);
        o.start(ctx.currentTime + offset);
        o.stop(ctx.currentTime + offset + 0.18);
      });
      return;
    }

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);

    if (type === 'ready') {
      // Zielony sygnał — wysoki ping
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.08);
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.45, ctx.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.22);
      osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.22);
    } else if (type === 'click') {
      // Kliknięcie — krótkie potwierdzenie
      osc.type = 'sine';
      osc.frequency.setValueAtTime(600, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(400, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
      osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.12);
    } else if (type === 'early') {
      // Za wcześnie — niski błąd
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(200, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + 0.28);
      gain.gain.setValueAtTime(0.25, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.28);
      osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.28);
    }
  } catch(e) {}
}

function rtToggleSound() {
  rtSoundOn = !rtSoundOn;
  const btn = document.getElementById('rtSoundBtn');
  if (btn) {
    btn.textContent = rtSoundOn ? '🔊' : '🔇';
    btn.style.opacity = rtSoundOn ? '1' : '0.4';
  }
  if (rtSoundOn) rtBeep('click');
}

function rtHandleClick() {
  const area  = document.getElementById('rtArea');
  const emoji = document.getElementById('rtEmoji');
  const msg   = document.getElementById('rtMsg');
  const res   = document.getElementById('rtResult');

  if (rtState === 'idle') {
    rtState = 'waiting';
    area.style.background   = '#1a0a2e';
    area.style.borderColor  = 'rgba(255,154,60,0.5)';
    emoji.textContent = '🔴';
    msg.textContent = t('rt_wait_green') || 'Czekaj na zielony sygnał…';
    msg.style.display = 'block';
    res.style.display = 'none';
    const delay = 1500 + Math.random() * 3500;
    rtTimer = setTimeout(() => {
      if (rtState !== 'waiting') return;
      rtState = 'ready';
      rtStart = performance.now();
      area.style.background  = 'rgba(0,245,160,0.18)';
      area.style.borderColor = 'rgba(0,245,160,0.8)';
      emoji.textContent = '🟢';
      msg.textContent = t('rt_click_now') || 'KLIKNIJ TERAZ!';
      rtBeep('ready');
    }, delay);
  } else if (rtState === 'waiting') {
    rtAbort();
    rtState = 'early';
    area.style.background  = 'rgba(255,77,109,0.18)';
    area.style.borderColor = 'rgba(255,77,109,0.6)';
    emoji.textContent = '💀';
    msg.textContent = t('rt_early') || 'Za wcześnie! Poczekaj na zielony';
    res.style.display = 'none';
    rtBeep('early');
    setTimeout(() => { rtState = 'idle'; rtSetIdle(); }, 1200);
  } else if (rtState === 'ready') {
    const ms = Math.round(performance.now() - rtStart);
    // BUG 2 FIX: filtruj nierealne wyniki (<80ms = prawdopodobnie false start lub lag)
    if(ms < 80) {
      rtState = 'idle';
      area.style.background  = 'rgba(245,196,0,0.1)';
      area.style.borderColor = 'rgba(245,196,0,0.6)';
      emoji.textContent = '⚡';
      msg.textContent = ms + 'ms — za szybko, spróbuj ponownie'; msg.style.display = 'block';
      res.style.display = 'none';
      setTimeout(() => { rtState = 'idle'; rtSetIdle(); }, 1200);
      return;
    }
    rtResults.push(ms);
    rtState = 'showing';
    area.style.background  = 'rgba(0,245,160,0.08)';
    area.style.borderColor = 'rgba(0,245,160,0.4)';
    emoji.textContent = ms < 150 ? '🚀' : ms < 250 ? '⚡' : ms < 400 ? '👍' : '🐢';
    msg.style.display = 'none';
    res.style.display = 'block';
    res.textContent = ms + ' ms';
    const isBest = rtResults.length === 1 || ms <= Math.min(...rtResults.slice(0, -1));
    rtBeep(isBest ? 'best' : 'click');
    rtUpdateStats();
    setTimeout(() => { rtState = 'idle'; rtSetIdle(); }, 1000);
  }
}

function rtAbort() {
  if (rtTimer) { clearTimeout(rtTimer); rtTimer = null; }
}

function rtSetIdle() {
  const area  = document.getElementById('rtArea');
  const emoji = document.getElementById('rtEmoji');
  const msg   = document.getElementById('rtMsg');
  const res   = document.getElementById('rtResult');
  const arrow = document.getElementById('rtChoiceArrow');
  if(!area) return;
  area.style.background  = '#1a0a2e';
  area.style.borderColor = 'rgba(168,85,247,0.3)';
  emoji.style.display = 'block';
  emoji.textContent = '⏳';
  if(arrow) arrow.style.display = 'none';
  const hasResults = rtResults.length > 0;
  if(rtMode === 'space') {
    msg.textContent = hasResults ? 'Spacja — spróbuj ponownie' : 'Spacja — aby zacząć';
  } else if(rtMode === 'choice') {
    msg.textContent = hasResults ? 'Spacja — spróbuj ponownie' : 'Spacja — aby zacząć · ← → gdy strzałka';
  } else {
    msg.textContent = hasResults ? (t('rt_again') || 'Kliknij, aby spróbować ponownie') : (t('rt_wait') || 'Kliknij, aby zacząć');
  }
  msg.style.display = 'block';
  res.style.display = 'none';
}

function rtUpdateStats() {
  const n = rtResults.length;
  if (!n) return;
  const last = rtResults[n-1];
  const best = Math.min(...rtResults);
  const avg  = Math.round(rtResults.reduce((a,b)=>a+b,0)/n);
  document.getElementById('rtLast').textContent  = last + ' ms';
  document.getElementById('rtBest').textContent  = best + ' ms';
  document.getElementById('rtAvg').textContent   = avg  + ' ms';
  document.getElementById('rtTries').textContent = n;

  // —— Histogram ——
  const buckets = [0,0,0,0,0];
  rtResults.forEach(v => { buckets[Math.min(Math.floor(v/RT_BUCKET_MS),4)]++; });
  const maxB   = Math.max(...buckets,1);
  const colors = ['#00f5a0','#00b4d8','#a855f7','#ff9a3c','#ff4d6d'];
  document.getElementById('rtHistogram').innerHTML = buckets.map((v,i) => {
    const h = Math.round((v/maxB)*54);
    return `<div title="${i*RT_BUCKET_MS}–${i<4?(i+1)*RT_BUCKET_MS:600}ms: ${v}x" style="flex:1;height:${h}px;background:${colors[i]};border-radius:3px 3px 0 0;min-height:${v?3:0}px;transition:height .3s;"></div>`;
  }).join('');

  // —— Wykres postępu ——
  rtDrawProgressChart();
  // —— Seria ——
  rtUpdateStreak();
  // —— Ranking ——
  rtUpdateRank();
}

function rtUpdateStreak() {
  const n = rtResults.length;
  if (!n) return;
  const avg = rtResults.reduce((a,b)=>a+b,0) / n;
  const last = rtResults[n-1];

  // Aktualizuj serię
  if (n === 1) {
    // Pierwsza próba — brak średniej historycznej, zawsze reset
    rtStreak = 0;
  } else {
    // Średnia BEZ ostatniego wyniku
    const prevAvg = rtResults.slice(0,-1).reduce((a,b)=>a+b,0) / (n-1);
    if (last < prevAvg) {
      rtStreak++;
      if (rtStreak > rtMaxStreak) {
        rtMaxStreak = rtStreak;
        // Dźwięk przy nowym rekordzie serii
        if (rtStreak >= 3) rtBeep('best');
      }
    } else {
      rtStreak = 0;
    }
  }

  // Aktualizuj UI
  const nowEl = document.getElementById('rtStreakNow');
  const maxEl = document.getElementById('rtStreakMax');
  const fire  = document.getElementById('rtStreakFire');
  if (nowEl) nowEl.textContent = rtStreak;
  if (maxEl) maxEl.textContent = rtMaxStreak;

  // Ogień rośnie z serią
  if (fire) {
    fire.textContent = rtStreak === 0 ? '💤' : rtStreak < 3 ? '🔥' : rtStreak < 6 ? '🔥🔥' : '🔥🔥🔥';
    fire.style.transform = rtStreak >= 3 ? 'scale(1.2)' : 'scale(1)';
  }

  // Pasek ostatnich 10 prób — zielony = poniżej średniej, czerwony = powyżej
  const bar = document.getElementById('rtStreakBar');
  if (bar) {
    const last10 = rtResults.slice(-10);
    const avg10  = last10.reduce((a,b)=>a+b,0) / last10.length;
    bar.innerHTML = last10.map((v, i) => {
      const isGood = i === 0 ? false : v < (last10.slice(0,i).reduce((a,b)=>a+b,0)/i);
      const color = isGood ? '#00f5a0' : 'rgba(255,255,255,0.12)';
      const h = Math.round(4 + (1 - Math.min(v, 600) / 600) * 8);
      return `<div title="${v}ms" style="flex:1;height:${h}px;background:${color};border-radius:2px;align-self:flex-end;"></div>`;
    }).join('');
  }
}

function rtUpdateRank() {
  const n = rtResults.length;
  if (n < 10) return; // Pokaż po 10 próbach

  const avg = Math.round(rtResults.reduce((a,b)=>a+b,0)/n);
  const card = document.getElementById('rtRankCard');
  if (!card) return;
  card.style.display = 'block';

  // Skala percentylowa (referencja: badania nad czasem reakcji człowieka)
  // <150ms = élite, 150-200 = pro, 200-250 = bardzo dobry, 250-300 = dobry,
  // 300-400 = przeciętny, 400-500 = poniżej, 500+ = słaby
  const ranks = [
    { max: 150, emoji: '🏆', label: 'Élite',        color: '#ffd700', pct: 98 },
    { max: 200, emoji: '🚀', label: 'Pro',           color: '#00f5a0', pct: 88 },
    { max: 250, emoji: '⚡', label: 'Bardzo dobry',  color: '#00b4d8', pct: 72 },
    { max: 300, emoji: '👍', label: 'Dobry',         color: '#a855f7', pct: 55 },
    { max: 400, emoji: '😐', label: 'Przeciętny',    color: '#ff9a3c', pct: 35 },
    { max: 500, emoji: '🐢', label: 'Poniżej śred.', color: '#ff6b6b', pct: 18 },
    { max: Infinity, emoji: '😴', label: 'Spróbuj ponownie', color: '#ff4d6d', pct: 5 },
  ];

  const rank = ranks.find(r => avg < r.max) || ranks[ranks.length-1];
  const pct  = rank.pct;

  document.getElementById('rtRankEmoji').textContent  = rank.emoji;
  document.getElementById('rtRankLabel').textContent  = rank.label;
  document.getElementById('rtRankLabel').style.color  = rank.color;
  document.getElementById('rtRankMs').textContent     = `${t('rt_avg_label') || 'Średnia'}: ${avg} ms`;

  // Progress bar — lewo=wolny, prawo=szybki
  const barW = pct;
  const barEl = document.getElementById('rtRankBar');
  const markerEl = document.getElementById('rtRankMarker');
  if (barEl)    barEl.style.width    = barW + '%';
  if (markerEl) markerEl.style.left  = `calc(${barW}% - 1.5px)`;
}

function rtDrawProgressChart() {
  const n = rtResults.length;
  const canvas = document.getElementById('rtProgressChart');
  const empty  = document.getElementById('rtChartEmpty');
  const badge  = document.getElementById('rtTrendBadge');
  const rangeL = document.getElementById('rtChartRangeLabel');
  const lastL  = document.getElementById('rtChartLastLabel');
  if (!canvas) return;

  if (n < 2) {
    canvas.style.display = 'none';
    if(empty) empty.style.display = 'flex';
    if(badge) badge.style.display = 'none';
    return;
  }
  canvas.style.display = 'block';
  if(empty) empty.style.display = 'none';

  const dpr = window.devicePixelRatio || 1;
  const W = canvas.getBoundingClientRect().width || canvas.parentElement?.clientWidth || 460;
  const H = 80;
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const PAD_L = 36, PAD_R = 8, PAD_T = 8, PAD_B = 4;
  const cW = W - PAD_L - PAD_R;
  const cH = H - PAD_T - PAD_B;

  const minV = Math.max(0,  Math.min(...rtResults) - 30);
  const maxV = Math.max(...rtResults) + 30;
  const toX  = i => PAD_L + (i / (n-1)) * cW;
  const toY  = v => PAD_T + cH - ((v - minV) / (maxV - minV)) * cH;

  ctx.clearRect(0, 0, W, H);

  // Grid lines
  const gridMs = [150, 250, 400];
  gridMs.forEach(gv => {
    if (gv < minV || gv > maxV) return;
    const gy = toY(gv);
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3,4]);
    ctx.moveTo(PAD_L, gy); ctx.lineTo(W - PAD_R, gy);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.font = `7px "Space Mono", monospace`;
    ctx.fillText(gv+'ms', 0, gy + 3);
  });

  // Moving average (window 3)
  const MA = 3;
  const maPoints = rtResults.map((_, i) => {
    const slice = rtResults.slice(Math.max(0, i-MA+1), i+1);
    return slice.reduce((a,b)=>a+b,0)/slice.length;
  });

  // Gradient fill under line
  const grad = ctx.createLinearGradient(0, PAD_T, 0, PAD_T + cH);
  grad.addColorStop(0, 'rgba(168,85,247,0.25)');
  grad.addColorStop(1, 'rgba(168,85,247,0)');
  ctx.beginPath();
  ctx.moveTo(toX(0), toY(rtResults[0]));
  rtResults.forEach((v,i) => { if(i>0) ctx.lineTo(toX(i), toY(v)); });
  ctx.lineTo(toX(n-1), H - PAD_B);
  ctx.lineTo(toX(0),   H - PAD_B);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Main line
  ctx.beginPath();
  ctx.moveTo(toX(0), toY(rtResults[0]));
  rtResults.forEach((v,i) => { if(i>0) ctx.lineTo(toX(i), toY(v)); });
  ctx.strokeStyle = 'rgba(168,85,247,0.7)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Moving average line
  if (n >= MA) {
    ctx.beginPath();
    ctx.moveTo(toX(0), toY(maPoints[0]));
    maPoints.forEach((v,i) => { if(i>0) ctx.lineTo(toX(i), toY(v)); });
    ctx.strokeStyle = '#00f5a0';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4,3]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Dots — best + last
  rtResults.forEach((v, i) => {
    const isBest = v === Math.min(...rtResults);
    const isLast = i === n-1;
    if (!isBest && !isLast) return;
    ctx.beginPath();
    ctx.arc(toX(i), toY(v), isBest ? 5 : 4, 0, Math.PI*2);
    ctx.fillStyle = isBest ? '#00f5a0' : '#a855f7';
    ctx.fill();
    ctx.strokeStyle = '#0a0a0f';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  });

  // Trend badge
  if (n >= 4) {
    const half = Math.floor(n/2);
    const firstHalfAvg = rtResults.slice(0, half).reduce((a,b)=>a+b,0)/half;
    const secondHalfAvg = rtResults.slice(half).reduce((a,b)=>a+b,0)/(n-half);
    const diff = Math.round(firstHalfAvg - secondHalfAvg);
    if (badge) {
      badge.style.display = 'block';
      if (diff > 10) {
        badge.textContent = `↓ ${diff}ms szybciej`;
        badge.style.background = 'rgba(0,245,160,0.12)';
        badge.style.color = '#00f5a0';
        badge.style.border = '1px solid rgba(0,245,160,0.3)';
      } else if (diff < -10) {
        badge.textContent = `↑ ${Math.abs(diff)}ms wolniej`;
        badge.style.background = 'rgba(255,77,109,0.12)';
        badge.style.color = '#ff4d6d';
        badge.style.border = '1px solid rgba(255,77,109,0.3)';
      } else {
        badge.textContent = '→ stabilny';
        badge.style.background = 'rgba(255,255,255,0.05)';
        badge.style.color = 'rgba(255,255,255,0.4)';
        badge.style.border = '1px solid rgba(255,255,255,0.1)';
      }
    }
  }

  if(rangeL) rangeL.textContent = `min ${Math.min(...rtResults)}ms / max ${Math.max(...rtResults)}ms`;
  if(lastL)  lastL.textContent  = `Próba ${n}`;
}

function rtReset() {
  rtAbort(); rtState='idle'; rtResults=[];
  rtStreak = 0; rtMaxStreak = 0;
  ['rtLast','rtBest','rtAvg'].forEach(id => document.getElementById(id).textContent='—');
  document.getElementById('rtTries').textContent='0';
  document.getElementById('rtHistogram').innerHTML='';
  // Streak
  const sNow = document.getElementById('rtStreakNow');
  const sMax = document.getElementById('rtStreakMax');
  const sFire = document.getElementById('rtStreakFire');
  const sBar  = document.getElementById('rtStreakBar');
  if(sNow)  sNow.textContent  = '0';
  if(sMax)  sMax.textContent  = '0';
  if(sFire) { sFire.textContent='🔥'; sFire.style.transform='scale(1)'; }
  if(sBar)  sBar.innerHTML    = '';
  // Rank card
  const rankCard = document.getElementById('rtRankCard');
  if(rankCard) rankCard.style.display = 'none';
  // Chart
  const canvas = document.getElementById('rtProgressChart');
  if(canvas) canvas.style.display='none';
  const empty = document.getElementById('rtChartEmpty');
  if(empty) empty.style.display='flex';
  const badge = document.getElementById('rtTrendBadge');
  if(badge) badge.style.display='none';
  const rangeL = document.getElementById('rtChartRangeLabel');
  if(rangeL) rangeL.textContent='';
  const lastL = document.getElementById('rtChartLastLabel');
  if(lastL) lastL.textContent='';
  rtSetIdle();
}

// ══════════════════════════════════════════════════════
// VOICE RECORDER + CHANGER
// ══════════════════════════════════════════════════════
let vrAudioCtx     = null;
let vrStream       = null;
let vrMediaRec     = null;
let vrChunks       = [];
let vrBlob         = null;
let vrBuffer       = null;
let vrSource       = null;
let vrIsRecording  = false;
let vrIsPlaying    = false;
let vrRecInterval  = null;
let vrRecSeconds   = 0;
let vrPlayStartAt  = 0;
let vrPlayOffset   = 0;
let vrWaveRafId    = null;
let vrPlayRafId    = null;
let vrPreset       = 'normal';
let vrAnalyser     = null;
let vrActiveOscs   = [];
let vrRecNodes     = [];
let vrLoopOn       = false;   // pętla
let vrABMode       = false;   // tryb A/B
let vrABOriginal   = true;    // true = graj oryginalny, false = z efektami
let vrOrigBuffer   = null;    // oryginalny buffer bez efektów (dla A/B)

function openVoiceRec() {
  document.getElementById('vrModal').classList.add('show');
  vrDrawIdleWave();
}
function closeVoiceRec() {
  document.getElementById('vrModal').classList.remove('show');
  vrStopRecord();
  vrStopPlay();
  if(vrWaveRafId) { cancelAnimationFrame(vrWaveRafId); vrWaveRafId = null; }
  // BUG 4 FIX: zamknij AudioContext po wyjściu z modalu
  if(vrAudioCtx && vrAudioCtx.state !== 'closed') {
    vrAudioCtx.close().catch(()=>{});
    vrAudioCtx = null;
  }
}

function vrGetCtx() {
  if(!vrAudioCtx || vrAudioCtx.state === 'closed')
    vrAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if(vrAudioCtx.state === 'suspended') vrAudioCtx.resume();
  return vrAudioCtx;
}

// ── Nagrywanie ──
async function vrToggleRecord() {
  if(vrIsRecording) { vrStopRecord(); return; }
  vrStopPlay();

  try {
    vrStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, sampleRate: 48000 } });
  } catch(e) {
    toast(t('toast_mic_no_access') + e.message, 'error'); return;
  }

  const ctx = vrGetCtx();
  vrAnalyser = ctx.createAnalyser();
  vrAnalyser.fftSize = 256;
  const src = ctx.createMediaStreamSource(vrStream);

  // Gain wejściowy + kompressor → głośniejsze nagranie
  const inputGain = ctx.createGain();
  inputGain.gain.value = 4.0;
  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -18;
  compressor.knee.value      = 12;
  compressor.ratio.value     = 6;
  compressor.attack.value    = 0.003;
  compressor.release.value   = 0.15;

  src.connect(inputGain);
  inputGain.connect(compressor);
  compressor.connect(vrAnalyser);

  const destNode = ctx.createMediaStreamDestination();
  compressor.connect(destNode);
  const boostedStream = destNode.stream;

  // BUG 3 FIX: zapamiętaj węzły do disconnect przy stopRecord
  vrRecNodes = [src, inputGain, compressor, vrAnalyser, destNode];

  const mime = ['audio/webm;codecs=opus','audio/webm','audio/ogg'].find(m => MediaRecorder.isTypeSupported(m)) || '';
  vrChunks = [];
  vrMediaRec = new MediaRecorder(boostedStream, mime ? { mimeType: mime } : {});
  vrMediaRec.ondataavailable = e => { if(e.data.size > 0) vrChunks.push(e.data); };
  vrMediaRec.onstop = vrOnRecStop;
  vrMediaRec.start(100);
  vrIsRecording = true;
  vrRecSeconds  = 0;

  // UI
  const dot   = document.getElementById('vrRecDot');
  const timer = document.getElementById('vrRecTimer');
  const lbl   = document.getElementById('vrRecStatus');
  const btn   = document.getElementById('vrRecBtn');
  if(dot)   { dot.style.display = 'block'; }
  if(timer) { timer.style.display = 'block'; timer.textContent = '0:00'; }
  if(lbl)   lbl.style.display = 'none';
  if(btn)   { btn.textContent = '⏹ STOP'; btn.style.borderColor = '#ff4d6d'; btn.style.color = '#ff4d6d'; }
  document.getElementById('vrPlayBtn').disabled = true;

  vrRecInterval = setInterval(() => {
    vrRecSeconds++;
    const m = Math.floor(vrRecSeconds/60), s = vrRecSeconds%60;
    if(timer) timer.textContent = `${m}:${String(s).padStart(2,'0')}`;
    if(vrRecSeconds >= 120) vrStopRecord(); // max 2 min
  }, 1000);

  vrDrawLiveWave();
}

function vrStopRecord() {
  if(!vrIsRecording) return;
  vrIsRecording = false;
  // BUG 9 FIX: disconnect all recording nodes
  if(vrRecNodes && vrRecNodes.length) {
    vrRecNodes.forEach(n => { try { n.disconnect(); } catch(e) {} });
    vrRecNodes = [];
  }
  clearInterval(vrRecInterval);
  if(vrMediaRec && vrMediaRec.state !== 'inactive') vrMediaRec.stop();
  if(vrStream) { vrStream.getTracks().forEach(t => t.stop()); vrStream = null; }
  // BUG 3 FIX: odłącz wszystkie węzły nagrywania
  vrRecNodes.forEach(n => { try { n.disconnect(); } catch(e) {} });
  vrRecNodes = [];
  vrAnalyser = null;

  const dot = document.getElementById('vrRecDot');
  const btn = document.getElementById('vrRecBtn');
  if(dot) dot.style.display = 'none';
  if(btn) { btn.textContent = '⏺ NAGRAJ'; btn.style.borderColor = '#ec4899'; btn.style.color = '#ec4899'; }
}

async function vrOnRecStop() {
  const mime = vrChunks[0]?.type || 'audio/webm';
  vrBlob = new Blob(vrChunks, { type: mime });
  const modalOpen = document.getElementById('vrModal')?.classList.contains('show');
  const arrayBuf = await vrBlob.arrayBuffer();
  const ctx = vrGetCtx();
  try {
    vrBuffer = await ctx.decodeAudioData(arrayBuf);
    vrOrigBuffer = vrBuffer; // zachowaj oryginał dla A/B
  } catch(e) {
    toast(t('toast_decode_err') + e.message, 'error');
    vrDrawIdleWave(); return;
  }

  // Zaktualizuj UI
  const dur   = vrBuffer.duration;
  const m = Math.floor(dur/60), s = Math.floor(dur%60);
  const durEl = document.getElementById('vrDuration');
  const lbl   = document.getElementById('vrRecStatus');
  const pb    = document.getElementById('vrPlayBtn');
  const dl    = document.getElementById('vrDownloadBtn');
  if(durEl) durEl.textContent = `${m}:${String(s).padStart(2,'0')}`;
  if(lbl)   { lbl.textContent = t('vr_click_play') || 'Nagrano — kliknij ▶ aby odtworzyć'; lbl.style.display = 'block'; }
  if(pb)    pb.disabled = false;
  if(dl) {
    dl.style.display = 'inline-block';
    dl.href     = URL.createObjectURL(vrBlob);
    dl.download = `glos_${Date.now()}.webm`;
    dl.onclick  = async (e) => {
      e.preventDefault();
      await vrDownloadProcessed();
    };
  }
  vrDrawBufferWave();
}

// ── Odtwarzanie ──
function vrTogglePlay() {
  if(vrIsPlaying) { vrStopPlay(); return; }
  if(!vrBuffer)   return;
  vrStartPlay(vrPlayOffset);
}

async function vrStartPlay(offset = 0) {
  vrStopPlay();
  const ctx = vrGetCtx();

  // BUGFIX: czekaj aż AudioContext się wznowi — bez tego start() na suspended = cisza
  if(ctx.state === 'suspended') await ctx.resume();
  // Dodatkowy guard — jeśli wciąż suspended po 300ms, spróbuj ponownie
  if(ctx.state === 'suspended') {
    await new Promise(r => setTimeout(r, 300));
    await ctx.resume().catch(()=>{});
  }

  vrSource = ctx.createBufferSource();
  vrSource.buffer = (vrABMode && vrABOriginal && vrOrigBuffer) ? vrOrigBuffer : vrBuffer;

  const semitones = parseFloat(document.getElementById('vrPitch').value) || 0;
  const speed     = parseFloat(document.getElementById('vrSpeed').value)  || 1;
  vrSource.playbackRate.value = Math.pow(2, semitones/12) * speed;
  vrSource.loop = vrLoopOn;
  vrSource.onended = () => {
    if(vrIsPlaying && !vrLoopOn) vrStopPlay();
  };

  // Output volume
  const vol = ctx.createGain();
  vol.gain.value = Math.max(0.001, parseFloat(document.getElementById('vrVolume').value) || 1);
  vol.connect(ctx.destination);

  // Chain efektów — vrBuildChain zwraca {input, output}
  const useEffects = !(vrABMode && vrABOriginal);
  if(useEffects) {
    try {
      const chain = vrBuildChain(ctx);
      // chain to {input, output} — dwa węzły graniczne
      if(chain && chain.input && chain.output) {
        vrSource.connect(chain.input);
        chain.output.connect(vol);
      } else {
        vrSource.connect(vol);
      }
    } catch(e) {
      console.warn('vrBuildChain error:', e);
      vrSource.connect(vol);
    }
  } else {
    vrSource.connect(vol);
  }

  vrPlayOffset  = Math.min(Math.max(offset || 0, 0), vrSource.buffer.duration - 0.01);
  vrPlayStartAt = ctx.currentTime - vrPlayOffset;
  vrSource.start(0, vrPlayOffset);
  vrIsPlaying = true;

  document.getElementById('vrPlayBtn').textContent = '⏸';
  vrAnimatePlaybar();
}

function vrStopPlay() {
  // BUG 1 FIX: zatrzymaj WSZYSTKIE oscylatory z chain efektów
  vrActiveOscs.forEach(osc => { try { osc.stop(); } catch(e) {} });
  vrActiveOscs = [];

  if(vrSource) {
    try { vrSource.stop(); } catch(e) {}
    vrSource = null;
  }
  if(vrPlayRafId) { cancelAnimationFrame(vrPlayRafId); vrPlayRafId = null; }
  vrIsPlaying = false;
  vrPlayOffset = 0;
  const pb = document.getElementById('vrPlayBtn');
  const bar = document.getElementById('vrPlayBar');
  if(pb)  pb.textContent = '▶';
  if(bar) bar.style.width = '0%';
}

function vrAnimatePlaybar() {
  const ctx = vrAudioCtx;
  const bar = document.getElementById('vrPlayBar');
  if(!ctx || !vrIsPlaying || !bar || !vrSource) return;
  const elapsed = ctx.currentTime - vrPlayStartAt;
  const dur = vrSource.buffer ? vrSource.buffer.duration : (vrBuffer ? vrBuffer.duration : 1);
  const pct = Math.min((elapsed / dur) * 100, 100);
  bar.style.width = pct + '%';
  if(pct >= 100 && !vrLoopOn) { vrStopPlay(); vrDrawBufferWave(); return; }
  vrPlayRafId = requestAnimationFrame(vrAnimatePlaybar);
}

function vrSeek(e) {
  if(!vrBuffer) return;
  const bar  = e.currentTarget;
  const rect = bar.getBoundingClientRect();
  const pct  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  const activeBuf = (vrABMode && vrABOriginal && vrOrigBuffer) ? vrOrigBuffer : vrBuffer;
  vrPlayOffset = Math.max(0, pct * activeBuf.duration);
  if(vrIsPlaying) vrStartPlay(vrPlayOffset);
}

// ── Efekty ──
function vrBuildChain(ctx) {
  // Architektura: source → [EQ] → [presetFX] → [reverb wet+dry] → [chorus wet+dry] → destination
  // Zwracamy {input, output} — dwa węzły graniczne
  // vrStartPlay: source → input, output → vol → destination

  vrActiveOscs.forEach(o => { try { o.stop(); } catch(e) {} });
  vrActiveOscs = [];

  function mkOsc(type, freq) {
    const o = ctx.createOscillator();
    o.type = type; o.frequency.value = freq; o.start();
    vrActiveOscs.push(o); return o;
  }

  // ── Węzły wejściowy i wyjściowy ──
  const chainIn  = ctx.createGain(); chainIn.gain.value  = 1;
  const chainOut = ctx.createGain(); chainOut.gain.value = 1;

  // ── EQ ──
  const bass = ctx.createBiquadFilter();
  bass.type = 'lowshelf'; bass.frequency.value = 200;
  bass.gain.value = parseFloat(document.getElementById('vrBass').value) || 0;

  const mid = ctx.createBiquadFilter();
  mid.type = 'peaking'; mid.frequency.value = 1000; mid.Q.value = 1;
  mid.gain.value = parseFloat(document.getElementById('vrMid').value) || 0;

  const treble = ctx.createBiquadFilter();
  treble.type = 'highshelf'; treble.frequency.value = 3500;
  treble.gain.value = parseFloat(document.getElementById('vrTreble').value) || 0;

  // ── Distortion ──
  const distAmt = parseFloat(document.getElementById('vrDist').value) || 0;
  const dist = ctx.createWaveShaper();
  if(distAmt > 0) { dist.curve = vrDistCurve(distAmt * 3); dist.oversample = '4x'; }

  // ── Preset FX node (ring mod, filter, etc.) ──
  const presetIn  = ctx.createGain(); presetIn.gain.value  = 1;
  const presetOut = ctx.createGain(); presetOut.gain.value = 1;
  buildPreset(ctx, presetIn, presetOut, mkOsc);

  // ── Reverb (parallel wet+dry) ──
  const reverbWet = parseFloat(document.getElementById('vrReverb').value) || 0;
  const reverbIn  = ctx.createGain(); reverbIn.gain.value  = 1;
  const reverbOut = ctx.createGain(); reverbOut.gain.value = 1;

  // Dry path
  const reverbDry = ctx.createGain(); reverbDry.gain.value = 1;
  reverbIn.connect(reverbDry); reverbDry.connect(reverbOut);

  // Wet path — parallel delays, all summed into reverbOut
  if(reverbWet > 0) {
    [0.015, 0.033, 0.057, 0.089, 0.13, 0.18, 0.25, 0.35].forEach((dt, i) => {
      const d  = ctx.createDelay(1.0); d.delayTime.value = dt;
      const rg = ctx.createGain(); rg.gain.value = reverbWet * (0.55 - i * 0.06);
      reverbIn.connect(d); d.connect(rg); rg.connect(reverbOut);
    });
  }

  // ── Chorus (parallel wet+dry) ──
  const chorusWet = parseFloat(document.getElementById('vrChorus').value) || 0;
  const chorusIn  = ctx.createGain(); chorusIn.gain.value  = 1;
  const chorusOut = ctx.createGain(); chorusOut.gain.value = 1;

  // Dry path
  const chorDry = ctx.createGain(); chorDry.gain.value = 1;
  chorusIn.connect(chorDry); chorDry.connect(chorusOut);

  // Wet path
  if(chorusWet > 0) {
    const chorDelay = ctx.createDelay(0.05); chorDelay.delayTime.value = 0.025;
    const chorLfo   = mkOsc('sine', 1.5);
    const chorLfoG  = ctx.createGain(); chorLfoG.gain.value = 0.008;
    chorLfo.connect(chorLfoG); chorLfoG.connect(chorDelay.delayTime);
    const chorWet = ctx.createGain(); chorWet.gain.value = chorusWet * 0.7;
    chorusIn.connect(chorDelay); chorDelay.connect(chorWet); chorWet.connect(chorusOut);
  }

  // ── Limiter ──
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -3; limiter.knee.value = 2;
  limiter.ratio.value = 20; limiter.attack.value = 0.001; limiter.release.value = 0.05;

  // ── Połącz CAŁOŚĆ szeregowo ──
  chainIn
    .connect(bass).connect(mid).connect(treble);

  if(distAmt > 0) treble.connect(dist).connect(presetIn);
  else            treble.connect(presetIn);

  presetOut.connect(reverbIn);
  reverbOut.connect(chorusIn);
  chorusOut.connect(limiter);

  // Post FX: Formant, Tremolo, Vibrato, Stereo Width
  const postIn  = ctx.createGain(); postIn.gain.value = 1;
  const postOut = ctx.createGain(); postOut.gain.value = 1;
  limiter.connect(postIn);
  vrApplyPostFx(ctx, postIn, postOut);
  postOut.connect(chainOut);

  return { input: chainIn, output: chainOut };
}

function buildPreset(ctx, input, output, mkOsc) {

  if(vrPreset === 'normal') {
    input.connect(output); return;
  }
  if(vrPreset === 'robot') {
    // AM ring mod z DC offset — gain oscyluje 0→1 (nie -1..+1)
    const amGain = ctx.createGain(); amGain.gain.value = 0.5;
    input.connect(amGain);
    const osc = mkOsc('sawtooth', 80);
    const oscScale = ctx.createGain(); oscScale.gain.value = 0.5;
    osc.connect(oscScale); oscScale.connect(amGain.gain);
    const bp = ctx.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=1200; bp.Q.value=0.6;
    const norm = ctx.createGain(); norm.gain.value = 0.85;
    amGain.connect(bp); bp.connect(norm); norm.connect(output); return;
  }
  if(vrPreset === 'deep') {
    const lo = ctx.createBiquadFilter(); lo.type='lowshelf'; lo.frequency.value=250; lo.gain.value=9;
    const lp = ctx.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=7000;
    const norm = ctx.createGain(); norm.gain.value = 0.8;
    input.connect(lo); lo.connect(lp); lp.connect(norm); norm.connect(output); return;
  }
  if(vrPreset === 'chipmunk') {
    const hi = ctx.createBiquadFilter(); hi.type='highshelf'; hi.frequency.value=800; hi.gain.value=10;
    const norm = ctx.createGain(); norm.gain.value = 0.78;
    input.connect(hi); hi.connect(norm); norm.connect(output); return;
  }
  if(vrPreset === 'echo') {
    const dry = ctx.createGain(); dry.gain.value = 0.75;
    const delay = ctx.createDelay(2.0); delay.delayTime.value = 0.35;
    const wet = ctx.createGain(); wet.gain.value = 0.35;
    const fb = ctx.createGain(); fb.gain.value = 0.38;
    delay.connect(fb); fb.connect(delay);
    input.connect(dry); dry.connect(output);
    input.connect(delay); delay.connect(wet); wet.connect(output); return;
  }
  if(vrPreset === 'phone') {
    const bp = ctx.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=1500; bp.Q.value=1.2;
    const d2 = ctx.createWaveShaper(); d2.curve=vrDistCurve(50);
    const norm = ctx.createGain(); norm.gain.value = 0.8;
    input.connect(bp); bp.connect(d2); d2.connect(norm); norm.connect(output); return;
  }
  if(vrPreset === 'alien') {
    const amGain = ctx.createGain(); amGain.gain.value = 0.5;
    input.connect(amGain);
    const osc = mkOsc('sine', 9);
    const oscScale = ctx.createGain(); oscScale.gain.value = 0.5;
    osc.connect(oscScale); oscScale.connect(amGain.gain);
    const hi = ctx.createBiquadFilter(); hi.type='highshelf'; hi.frequency.value=2000; hi.gain.value=8;
    const norm = ctx.createGain(); norm.gain.value = 1.05;
    amGain.connect(hi); hi.connect(norm); norm.connect(output); return;
  }
  if(vrPreset === 'cave') {
    const dry = ctx.createGain(); dry.gain.value = 0.55;
    input.connect(dry); dry.connect(output);
    [0.07,0.17,0.31,0.52,0.8].forEach((dt,i) => {
      const d = ctx.createDelay(1.5); d.delayTime.value=dt;
      const g = ctx.createGain(); g.gain.value = 0.2-i*0.035;
      input.connect(d); d.connect(g); g.connect(output);
    }); return;
  }
  if(vrPreset === 'whisper') {
    const hp = ctx.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=900;
    const d2 = ctx.createWaveShaper(); d2.curve=vrDistCurve(120);
    const lp = ctx.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=6000;
    const norm = ctx.createGain(); norm.gain.value = 0.55;
    input.connect(hp); hp.connect(d2); d2.connect(lp); lp.connect(norm); norm.connect(output); return;
  }
  if(vrPreset === 'megaphone') {
    const bp1 = ctx.createBiquadFilter(); bp1.type='bandpass'; bp1.frequency.value=2000; bp1.Q.value=0.7;
    const d2 = ctx.createWaveShaper(); d2.curve=vrDistCurve(90);
    const bp2 = ctx.createBiquadFilter(); bp2.type='bandpass'; bp2.frequency.value=2200; bp2.Q.value=1.2;
    const norm = ctx.createGain(); norm.gain.value = 0.82;
    input.connect(bp1); bp1.connect(d2); d2.connect(bp2); bp2.connect(norm); norm.connect(output); return;
  }
  if(vrPreset === 'underwater') {
    const lp = ctx.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=500; lp.Q.value=2;
    const delay = ctx.createDelay(0.05); delay.delayTime.value=0.02;
    const lfo = mkOsc('sine',0.4);
    const lfoG = ctx.createGain(); lfoG.gain.value=0.01;
    lfo.connect(lfoG); lfoG.connect(delay.delayTime);
    const norm = ctx.createGain(); norm.gain.value = 0.85;
    input.connect(lp); lp.connect(delay); delay.connect(norm); norm.connect(output); return;
  }
  if(vrPreset === 'stadium') {
    const dry = ctx.createGain(); dry.gain.value = 0.5;
    input.connect(dry); dry.connect(output);
    [0.05,0.12,0.22,0.38,0.6,0.9,1.3].forEach((dt,i) => {
      const d = ctx.createDelay(2.0); d.delayTime.value=dt;
      const g = ctx.createGain(); g.gain.value = 0.18-i*0.022;
      input.connect(d); d.connect(g); g.connect(output);
    }); return;
  }
  if(vrPreset === 'demon') {
    const lo = ctx.createBiquadFilter(); lo.type='lowshelf'; lo.frequency.value=200; lo.gain.value=9;
    const d2 = ctx.createWaveShaper(); d2.curve=vrDistCurve(80);
    const lp = ctx.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=2500;
    // Oscylator jako sub-bass (bardzo cicho, tylko dołem)
    const osc = mkOsc('sawtooth',45);
    const oscLp = ctx.createBiquadFilter(); oscLp.type='lowpass'; oscLp.frequency.value=200;
    const og = ctx.createGain(); og.gain.value=0.06;
    osc.connect(oscLp); oscLp.connect(og); og.connect(lp);
    const norm = ctx.createGain(); norm.gain.value = 0.72;
    input.connect(lo); lo.connect(d2); d2.connect(lp); lp.connect(norm); norm.connect(output); return;
  }
  if(vrPreset === 'helium') {
    const hp = ctx.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=300;
    const hi = ctx.createBiquadFilter(); hi.type='highshelf'; hi.frequency.value=2000; hi.gain.value=6;
    const norm = ctx.createGain(); norm.gain.value = 0.8;
    input.connect(hp); hp.connect(hi); hi.connect(norm); norm.connect(output); return;
  }
  if(vrPreset === 'radio') {
    const bp = ctx.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=1800; bp.Q.value=0.8;
    const d2 = ctx.createWaveShaper(); d2.curve=vrDistCurve(30);
    const norm = ctx.createGain(); norm.gain.value = 0.85;
    input.connect(bp); bp.connect(d2); d2.connect(norm); norm.connect(output); return;
  }
  if(vrPreset === 'vintage') {
    const hp = ctx.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=200;
    const lp = ctx.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=4000;
    const warm = ctx.createBiquadFilter(); warm.type='peaking'; warm.frequency.value=300; warm.gain.value=5; warm.Q.value=0.7;
    const d2 = ctx.createWaveShaper(); d2.curve=vrDistCurve(18);
    const hum = mkOsc('sine',50); const humG = ctx.createGain(); humG.gain.value=0.012;
    hum.connect(humG); humG.connect(output);
    const norm = ctx.createGain(); norm.gain.value = 0.8;
    input.connect(hp); hp.connect(lp); lp.connect(warm); warm.connect(d2); d2.connect(norm); norm.connect(output); return;
  }
  if(vrPreset === 'darth') {
    const lo=ctx.createBiquadFilter(); lo.type='lowshelf'; lo.frequency.value=150; lo.gain.value=12;
    const lp=ctx.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=2500;
    const d2=ctx.createWaveShaper(); d2.curve=vrDistCurve(60);
    const osc=mkOsc('sawtooth',60); const og=ctx.createGain(); og.gain.value=0.09;
    osc.connect(og); og.connect(output);
    const norm=ctx.createGain(); norm.gain.value=0.72;
    input.connect(lo); lo.connect(d2); d2.connect(lp); lp.connect(norm); norm.connect(output); return;
  }
  if(vrPreset === 'giant') {
    const lo=ctx.createBiquadFilter(); lo.type='lowshelf'; lo.frequency.value=200; lo.gain.value=12;
    const lp=ctx.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=2000;
    const norm=ctx.createGain(); norm.gain.value=0.58;
    input.connect(lo); lo.connect(lp); lp.connect(norm); norm.connect(output);
    [0.1,0.3,0.6,1.0,1.5].forEach((dt,i)=>{
      const d=ctx.createDelay(2.0); d.delayTime.value=dt;
      const g=ctx.createGain(); g.gain.value=0.18-i*0.03;
      input.connect(d); d.connect(g); g.connect(output);
    }); return;
  }
  if(vrPreset === 'ghost') {
    // FIX: hp 300Hz (nie 600), norm 0.65 (nie 0.35)
    const hp=ctx.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=300;
    const delay=ctx.createDelay(0.04); delay.delayTime.value=0.025;
    const lfo=mkOsc('sine',0.5); const lfoG=ctx.createGain(); lfoG.gain.value=0.012;
    lfo.connect(lfoG); lfoG.connect(delay.delayTime);
    const wet=ctx.createGain(); wet.gain.value=0.6;
    const dry=ctx.createGain(); dry.gain.value=0.5;
    input.connect(hp); hp.connect(dry); dry.connect(output);
    hp.connect(delay); delay.connect(wet); wet.connect(output); return;
  }
  if(vrPreset === 'choir') {
    // FIX: sumaryczny gain zmniejszony
    const dry=ctx.createGain(); dry.gain.value=0.45;
    input.connect(dry); dry.connect(output);
    [0.005,0.011,0.019,0.028,0.038].forEach((dt)=>{
      const d=ctx.createDelay(0.05); d.delayTime.value=dt;
      const g=ctx.createGain(); g.gain.value=0.18;
      input.connect(d); d.connect(g); g.connect(output);
    }); return;
  }
  if(vrPreset === 'troll') {
    // FIX: lfo gain 120→40 (mniejszy sweep, bez artefaktów)
    const lo=ctx.createBiquadFilter(); lo.type='lowshelf'; lo.frequency.value=300; lo.gain.value=10;
    const bp=ctx.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=500; bp.Q.value=2;
    const lfo1=mkOsc('sine',3); const lg1=ctx.createGain(); lg1.gain.value=40;
    lfo1.connect(lg1); lg1.connect(bp.frequency);
    const norm=ctx.createGain(); norm.gain.value=0.78;
    input.connect(lo); lo.connect(bp); bp.connect(norm); norm.connect(output); return;
  }
  if(vrPreset === 'chipmunk2') {
    const hi=ctx.createBiquadFilter(); hi.type='highshelf'; hi.frequency.value=800; hi.gain.value=10;
    const trem=ctx.createGain(); trem.gain.value=0.7;
    const lfo=mkOsc('sine',7); const lg=ctx.createGain(); lg.gain.value=0.25;
    lfo.connect(lg); lg.connect(trem.gain);
    const norm=ctx.createGain(); norm.gain.value=0.75;
    input.connect(hi); hi.connect(trem); trem.connect(norm); norm.connect(output); return;
  }
  if(vrPreset === 'horror') {
    const lo=ctx.createBiquadFilter(); lo.type='lowshelf'; lo.frequency.value=250; lo.gain.value=9;
    const d2=ctx.createWaveShaper(); d2.curve=vrDistCurve(70);
    const trem=ctx.createGain(); trem.gain.value=0.7;
    const lfo=mkOsc('sine',3.5); const lg=ctx.createGain(); lg.gain.value=0.28;
    lfo.connect(lg); lg.connect(trem.gain);
    const norm=ctx.createGain(); norm.gain.value=0.72;
    input.connect(lo); lo.connect(d2); d2.connect(trem); trem.connect(norm); norm.connect(output); return;
  }
  if(vrPreset === 'angel') {
    const hi=ctx.createBiquadFilter(); hi.type='highshelf'; hi.frequency.value=3000; hi.gain.value=6;
    const dry=ctx.createGain(); dry.gain.value=0.55;
    input.connect(hi); hi.connect(dry); dry.connect(output);
    [0.02,0.05,0.09,0.15,0.25,0.4].forEach((dt,i)=>{
      const d=ctx.createDelay(1.0); d.delayTime.value=dt;
      const g=ctx.createGain(); g.gain.value=0.16-i*0.022;
      input.connect(d); d.connect(g); g.connect(output);
    }); return;
  }
  if(vrPreset === 'walkie') {
    const bp=ctx.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=1300; bp.Q.value=2;
    const d2=ctx.createWaveShaper(); d2.curve=vrDistCurve(150);
    const norm=ctx.createGain(); norm.gain.value=0.78;
    input.connect(bp); bp.connect(d2); d2.connect(norm); norm.connect(output); return;
  }
  if(vrPreset === 'submarine') {
    // FIX: lfo gain 80→30 na częstotliwości cutoff
    const lp=ctx.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=450; lp.Q.value=3;
    const lfo=mkOsc('sine',0.2); const lg=ctx.createGain(); lg.gain.value=30;
    lfo.connect(lg); lg.connect(lp.frequency);
    const del=ctx.createDelay(0.9); del.delayTime.value=0.85;
    const dfb=ctx.createGain(); dfb.gain.value=0.38; del.connect(dfb); dfb.connect(del);
    const dry=ctx.createGain(); dry.gain.value=0.65;
    const wet=ctx.createGain(); wet.gain.value=0.32;
    input.connect(lp); lp.connect(dry); dry.connect(output);
    lp.connect(del); del.connect(wet); wet.connect(output); return;
  }
  if(vrPreset === 'drunk') {
    const lfo=mkOsc('sine',1.5); const lg=ctx.createGain(); lg.gain.value=0.018;
    const del=ctx.createDelay(0.06); del.delayTime.value=0.03;
    lfo.connect(lg); lg.connect(del.delayTime);
    const dry=ctx.createGain(); dry.gain.value=0.65;
    const wet=ctx.createGain(); wet.gain.value=0.48;
    input.connect(dry); dry.connect(output);
    input.connect(del); del.connect(wet); wet.connect(output); return;
  }
  if(vrPreset === 'monster') {
    const lo=ctx.createBiquadFilter(); lo.type='lowshelf'; lo.frequency.value=120; lo.gain.value=12;
    const osc1=mkOsc('sawtooth',38); const og1=ctx.createGain(); og1.gain.value=0.13;
    osc1.connect(og1); og1.connect(output);
    const osc2=mkOsc('square',26); const og2=ctx.createGain(); og2.gain.value=0.07;
    osc2.connect(og2); og2.connect(output);
    const d2=ctx.createWaveShaper(); d2.curve=vrDistCurve(150);
    const lp=ctx.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=1500;
    const norm=ctx.createGain(); norm.gain.value=0.65;
    input.connect(lo); lo.connect(d2); d2.connect(lp); lp.connect(norm); norm.connect(output); return;
  }

  // ── 10 NOWYCH PRESETÓW ──
  if(vrPreset === 'cartoon') {
    // Kreskówka — wysokie + AM 20Hz + saturacja
    const amG=ctx.createGain(); amG.gain.value=0.5;
    input.connect(amG);
    const osc=mkOsc('square',20); const os=ctx.createGain(); os.gain.value=0.5;
    osc.connect(os); os.connect(amG.gain);
    const hi=ctx.createBiquadFilter(); hi.type='highshelf'; hi.frequency.value=1500; hi.gain.value=8;
    const d2=ctx.createWaveShaper(); d2.curve=vrDistCurve(40);
    const norm=ctx.createGain(); norm.gain.value=0.8;
    amG.connect(hi); hi.connect(d2); d2.connect(norm); norm.connect(output); return;
  }
  if(vrPreset === 'cave2') {
    // Wielka jaskinia — długi pogłos + lowpass
    const lp=ctx.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=5000;
    const dry=ctx.createGain(); dry.gain.value=0.5;
    input.connect(lp); lp.connect(dry); dry.connect(output);
    [0.15,0.28,0.45,0.7,1.1,1.6,2.2].forEach((dt,i)=>{
      const d=ctx.createDelay(3.0); d.delayTime.value=dt;
      const g=ctx.createGain(); g.gain.value=0.22-i*0.028;
      lp.connect(d); d.connect(g); g.connect(output);
    }); return;
  }
  if(vrPreset === 'radio2') {
    // CB Radio — mono bandpass + crackle dist
    const hp=ctx.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=400;
    const lp=ctx.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=3500;
    const d2=ctx.createWaveShaper(); d2.curve=vrDistCurve(70);
    const norm=ctx.createGain(); norm.gain.value=0.82;
    input.connect(hp); hp.connect(lp); lp.connect(d2); d2.connect(norm); norm.connect(output); return;
  }
  if(vrPreset === 'bathroom') {
    // Łazienka — krótki żywy reverb + bright
    const hi=ctx.createBiquadFilter(); hi.type='highshelf'; hi.frequency.value=3000; hi.gain.value=5;
    const dry=ctx.createGain(); dry.gain.value=0.6;
    input.connect(hi); hi.connect(dry); dry.connect(output);
    [0.012,0.024,0.038,0.055,0.075,0.1].forEach((dt,i)=>{
      const d=ctx.createDelay(0.2); d.delayTime.value=dt;
      const g=ctx.createGain(); g.gain.value=0.25-i*0.035;
      input.connect(d); d.connect(g); g.connect(output);
    }); return;
  }
  if(vrPreset === 'cyborg') {
    // Cyborg — AM 80Hz buzz + bandpass + dist, znormalizowany
    const bp=ctx.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=1400; bp.Q.value=1.2;
    const amG=ctx.createGain(); amG.gain.value=1.0;
    bp.connect(amG);
    const osc=mkOsc('square',80); const os=ctx.createGain(); os.gain.value=0.35;
    osc.connect(os); os.connect(amG.gain);
    const d2=ctx.createWaveShaper(); d2.curve=vrDistCurve(30);
    const norm=ctx.createGain(); norm.gain.value=0.55;
    input.connect(bp); amG.connect(d2); d2.connect(norm); norm.connect(output); return;
  }
  if(vrPreset === 'baby') {
    // Dziecko — jasne EQ + delikatne tremolo, znormalizowany
    const hi=ctx.createBiquadFilter(); hi.type='highshelf'; hi.frequency.value=2000; hi.gain.value=5;
    const lp=ctx.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=7000;
    const hp=ctx.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=200;
    const trem=ctx.createGain(); trem.gain.value=0.85;
    const lfo=mkOsc('sine',4); const lg=ctx.createGain(); lg.gain.value=0.12;
    lfo.connect(lg); lg.connect(trem.gain);
    const norm=ctx.createGain(); norm.gain.value=0.65;
    input.connect(hp); hp.connect(hi); hi.connect(lp); lp.connect(trem); trem.connect(norm); norm.connect(output); return;
  }
  if(vrPreset === 'satan') {
    // Szatan — niskie brzmienie + lekki dist, bez przesterowania głośności
    const lo=ctx.createBiquadFilter(); lo.type='lowshelf'; lo.frequency.value=100; lo.gain.value=6;
    const d2=ctx.createWaveShaper(); d2.curve=vrDistCurve(60);
    const lp=ctx.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=1400;
    const osc1=mkOsc('sawtooth',28);
    const oscLp=ctx.createBiquadFilter(); oscLp.type='lowpass'; oscLp.frequency.value=120;
    const og1=ctx.createGain(); og1.gain.value=0.04;
    osc1.connect(oscLp); oscLp.connect(og1); og1.connect(lp);
    const norm=ctx.createGain(); norm.gain.value=0.48;
    input.connect(lo); lo.connect(d2); d2.connect(lp); lp.connect(norm); norm.connect(output); return;
  }
  if(vrPreset === 'space') {
    // Kosmiczny — flanger + długi reverb + highshelf
    const delay=ctx.createDelay(0.03); delay.delayTime.value=0.015;
    const lfo=mkOsc('sine',0.3); const lfoG=ctx.createGain(); lfoG.gain.value=0.012;
    lfo.connect(lfoG); lfoG.connect(delay.delayTime);
    const hi=ctx.createBiquadFilter(); hi.type='highshelf'; hi.frequency.value=4000; hi.gain.value=5;
    const dry=ctx.createGain(); dry.gain.value=0.55;
    const wet=ctx.createGain(); wet.gain.value=0.5;
    input.connect(hi); hi.connect(dry); dry.connect(output);
    hi.connect(delay); delay.connect(wet); wet.connect(output);
    [0.08,0.2,0.45,0.9].forEach((dt,i)=>{
      const d=ctx.createDelay(1.5); d.delayTime.value=dt;
      const g=ctx.createGain(); g.gain.value=0.18-i*0.04;
      input.connect(d); d.connect(g); g.connect(output);
    }); return;
  }
  if(vrPreset === 'kazoo') {
    // Kazoo — wąski bandpass + AM buzz 120Hz
    const bp=ctx.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=1000; bp.Q.value=4;
    const amG=ctx.createGain(); amG.gain.value=0.5;
    bp.connect(amG);
    const osc=mkOsc('square',120); const os=ctx.createGain(); os.gain.value=0.45;
    osc.connect(os); os.connect(amG.gain);
    const norm=ctx.createGain(); norm.gain.value=0.8;
    input.connect(bp); amG.connect(norm); norm.connect(output); return;
  }
  if(vrPreset === 'hall') {
    // Sala koncertowa — naturalny długi reverb
    const hi=ctx.createBiquadFilter(); hi.type='highshelf'; hi.frequency.value=5000; hi.gain.value=3;
    const dry=ctx.createGain(); dry.gain.value=0.55;
    input.connect(hi); hi.connect(dry); dry.connect(output);
    [0.03,0.06,0.1,0.18,0.3,0.5,0.8,1.2,1.8].forEach((dt,i)=>{
      const d=ctx.createDelay(2.5); d.delayTime.value=dt;
      const g=ctx.createGain(); g.gain.value=0.16-i*0.015;
      input.connect(d); d.connect(g); g.connect(output);
    }); return;
  }

  if(vrPreset === 'oldman') {
    // Staruszek — drżący głos (tremolo) + chrapliwy (dist) + lekki lowpass
    const lp=ctx.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=2800;
    const hp=ctx.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=120;
    const dist2=ctx.createWaveShaper(); dist2.curve=vrDistCurve(25);
    // Drżenie głosu — LFO na gain
    const trem=ctx.createGain(); trem.gain.value=0.85;
    const lfo=mkOsc('sine', 5.5); const lg=ctx.createGain(); lg.gain.value=0.18;
    lfo.connect(lg); lg.connect(trem.gain);
    // Lekki chorus dla chropowatości
    const d1=ctx.createDelay(0.05); d1.delayTime.value=0.012;
    const d2=ctx.createDelay(0.05); d2.delayTime.value=0.018;
    const g1=ctx.createGain(); g1.gain.value=0.3;
    const g2=ctx.createGain(); g2.gain.value=0.3;
    const norm=ctx.createGain(); norm.gain.value=0.7;
    input.connect(hp); hp.connect(lp); lp.connect(dist2); dist2.connect(trem);
    trem.connect(norm);
    trem.connect(d1); d1.connect(g1); g1.connect(norm);
    trem.connect(d2); d2.connect(g2); g2.connect(norm);
    norm.connect(output); return;
  }

  if(vrPreset === 'siren') {
    // Syrena — pitch sinusoidalnie faluje w czasie
    const lp=ctx.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=5000;
    const norm=ctx.createGain(); norm.gain.value=0.8;
    // LFO moduluje detune na source (przez periodicWave trick — symulujemy przez chorus)
    const d1=ctx.createDelay(0.1); d1.delayTime.value=0.01;
    const lfo=mkOsc('sine', 0.8);
    const lfoG=ctx.createGain(); lfoG.gain.value=0.04;
    lfo.connect(lfoG); lfoG.connect(d1.delayTime);
    const wet=ctx.createGain(); wet.gain.value=0.7;
    const dry=ctx.createGain(); dry.gain.value=0.5;
    // Dodaj delikatne vibrato na głośność
    const tremG=ctx.createGain(); tremG.gain.value=0.85;
    const lfo2=mkOsc('sine', 0.8); const lg2=ctx.createGain(); lg2.gain.value=0.12;
    lfo2.connect(lg2); lg2.connect(tremG.gain);
    input.connect(lp);
    lp.connect(dry); dry.connect(norm);
    lp.connect(d1); d1.connect(wet); wet.connect(tremG); tremG.connect(norm);
    norm.connect(output); return;
  }

  // ── Nowe suwaki: Formant, Tremolo, Vibrato, Stereo Width ──
  // (aplikowane na końcu jako dodatkowe efekty po presetcie)
  // Obsługiwane w dodatkowej warstwie poniżej fallbacku

  // Fallback
  input.connect(output);

  // Post-processing: Formant, Tremolo, Vibrato, Stereo
  const formantVal = parseFloat(document.getElementById('vrFormant')?.value || 0);
  const tremoloVal = parseFloat(document.getElementById('vrTremolo')?.value || 0);
  const vibratoVal = parseFloat(document.getElementById('vrVibrato')?.value || 0);
  const stereoVal  = parseFloat(document.getElementById('vrStereo')?.value  || 0);

  // Te suwaki są aplikowane przez vrBuildFxChainPost który jest wywoływany z vrStartPlay
}

// Post-processing layer dla nowych suwaków
function vrApplyPostFx(ctx, source, dest) {
  const formantVal = parseFloat(document.getElementById('vrFormant')?.value || 0);
  const tremoloVal = parseFloat(document.getElementById('vrTremolo')?.value || 0);
  const vibratoVal = parseFloat(document.getElementById('vrVibrato')?.value || 0);
  const stereoVal  = parseFloat(document.getElementById('vrStereo')?.value  || 0);

  let node = source;

  // Formant — peak filter przesuwający formant
  if(formantVal !== 0) {
    const f1=ctx.createBiquadFilter(); f1.type='peaking'; f1.frequency.value=800;  f1.Q.value=2; f1.gain.value= formantVal*2;
    const f2=ctx.createBiquadFilter(); f2.type='peaking'; f2.frequency.value=1600; f2.Q.value=2; f2.gain.value= formantVal*1.5;
    const f3=ctx.createBiquadFilter(); f3.type='peaking'; f3.frequency.value=2800; f3.Q.value=2; f3.gain.value=-formantVal;
    node.connect(f1); f1.connect(f2); f2.connect(f3); node=f3;
  }

  // Tremolo — LFO na gain
  if(tremoloVal > 0) {
    const tg=ctx.createGain(); tg.gain.value=1-tremoloVal*0.5;
    const lfo=ctx.createOscillator(); lfo.type='sine'; lfo.frequency.value=5;
    const lg=ctx.createGain(); lg.gain.value=tremoloVal*0.5;
    lfo.connect(lg); lg.connect(tg.gain); lfo.start();
    node.connect(tg); node=tg;
  }

  // Vibrato — LFO na delay time
  if(vibratoVal > 0) {
    const vd=ctx.createDelay(0.05); vd.delayTime.value=0.005;
    const lfo=ctx.createOscillator(); lfo.type='sine'; lfo.frequency.value=6;
    const lg=ctx.createGain(); lg.gain.value=vibratoVal*0.008;
    lfo.connect(lg); lg.connect(vd.delayTime); lfo.start();
    node.connect(vd); node=vd;
  }

  // Stereo Width — mid-side processing
  if(stereoVal > 0) {
    const merger=ctx.createChannelMerger(2);
    const splitter=ctx.createChannelSplitter(2);
    const lGain=ctx.createGain(); lGain.gain.value=1+stereoVal*0.5;
    const rGain=ctx.createGain(); rGain.gain.value=1-stereoVal*0.5;
    node.connect(splitter);
    splitter.connect(lGain,0); splitter.connect(rGain,1);
    lGain.connect(merger,0,0); rGain.connect(merger,0,1);
    node=merger;
  }

  node.connect(dest);
}
function vrDistCurve(amount) {
  const n = 256, c = new Float32Array(n);
  for(let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    c[i] = (Math.PI + amount) * x / (Math.PI + amount * Math.abs(x));
  }
  return c;
}

// ── Pobierz z efektami ──
async function vrDownloadProcessed() {
  if(!vrBuffer) { toast(t('toast_no_recording'), 'error'); return; }

  const dl = document.getElementById('vrDownloadBtn');
  const origText = dl.textContent;
  dl.textContent = '⏳ Renderuję...';
  dl.style.pointerEvents = 'none';

  try {
    const semitones = parseFloat(document.getElementById('vrPitch').value)  || 0;
    const speed     = parseFloat(document.getElementById('vrSpeed').value)   || 1;
    const playbackRate = Math.pow(2, semitones / 12) * speed;

    // OfflineAudioContext — renderuje szybciej niż real-time
    const duration   = vrBuffer.duration / playbackRate;
    const sampleRate = vrBuffer.sampleRate || 44100;
    const offCtx     = new OfflineAudioContext(2, Math.ceil(duration * sampleRate), sampleRate);

    const src = offCtx.createBufferSource();
    src.buffer = vrBuffer;
    src.playbackRate.value = playbackRate;

    // Zbuduj chain efektów w OfflineAudioContext
    // Chwilowo podmień globalny ctx żeby vrBuildChain użył offCtx
    const savedCtx = vrAudioCtx;
    vrAudioCtx = offCtx;

    let chain;
    try { chain = vrBuildChain(offCtx); } catch(e) { chain = null; }

    const vol = offCtx.createGain();
    vol.gain.value = parseFloat(document.getElementById('vrVolume').value) || 1;
    vol.connect(offCtx.destination);

    if(chain && chain.input && chain.output) {
      src.connect(chain.input);
      chain.output.connect(vol);
    } else {
      src.connect(vol);
    }

    vrAudioCtx = savedCtx; // przywróć

    src.start(0);
    const renderedBuffer = await offCtx.startRendering();

    // Konwertuj AudioBuffer → WAV blob
    const wav = vrAudioBufferToWav(renderedBuffer);
    const blob = new Blob([wav], { type: 'audio/wav' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `glos_efekt_${vrPreset}_${Date.now()}.wav`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast(t('toast_downloaded_fx'), 'ok');
  } catch(e) {
    console.error(e);
    // Fallback — pobierz surowe
    const a = document.createElement('a');
    a.href  = URL.createObjectURL(vrBlob);
    a.download = `glos_${Date.now()}.webm`;
    a.click();
    toast(t('toast_downloaded_orig_err'), 'warn');
  }

  dl.textContent = origText;
  dl.style.pointerEvents = '';
}

// AudioBuffer → WAV (16-bit PCM)
function vrAudioBufferToWav(buffer) {
  const numCh  = buffer.numberOfChannels;
  const sr     = buffer.sampleRate;
  const len    = buffer.length;
  const bpp    = 2; // 16-bit
  const data   = new DataView(new ArrayBuffer(44 + len * numCh * bpp));
  let off = 0;
  const str = s => { for(let i=0;i<s.length;i++) data.setUint8(off++, s.charCodeAt(i)); };
  const u16 = v => { data.setUint16(off, v, true); off+=2; };
  const u32 = v => { data.setUint32(off, v, true); off+=4; };
  str('RIFF'); u32(36 + len*numCh*bpp); str('WAVE');
  str('fmt '); u32(16); u16(1); u16(numCh); u32(sr); u32(sr*numCh*bpp); u16(numCh*bpp); u16(16);
  str('data'); u32(len*numCh*bpp);
  // Interleave channels
  const ch = [];
  for(let c=0;c<numCh;c++) ch.push(buffer.getChannelData(c));
  for(let i=0;i<len;i++) {
    for(let c=0;c<numCh;c++) {
      const s = Math.max(-1, Math.min(1, ch[c][i]));
      data.setInt16(off, s < 0 ? s*0x8000 : s*0x7FFF, true); off+=2;
    }
  }
  return data.buffer;
}

// ── Pętla ──
function vrToggleLoop() {
  vrLoopOn = !vrLoopOn;
  const btn = document.getElementById('vrLoopBtn');
  if(btn) {
    btn.style.background = vrLoopOn ? 'rgba(236,72,153,0.18)' : 'rgba(255,255,255,0.04)';
    btn.style.borderColor = vrLoopOn ? '#ec4899' : 'rgba(255,255,255,0.12)';
    btn.style.color = vrLoopOn ? '#ec4899' : 'rgba(255,255,255,0.35)';
  }
  if(vrSource) vrSource.loop = vrLoopOn;
  if(vrLoopOn && !vrIsPlaying && vrBuffer) vrStartPlay(0);
}

// ── A/B porównanie ──
function vrToggleAB() {
  if(!vrBuffer) { toast(t('toast_record_voice_first'), 'warn'); return; }
  if(!vrABMode) {
    // Włącz tryb A/B — zacznij od oryginału
    vrABMode = true;
    vrABOriginal = true;
  } else {
    // Przełącz między oryginałem a efektem
    vrABOriginal = !vrABOriginal;
  }
  const bar   = document.getElementById('vrABBar');
  const label = document.getElementById('vrABLabel');
  const btn   = document.getElementById('vrABBtn');
  if(bar) bar.style.display = 'block';
  if(label) label.textContent = vrABOriginal ? 'ORYGINAŁ' : 'Z EFEKTAMI';
  if(btn) {
    btn.style.background = vrABOriginal
      ? 'rgba(0,180,216,0.15)' : 'rgba(236,72,153,0.15)';
    btn.style.borderColor = vrABOriginal ? '#00b4d8' : '#ec4899';
    btn.style.color       = vrABOriginal ? '#00b4d8' : '#ec4899';
    btn.textContent       = vrABOriginal ? 'A' : 'B';
  }
  if(vrIsPlaying) {
    const off = vrAudioCtx ? Math.max(0, vrAudioCtx.currentTime - vrPlayStartAt) : 0;
    vrStartPlay(off);
  } else if(vrBuffer) {
    vrStartPlay(0);
  }
}

// ── Losuj preset i suwaki ──
function vrRandomize() {
  const presets = ['normal','robot','deep','chipmunk','echo','phone','alien','cave',
                   'whisper','megaphone','underwater','stadium','demon','helium','radio','vintage',
                   'darth','giant','ghost','choir','troll','chipmunk2','horror','angel','walkie','submarine','drunk','monster','cartoon','cave2','radio2','bathroom','cyborg','baby','satan','space','kazoo','hall'];
  const newPreset = presets[Math.floor(Math.random() * presets.length)];

  // Losuj suwaki w rozsądnych zakresach
  document.getElementById('vrPitch').value   = (Math.random() * 16 - 8).toFixed(1);
  document.getElementById('vrSpeed').value   = (0.6 + Math.random() * 1.4).toFixed(2);
  document.getElementById('vrBass').value    = (Math.random() * 24 - 12).toFixed(0);
  document.getElementById('vrTreble').value  = (Math.random() * 24 - 12).toFixed(0);
  document.getElementById('vrMid').value     = (Math.random() * 20 - 10).toFixed(0);
  document.getElementById('vrVolume').value  = (0.7 + Math.random() * 0.8).toFixed(2);
  document.getElementById('vrReverb').value  = (Math.random() * 0.7).toFixed(2);
  document.getElementById('vrDist').value    = Math.floor(Math.random() * 60);
  document.getElementById('vrChorus').value  = (Math.random() * 0.6).toFixed(2);

  vrUpdateSliders();
  const btn = document.querySelector(`.vr-preset[data-preset="${newPreset}"]`);
  vrSetPreset(newPreset, btn);

  // Animacja przycisku 🎲
  const randBtn = document.querySelector('[onclick="vrRandomize()"]');
  if(randBtn) {
    randBtn.style.transform = 'scale(1.3) rotate(30deg)';
    setTimeout(() => { randBtn.style.transform = ''; }, 200);
  }
}

// ── Preset / suwaki ──
function vrSetPreset(name, btn) {
  vrPreset = name;
  document.querySelectorAll('.vr-preset').forEach(b => b.classList.remove('active'));
  if(btn) btn.classList.add('active');

  // Auto-ustaw suwaki dla konkretnych presetów
  const presetSliders = {
    baby:    { pitch: 7,   speed: 1.15 },
    chipmunk:{ pitch: 8,   speed: 1.3  },
    deep:    { pitch: -5,  speed: 0.88 },
    giant:   { pitch: -6,  speed: 0.82 },
    darth:   { pitch: -4,  speed: 0.92 },
    demon:   { pitch: -3,  speed: 0.9  },
    satan:   { pitch: -5,  speed: 0.85 },
    helium:  { pitch: 10,  speed: 1.4  },
    troll:   { pitch: -4,  speed: 0.85 },
    mouse:   { pitch: 9,   speed: 1.35 },
    cyborg:  { pitch: 0,   speed: 1.0  },
    oldman:  { pitch: -3,  speed: 0.88 },
    siren:   { pitch: 0,   speed: 1.0  },
  };

  if(presetSliders[name]) {
    document.getElementById('vrPitch').value = presetSliders[name].pitch;
    document.getElementById('vrSpeed').value = presetSliders[name].speed;
    vrUpdateSliders();
    return; // vrUpdateSliders wywoła vrStartPlay jeśli gra
  }

  if(vrIsPlaying) { const off = vrAudioCtx ? Math.max(0, vrAudioCtx.currentTime - vrPlayStartAt) : 0; vrStartPlay(off); }
}

function vrUpdateSliders() {
  const pitch   = parseFloat(document.getElementById('vrPitch').value);
  const speed   = parseFloat(document.getElementById('vrSpeed').value);
  const bass    = parseFloat(document.getElementById('vrBass').value);
  const treble  = parseFloat(document.getElementById('vrTreble').value);
  const mid     = parseFloat(document.getElementById('vrMid').value);
  const vol     = parseFloat(document.getElementById('vrVolume').value);
  const rev     = parseFloat(document.getElementById('vrReverb').value);
  const dist    = parseFloat(document.getElementById('vrDist').value);
  const chor    = parseFloat(document.getElementById('vrChorus').value);
  const formant = parseFloat(document.getElementById('vrFormant').value);
  const tremolo = parseFloat(document.getElementById('vrTremolo').value);
  const vibrato = parseFloat(document.getElementById('vrVibrato').value);
  const stereo  = parseFloat(document.getElementById('vrStereo').value);
  document.getElementById('vrPitchVal').textContent   = (pitch >= 0 ? '+' : '') + pitch + ' st';
  document.getElementById('vrSpeedVal').textContent   = speed.toFixed(2) + '×';
  document.getElementById('vrBassVal').textContent    = (bass >= 0 ? '+' : '') + bass + ' dB';
  document.getElementById('vrTrebleVal').textContent  = (treble >= 0 ? '+' : '') + treble + ' dB';
  document.getElementById('vrMidVal').textContent     = (mid >= 0 ? '+' : '') + mid + ' dB';
  document.getElementById('vrVolumeVal').textContent  = Math.round(vol * 100) + '%';
  document.getElementById('vrReverbVal').textContent  = Math.round(rev * 100) + '%';
  document.getElementById('vrDistVal').textContent    = dist;
  document.getElementById('vrChorusVal').textContent  = Math.round(chor * 100) + '%';
  document.getElementById('vrFormantVal').textContent = (formant >= 0 ? '+' : '') + formant + ' st';
  document.getElementById('vrTremoloVal').textContent = Math.round(tremolo * 100) + '%';
  document.getElementById('vrVibratoVal').textContent = Math.round(vibrato * 100) + '%';
  document.getElementById('vrStereoVal').textContent  = Math.round(stereo * 100) + '%';
  if(vrIsPlaying) {
    const off = vrAudioCtx ? Math.max(0, vrAudioCtx.currentTime - vrPlayStartAt) : 0;
    vrStartPlay(off);
  }
}

// ── Reset ──
function vrReset() {
  vrStopRecord();
  vrStopPlay();
  vrBlob = null; vrBuffer = null; vrOrigBuffer = null; vrChunks = [];
  vrPlayOffset = 0; vrRecSeconds = 0;
  vrLoopOn = false; vrABMode = false; vrABOriginal = true;

  document.getElementById('vrPlayBtn').disabled = true;
  document.getElementById('vrPlayBtn').textContent = '▶';
  document.getElementById('vrPlayBar').style.width = '0%';
  document.getElementById('vrDuration').textContent = '0:00';
  document.getElementById('vrDownloadBtn').style.display = 'none';
  document.getElementById('vrRecTimer').style.display = 'none';

  // A/B bar
  const ab = document.getElementById('vrABBar');
  if(ab) ab.style.display = 'none';
  const abBtn = document.getElementById('vrABBtn');
  if(abBtn) { abBtn.textContent='A/B'; abBtn.style.background='rgba(0,180,216,0.06)'; abBtn.style.borderColor='rgba(0,180,216,0.3)'; abBtn.style.color='#00b4d8'; }

  // Loop btn
  const loopBtn = document.getElementById('vrLoopBtn');
  if(loopBtn) { loopBtn.style.background='rgba(255,255,255,0.04)'; loopBtn.style.borderColor='rgba(255,255,255,0.12)'; loopBtn.style.color='rgba(255,255,255,0.35)'; }

  const lbl = document.getElementById('vrRecStatus');
  if(lbl) { lbl.style.display = 'block'; lbl.textContent = t('vr_click_rec') || 'Kliknij aby nagrywać'; }

  document.getElementById('vrPitch').value   = 0;
  document.getElementById('vrSpeed').value   = 1;
  document.getElementById('vrBass').value    = 0;
  document.getElementById('vrTreble').value  = 0;
  document.getElementById('vrMid').value     = 0;
  document.getElementById('vrVolume').value  = 1;
  document.getElementById('vrReverb').value  = 0;
  document.getElementById('vrDist').value    = 0;
  document.getElementById('vrChorus').value  = 0;
  document.getElementById('vrFormant').value = 0;
  document.getElementById('vrTremolo').value = 0;
  document.getElementById('vrVibrato').value = 0;
  document.getElementById('vrStereo').value  = 0;
  vrUpdateSliders();
  vrPreset = 'normal';
  document.querySelectorAll('.vr-preset').forEach((b,i) => { b.classList.toggle('active', i === 0); });
  vrDrawIdleWave();
}

// ── Wizualizacja ──
function vrDrawIdleWave() {
  const canvas = document.getElementById('vrWaveCanvas');
  if(!canvas) return;
  const W = canvas.offsetWidth || 500, H = 64;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(236,72,153,0.2)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, H/2);
  for(let x = 0; x < W; x++) {
    const y = H/2 + Math.sin(x * 0.06) * 4;
    ctx.lineTo(x, y);
  }
  ctx.stroke();
}

function vrDrawLiveWave() {
  const canvas = document.getElementById('vrWaveCanvas');
  if(!canvas || !vrIsRecording) return;
  const W = canvas.offsetWidth || 500, H = 64;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  const analyserNow = vrAnalyser; // BUG 5 FIX: lokalna kopia — nullowanie w stopRecord nie crashnie
  if(analyserNow) {
    const data = new Uint8Array(analyserNow.fftSize);
    analyserNow.getByteTimeDomainData(data);
    ctx.strokeStyle = '#ec4899';
    ctx.lineWidth = 2;
    ctx.shadowBlur = 8; ctx.shadowColor = '#ec4899';
    ctx.beginPath();
    data.forEach((v, i) => {
      const x = (i / data.length) * W;
      const y = ((v / 128) - 1) * (H/2 - 4) + H/2;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
  vrWaveRafId = requestAnimationFrame(vrDrawLiveWave);
}

function vrDrawBufferWave() {
  const canvas = document.getElementById('vrWaveCanvas');
  if(!canvas || !vrBuffer) return;
  const W = canvas.offsetWidth || 500, H = 64;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  const data    = vrBuffer.getChannelData(0);
  const step    = Math.ceil(data.length / W);
  const grad    = ctx.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0,   '#ec4899');
  grad.addColorStop(0.5, '#a855f7');
  grad.addColorStop(1,   '#ec4899');
  ctx.fillStyle = grad;

  for(let i = 0; i < W; i++) {
    let max = 0;
    for(let j = 0; j < step; j++) {
      const v = Math.abs(data[i * step + j] || 0);
      if(v > max) max = v;
    }
    const h = Math.max(2, max * (H - 8));
    ctx.fillRect(i, (H - h) / 2, 1, h);
  }
}

function openSpeakerTest() {
  document.getElementById('speakerModal').classList.add('show');
  spkBuildToneGrid();
  spkBuildHearGrid();
}

function closeSpeakerTest() {
  document.getElementById('speakerModal').classList.remove('show');
  spkStopSweep();
  spkStopTone();
  spkStopHear();
  // close AudioContext to release audio hardware
  if(spkAC) { try { spkAC.close(); } catch(e){} spkAC = null; }
}

// ── Channel test ──
function spkPlayChannel(ch) {
  const ac = spkGetAC();
  const dur = 1.5;

  // panner for L/C/R
  const panner = ac.createStereoPanner();
  panner.pan.value = ch === 'left' ? -1 : ch === 'right' ? 1 : 0;

  const osc = ac.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = 440;

  const gain = ac.createGain();
  gain.gain.setValueAtTime(spkVolume_v, ac.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);

  osc.connect(gain); gain.connect(panner); panner.connect(ac.destination);
  osc.start(); osc.stop(ac.currentTime + dur);

  // add a second harmonic for richness
  const osc2 = ac.createOscillator();
  osc2.type = 'sine'; osc2.frequency.value = 880;
  const g2 = ac.createGain();
  g2.gain.setValueAtTime(spkVolume_v * 0.3, ac.currentTime);
  g2.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
  osc2.connect(g2); g2.connect(panner);
  osc2.start(); osc2.stop(ac.currentTime + dur);

  const labels = {left:'⬅️ Lewy kanał gra', center:'🔊 Środek gra', right:'Prawy kanał gra ➡️'};
  const statusEl = document.getElementById('spkChStatus');
  statusEl.textContent = labels[ch];
  statusEl.style.color = ch === 'left' ? '#00b4d8' : ch === 'right' ? '#ff4d6d' : '#00f5a0';
  setTimeout(() => { statusEl.textContent = 'Kliknij kanał aby przetestować'; statusEl.style.color = ''; }, dur * 1000);
}

// ── Sweep ──
let spkSweepCanvas_hist = [];

function spkStartSweep(ch) {
  spkStopSweep();
  const ac = spkGetAC();
  const dur = parseInt(document.getElementById('spkDuration').value);
  const startFreq = 20, endFreq = 20000;
  spkSweepRunning = true;
  spkSweepCanvas_hist = [];

  document.getElementById('spkBtnStop').style.display = 'inline-block';
  ['spkBtnBoth','spkBtnLeft','spkBtnRight'].forEach(id => {
    document.getElementById(id).disabled = true;
  });

  const panner = ac.createStereoPanner();
  panner.pan.value = ch === 'left' ? -1 : ch === 'right' ? 1 : 0;

  spkSweepOsc = ac.createOscillator();
  spkSweepOsc.type = 'sine';
  spkSweepOsc.frequency.setValueAtTime(startFreq, ac.currentTime);
  spkSweepOsc.frequency.exponentialRampToValueAtTime(endFreq, ac.currentTime + dur);

  spkSweepGain = ac.createGain();
  spkSweepGain.gain.value = spkVolume_v;

  spkSweepOsc.connect(spkSweepGain); spkSweepGain.connect(panner); panner.connect(ac.destination);
  spkSweepOsc.start();
  spkSweepOsc.stop(ac.currentTime + dur);

  const chLabel = ch === 'left' ? '⬅ L' : ch === 'right' ? 'R ➡' : 'L+R';
  document.getElementById('spkSweepCh').textContent = chLabel;

  const startTime = ac.currentTime;
  function animSweep() {
    if(!spkSweepRunning) return;
    const elapsed = ac.currentTime - startTime;
    const pct = Math.min(elapsed / dur, 1);
    // log scale frequency display
    const freq = Math.round(startFreq * Math.pow(endFreq/startFreq, pct));
    document.getElementById('spkSweepHz').textContent = freq >= 1000 ? (freq/1000).toFixed(1)+'k' : freq;
    document.getElementById('spkSweepPct').textContent = Math.round(pct*100) + '%';
    document.getElementById('spkSweepTime').textContent = elapsed.toFixed(1);
    document.getElementById('spkSweepBar').style.width = (pct*100) + '%';

    // draw sweep canvas
    spkSweepCanvas_hist.push({pct, freq});
    spkDrawSweepCanvas(ch);

    if(pct < 1) {
      spkSweepRaf = requestAnimationFrame(animSweep);
    } else {
      spkStopSweep(true);
    }
  }
  spkSweepRaf = requestAnimationFrame(animSweep);
}

function spkStopSweep(finished) {
  spkSweepRunning = false;
  if(spkSweepRaf) { cancelAnimationFrame(spkSweepRaf); spkSweepRaf = null; }
  if(spkSweepOsc) { try { spkSweepOsc.stop(); } catch(e){} spkSweepOsc = null; }
  if(spkSweepGain) { spkSweepGain.disconnect(); spkSweepGain = null; }
  const stopBtn = document.getElementById('spkBtnStop');
  if(stopBtn) stopBtn.style.display = 'none';
  ['spkBtnBoth','spkBtnLeft','spkBtnRight'].forEach(id => {
    const el = document.getElementById(id);
    if(el) el.disabled = false;
  });
  if(!finished) {
    const hzEl = document.getElementById('spkSweepHz');
    const pctEl = document.getElementById('spkSweepPct');
    const barEl = document.getElementById('spkSweepBar');
    if(hzEl) hzEl.textContent = '—';
    if(pctEl) pctEl.textContent = '0%';
    if(barEl) barEl.style.width = '0%';
  }
}

function spkDrawSweepCanvas(ch) {
  const canvas = document.getElementById('spkSweepCanvas');
  if(!canvas) return;
  const W = canvas.offsetWidth || 600, H = 60;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0,0,W,H);

  if(spkSweepCanvas_hist.length < 2) return;

  const grad = ctx.createLinearGradient(0,0,W,0);
  if(ch === 'left')       { grad.addColorStop(0,'#00b4d8'); grad.addColorStop(1,'#00f5a0'); }
  else if(ch === 'right') { grad.addColorStop(0,'#ff9a3c'); grad.addColorStop(1,'#ff4d6d'); }
  else                    { grad.addColorStop(0,'#a78bff'); grad.addColorStop(1,'#ff9a3c'); }

  // sine wave visualization
  ctx.beginPath(); ctx.strokeStyle = grad; ctx.lineWidth = 2;
  spkSweepCanvas_hist.forEach((pt, i) => {
    const x = pt.pct * W;
    const freq = pt.freq;
    const amp = H * 0.35;
    // amplitude decreases at extremes (very low/high harder to hear)
    const loudness = freq < 100 ? freq/100 : freq > 10000 ? (20000-freq)/10000 : 1;
    const y = H/2 + Math.sin(i * 0.4) * amp * loudness;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();

  // freq labels
  [100, 1000, 10000].forEach(f => {
    const pct = Math.log(f/20) / Math.log(20000/20);
    const x = pct * W;
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.font = '7px Space Mono,monospace';
    ctx.fillText(f >= 1000 ? f/1000+'kHz' : f+'Hz', x+2, H-4);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke();
  });
}

// ── Tone generator ──
function spkBuildToneGrid() {
  const grid = document.getElementById('spkToneGrid');
  grid.innerHTML = '';
  SPK_TONES.forEach(t => {
    const btn = document.createElement('button');
    btn.className = 'spk-tone-key';
    btn.dataset.freq = t.freq;
    btn.innerHTML = `<div style="font-weight:700">${t.label}</div><div style="font-size:7px;opacity:0.6">${t.note}</div>`;
    btn.onclick = () => {
      document.querySelectorAll('.spk-tone-key').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('spkFreqSlider').value = t.freq;
      document.getElementById('spkFreqVal').textContent = t.label;
      spkCustomFreq = t.freq;
      spkPlayTone();
    };
    grid.appendChild(btn);
  });
}

function spkUpdateCustomFreq(val) {
  spkCustomFreq = parseInt(val);
  document.getElementById('spkFreqVal').textContent = val >= 1000 ? (val/1000).toFixed(1)+' kHz' : val+' Hz';
  document.querySelectorAll('.spk-tone-key').forEach(b => b.classList.remove('active'));
  if(spkToneOsc) spkToneOsc.frequency.setValueAtTime(spkCustomFreq, spkAC.currentTime);
}

function spkPlayTone() {
  spkStopTone();
  const ac = spkGetAC();
  spkToneGain = ac.createGain();
  spkToneGain.gain.value = spkVolume_v;
  spkToneOsc = ac.createOscillator();
  spkToneOsc.type = document.getElementById('spkWaveType').value;
  spkToneOsc.frequency.value = spkCustomFreq;
  spkToneOsc.connect(spkToneGain);
  spkToneGain.connect(ac.destination);
  spkToneOsc.start();
  document.getElementById('spkToneBtn').textContent = '🔊 Gra...';
}

function spkStopTone() {
  if(spkToneOsc) { try { spkToneOsc.stop(); } catch(e){} spkToneOsc = null; }
  if(spkToneGain) { spkToneGain.disconnect(); spkToneGain = null; }
  document.getElementById('spkToneBtn').textContent = '▶ Graj ton';
  document.querySelectorAll('.spk-tone-key').forEach(b => b.classList.remove('active'));
}

// ── Hearing test ──
function spkBuildHearGrid() {
  const grid = document.getElementById('spkHearGrid');
  grid.innerHTML = '';
  spkHearFreqs.forEach((f, i) => {
    const btn = document.createElement('button');
    btn.className = 'spk-hear-key';
    btn.id = `spkHear_${i}`;
    btn.innerHTML = `<span style="font-weight:700">${f >= 1000 ? f/1000+'kHz' : f+'Hz'}</span><span style="font-size:6px;opacity:0.5">—</span>`;
    grid.appendChild(btn);
  });
}

function spkStartHearTest() {
  spkHearResults = {};
  spkHearFreqs.forEach((f,i) => {
    const btn = document.getElementById(`spkHear_${i}`);
    if(btn) { btn.className = 'spk-hear-key'; btn.onclick = null; }
  });
  document.getElementById('spkHearResult').textContent = '';
  spkHearCurrentIdx = 0;
  spkPlayHearTone(0);
}

function spkPlayHearTone(idx) {
  spkStopHear();
  if(idx >= spkHearFreqs.length) { spkShowHearResult(); return; }
  spkHearCurrentIdx = idx;
  const freq = spkHearFreqs[idx];
  const ac = spkGetAC();

  const osc = ac.createOscillator();
  osc.type = 'sine'; osc.frequency.value = freq;
  const gain = ac.createGain();
  gain.gain.setValueAtTime(0, ac.currentTime);
  gain.gain.linearRampToValueAtTime(spkVolume_v * 0.7, ac.currentTime + 0.1);
  gain.gain.setValueAtTime(spkVolume_v * 0.7, ac.currentTime + 1.5);
  gain.gain.linearRampToValueAtTime(0, ac.currentTime + 1.8);
  osc.connect(gain); gain.connect(ac.destination);
  osc.start(); osc.stop(ac.currentTime + 2);
  spkHearOsc = osc;

  // highlight current
  const btn = document.getElementById(`spkHear_${idx}`);
  if(btn) {
    btn.className = 'spk-hear-key playing';
    btn.onclick = null;
    // after tone, show yes/no — guard: only if modal still open
    setTimeout(() => {
      if(!document.getElementById('speakerModal').classList.contains('show')) return;
      btn.className = 'spk-hear-key';
      btn.innerHTML = `<span style="font-weight:700">${freq >= 1000 ? freq/1000+'kHz' : freq+'Hz'}</span>
        <div style="display:flex;gap:2px;margin-top:2px;">
          <span onclick="spkHearAnswer(${idx},true)" style="cursor:pointer;padding:1px 5px;border-radius:3px;background:rgba(0,245,160,0.2);color:#00f5a0;">✓</span>
          <span onclick="spkHearAnswer(${idx},false)" style="cursor:pointer;padding:1px 5px;border-radius:3px;background:rgba(255,77,109,0.2);color:#ff4d6d;">✗</span>
        </div>`;
    }, 2000);
  }
}

function spkHearAnswer(idx, heard) {
  spkHearResults[idx] = heard;
  const btn = document.getElementById(`spkHear_${idx}`);
  const freq = spkHearFreqs[idx];
  if(btn) {
    btn.className = 'spk-hear-key ' + (heard ? 'heard' : 'notheard');
    btn.innerHTML = `<span style="font-weight:700">${freq >= 1000 ? freq/1000+'kHz' : freq+'Hz'}</span><span>${heard ? '✓' : '✗'}</span>`;
    btn.onclick = null;
  }
  // play next
  setTimeout(() => spkPlayHearTone(idx + 1), 400);
}

function spkStopHear() {
  if(spkHearOsc) { try { spkHearOsc.stop(); } catch(e){} spkHearOsc = null; }
}

function spkShowHearResult() {
  const heard = Object.values(spkHearResults).filter(Boolean).length;
  const total = spkHearFreqs.length;
  const heardIndices = Object.entries(spkHearResults).filter(([,v])=>v).map(([k])=>parseInt(k));
  const maxHeardIdx = heardIndices.length > 0 ? Math.max(...heardIndices) : -1;
  const maxFreq = maxHeardIdx >= 0 ? (spkHearFreqs[maxHeardIdx] || 0) : 0;
  let rating;
  if(heard === 0)            rating = '❌ Brak słyszalnych tonów — sprawdź głośność';
  else if(maxFreq >= 16000)  rating = '🏆 Doskonały słuch!';
  else if(maxFreq >= 12000)  rating = '✅ Dobry słuch';
  else if(maxFreq >= 8000)   rating = '👍 Przeciętny słuch';
  else if(maxFreq >= 4000)   rating = '⚠️ Słaby słuch — rozważ badanie';
  else                        rating = '❌ Bardzo słaby słuch';
  document.getElementById('spkHearResult').textContent = heard === 0
    ? rating
    : `${rating} — słyszysz do ${maxFreq >= 1000 ? maxFreq/1000+'kHz' : maxFreq+'Hz'} (${heard}/${total} tonów)`;
}

function spkSetVolume(val) {
  spkVolume_v = val / 100;
  document.getElementById('spkVolVal').textContent = val + '%';
  if(spkToneGain) spkToneGain.gain.value = spkVolume_v;
}

// ─── WIFI INFO ────────────────────────────────────────
function openWifiInfo() {
  document.getElementById('wifiModal').classList.add('show');
  loadWifiInfo();
}
function closeWifiInfo() {
  document.getElementById('wifiModal').classList.remove('show');
}

async function loadWifiInfo() {
  // reset
  ['wifiLocalIp','wifiPublicIp','wifiHostname','wifiConnType','wifiDownlink','wifiRtt','wifiProto','wifiUa','wifiNetClass','wifiRange','wifiGateway','wifiMask'].forEach(id => {
    const el = document.getElementById(id); if(el) el.textContent = '⏳...';
  });
  document.getElementById('wifiWebrtcIps').textContent = t('wifi_detecting');

  // ── Public IP — pełna lista fallbacków jak w teście internetu ──
  const wifiIpApis = [
    { url: 'https://ipwho.is/',                   get: d => d.ip },
    { url: 'https://ip-api.com/json/?fields=query', get: d => d.query },
    { url: 'https://freeipapi.com/api/json',       get: d => d.ipAddress },
    { url: 'https://api64.ipify.org?format=json',  get: d => d.ip },
    { url: 'https://api.ipify.org?format=json',    get: d => d.ip },
  ];
  let publicIp = null;
  for(const api of wifiIpApis) {
    try {
      const _ctrl = new AbortController(); const _t = setTimeout(()=>_ctrl.abort(),7000);
      let r; try { r = await fetch(api.url, { signal: _ctrl.signal }); } finally { clearTimeout(_t); }
      const d = await r.json();
      if(api.get(d)) { publicIp = api.get(d); break; }
    } catch(e) {}
  }
  document.getElementById('wifiPublicIp').textContent = publicIp || t('wifi_unavail');

  // ── Local IP via WebRTC ──
  const localIps = await getLocalIpsViaWebRTC();
  const ipEl = document.getElementById('wifiWebrtcIps');
  const localEl = document.getElementById('wifiLocalIp');
  if(localIps.length) {
    ipEl.innerHTML = localIps.map(ip => {
      const isIpv6 = ip.startsWith('[IPv6]');
      const isVpn  = ip.startsWith('10.') || ip.startsWith('172.') || isIpv6;
      const label  = isIpv6 ? 'Tunel VPN IPv6' : classifyIp(ip);
      const color  = isIpv6 ? 'var(--accent3)' : 'var(--accent)';
      return `<div style="display:flex;align-items:center;gap:10px;"><span style="color:${color}">${ip}</span><span style="font-size:9px;color:var(--muted);">${label}</span></div>`;
    }).join('');
    // Priorytet: najpierw 192.168.x.x, potem 10.x, potem VPN 172.x, potem cokolwiek
    const lanIp = localIps.find(ip => ip.startsWith('192.168.'))
      || localIps.find(ip => ip.startsWith('10.'))
      || localIps.find(ip => /^172\.(1[6-9]|2\d|3[01])\./.test(ip))
      || localIps.find(ip => !ip.startsWith('[IPv6]'))
      || localIps[0];
    localEl.textContent = lanIp;
    if(!lanIp.startsWith('[IPv6]')) fillNetworkInfo(lanIp);
  } else {
    ipEl.textContent = 'WebRTC zablokowany lub niedostępny (VPN może blokować STUN)';
    localEl.textContent = '— (WebRTC zablokowany)';
    document.getElementById('wifiNetClass').textContent = '—';
    document.getElementById('wifiRange').textContent = '—';
    document.getElementById('wifiGateway').textContent = '—';
    document.getElementById('wifiMask').textContent = '—';
  }

  // ── Hostname ──
  document.getElementById('wifiHostname').textContent = window.location.hostname || 'localhost';

  // ── Connection info ──
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if(conn) {
    const typeMap = {wifi:'📶 WiFi', ethernet:'🔌 Ethernet', cellular:'📱 Komórkowe', bluetooth:'📡 Bluetooth'};
    const effMap  = {'slow-2g':'Slow 2G','2g':'2G','3g':'3G','4g':'4G / WiFi'};
    let connType = typeMap[conn.type] || '';
    if(!connType) {
      const dl = conn.downlink || 0, rtt = conn.rtt || 999;
      if(dl >= 10 && rtt <= 50)      connType = '📶 WiFi (szybkie)';
      else if(dl >= 2 && rtt <= 150) connType = '📶 WiFi / Ethernet';
      else if(conn.effectiveType === '4g') connType = '📶 WiFi lub LTE';
      else connType = '🌐 Online';
    }
    document.getElementById('wifiConnType').textContent = connType;
    document.getElementById('wifiDownlink').textContent = conn.downlink ? `~${conn.downlink} Mb/s` : '— (brak danych)';
    document.getElementById('wifiRtt').textContent      = conn.rtt      ? `~${conn.rtt} ms`        : '— (brak danych)';
  } else {
    document.getElementById('wifiConnType').textContent = navigator.onLine ? '🌐 Online' : '❌ Offline';
    document.getElementById('wifiDownlink').textContent = '— (Network API niedostępne)';
    document.getElementById('wifiRtt').textContent      = '—';
  }

  // ── Protocol ──
  document.getElementById('wifiProto').textContent = window.location.protocol === 'https:' ? '🔒 HTTPS / TLS' : '⚠️ HTTP (nieszyfrowane)';

  // ── User Agent ──
  const ua = navigator.userAgent;
  let uaShort = ua;
  if(ua.includes('Chrome'))  uaShort = 'Chrome ' + (/Chrome\/([\d.]+)/.exec(ua)||['','?'])[1];
  if(ua.includes('Firefox')) uaShort = 'Firefox ' + (/Firefox\/([\d.]+)/.exec(ua)||['','?'])[1];
  if(ua.includes('Edg/'))    uaShort = 'Edge ' + (/Edg\/([\d.]+)/.exec(ua)||['','?'])[1];
  if(ua.includes('Safari') && !ua.includes('Chrome')) uaShort = 'Safari ' + (/Version\/([\d.]+)/.exec(ua)||['','?'])[1];
  const os = ua.includes('Windows') ? 'Windows' : ua.includes('Mac') ? 'macOS' : ua.includes('Linux') ? 'Linux' : ua.includes('Android') ? 'Android' : 'Inny';
  document.getElementById('wifiUa').textContent = `${uaShort} · ${os}`;
}

async function getLocalIpsViaWebRTC() {
  return new Promise(resolve => {
    const ips = new Set();
    let pc;
    // Wiele STUN serwerów — VPN-y mogą blokować Google STUN
    const iceServers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' },
      { urls: 'stun:stun.stunprotocol.org:3478' },
      { urls: 'stun:stun.ekiga.net' },
    ];
    try {
      pc = new RTCPeerConnection({ iceServers });
      pc.createDataChannel('');
      pc.createOffer().then(o => pc.setLocalDescription(o));
      pc.onicecandidate = e => {
        if(!e.candidate) {
          pc.close();
          // Zwróć wszystkie IPv4 + oddzielnie oznaczone IPv6 (przydatne przy VPN)
          resolve([...ips]);
        } else {
          const cand = e.candidate.candidate;
          // IPv4
          const m4 = /(\d+\.\d+\.\d+\.\d+)/.exec(cand);
          if(m4) ips.add(m4[1]);
          // IPv6 — przy VPN często widoczny tunel
          const m6 = /([0-9a-f]{0,4}(?::[0-9a-f]{0,4}){2,7})/.exec(cand);
          if(m6 && m6[1].includes(':') && !m6[1].startsWith('::ffff')) ips.add('[IPv6] ' + m6[1]);
        }
      };
      // 6s timeout — VPN może mieć wysokie latency do STUN
      setTimeout(() => { try { pc.close(); } catch(e){} resolve([...ips]); }, 6000);
    } catch(e) { resolve([]); }
  });
}

function classifyIp(ip) {
  if(ip.startsWith('192.168.')) return 'Sieć domowa (klasa C)';
  if(ip.startsWith('10.'))      return 'Sieć prywatna (klasa A)';
  if(/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return 'Sieć prywatna (klasa B)';
  if(ip.startsWith('169.254.')) return 'APIPA (brak DHCP)';
  if(ip === '127.0.0.1')        return 'Loopback';
  return 'Publiczny';
}

function fillNetworkInfo(ip) {
  if(!ip || ip === '—') return;
  const parts = ip.split('.');
  if(parts.length !== 4) return;

  // Network class
  const first = parseInt(parts[0]);
  let cls = '—', range = '—', gw = '—', mask = '—';
  if(ip.startsWith('192.168.')) {
    cls   = 'Klasa C (prywatna)';
    range = `192.168.${parts[2]}.1 – 192.168.${parts[2]}.254`;
    gw    = `192.168.${parts[2]}.1`;
    mask  = '255.255.255.0 (/24)';
  } else if(ip.startsWith('10.')) {
    cls   = 'Klasa A (prywatna)';
    range = '10.0.0.1 – 10.255.255.254';
    gw    = `10.${parts[1]}.${parts[2]}.1`;
    mask  = '255.0.0.0 (/8)';
  } else if(/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) {
    cls   = 'Klasa B (prywatna)';
    range = `172.${parts[1]}.0.1 – 172.${parts[1]}.255.254`;
    gw    = `172.${parts[1]}.${parts[2]}.1`;
    mask  = '255.255.0.0 (/16)';
  } else if(ip.startsWith('169.254.')) {
    cls  = 'APIPA (brak DHCP)';
    range = '169.254.0.1 – 169.254.255.254';
    mask  = '255.255.0.0 (/16)';
  }

  document.getElementById('wifiNetClass').textContent = cls;
  document.getElementById('wifiRange').textContent    = range;
  document.getElementById('wifiGateway').textContent  = gw;
  document.getElementById('wifiMask').textContent     = mask;
  if(gw !== '—') document.getElementById('wifiRouterLink').textContent = gw;
}

// ─── DISPLAY TEST ─────────────────────────────────────
let dtColor = '#000000';
let dtMode  = 'solid';
let dtHudPinned = false;
let dtPixelPos  = { x: 0.5, y: 0.5 }; // normalized
let dtRaf = null;
let dtHintTimer = null;

const DT_COLORS = ['#000000','#ffffff','#ff0000','#00ff00','#0000ff','#808080','#00ffff','#ff00ff','#ffff00'];
const DT_COLOR_IDS = ['dtc-black','dtc-white','dtc-red','dtc-green','dtc-blue','dtc-gray','dtc-cyan','dtc-magenta','dtc-yellow'];

function openDisplayTest() {
  const overlay = document.getElementById('displayTestOverlay');
  overlay.classList.add('show');
  document.addEventListener('keydown', dtOnKey);
  overlay.addEventListener('mousemove', dtOnMouseMove);
  overlay.addEventListener('click', dtOnClick);

  // resize canvas
  const c = document.getElementById('dtCanvas');
  c.width  = screen.width;
  c.height = screen.height;

  dtRedraw();

  // hide hint after 4s
  clearTimeout(dtHintTimer);
  dtHintTimer = setTimeout(() => {
    const h = document.getElementById('dtHint');
    if(h) h.style.opacity = '0';
  }, 4000);
}

function closeDisplayTest() {
  document.getElementById('displayTestOverlay').classList.remove('show');
  document.removeEventListener('keydown', dtOnKey);
  cancelAnimationFrame(dtRaf);
}

function dtTogglePin() {
  dtHudPinned = !dtHudPinned;
  const overlay = document.getElementById('displayTestOverlay');
  overlay.classList.toggle('hud-pinned', dtHudPinned);
  document.getElementById('dtPinBtn').classList.toggle('active', dtHudPinned);
}

function dtReset() {
  // Reset kolor → czarny
  dtSetColor('#000000', document.getElementById('dtc-black'));
  // Reset wzór → pełny
  dtSetMode('solid', document.getElementById('dtm-solid'));
  // Reset jasność → 100%
  const br = document.getElementById('dtBrightness');
  if(br) { br.value = 100; document.getElementById('dtBrightVal').textContent = '100%'; }
  // Reset custom color picker
  const cp = document.getElementById('dtCustomColor');
  if(cp) cp.value = '#ff6600';
  // Odepnij HUD
  dtHudPinned = false;
  const overlay = document.getElementById('displayTestOverlay');
  overlay.classList.remove('hud-pinned');
  document.getElementById('dtPinBtn').classList.remove('active');
  dtRedraw();
}

function dtSetColor(color, btn) {
  dtColor = color;
  document.querySelectorAll('.dt-color-btn').forEach(b => b.classList.remove('active'));
  if(btn) btn.classList.add('active');
  dtRedraw();
}

function dtSetMode(mode, btn) {
  dtMode = mode;
  document.querySelectorAll('.dt-mode-btn').forEach(b => b.classList.remove('active'));
  if(btn) btn.classList.add('active');
  // show/hide pixel info
  document.getElementById('dtPixelInfo').style.display = mode === 'pixel' ? 'block' : 'none';
  dtRedraw();
}

function dtOnKey(e) {
  if(e.key === 'Escape') { closeDisplayTest(); return; }
  // arrow keys cycle colors
  const idx = DT_COLORS.indexOf(dtColor);
  if(e.key === 'ArrowRight' || e.key === 'ArrowDown') {
    const next = (idx + 1) % DT_COLORS.length;
    dtSetColor(DT_COLORS[next], document.getElementById(DT_COLOR_IDS[next]));
  }
  if(e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
    const prev = (idx - 1 + DT_COLORS.length) % DT_COLORS.length;
    dtSetColor(DT_COLORS[prev], document.getElementById(DT_COLOR_IDS[prev]));
  }
  // number keys 1-9 for colors
  if(e.key >= '1' && e.key <= '9') {
    const i = parseInt(e.key) - 1;
    if(i < DT_COLORS.length) dtSetColor(DT_COLORS[i], document.getElementById(DT_COLOR_IDS[i]));
  }
}

function dtOnMouseMove(e) {
  if(dtMode === 'pixel') {
    dtPixelPos = { x: e.clientX / window.innerWidth, y: e.clientY / window.innerHeight };
    dtRedraw();
  }
}

function dtOnClick(e) {
  if(e.target.closest('#dtHud')) return;
  if(dtMode === 'pixel') {
    dtPixelPos = { x: e.clientX / window.innerWidth, y: e.clientY / window.innerHeight };
    dtRedraw();
  } else {
    // click cycles solid colors
    const idx = DT_COLORS.indexOf(dtColor);
    const next = (idx + 1) % DT_COLORS.length;
    dtSetColor(DT_COLORS[next], document.getElementById(DT_COLOR_IDS[next]));
  }
}

function dtRedraw() {
  const c   = document.getElementById('dtCanvas');
  const ctx = c.getContext('2d');
  const W   = window.innerWidth;
  const H   = window.innerHeight;
  c.width   = W; c.height = H;

  const bri   = parseFloat(document.getElementById('dtBrightness')?.value ?? 100) / 100;
  document.getElementById('dtBrightVal').textContent = Math.round(bri * 100) + '%';

  // apply brightness via globalAlpha + black bg trick
  ctx.clearRect(0, 0, W, H);

  // parse hex color, apply brightness
  const r = parseInt(dtColor.slice(1,3),16);
  const g = parseInt(dtColor.slice(3,5),16);
  const b = parseInt(dtColor.slice(5,7),16);
  const br = c => Math.round(c * bri);
  const bright = `rgb(${br(r)},${br(g)},${br(b)})`;
  const dark   = `rgb(0,0,0)`;

  switch(dtMode) {
    case 'solid':
      ctx.fillStyle = bright;
      ctx.fillRect(0, 0, W, H);
      break;

    case 'checker': {
      const sz = Math.max(16, Math.round(Math.min(W,H) / 30));
      for(let x=0; x<W; x+=sz) for(let y=0; y<H; y+=sz) {
        ctx.fillStyle = ((x/sz + y/sz) % 2 === 0) ? bright : dark;
        ctx.fillRect(x, y, sz, sz);
      }
      break;
    }

    case 'checker2': {
      const sz = 2;
      for(let x=0; x<W; x+=sz) for(let y=0; y<H; y+=sz) {
        ctx.fillStyle = ((x/sz + y/sz) % 2 === 0) ? bright : dark;
        ctx.fillRect(x, y, sz, sz);
      }
      break;
    }

    case 'gradient': {
      // horizontal gradient: black → color → white
      const grd = ctx.createLinearGradient(0, 0, W, 0);
      grd.addColorStop(0, '#000');
      grd.addColorStop(0.5, bright);
      grd.addColorStop(1, '#fff');
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, W, H);
      // vertical gradient overlay: black top → transparent → white bottom
      const grd2 = ctx.createLinearGradient(0, 0, 0, H);
      grd2.addColorStop(0, 'rgba(0,0,0,0.4)');
      grd2.addColorStop(0.5, 'transparent');
      grd2.addColorStop(1, 'rgba(255,255,255,0.4)');
      ctx.fillStyle = grd2;
      ctx.fillRect(0, 0, W, H);
      break;
    }

    case 'crosshair': {
      ctx.fillStyle = bright;
      ctx.fillRect(0, 0, W, H);
      const cx = W/2, cy = H/2;
      const inv = `rgb(${br(255-r)},${br(255-g)},${br(255-b)})`;
      ctx.strokeStyle = inv; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(W, cy); ctx.stroke();
      // circles
      ctx.strokeStyle = `rgba(${255-r},${255-g},${255-b},0.35)`;
      [0.1,0.2,0.3,0.4].forEach(f => {
        ctx.beginPath(); ctx.arc(cx, cy, Math.min(W,H)*f, 0, Math.PI*2); ctx.stroke();
      });
      // center dot
      ctx.fillStyle = inv; ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI*2); ctx.fill();
      break;
    }

    case 'grid': {
      ctx.fillStyle = bright;
      ctx.fillRect(0, 0, W, H);
      const inv = `rgba(${255-r},${255-g},${255-b},0.4)`;
      ctx.strokeStyle = inv; ctx.lineWidth = 1;
      const cellW = W/9, cellH = H/9;
      for(let i=0; i<=9; i++) {
        ctx.beginPath(); ctx.moveTo(i*cellW, 0); ctx.lineTo(i*cellW, H); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, i*cellH); ctx.lineTo(W, i*cellH); ctx.stroke();
      }
      // diagonal corners
      ctx.strokeStyle = `rgba(${255-r},${255-g},${255-b},0.15)`;
      ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(W,H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(W,0); ctx.lineTo(0,H); ctx.stroke();
      break;
    }

    case 'circles': {
      ctx.fillStyle = dark; ctx.fillRect(0, 0, W, H);
      const cx=W/2, cy=H/2;
      const maxR = Math.sqrt(cx*cx+cy*cy);
      const steps = 12;
      for(let i=steps; i>=0; i--) {
        const t = i/steps;
        ctx.fillStyle = i%2===0 ? bright : dark;
        ctx.beginPath(); ctx.arc(cx, cy, maxR*t, 0, Math.PI*2); ctx.fill();
      }
      // crosshair
      ctx.strokeStyle = `rgba(${255-r},${255-g},${255-b},0.3)`; ctx.lineWidth=1;
      ctx.beginPath(); ctx.moveTo(cx,0); ctx.lineTo(cx,H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0,cy); ctx.lineTo(W,cy); ctx.stroke();
      break;
    }

    case 'colorbars': {
      // SMPTE-style 7 color bars
      const bars = [
        [192,192,192],[192,192,0],[0,192,192],[0,192,0],
        [192,0,192],[192,0,0],[0,0,192]
      ];
      const bw = W / bars.length;
      bars.forEach((col, i) => {
        ctx.fillStyle = `rgb(${br(col[0])},${br(col[1])},${br(col[2])})`;
        ctx.fillRect(i * bw, 0, bw, H * 0.75);
      });
      // bottom strip: cyan, white, magenta, black, white, black, white
      const bot = [[0,192,192],[255,255,255],[192,0,192],[0,0,0],[255,255,255],[0,0,0],[255,255,255]];
      bot.forEach((col, i) => {
        ctx.fillStyle = `rgb(${br(col[0])},${br(col[1])},${br(col[2])})`;
        ctx.fillRect(i * bw, H * 0.75, bw, H * 0.25);
      });
      break;
    }

    case 'pixel': {
      ctx.fillStyle = dark; ctx.fillRect(0, 0, W, H);
      const px = Math.round(dtPixelPos.x * W);
      const py = Math.round(dtPixelPos.y * H);
      ctx.fillStyle = bright; ctx.fillRect(px, py, 1, 1);
      // crosshair guides
      ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth=1; ctx.setLineDash([4,8]);
      ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(W, py); ctx.stroke();
      ctx.setLineDash([]);
      // magnifier — 20x20 area zoomed x10
      const mgSize = 200, mgZoom = 10, mgX = 20, mgY = H - mgSize - 20;
      ctx.fillStyle = 'rgba(0,0,0,0.8)'; ctx.fillRect(mgX-2, mgY-2, mgSize+4, mgSize+4);
      ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth=1; ctx.strokeRect(mgX-2, mgY-2, mgSize+4, mgSize+4);
      const half = mgSize / mgZoom / 2;
      for(let dx=-half; dx<=half; dx++) for(let dy=-half; dy<=half; dy++) {
        const isPx = Math.round(px+dx)===px && Math.round(py+dy)===py;
        ctx.fillStyle = isPx ? bright : (((Math.round(dx)+Math.round(dy))%2===0)?'#1a1a1a':'#0a0a0a');
        ctx.fillRect(mgX + (dx+half)*mgZoom, mgY + (dy+half)*mgZoom, mgZoom, mgZoom);
      }
      // center marker in magnifier
      ctx.strokeStyle='rgba(255,0,0,0.8)'; ctx.lineWidth=1;
      const mcx = mgX+mgSize/2, mcy = mgY+mgSize/2;
      ctx.strokeRect(mcx-mgZoom/2, mcy-mgZoom/2, mgZoom, mgZoom);

      document.getElementById('dtPixelInfo').textContent = `Piksel: X=${px}  Y=${py}  —  przesuń mysz lub kliknij`;
      break;
    }
  }
}

// ─── MOUSE TEST ───────────────────────────────────────────────────────────────
let mClicks_v = 0, mMaxCps_v = 0, mDist_v = 0;
let mLastX = null, mLastY = null;
let mClickTimes = [];
let mTrailOn = true;
let mTrailPoints = [];
let mPadRaf = null;
let mScrollTotal = 0;
let mTestedBtns = new Set();
let mActiveTab = 'move';

// Prędkość i jitter
let mSpeedHistory = [];
let mLastMoveT = null;
let mJitterBuf = [];

// Heatmap
let heatPoints = [];
let heatClickCount = 0;
let heatRaf = null;

// Cel shooting
let celActive = false;
let celTargets = [];
let celHits_v = 0, celMiss_v = 0, celScore_v = 0;
let celTimerInterval = null;
let celTimeLeft = 30;
let celLastHitT = null;
let celHitTimes = [];
let celRaf = null;

// ── Tab switching ──
function mSwitchTab(tab) {
  mActiveTab = tab;
  document.querySelectorAll('.mouse-tab').forEach((b,i) => {
    const tabs = ['move','heat','cel'];
    b.classList.toggle('active', tabs[i] === tab);
  });
  document.querySelectorAll('.mouse-tab-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('mtab-'+tab).classList.add('active');

  if(tab === 'heat') {
    setTimeout(() => {
      const w = document.getElementById('heatmapWrap');
      const c = document.getElementById('heatmapCanvas');
      c.width = w.offsetWidth;
      drawHeatmap();
    }, 50);
  }
  if(tab === 'cel') {
    setTimeout(() => {
      const w = document.getElementById('celWrap');
      const c = document.getElementById('celCanvas');
      if(w.offsetWidth > 10) { c.width = w.offsetWidth; c.height = Math.round(w.offsetWidth * 0.38); }
      if(!celActive) drawCelIdle();
    }, 30);
  }
}

function mModalDown(e) {
  const hw = document.getElementById('heatmapWrap');
  const pw = document.getElementById('mousePadWrap');
  // BUG FIX: celOnClick już jest obsługiwane przez własny listener na celWrap — nie dubluj tutaj
  if(hw && hw.contains(e.target)) { heatOnClick(e); return; }
}
function mModalMove(e) {
  const hw = document.getElementById('heatmapWrap');
  if(hw && hw.contains(e.target)) { heatOnMove(e); return; }
}
function openMouseTest() {
  document.getElementById('mouseModal').classList.add('show');
  mReset();
  const pad = document.getElementById('mousePad');
  const wrap = document.getElementById('mousePadWrap');
  pad.width = wrap.offsetWidth || 800;

  wrap.addEventListener('mousemove', mOnMove);
  wrap.addEventListener('mousedown', mOnDown);
  wrap.addEventListener('contextmenu', mNoCtx);
  wrap.addEventListener('wheel', mOnScroll, {passive:true});
  document.addEventListener('mouseup', mOnUp);
  document.addEventListener('mousedown', mOnDocDown);

  // Heatmap listeners (zawsze aktywne)
  const hw = document.getElementById('heatmapWrap');
  hw.addEventListener('mousemove', heatOnMove);
  hw.addEventListener('mousedown', heatOnClick);
  hw.addEventListener('contextmenu', e => e.preventDefault());

  // Cel listeners
  const cw = document.getElementById('celWrap');
  cw.addEventListener('mousedown', celOnClick);
  cw.addEventListener('contextmenu', e => e.preventDefault());

  mPadRaf = requestAnimationFrame(mDrawPad);
  document.getElementById('mouseModal').addEventListener('mousedown', mModalDown);
  document.getElementById('mouseModal').addEventListener('mousemove', mModalMove);

  // Init canvas sizes
  setTimeout(() => {
    const modalW = (document.querySelector('.mouse-modal').offsetWidth || 820) - 56;
    const hc = document.getElementById('heatmapCanvas');
    hc.width = modalW; hc.height = 300;
    const celC = document.getElementById('celCanvas');
    celC.width = modalW; celC.height = Math.round(modalW * 0.38);
    drawHeatmap();
    drawCelIdle();
  }, 80);
}

function closeMouseTest() {
  document.getElementById('mouseModal').classList.remove('show');
  const wrap = document.getElementById('mousePadWrap');
  wrap.removeEventListener('mousemove', mOnMove);
  wrap.removeEventListener('mousedown', mOnDown);
  wrap.removeEventListener('contextmenu', mNoCtx);
  wrap.removeEventListener('wheel', mOnScroll);
  document.removeEventListener('mouseup', mOnUp);
  document.removeEventListener('mousedown', mOnDocDown);
  document.getElementById('mouseModal').removeEventListener('mousedown', mModalDown);
  document.getElementById('mouseModal').removeEventListener('mousemove', mModalMove);
  cancelAnimationFrame(mPadRaf);
  cancelAnimationFrame(heatRaf);
  cancelAnimationFrame(celRaf);
  celStop();
  mTrailPoints = [];
  const pad = document.getElementById('mousePad');
  if(pad) pad.getContext('2d').clearRect(0,0,pad.width,pad.height);
}

function mNoCtx(e) { e.preventDefault(); }

function mReset() {
  mClicks_v=0; mMaxCps_v=0; mDist_v=0; mLastX=null; mLastY=null;
  mClickTimes=[]; mTrailPoints=[]; mScrollTotal=0; mTestedBtns.clear();
  mSpeedHistory=[]; mJitterBuf=[];
  ['mClicks','mCps','mMaxCps','mDist'].forEach(id => document.getElementById(id).textContent='0');
  document.getElementById('mPos').textContent='— / —';
  document.getElementById('mSpeed').textContent='0';
  document.getElementById('mJitter').textContent='0';
  document.getElementById('mScrollVal').textContent='0';
  document.getElementById('mScrollBar').style.bottom='50%';
  document.querySelectorAll('.mouse-btn-key').forEach(b => b.classList.remove('lit','tested'));
  // Reset SVG
  [0,1,2,3,4].forEach(btn => mSvgHighlight(btn, false, false));
  const pad=document.getElementById('mousePad');
  if(pad) pad.getContext('2d').clearRect(0,0,pad.width,pad.height);
}

function mOnMove(e) {
  const wrap = document.getElementById('mousePadWrap');
  const rect = wrap.getBoundingClientRect();
  const x = e.clientX - rect.left, y = e.clientY - rect.top;
  document.getElementById('mPos').textContent = Math.round(e.clientX) + ' / ' + Math.round(e.clientY);

  const now = performance.now();
  if(mLastX !== null) {
    const dx=x-mLastX, dy=y-mLastY;
    const dist = Math.sqrt(dx*dx+dy*dy);
    mDist_v += dist;
    document.getElementById('mDist').textContent = Math.round(mDist_v);

    // Prędkość px/s
    if(mLastMoveT !== null) {
      const dt = (now - mLastMoveT) / 1000;
      if(dt > 0) {
        const spd = Math.round(dist / dt);
        mSpeedHistory.push(spd);
        if(mSpeedHistory.length > 8) mSpeedHistory.shift();
        const avgSpd = Math.round(mSpeedHistory.reduce((a,b)=>a+b,0)/mSpeedHistory.length);
        document.getElementById('mSpeed').textContent = avgSpd;
      }
    }

    // Jitter = odchylenie od linii prostej
    mJitterBuf.push({x, y});
    if(mJitterBuf.length > 5) mJitterBuf.shift();
    if(mJitterBuf.length >= 3) {
      const p0 = mJitterBuf[0], p1 = mJitterBuf[mJitterBuf.length-1];
      const lineLen = Math.sqrt((p1.x-p0.x)**2+(p1.y-p0.y)**2);
      let maxDev = 0;
      if(lineLen > 2) {
        mJitterBuf.forEach(p => {
          // Odległość punktu od linii p0->p1
          const dev = Math.abs((p1.y-p0.y)*p.x-(p1.x-p0.x)*p.y+p1.x*p0.y-p1.y*p0.x) / lineLen;
          if(dev > maxDev) maxDev = dev;
        });
        document.getElementById('mJitter').textContent = maxDev.toFixed(1);
      }
    }
  }

  mLastMoveT = now;
  if(mTrailOn) mTrailPoints.push({x, y, t: Date.now()});
  if(mTrailPoints.length > 1000) mTrailPoints.shift();
  mLastX=x; mLastY=y;
  const dot = document.getElementById('mCursorDot');
  dot.style.left = x+'px'; dot.style.top = y+'px';
}

function mOnDown(e) {
  e.preventDefault();
  mClicks_v++;
  document.getElementById('mClicks').textContent = mClicks_v;
  const now = Date.now();
  mClickTimes.push(now);
  mClickTimes = mClickTimes.filter(t => now-t < 1000);
  const cps = mClickTimes.length;
  if(cps > mMaxCps_v) mMaxCps_v = cps;
  document.getElementById('mCps').textContent = cps;
  document.getElementById('mMaxCps').textContent = mMaxCps_v;
  const id = 'mbtn-'+e.button;
  const el = document.getElementById(id);
  if(el) { el.classList.add('lit'); mTestedBtns.add(e.button); }
  // Podświetl też element SVG
  mSvgHighlight(e.button, true);
  const wrap = document.getElementById('mousePadWrap');
  const rect = wrap.getBoundingClientRect();
  mTrailPoints.push({x:e.clientX-rect.left, y:e.clientY-rect.top, click:true, t:Date.now()});
}

function mOnDocDown(e) {
  setTimeout(() => {
    mClickTimes = mClickTimes.filter(t => Date.now()-t < 1000);
    document.getElementById('mCps').textContent = mClickTimes.length;
  }, 1100);
}

function mOnUp(e) {
  const id='mbtn-'+e.button;
  const el=document.getElementById(id);
  if(el){ el.classList.remove('lit'); if(mTestedBtns.has(e.button)) el.classList.add('tested'); }
  mSvgHighlight(e.button, false, mTestedBtns.has(e.button));
}

function mSvgHighlight(btn, active, tested) {
  // Mapowanie buttonu na id SVG
  const map = { 0:'svg-mbtn-0', 1:'svg-mbtn-1', 2:'svg-mbtn-2', 3:'svg-mbtn-3', 4:'svg-mbtn-4' };
  const svgId = map[btn];
  if(!svgId) return;
  const el = document.getElementById(svgId);
  if(!el) return;
  if(active) {
    el.setAttribute('fill', 'rgba(168,85,247,0.55)');
    el.setAttribute('stroke', '#a855f7');
    el.style.filter = 'drop-shadow(0 0 8px #a855f7)';
  } else if(tested) {
    el.setAttribute('fill', 'rgba(0,245,160,0.15)');
    el.setAttribute('stroke', '#00f5a0');
    el.style.filter = '';
  } else {
    el.setAttribute('fill', 'rgba(168,85,247,0.08)');
    el.setAttribute('stroke', 'rgba(168,85,247,0.3)');
    el.style.filter = '';
  }
}

function mOnScroll(e) {
  mScrollTotal += e.deltaY;
  const norm = Math.max(0, Math.min(100, 50 + mScrollTotal/20));
  document.getElementById('mScrollBar').style.bottom = (100-norm)+'%';
  document.getElementById('mScrollVal').textContent = Math.round(mScrollTotal);
  const sc=document.getElementById('mbtn-scroll');
  sc.classList.add('lit'); setTimeout(()=>{ sc.classList.remove('lit'); sc.classList.add('tested'); },150);
}

function mToggleTrail() {
  mTrailOn = !mTrailOn;
  document.getElementById('mTrailBtn').textContent = mTrailOn ? 'Wł' : 'Wył';
  if(!mTrailOn) mTrailPoints=[];
}

function mDrawPad() {
  mPadRaf = requestAnimationFrame(mDrawPad);
  const pad=document.getElementById('mousePad');
  if(!pad) return;
  const ctx=pad.getContext('2d');
  const W=pad.width, H=pad.height;
  ctx.fillStyle='rgba(10,10,15,0.18)';
  ctx.fillRect(0,0,W,H);
  // grid
  ctx.strokeStyle='rgba(255,255,255,0.03)'; ctx.lineWidth=1;
  for(let x=0;x<W;x+=40){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
  for(let y=0;y<H;y+=40){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }
  // trail
  const now=Date.now();
  const fresh=mTrailPoints.filter(p=>now-p.t<3000);
  if(fresh.length>1){
    for(let i=1;i<fresh.length;i++){
      const p=fresh[i], pp=fresh[i-1];
      const age=(now-p.t)/3000;
      if(p.click){
        ctx.beginPath();
        ctx.arc(p.x,p.y,6+(1-age)*8,0,Math.PI*2);
        ctx.strokeStyle='rgba(255,77,109,'+(1-age)+')';
        ctx.lineWidth=2; ctx.stroke();
      } else if(!pp.click) {
        ctx.beginPath();
        ctx.strokeStyle='rgba(167,139,255,'+(1-age)+')';
        ctx.lineWidth=1.5;
        ctx.moveTo(pp.x,pp.y); ctx.lineTo(p.x,p.y); ctx.stroke();
      }
    }
  }
}

// ── HEATMAPA ────────────────────────────────────────────────
function heatOnMove(e) {
  if(mActiveTab !== 'heat') return;
  const wrap = document.getElementById('heatmapWrap');
  const rect = wrap.getBoundingClientRect();
  if(!rect.width) return;
  const x = e.clientX - rect.left, y = e.clientY - rect.top;
  const cur = document.getElementById('heatmapCursor');
  cur.style.left = x + 'px'; cur.style.top = y + 'px';
}

function heatOnClick(e) {
  e.preventDefault();
  if(mActiveTab !== 'heat') mSwitchTab('heat');
  requestAnimationFrame(() => {
    const wrap = document.getElementById('heatmapWrap');
    const rect = wrap.getBoundingClientRect();
    if(!rect.width) return;
    const nx = (e.clientX - rect.left) / rect.width;
    const ny = (e.clientY - rect.top)  / rect.height;
    if(nx < 0 || nx > 1 || ny < 0 || ny > 1) return;
    heatPoints.push({nx, ny, btn: e.button});
    heatClickCount++;
    document.getElementById('heatClickCount').textContent = 'Kliknięć: ' + heatClickCount;
    drawHeatmap();
  });
}

function mResetHeat() {
  heatPoints = []; heatClickCount = 0;
  document.getElementById('heatClickCount').textContent = 'Kliknięć: 0';
  drawHeatmap();
}

function drawHeatmap() {
  const c = document.getElementById('heatmapCanvas');
  if(!c) return;
  if(!c.width || c.width < 10) {
    const modal = document.querySelector('.mouse-modal');
    c.width = modal ? modal.offsetWidth - 56 : 700;
    c.height = 300;
  }
  const ctx = c.getContext('2d');
  const W = c.width, H = c.height;
  ctx.clearRect(0,0,W,H);

  // Tło z siatką
  ctx.fillStyle = '#0a0a0f';
  ctx.fillRect(0,0,W,H);
  ctx.strokeStyle='rgba(255,255,255,0.04)'; ctx.lineWidth=1;
  for(let x=0;x<W;x+=50){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
  for(let y=0;y<H;y+=50){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }

  if(heatPoints.length === 0) {
    ctx.fillStyle='rgba(255,255,255,0.15)';
    ctx.font='14px Space Mono,monospace';
    ctx.textAlign='center';
    ctx.fillText('Klikaj tutaj żeby zobaczyć heatmapę', W/2, H/2);
    return;
  }

  // Rysuj gradient heatmapy
  const radius = Math.max(30, Math.min(W,H) * 0.08);
  heatPoints.forEach(p => {
    const x = p.nx * W, y = p.ny * H;
    const col = p.btn === 2 ? '255,77,109' : p.btn === 1 ? '245,196,0' : '123,97,255';
    const grad = ctx.createRadialGradient(x,y,0,x,y,radius);
    grad.addColorStop(0, 'rgba('+col+',0.45)');
    grad.addColorStop(0.5, 'rgba('+col+',0.15)');
    grad.addColorStop(1, 'rgba('+col+',0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x,y,radius,0,Math.PI*2);
    ctx.fill();
  });

  // Punkty kliknięć
  heatPoints.forEach(p => {
    const x = p.nx * W, y = p.ny * H;
    const col = p.btn === 2 ? '#ff4d6d' : p.btn === 1 ? '#f5c400' : '#a78bff';
    ctx.beginPath();
    ctx.arc(x,y,3,0,Math.PI*2);
    ctx.fillStyle = col;
    ctx.fill();
  });

  // Legenda
  ctx.font = '9px Space Mono,monospace';
  ctx.textAlign = 'left';
  [['#a78bff','LPM'],['#ff4d6d','PPM'],['#f5c400','Środkowy']].forEach(([col,lbl],i) => {
    ctx.fillStyle = col;
    ctx.fillRect(10, 10+i*16, 8, 8);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillText(lbl, 24, 18+i*16);
  });
}

// ── CEL SHOOTING ─────────────────────────────────────────────
let CEL_DURATION = 15;
let celHitFlash = [];

function drawCelIdle() {
  const c = document.getElementById('celCanvas');
  if(!c) return;
  const ctx = c.getContext('2d');
  const W=c.width, H=c.height;
  ctx.fillStyle='#0a0a0f'; ctx.fillRect(0,0,W,H);
  ctx.strokeStyle='rgba(255,255,255,0.04)'; ctx.lineWidth=1;
  for(let x=0;x<W;x+=50){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
  for(let y=0;y<H;y+=50){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }
  // Celownik dekoracyjny
  const cx=W/2, cy=H/2;
  ctx.strokeStyle='rgba(255,77,109,0.3)'; ctx.lineWidth=1.5;
  [40,70,100].forEach(r => {
    ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.stroke();
  });
  ctx.beginPath(); ctx.moveTo(cx-120,cy); ctx.lineTo(cx+120,cy); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx,cy-80); ctx.lineTo(cx,cy+80); ctx.stroke();
  ctx.fillStyle='rgba(255,77,109,0.6)';
  ctx.font='12px Space Mono,monospace'; ctx.textAlign='center';
  ctx.fillText('Naciśnij START żeby zacząć', cx, H-20);
}

function celSetTime(sec, btn) {
  if(celActive) return;
  CEL_DURATION = sec;
  document.getElementById('celTime').textContent = sec;
  document.querySelectorAll('.cel-time-btn').forEach(b => b.classList.remove('active'));
  if(btn) btn.classList.add('active');
}

function celToggle() {
  if(celActive) { celStop(); } else { celStart(); }
}

function celStart() {
  celActive=true; celHits_v=0; celMiss_v=0; celScore_v=0;
  celTimeLeft=CEL_DURATION; celHitTimes=[]; celHitFlash=[];
  celTargets=[];
  ['celHits','celMiss','celScore'].forEach(id => document.getElementById(id).textContent='0');
  document.getElementById('celAcc').textContent='—';
  document.getElementById('celAvg').textContent='—';
  document.getElementById('celTime').textContent=celTimeLeft=CEL_DURATION;
  document.getElementById('celStartBtn').textContent='■ STOP';
  document.getElementById('celStartBtn').classList.add('active');
  document.getElementById('celStatus').textContent='Klikaj w tarcze!';

  // Spawn pierwszego celu
  celSpawnTarget();

  celTimerInterval = setInterval(() => {
    celTimeLeft--;
    document.getElementById('celTime').textContent = celTimeLeft;
    if(celTimeLeft <= 0) celStop();
  }, 1000);

  celRaf = requestAnimationFrame(celDraw);
}

function celStop() {
  celActive=false;
  clearInterval(celTimerInterval); celTimerInterval=null;
  cancelAnimationFrame(celRaf);
  document.getElementById('celStartBtn').textContent='▶ START';
  document.getElementById('celStartBtn').classList.remove('active');
  if(celHits_v+celMiss_v > 0) {
    const acc = Math.round(celHits_v/(celHits_v+celMiss_v)*100);
    document.getElementById('celStatus').textContent =
      'Wynik: ' + celScore_v + ' pkt | Celność: ' + acc + '%';
  } else {
    document.getElementById('celStatus').textContent='Naciśnij START żeby zacząć';
  }
  celTargets=[];
  drawCelIdle();
}

function celSpawnTarget() {
  const c = document.getElementById('celCanvas');
  if(!c) return;
  const W=c.width, H=c.height;
  const minR=18, maxR=45;
  // Losowy rozmiar — mniejszy cel = więcej punktów
  const r = Math.round(minR + Math.random()*(maxR-minR));
  const x = r + Math.random()*(W-2*r);
  const y = r + Math.random()*(H-2*r);
  const points = Math.round(100 * (minR/r)); // mały = więcej punktów
  const spawnT = performance.now();
  celTargets.push({x, y, r, points, spawnT, opacity:0});
}

function celOnClick(e) {
  e.preventDefault();
  if(!celActive) return;
  const c = document.getElementById('celCanvas');
  const rect = document.getElementById('celWrap').getBoundingClientRect();
  const scaleX = c.width / rect.width;
  const scaleY = c.height / rect.height;
  const mx = (e.clientX-rect.left) * scaleX, my = (e.clientY-rect.top) * scaleY;

  let hit = false;
  celTargets = celTargets.filter(t => {
    const dx=mx-t.x, dy=my-t.y;
    if(dx*dx+dy*dy <= t.r*t.r) {
      // TRAFIENIE
      hit=true;
      celHits_v++;
      celScore_v += t.points;
      const reactionMs = Math.round(performance.now()-t.spawnT);
      celHitTimes.push(reactionMs);
      const avg = Math.round(celHitTimes.reduce((a,b)=>a+b,0)/celHitTimes.length);
      document.getElementById('celHits').textContent=celHits_v;
      document.getElementById('celScore').textContent=celScore_v;
      document.getElementById('celAvg').textContent=avg+'ms';
      const acc=Math.round(celHits_v/(celHits_v+celMiss_v)*100);
      document.getElementById('celAcc').textContent=acc+'%';
      // Flash animacja
      celHitFlash.push({x:t.x,y:t.y,r:t.r,pts:t.points,t:performance.now()});
      // Nowy cel
      celSpawnTarget();
      return false;
    }
    return true;
  });

  if(!hit) {
    celMiss_v++;
    document.getElementById('celMiss').textContent=celMiss_v;
    const acc=celHits_v+celMiss_v>0?Math.round(celHits_v/(celHits_v+celMiss_v)*100):0;
    document.getElementById('celAcc').textContent=acc+'%';
    // Miss flash
    celHitFlash.push({x:mx,y:my,r:0,pts:0,miss:true,t:performance.now()});
  }
}

function celDraw() {
  if(!celActive) return;
  celRaf = requestAnimationFrame(celDraw);
  const c = document.getElementById('celCanvas');
  if(!c) return;
  const ctx=c.getContext('2d');
  const W=c.width, H=c.height;
  const now=performance.now();

  // Tło
  ctx.fillStyle='rgba(10,10,15,0.85)'; ctx.fillRect(0,0,W,H);
  ctx.strokeStyle='rgba(255,255,255,0.03)'; ctx.lineWidth=1;
  for(let x=0;x<W;x+=50){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
  for(let y=0;y<H;y+=50){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }

  // Targety
  celTargets.forEach(t => {
    // Fade-in przez 150ms
    t.opacity = Math.min(1, (now-t.spawnT)/150);
    // Shrink po 2s
    const age = now-t.spawnT;
    const shrink = age > 2000 ? Math.max(0.3, 1-(age-2000)/1500) : 1;
    const r = t.r * shrink;
    if(r < 5) return; // cel zostanie usunięty przez filtr poniżej

    const alpha = t.opacity;
    // Zewnętrzny ring
    ctx.beginPath(); ctx.arc(t.x,t.y,r,0,Math.PI*2);
    ctx.strokeStyle='rgba(255,77,109,'+alpha+')'; ctx.lineWidth=2; ctx.stroke();
    // Wypełnienie
    ctx.beginPath(); ctx.arc(t.x,t.y,r*0.7,0,Math.PI*2);
    ctx.fillStyle='rgba(255,77,109,'+(alpha*0.15)+')'; ctx.fill();
    // Środek
    ctx.beginPath(); ctx.arc(t.x,t.y,r*0.25,0,Math.PI*2);
    ctx.fillStyle='rgba(255,77,109,'+(alpha*0.8)+')'; ctx.fill();
    // Linie celownika
    ctx.strokeStyle='rgba(255,77,109,'+(alpha*0.5)+')'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(t.x-r*1.3,t.y); ctx.lineTo(t.x+r*1.3,t.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(t.x,t.y-r*1.3); ctx.lineTo(t.x,t.y+r*1.3); ctx.stroke();
    // Pulsowanie
    const pulse = Math.sin(now/200)*3;
    ctx.beginPath(); ctx.arc(t.x,t.y,r+pulse,0,Math.PI*2);
    ctx.strokeStyle='rgba(255,77,109,'+(alpha*0.2)+')'; ctx.lineWidth=1; ctx.stroke();
    // Timer ring (kurczy się wraz z czasem)
    const timerFrac = age > 2000 ? 1-(age-2000)/1500 : 1;
    ctx.beginPath();
    ctx.arc(t.x,t.y,r+6,-Math.PI/2,-Math.PI/2+timerFrac*Math.PI*2);
    ctx.strokeStyle='rgba(245,196,0,'+(alpha*0.7)+')'; ctx.lineWidth=2; ctx.stroke();
  });

  // Hit flashes
  celHitFlash = celHitFlash.filter(f => {
    const age=(now-f.t)/400;
    if(age>1) return false;
    if(f.miss) {
      ctx.strokeStyle='rgba(255,77,109,'+(1-age)+')';
      ctx.lineWidth=2;
      const s=10*(1+age);
      ctx.beginPath(); ctx.moveTo(f.x-s,f.y-s); ctx.lineTo(f.x+s,f.y+s); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(f.x+s,f.y-s); ctx.lineTo(f.x-s,f.y+s); ctx.stroke();
    } else {
      ctx.strokeStyle='rgba(0,245,160,'+(1-age)+')';
      ctx.lineWidth=2;
      ctx.beginPath(); ctx.arc(f.x,f.y,f.r*(1+age*0.5),0,Math.PI*2); ctx.stroke();
      // Punkty
      ctx.fillStyle='rgba(0,245,160,'+(1-age)+')';
      ctx.font='bold 14px Space Mono,monospace'; ctx.textAlign='center';
      ctx.fillText('+'+f.pts, f.x, f.y-f.r-10-age*20);
    }
    return true;
  });

  // Usuń wygasłe cele — zlicz miss i spawn nowego
  const beforeCount = celTargets.length;
  celTargets = celTargets.filter(t => {
    const age = now - t.spawnT;
    if(age > 3500) {
      if(!t.expired) {
        t.expired = true;
        celMiss_v++;
        document.getElementById('celMiss').textContent = celMiss_v;
        const tot = celHits_v + celMiss_v;
        if(tot > 0) document.getElementById('celAcc').textContent = Math.round(celHits_v/tot*100)+'%';
      }
      return false;
    }
    return true;
  });
  // Jeśli lista jest pusta po usunięciu — spawn nowego celu
  if(celTargets.length === 0 && celActive) {
    celSpawnTarget();
  }
}

// ─── SYSTEM INFO ──────────────────────────────────────
function openSysInfo() {
  document.getElementById('sysModal').classList.add('show');
  loadSysInfo();
}
function closeSysInfo() {
  document.getElementById('sysModal').classList.remove('show');
}

async function loadSysInfo() {

  // ── CPU ──
  const cores = navigator.hardwareConcurrency || '—';
  document.getElementById('siCores').textContent = cores;

  // ── RAM ──
  const ramApi = navigator.deviceMemory;
  document.getElementById('siRam').textContent = ramApi ? (ramApi >= 8 ? '8+' : ramApi) : '—';
  document.getElementById('siRamNote').textContent = ramApi >= 8
    ? '⚠️ API ograniczone do 8 GB (prywatność). Rzeczywisty RAM może być 16/32/64 GB.'
    : ramApi ? 'Wartość z navigator.deviceMemory (GB).' : 'API niedostępne w tej przeglądarce.';

  // ── Screen ──
  const sw=screen.width, sh=screen.height, dpr=window.devicePixelRatio||1;
  document.getElementById('siRes').textContent = `${sw}×${sh}`;
  document.getElementById('siResSub').textContent = `${Math.round(sw*dpr)}×${Math.round(sh*dpr)} px fizycznych`;
  document.getElementById('siScreen').innerHTML =
    `Logiczna: ${sw}×${sh} · Fizyczna: ${Math.round(sw*dpr)}×${Math.round(sh*dpr)}<br>`+
    `DPR: ${dpr} · Kolory: ${screen.colorDepth}-bit · Orientacja: ${screen.orientation?.type||'—'}<br>`+
    `Dostępna: ${screen.availWidth}×${screen.availHeight}`;

  // ── Browser ──
  const ua = navigator.userAgent;
  let browser = '—', browserVer = '';
  const brands = navigator.userAgentData?.brands;
  if(brands) {
    const notChromium = brands.filter(b => !['Chromium','Not/A)Brand','Not A(Brand'].some(x => b.brand.includes(x)));
    if(notChromium.length) { browser = notChromium[0].brand; browserVer = notChromium[0].version; }
  }
  if(browser === '—') {
    if(/Edg\//.test(ua))        { browser='Microsoft Edge';   browserVer=(/Edg\/([\d.]+)/.exec(ua)||['',''])[1]; }
    else if(/OPR\//.test(ua))   { browser='Opera';            browserVer=(/OPR\/([\d.]+)/.exec(ua)||['',''])[1]; }
    else if(/Firefox\//.test(ua)){ browser='Firefox';          browserVer=(/Firefox\/([\d.]+)/.exec(ua)||['',''])[1]; }
    else if(/Chrome\//.test(ua)){ browser='Chrome';           browserVer=(/Chrome\/([\d.]+)/.exec(ua)||['',''])[1]; }
    else if(/Safari\//.test(ua)){ browser='Safari';           browserVer=(/Version\/([\d.]+)/.exec(ua)||['',''])[1]; }
  }
  const engine = /Gecko\//.test(ua) && !/Chrome/.test(ua) ? 'Gecko' : /WebKit/.test(ua) ? 'WebKit/Blink' : '—';
  document.getElementById('siBrowser').innerHTML =
    `${browser} ${browserVer}<br>`+
    `<span style="font-size:9px;color:var(--muted);">Silnik: ${engine} · `+
    `${navigator.vendor||'—'}</span><br>`+
    `<span style="font-size:8px;color:var(--muted);opacity:0.6;">${ua.substring(0,90)}…</span>`;

  // ── OS ──
  let os = '—';
  // Try modern User-Agent Client Hints (Chromium 90+, works on Netlify HTTPS)
  if(navigator.userAgentData?.getHighEntropyValues) {
    try {
      const hi = await navigator.userAgentData.getHighEntropyValues(['platform','platformVersion','architecture','model','mobile']);
      const plat = hi.platform || '';
      const ver  = hi.platformVersion || '';
      const arch = hi.architecture || '';
      if(plat === 'Windows') {
        const major = parseInt(ver.split('.')[0]);
        os = major >= 13 ? `Windows 11 (${arch})` : `Windows 10 (${arch})`;
      } else if(plat === 'macOS') {
        os = `macOS ${ver} (${arch})`;
      } else if(plat === 'Linux') {
        os = hi.mobile ? `Android ${ver}` : `Linux (${arch})`;
      } else {
        os = plat + (ver ? ' ' + ver : '');
      }
    } catch(e) {
      os = navigator.userAgentData?.platform || '—';
    }
  }
  // Fallback UA string parsing
  if(os === '—') {
    if(/Windows NT 10\.0/.test(ua))      os = 'Windows 10/11';
    else if(/Windows NT 6\.3/.test(ua))  os = 'Windows 8.1';
    else if(/Windows NT/.test(ua))       os = 'Windows';
    else if(/Android ([\d.]+)/.test(ua)) os = 'Android ' + /Android ([\d.]+)/.exec(ua)[1];
    else if(/iPhone|iPad/.test(ua))      os = 'iOS ' + (/OS ([\d_]+)/.exec(ua)||['',''])[1].replace(/_/g,'.');
    else if(/Mac OS X ([\d_]+)/.test(ua))os = 'macOS ' + /Mac OS X ([\d_]+)/.exec(ua)[1].replace(/_/g,'.');
    else if(/Linux/.test(ua))            os = 'Linux';
    else if(/CrOS/.test(ua))             os = 'ChromeOS';
  }
  document.getElementById('siOs').textContent = os;

  // ── GPU ──
  try {
    const canvas = document.createElement('canvas');
    // Try WebGL2 first, then WebGL1
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if(gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      if(ext) {
        const vendor   = gl.getParameter(ext.UNMASKED_VENDOR_WEBGL);
        const renderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
        // Clean up long renderer strings
        const short = renderer.replace(/\s*\(.*?\)\s*/g,' ').replace(/OpenGL ES.*$/,'').trim();
        document.getElementById('siGpu').innerHTML =
          `${short}<br><span style="font-size:9px;color:var(--muted);">${vendor}</span>`;
      } else {
        // On Netlify HTTPS, WEBGL_debug_renderer_info may be blocked (Firefox privacy.resistFingerprinting)
        const glVersion = gl.getParameter(gl.VERSION);
        const glslVersion = gl.getParameter(gl.SHADING_LANGUAGE_VERSION);
        document.getElementById('siGpu').innerHTML =
          `WebGL dostępny (info GPU zablokowane przez przeglądarkę)<br>`+
          `<span style="font-size:9px;color:var(--muted);">${glVersion}</span>`;
      }
    } else {
      document.getElementById('siGpu').textContent = '❌ WebGL niedostępny';
    }
  } catch(e) {
    document.getElementById('siGpu').textContent = 'Błąd: ' + e.message;
  }

  // ── Network ──
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if(conn) {
    const type = conn.type && conn.type !== 'unknown' ? conn.type : null;
    const eff  = conn.effectiveType || null;
    const dl   = conn.downlink != null ? conn.downlink + ' Mb/s' : '—';
    const rtt  = conn.rtt  != null ? conn.rtt  + ' ms' : '—';
    const save = conn.saveData ? '⚠️ Tryb oszczędny danych' : '';
    document.getElementById('siNet').innerHTML =
      [type?`Typ: ${type}`:'', eff?`Skuteczne: ${eff}`:'', `↓ ~${dl}`, `RTT: ~${rtt}`, save]
      .filter(Boolean).join('<br>');
  } else {
    document.getElementById('siNet').textContent = navigator.onLine ? 'Online (Network Info API niedostępne)' : '❌ Offline';
  }

  // ── Language & timezone ──
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const offset = -new Date().getTimezoneOffset() / 60;
  document.getElementById('siLang').innerHTML =
    `Język: ${navigator.language}<br>`+
    `Języki: ${(navigator.languages||[]).slice(0,4).join(', ')}<br>`+
    `Strefa: ${tz}<br>`+
    `UTC${offset >= 0 ? '+' : ''}${offset}h`;

  // ── Touch / input ──
  const maxTouch = navigator.maxTouchPoints || 0;
  const hasGyro  = 'Gyroscope' in window;
  const hasAccel = 'Accelerometer' in window || 'DeviceMotionEvent' in window;
  document.getElementById('siTouch').innerHTML =
    `Punkty dotyku: ${maxTouch}<br>`+
    `Ekran dotykowy: ${maxTouch > 0 ? '✅ Tak' : '❌ Nie'}<br>`+
    `Żyroskop: ${hasGyro ? '✅' : '❌'} · Akcelerometr: ${hasAccel ? '✅' : '❌'}<br>`+
    `Pointer Events: ${'PointerEvent' in window ? '✅' : '❌'}`;

  // ── Storage ──
  let storageInfo = '';
  try {
    const est = await navigator.storage?.estimate?.();
    if(est) {
      storageInfo = `<br>Użyto: ${(est.usage/1e6).toFixed(1)} MB · Dostępne: ${((est.quota||0)/1e9).toFixed(1)} GB`;
    }
  } catch(e) {}
  const hasLS = (() => { try { localStorage.setItem('_t','1'); localStorage.removeItem('_t'); return true; } catch(e){ return false; } })();
  document.getElementById('siStorage').innerHTML =
    `Cookies: ${navigator.cookieEnabled ? '✅ Włączone' : '❌ Wyłączone'}<br>`+
    `localStorage: ${hasLS ? '✅' : '❌'} · IndexedDB: ${'indexedDB' in window ? '✅' : '❌'}<br>`+
    `Cache API: ${'caches' in window ? '✅' : '❌'} · Service Worker: ${'serviceWorker' in navigator ? '✅' : '❌'}`+
    storageInfo;

  // ── Battery ──
  try {
    const b = await navigator.getBattery?.();
    if(b) {
      const pct = Math.round(b.level * 100);
      document.getElementById('siBatt').textContent = pct;
      document.getElementById('siBattDetail').textContent =
        `${pct}% — ${b.charging ? '⚡ Ładowanie' : '🔋 Na baterii'}`;
      const ttf = b.charging ? b.chargingTime : b.dischargingTime;
      document.getElementById('siBattTime').textContent =
        isFinite(ttf) && ttf > 0 ? `${Math.floor(ttf/3600)}h ${Math.floor((ttf%3600)/60)}min` : '';
      const fill = document.getElementById('siBattBar');
      if(fill) { fill.style.width = pct + '%'; fill.style.background = pct > 50 ? '#00f5a0' : pct > 20 ? '#f5c400' : '#ff4d6d'; }
      document.getElementById('siBattSub').textContent = b.charging ? '% (ładuje)' : '%';
    } else {
      document.getElementById('siBatt').textContent = '—';
      document.getElementById('siBattDetail').textContent = 'Brak API (desktop) lub niedostępne';
    }
  } catch(e) {
    document.getElementById('siBatt').textContent = '—';
    document.getElementById('siBattDetail').textContent = 'Battery API zablokowane (Firefox/Netlify HTTPS)';
  }

  // ── JS benchmark ──
  document.getElementById('siPerf').textContent = 'Testowanie...';
  setTimeout(() => {
    const t0 = performance.now();
    let n = 0; for(let i = 0; i < 5e6; i++) n += Math.sqrt(i);
    const ms = performance.now() - t0;
    const score = Math.round(10000 / ms);
    document.getElementById('siPerf').textContent = `${ms.toFixed(1)} ms (5M operacji)`;
    document.getElementById('siPerfScore').textContent = `Score: ${score}`;
    if(document.getElementById('siPerfBar'))
      document.getElementById('siPerfBar').style.width = Math.min(100, score/10) + '%';
  }, 100);
}


  // RAM — deviceMemory API caps at 8GB for privacy, show real estimate via performance
  const ramApi = navigator.deviceMemory; // max 8 per spec
  let ramDisplay = ramApi ? ramApi+'+ GB' : '—';
  let ramNote = '';
  // Try to estimate real RAM via performance.memory (Chrome only, in bytes)
  if(performance.memory) {
    const heapLimit = performance.memory.jsHeapSizeLimit;
    // heap limit is typically ~1-4 GB; real RAM is usually much more
    ramNote = `(heap limit: ${(heapLimit/1e9).toFixed(1)} GB)`;
  }
  // deviceMemory is intentionally capped at 8 by browsers for fingerprint protection
  // Real RAM can only be hinted — show API value + note
  document.getElementById('siRam').textContent = ramApi >= 8 ? '8+' : (ramApi || '—');
  document.getElementById('siRamNote').textContent = ramApi >= 8
    ? '⚠️ API celowo ograniczone do 8 GB (Chrome/Firefox blokuje dla prywatności). Twoja rzeczywista ilość RAM może być większa (np. 16/32/64 GB).'
    : `Wartość z navigator.deviceMemory. ${ramNote}`;

  // Screen
  const sw=screen.width, sh=screen.height, dpr=devicePixelRatio||1;
  document.getElementById('siRes').textContent = `${sw}×${sh}`;
  document.getElementById('siResSub').textContent = `${Math.round(sw*dpr)}×${Math.round(sh*dpr)} px fizycznych`;
  document.getElementById('siScreen').innerHTML =
    `Logiczna: ${sw}×${sh}<br>Fizyczna: ${Math.round(sw*dpr)}×${Math.round(sh*dpr)}<br>DPR: ${dpr}<br>Głębia koloru: ${screen.colorDepth} bit<br>Orientacja: ${screen.orientation?.type||'—'}`;

  // Browser
  const ua = navigator.userAgent;
  let browser = '—';
  if(ua.includes('Edg/')) browser='Microsoft Edge '+(/Edg\/([\d.]+)/.exec(ua)||['',''])[1];
  else if(ua.includes('Chrome/')) browser='Chrome '+(/Chrome\/([\d.]+)/.exec(ua)||['',''])[1];
  else if(ua.includes('Firefox/')) browser='Firefox '+(/Firefox\/([\d.]+)/.exec(ua)||['',''])[1];
  else if(ua.includes('Safari/')) browser='Safari '+(/Version\/([\d.]+)/.exec(ua)||['',''])[1];
  document.getElementById('siBrowser').innerHTML = `${browser}<br><span style="font-size:9px;color:var(--muted);">${ua.substring(0,80)}...</span>`;

  // OS
  let os='—';
  if(ua.includes('Windows NT 10')) os='Windows 10/11';
  else if(ua.includes('Windows NT')) os='Windows';
  else if(ua.includes('Mac OS X')) os='macOS '+(/Mac OS X ([\d_]+)/.exec(ua)||['',''])[1].replace(/_/g,'.');
  else if(ua.includes('Linux')) os='Linux';
  else if(ua.includes('Android')) os='Android '+(/Android ([\d.]+)/.exec(ua)||['',''])[1];
  else if(ua.includes('iPhone')||ua.includes('iPad')) os='iOS';
  document.getElementById('siOs').textContent = os;

  // GPU
  try {
    const canvas=document.createElement('canvas');
    const gl=canvas.getContext('webgl')||canvas.getContext('experimental-webgl');
    if(gl){
      const ext=gl.getExtension('WEBGL_debug_renderer_info');
      const vendor=ext?gl.getParameter(ext.UNMASKED_VENDOR_WEBGL):'—';
      const renderer=ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):'WebGL dostępny';
      document.getElementById('siGpu').innerHTML=`${renderer}<br><span style="font-size:9px;color:var(--muted);">${vendor}</span>`;
    } else { document.getElementById('siGpu').textContent='WebGL niedostępny'; }
  } catch(e){ document.getElementById('siGpu').textContent='Błąd WebGL'; }

  // Network
  const conn=navigator.connection||navigator.mozConnection||navigator.webkitConnection;
  if(conn){
    document.getElementById('siNet').innerHTML =
      `Typ: ${conn.type||conn.effectiveType||'—'}<br>Skuteczne: ${conn.effectiveType||'—'}<br>Pobieranie: ~${conn.downlink||'?'} Mb/s<br>RTT: ~${conn.rtt||'?'} ms`;
  } else { document.getElementById('siNet').textContent=navigator.onLine?'Online (brak szczegółów)':'Offline'; }


// ─── KEYBOARD TEST ───────────────────────────────────
// ─── FULL 105-KEY LAYOUT ─────────────────────────────
// Main block | Nav cluster | Numpad
const KB_LAYOUT_MAIN = [
  // Row 0 — Esc + F1–F12 + PrtSc/ScrLk/Pause
  [
    {l:'Esc',c:'Escape'},        {l:'',c:'',w:0.5},
    {l:'F1',c:'F1'},{l:'F2',c:'F2'},{l:'F3',c:'F3'},{l:'F4',c:'F4'}, {l:'',c:'',w:0.5},
    {l:'F5',c:'F5'},{l:'F6',c:'F6'},{l:'F7',c:'F7'},{l:'F8',c:'F8'}, {l:'',c:'',w:0.5},
    {l:'F9',c:'F9'},{l:'F10',c:'F10'},{l:'F11',c:'F11'},{l:'F12',c:'F12'},
  ],
  // Row 1 — ` 1–0 -= Backspace
  [
    {l:'`',s:'~',c:'Backquote'},
    {l:'1',s:'!',c:'Digit1'},{l:'2',s:'@',c:'Digit2'},{l:'3',s:'#',c:'Digit3'},
    {l:'4',s:'$',c:'Digit4'},{l:'5',s:'%',c:'Digit5'},{l:'6',s:'^',c:'Digit6'},
    {l:'7',s:'&',c:'Digit7'},{l:'8',s:'*',c:'Digit8'},{l:'9',s:'(',c:'Digit9'},
    {l:'0',s:')',c:'Digit0'},{l:'-',s:'_',c:'Minus'},{l:'=',s:'+',c:'Equal'},
    {l:'⌫ Backspace',c:'Backspace',w:2},
  ],
  // Row 2 — Tab + QWERTY row
  [
    {l:'Tab',c:'Tab',w:1.5},
    {l:'Q',c:'KeyQ'},{l:'W',c:'KeyW'},{l:'E',c:'KeyE'},{l:'R',c:'KeyR'},{l:'T',c:'KeyT'},
    {l:'Y',c:'KeyY'},{l:'U',c:'KeyU'},{l:'I',c:'KeyI'},{l:'O',c:'KeyO'},{l:'P',c:'KeyP'},
    {l:'[',s:'{',c:'BracketLeft'},{l:']',s:'}',c:'BracketRight'},{l:'\\',s:'|',c:'Backslash',w:1.5},
  ],
  // Row 3 — Caps + ASDF row + Enter
  [
    {l:'Caps Lock',c:'CapsLock',w:1.75},
    {l:'A',c:'KeyA'},{l:'S',c:'KeyS'},{l:'D',c:'KeyD'},{l:'F',c:'KeyF'},{l:'G',c:'KeyG'},
    {l:'H',c:'KeyH'},{l:'J',c:'KeyJ'},{l:'K',c:'KeyK'},{l:'L',c:'KeyL'},
    {l:';',s:':',c:'Semicolon'},{l:"'",s:'"',c:'Quote'},
    {l:'Enter ↵',c:'Enter',w:2.25},
  ],
  // Row 4 — Shift + ZXCV row
  [
    {l:'⇧ Shift',c:'ShiftLeft',w:2.25},
    {l:'Z',c:'KeyZ'},{l:'X',c:'KeyX'},{l:'C',c:'KeyC'},{l:'V',c:'KeyV'},{l:'B',c:'KeyB'},
    {l:'N',c:'KeyN'},{l:'M',c:'KeyM'},{l:',',s:'<',c:'Comma'},{l:'.',s:'>',c:'Period'},
    {l:'/',s:'?',c:'Slash'},
    {l:'Shift ⇧',c:'ShiftRight',w:2.75},
  ],
  // Row 5 — Ctrl Win Alt Space …
  [
    {l:'Ctrl',c:'ControlLeft',w:1.25},{l:'⊞ Win',c:'MetaLeft',w:1.25},{l:'Alt',c:'AltLeft',w:1.25},
    {l:'Space',c:'Space',w:6.25},
    {l:'Alt',c:'AltRight',w:1.25},{l:'⊞ Win',c:'MetaRight',w:1.25},
    {l:'Menu',c:'ContextMenu',w:1.25},{l:'Ctrl',c:'ControlRight',w:1.25},
  ],
];

const KB_NAV_CLUSTER = [
  // row 0: PrtSc ScrLk Pause  (aligns with F9-F12 row)
  [{l:'PrtSc',c:'PrintScreen'},{l:'ScrLk',c:'ScrollLock'},{l:'Pause',c:'Pause'}],
  // row 1: spacer (gap between F-row and number row)
  null,
  // row 2: Ins Home PgUp
  [{l:'Ins',c:'Insert'},{l:'Home',c:'Home'},{l:'PgUp',c:'PageUp'}],
  // row 3: Del End PgDn
  [{l:'Del',c:'Delete'},{l:'End',c:'End'},{l:'PgDn',c:'PageDown'}],
  // row 4: spacer (gap between Del row and arrows)
  null,
  // row 5: spacer (extra gap)
  null,
  // row 6: [blank] Up [blank]
  [null,{l:'↑',c:'ArrowUp'},null],
  // row 7: Left Down Right
  [{l:'←',c:'ArrowLeft'},{l:'↓',c:'ArrowDown'},{l:'→',c:'ArrowRight'}],
];

const KB_NUMPAD = [
  // row 0: NumLock / * -
  [{l:'NumLk',c:'NumLock'},{l:'/',c:'NumpadDivide'},{l:'*',c:'NumpadMultiply'},{l:'−',c:'NumpadSubtract'}],
  // row 1: 7 8 9 [+tall start]
  [{l:'7',c:'Numpad7'},{l:'8',c:'Numpad8'},{l:'9',c:'Numpad9'},{l:'+',c:'NumpadAdd',tall:true}],
  // row 2: 4 5 6 [+tall cont]
  [{l:'4',c:'Numpad4'},{l:'5',c:'Numpad5'},{l:'6',c:'Numpad6'}],
  // row 3: 1 2 3 [Enter tall start]
  [{l:'1',c:'Numpad1'},{l:'2',c:'Numpad2'},{l:'3',c:'Numpad3'},{l:'Ent',c:'NumpadEnter',tall:true}],
  // row 4: 0(wide) .  [Enter tall cont]
  [{l:'0',c:'Numpad0',wide:true},{l:'.',c:'NumpadDecimal'}],
];

const KB_ALL_CODES = [
  ...KB_LAYOUT_MAIN.flatMap(r => r.filter(k => k.c && k.c !== '')),
  ...KB_NAV_CLUSTER.filter(Boolean).flatMap(r => r.filter(k => k && k.c)),
  ...KB_NUMPAD.flatMap(r => r.filter(k => k.c)),
].map(k => k.c);
const KB_TOTAL = KB_ALL_CODES.length;

// ── Sound profiles ──────────────────────────────────
let kbActive = false;
let kbTested = new Set();
let kbPressed = new Set();
let kbTotalPresses = 0;
let kbStartTime = null;
let kbTimerInterval = null;
let kbRecentTimes = [];
let kbSoundOn = false;
let kbSoundProfile = 'click';
let kbAudioCtxKb = null;
let kbModsDown = {Shift:false, Ctrl:false, Alt:false, Meta:false, Caps:false};

const KB_SOUNDS = {
  // ── Mechaniczne ──
  click: {label:'🖱️ Click', fn(ac,g){
    const buf=ac.createBuffer(1,ac.sampleRate*0.04,ac.sampleRate);
    const d=buf.getChannelData(0);
    for(let i=0;i<d.length;i++) d[i]=(Math.random()*2-1)*Math.exp(-i/(ac.sampleRate*0.008));
    const s=ac.createBufferSource(); s.buffer=buf; s.connect(g); s.start();
  }},
  thock: {label:'🪵 Thock', fn(ac,g){
    // deep thock — low freq body + mid click
    const buf=ac.createBuffer(1,ac.sampleRate*0.08,ac.sampleRate);
    const d=buf.getChannelData(0);
    for(let i=0;i<d.length;i++){
      const t=i/ac.sampleRate;
      d[i]=(Math.random()*2-1)*0.45*Math.exp(-t/0.015)
           +Math.sin(2*Math.PI*180*t)*1.1*Math.exp(-t/0.06);
    }
    const lp=ac.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=600;
    const s=ac.createBufferSource(); s.buffer=buf; s.connect(lp); lp.connect(g); s.start();
  }},
  clack: {label:'⚡ Clack', fn(ac,g){
    const buf=ac.createBuffer(1,ac.sampleRate*0.025,ac.sampleRate);
    const d=buf.getChannelData(0);
    for(let i=0;i<d.length;i++) d[i]=(Math.random()*2-1)*Math.exp(-i/(ac.sampleRate*0.003));
    const s=ac.createBufferSource(); s.buffer=buf;
    const hp=ac.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=4000;
    s.connect(hp); hp.connect(g); s.start();
  }},
  tactile: {label:'🔵 Tactile', fn(ac,g){
    // tactile bump — click + small bump resonance
    const buf=ac.createBuffer(1,ac.sampleRate*0.05,ac.sampleRate);
    const d=buf.getChannelData(0);
    for(let i=0;i<d.length;i++){
      const t=i/ac.sampleRate;
      d[i]=(Math.random()*2-1)*Math.exp(-t/0.004)
           +Math.sin(2*Math.PI*800*t)*0.3*Math.exp(-t/0.01);
    }
    const bp=ac.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=2000; bp.Q.value=2;
    const s=ac.createBufferSource(); s.buffer=buf; s.connect(bp); bp.connect(g); s.start();
  }},
  blue: {label:'🔷 Blue Switch', fn(ac,g){
    // Cherry MX Blue — loud click + high pitch
    const buf=ac.createBuffer(1,ac.sampleRate*0.06,ac.sampleRate);
    const d=buf.getChannelData(0);
    for(let i=0;i<d.length;i++){
      const t=i/ac.sampleRate;
      d[i]=(Math.random()*2-1)*Math.exp(-t/0.005)*0.8
           +Math.sin(2*Math.PI*2400*t)*Math.exp(-t/0.015)*0.4;
    }
    const s=ac.createBufferSource(); s.buffer=buf; s.connect(g); s.start();
  }},
  red: {label:'🔴 Red Switch', fn(ac,g){
    // Cherry MX Red — linear, quiet, smooth
    const buf=ac.createBuffer(1,ac.sampleRate*0.035,ac.sampleRate);
    const d=buf.getChannelData(0);
    for(let i=0;i<d.length;i++){
      const t=i/ac.sampleRate;
      d[i]=(Math.random()*2-1)*0.35*Math.exp(-t/0.01);
    }
    const lp=ac.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=1500;
    const s=ac.createBufferSource(); s.buffer=buf; s.connect(lp); lp.connect(g); s.start();
  }},
  // ── Membranowe / ciche ──
  soft: {label:'🤫 Cichy', fn(ac,g){
    const buf=ac.createBuffer(1,ac.sampleRate*0.025,ac.sampleRate);
    const d=buf.getChannelData(0);
    for(let i=0;i<d.length;i++) d[i]=(Math.random()*2-1)*0.4*Math.exp(-i/(ac.sampleRate*0.012));
    const s=ac.createBufferSource(); s.buffer=buf; s.connect(g); s.start();
  }},
  membrane: {label:'💻 Laptop', fn(ac,g){
    // flat membrane keyboard — dull thud
    const buf=ac.createBuffer(1,ac.sampleRate*0.04,ac.sampleRate);
    const d=buf.getChannelData(0);
    for(let i=0;i<d.length;i++){
      const t=i/ac.sampleRate;
      d[i]=(Math.random()*2-1)*0.8*Math.exp(-t/0.018)
           +Math.sin(2*Math.PI*120*t)*0.4*Math.exp(-t/0.025);
    }
    const lp=ac.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=800;
    const s=ac.createBufferSource(); s.buffer=buf; s.connect(lp); lp.connect(g); s.start();
  }},
  // ── Specjalne ──
  typewriter: {label:'📰 Maszyna', fn(ac,g){
    const osc=ac.createOscillator(); osc.type='square'; osc.frequency.value=900;
    const g2=ac.createGain(); g2.gain.setValueAtTime(0.3,ac.currentTime); g2.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+0.04);
    // add metal ping
    const osc2=ac.createOscillator(); osc2.type='sine'; osc2.frequency.value=3200;
    const g3=ac.createGain(); g3.gain.setValueAtTime(0.08,ac.currentTime); g3.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+0.08);
    osc.connect(g2); g2.connect(g); osc2.connect(g3); g3.connect(g);
    osc.start(); osc.stop(ac.currentTime+0.05); osc2.start(); osc2.stop(ac.currentTime+0.08);
  }},
  pop: {label:'💧 Pop', fn(ac,g){
    const osc=ac.createOscillator(); osc.type='sine';
    osc.frequency.setValueAtTime(400,ac.currentTime); osc.frequency.exponentialRampToValueAtTime(80,ac.currentTime+0.06);
    const g2=ac.createGain(); g2.gain.setValueAtTime(0.85,ac.currentTime); g2.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+0.07);
    osc.connect(g2); g2.connect(g); osc.start(); osc.stop(ac.currentTime+0.07);
  }},
  bubble: {label:'🫧 Bąbelki', fn(ac,g){
    // bubbly pop — rising pitch
    const osc=ac.createOscillator(); osc.type='sine';
    osc.frequency.setValueAtTime(200,ac.currentTime); osc.frequency.exponentialRampToValueAtTime(1200,ac.currentTime+0.05);
    const g2=ac.createGain(); g2.gain.setValueAtTime(0.35,ac.currentTime); g2.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+0.06);
    osc.connect(g2); g2.connect(g); osc.start(); osc.stop(ac.currentTime+0.06);
  }},
  wood: {label:'🥁 Drewno', fn(ac,g){
    const buf=ac.createBuffer(1,ac.sampleRate*0.1,ac.sampleRate);
    const d=buf.getChannelData(0);
    for(let i=0;i<d.length;i++){
      const t=i/ac.sampleRate;
      d[i]=Math.sin(2*Math.PI*300*t)*Math.exp(-t/0.03)*1.0
          +(Math.random()*2-1)*0.55*Math.exp(-t/0.008);
    }
    const lp=ac.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=700;
    const s=ac.createBufferSource(); s.buffer=buf; s.connect(lp); lp.connect(g); s.start();
  }},
  snap: {label:'👌 Snap', fn(ac,g){
    // finger snap — sharp transient + body
    const buf=ac.createBuffer(1,ac.sampleRate*0.06,ac.sampleRate);
    const d=buf.getChannelData(0);
    for(let i=0;i<d.length;i++){
      const t=i/ac.sampleRate;
      d[i]=(Math.random()*2-1)*Math.exp(-t/0.005)
          +Math.sin(2*Math.PI*600*t)*0.5*Math.exp(-t/0.02);
    }
    const s=ac.createBufferSource(); s.buffer=buf; s.connect(g); s.start();
  }},
  // ── Muzyczne ──
  piano: {label:'🎹 Piano', fn(ac,g,freq){
    const f=freq||440;
    const osc=ac.createOscillator(); osc.type='triangle'; osc.frequency.value=f;
    const osc2=ac.createOscillator(); osc2.type='sine'; osc2.frequency.value=f*2;
    const osc3=ac.createOscillator(); osc3.type='sine'; osc3.frequency.value=f*0.5;
    const g2=ac.createGain(); g2.gain.setValueAtTime(0.4,ac.currentTime); g2.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+0.5);
    osc.connect(g2); osc2.connect(g2); osc3.connect(g2); g2.connect(g);
    osc.start(); osc2.start(); osc3.start();
    osc.stop(ac.currentTime+0.5); osc2.stop(ac.currentTime+0.5); osc3.stop(ac.currentTime+0.5);
  }},
  xylophone: {label:'🎵 Ksylofon', fn(ac,g,freq){
    const f=freq||600;
    const osc=ac.createOscillator(); osc.type='sine'; osc.frequency.value=f;
    const osc2=ac.createOscillator(); osc2.type='sine'; osc2.frequency.value=f*3.2;
    const g2=ac.createGain(); g2.gain.setValueAtTime(0.5,ac.currentTime); g2.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+0.25);
    const g3=ac.createGain(); g3.gain.setValueAtTime(0.15,ac.currentTime); g3.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+0.12);
    osc.connect(g2); g2.connect(g); osc2.connect(g3); g3.connect(g);
    osc.start(); osc2.start(); osc.stop(ac.currentTime+0.25); osc2.stop(ac.currentTime+0.12);
  }},
  retro: {label:'👾 Retro', fn(ac,g,freq){
    const osc=ac.createOscillator(); osc.type='square'; osc.frequency.value=freq||800;
    const g2=ac.createGain(); g2.gain.setValueAtTime(0.2,ac.currentTime); g2.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+0.05);
    osc.connect(g2); g2.connect(g); osc.start(); osc.stop(ac.currentTime+0.05);
  }},
  laser: {label:'🔫 Laser', fn(ac,g,freq){
    const osc=ac.createOscillator(); osc.type='sawtooth';
    osc.frequency.setValueAtTime(freq||1200,ac.currentTime);
    osc.frequency.exponentialRampToValueAtTime(200,ac.currentTime+0.1);
    const g2=ac.createGain(); g2.gain.setValueAtTime(0.25,ac.currentTime); g2.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+0.1);
    osc.connect(g2); g2.connect(g); osc.start(); osc.stop(ac.currentTime+0.1);
  }},
  coin: {label:'🪙 Moneta', fn(ac,g,freq){
    // Mario coin — two notes
    const f=freq||988;
    [0, 0.08].forEach((delay,i)=>{
      const osc=ac.createOscillator(); osc.type='square'; osc.frequency.value=i===0?f:f*1.5;
      const g2=ac.createGain(); g2.gain.setValueAtTime(0,ac.currentTime+delay);
      g2.gain.linearRampToValueAtTime(0.3,ac.currentTime+delay+0.005);
      g2.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+delay+0.08);
      osc.connect(g2); g2.connect(g); osc.start(ac.currentTime+delay); osc.stop(ac.currentTime+delay+0.1);
    });
  }},

  // ── NOWE PROFILE ──────────────────────────────────────

  // Mechaniczne — nowe
  green: {label:'🟢 Green Switch', fn(ac,g){
    // Cherry MX Green — louder tactile click
    const buf=ac.createBuffer(1,ac.sampleRate*0.06,ac.sampleRate);
    const d=buf.getChannelData(0);
    for(let i=0;i<d.length;i++) d[i]=(Math.random()*2-1)*(i<200?1:Math.exp(-i/600));
    const src=ac.createBufferSource();
    const hi=ac.createBiquadFilter(); hi.type='highpass'; hi.frequency.value=3000;
    const bump=ac.createOscillator(); bump.type='sine'; bump.frequency.value=180;
    const bg=ac.createGain(); bg.gain.setValueAtTime(0.25,ac.currentTime); bg.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+0.04);
    src.buffer=buf; src.connect(hi); hi.connect(g);
    bump.connect(bg); bg.connect(g);
    src.start(); src.stop(ac.currentTime+0.06);
    bump.start(); bump.stop(ac.currentTime+0.04);
  }},

  brown: {label:'🟤 Brown Switch', fn(ac,g){
    // Cherry MX Brown — soft tactile bump
    const buf=ac.createBuffer(1,ac.sampleRate*0.05,ac.sampleRate);
    const d=buf.getChannelData(0);
    for(let i=0;i<d.length;i++) d[i]=(Math.random()*2-1)*Math.exp(-i/400);
    const src=ac.createBufferSource();
    const bp=ac.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=1200; bp.Q.value=0.8;
    const bump=ac.createOscillator(); bump.type='sine'; bump.frequency.value=140;
    const bg=ac.createGain(); bg.gain.setValueAtTime(0.2,ac.currentTime); bg.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+0.05);
    src.buffer=buf; src.connect(bp); bp.connect(g);
    bump.connect(bg); bg.connect(g);
    src.start(); src.stop(ac.currentTime+0.05);
    bump.start(); bump.stop(ac.currentTime+0.05);
  }},

  speed: {label:'⚪ Speed Silver', fn(ac,g){
    // Ultra-fast linear — very short transient
    const buf=ac.createBuffer(1,ac.sampleRate*0.025,ac.sampleRate);
    const d=buf.getChannelData(0);
    for(let i=0;i<d.length;i++) d[i]=(Math.random()*2-1)*Math.exp(-i/200);
    const src=ac.createBufferSource();
    const hi=ac.createBiquadFilter(); hi.type='highpass'; hi.frequency.value=4000;
    src.buffer=buf; src.connect(hi); hi.connect(g);
    src.start(); src.stop(ac.currentTime+0.025);
  }},

  // Specjalne faktury
  cream: {label:'🍦 Creamy', fn(ac,g){
    // Smooth creamy thock — low freq sine + soft noise
    const osc=ac.createOscillator(); osc.type='sine'; osc.frequency.value=95;
    const og=ac.createGain(); og.gain.setValueAtTime(0.4,ac.currentTime); og.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+0.18);
    const buf=ac.createBuffer(1,ac.sampleRate*0.18,ac.sampleRate);
    const d=buf.getChannelData(0);
    for(let i=0;i<d.length;i++) d[i]=(Math.random()*2-1)*Math.exp(-i/1800)*0.15;
    const src=ac.createBufferSource(); src.buffer=buf;
    const lp=ac.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=600;
    osc.connect(og); og.connect(g);
    src.connect(lp); lp.connect(g);
    osc.start(); osc.stop(ac.currentTime+0.18);
    src.start(); src.stop(ac.currentTime+0.18);
  }},

  marble: {label:'🔮 Marble', fn(ac,g){
    // Hard hollow marble-like click
    const osc=ac.createOscillator(); osc.type='sine'; osc.frequency.setValueAtTime(900,ac.currentTime); osc.frequency.exponentialRampToValueAtTime(200,ac.currentTime+0.05);
    const og=ac.createGain(); og.gain.setValueAtTime(0.35,ac.currentTime); og.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+0.07);
    const osc2=ac.createOscillator(); osc2.type='sine'; osc2.frequency.value=1800;
    const og2=ac.createGain(); og2.gain.setValueAtTime(0.15,ac.currentTime); og2.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+0.03);
    osc.connect(og); og.connect(g);
    osc2.connect(og2); og2.connect(g);
    osc.start(); osc.stop(ac.currentTime+0.07);
    osc2.start(); osc2.stop(ac.currentTime+0.03);
  }},

  metal: {label:'🔩 Metal', fn(ac,g){
    // Metallic ping — high harmonics
    [800,1600,2400,4000].forEach((f,i)=>{
      const osc=ac.createOscillator(); osc.type='sine'; osc.frequency.value=f;
      const og=ac.createGain(); og.gain.setValueAtTime(0.15/(i+1),ac.currentTime); og.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+0.12/(i*0.5+1));
      osc.connect(og); og.connect(g);
      osc.start(); osc.stop(ac.currentTime+0.15);
    });
  }},

  rubber: {label:'🟡 Gumowy', fn(ac,g){
    // Rubbery muted thud
    const osc=ac.createOscillator(); osc.type='sine'; osc.frequency.setValueAtTime(200,ac.currentTime); osc.frequency.exponentialRampToValueAtTime(60,ac.currentTime+0.08);
    const og=ac.createGain(); og.gain.setValueAtTime(0.5,ac.currentTime); og.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+0.09);
    const lp=ac.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=400;
    osc.connect(lp); lp.connect(og); og.connect(g);
    osc.start(); osc.stop(ac.currentTime+0.1);
  }},

  hollow: {label:'🪣 Hollow', fn(ac,g){
    // Empty hollow knock — like knocking on a box
    const osc=ac.createOscillator(); osc.type='triangle'; osc.frequency.setValueAtTime(380,ac.currentTime); osc.frequency.exponentialRampToValueAtTime(120,ac.currentTime+0.1);
    const og=ac.createGain(); og.gain.setValueAtTime(0.45,ac.currentTime); og.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+0.12);
    const buf=ac.createBuffer(1,ac.sampleRate*0.03,ac.sampleRate);
    const d=buf.getChannelData(0);
    for(let i=0;i<d.length;i++) d[i]=(Math.random()*2-1)*Math.exp(-i/150)*0.2;
    const src=ac.createBufferSource(); src.buffer=buf;
    osc.connect(og); og.connect(g);
    src.connect(g);
    osc.start(); osc.stop(ac.currentTime+0.12);
    src.start(); src.stop(ac.currentTime+0.03);
  }},

  // Dźwięki otoczenia / retro
  spring: {label:'🌀 Sprężyna', fn(ac,g){
    // Boing spring twang
    const osc=ac.createOscillator(); osc.type='sawtooth';
    osc.frequency.setValueAtTime(300,ac.currentTime);
    osc.frequency.linearRampToValueAtTime(80,ac.currentTime+0.15);
    const og=ac.createGain(); og.gain.setValueAtTime(0.25,ac.currentTime); og.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+0.2);
    const bp=ac.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=400; bp.Q.value=5;
    osc.connect(bp); bp.connect(og); og.connect(g);
    osc.start(); osc.stop(ac.currentTime+0.2);
  }},

  sci: {label:'🛸 Sci-Fi', fn(ac,g,freq){
    // Futuristic blip
    const f=freq||600;
    const osc=ac.createOscillator(); osc.type='square';
    osc.frequency.setValueAtTime(f*2,ac.currentTime);
    osc.frequency.exponentialRampToValueAtTime(f*0.5,ac.currentTime+0.06);
    const og=ac.createGain(); og.gain.setValueAtTime(0.2,ac.currentTime); og.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+0.08);
    const hp=ac.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=800;
    osc.connect(hp); hp.connect(og); og.connect(g);
    osc.start(); osc.stop(ac.currentTime+0.08);
  }},

  chime: {label:'🔔 Dzwonek', fn(ac,g,freq){
    // Bell chime
    const f=freq||1200;
    [f, f*2.75, f*5.4].forEach((hz,i)=>{
      const osc=ac.createOscillator(); osc.type='sine'; osc.frequency.value=hz;
      const og=ac.createGain();
      og.gain.setValueAtTime(0.2/(i+1),ac.currentTime);
      og.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+0.4/(i*0.3+1));
      osc.connect(og); og.connect(g);
      osc.start(); osc.stop(ac.currentTime+0.5);
    });
  }},

  neon_buzz: {label:'⚡ Buzz', fn(ac,g){
    // Electric buzz / zap
    const buf=ac.createBuffer(1,ac.sampleRate*0.04,ac.sampleRate);
    const d=buf.getChannelData(0);
    for(let i=0;i<d.length;i++) d[i]=(Math.random()*2-1)*Math.exp(-i/300);
    const src=ac.createBufferSource(); src.buffer=buf;
    const bp=ac.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=2500; bp.Q.value=3;
    const og=ac.createGain(); og.gain.setValueAtTime(0.6,ac.currentTime); og.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+0.04);
    src.connect(bp); bp.connect(og); og.connect(g);
    src.start(); src.stop(ac.currentTime+0.04);
  }},

  underwater: {label:'🌊 Podwodny', fn(ac,g){
    // Muffled underwater blub
    const buf=ac.createBuffer(1,ac.sampleRate*0.12,ac.sampleRate);
    const d=buf.getChannelData(0);
    for(let i=0;i<d.length;i++) d[i]=(Math.random()*2-1)*Math.exp(-i/1200);
    const src=ac.createBufferSource(); src.buffer=buf;
    const lp=ac.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=300;
    const lp2=ac.createBiquadFilter(); lp2.type='lowpass'; lp2.frequency.value=250;
    const og=ac.createGain(); og.gain.value=0.8;
    src.connect(lp); lp.connect(lp2); lp2.connect(og); og.connect(g);
    src.start(); src.stop(ac.currentTime+0.12);
  }},

  // Muzyczne — nowe
  harp: {label:'🎶 Harfa', fn(ac,g,freq){
    const f=freq||440;
    [f,f*2,f*3].forEach((hz,i)=>{
      const osc=ac.createOscillator(); osc.type='triangle'; osc.frequency.value=hz;
      const og=ac.createGain();
      og.gain.setValueAtTime(0,(ac.currentTime+i*0.015));
      og.gain.linearRampToValueAtTime(0.15/(i+1),(ac.currentTime+i*0.015+0.005));
      og.gain.exponentialRampToValueAtTime(0.001,(ac.currentTime+0.3));
      osc.connect(og); og.connect(g);
      osc.start(ac.currentTime+i*0.015); osc.stop(ac.currentTime+0.35);
    });
  }},

  marimba: {label:'🎼 Marimba', fn(ac,g,freq){
    const f=freq||330;
    const osc=ac.createOscillator(); osc.type='sine'; osc.frequency.value=f;
    const osc2=ac.createOscillator(); osc2.type='sine'; osc2.frequency.value=f*4;
    const og=ac.createGain(); og.gain.setValueAtTime(0.4,ac.currentTime); og.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+0.25);
    const og2=ac.createGain(); og2.gain.setValueAtTime(0.1,ac.currentTime); og2.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+0.06);
    const buf=ac.createBuffer(1,ac.sampleRate*0.01,ac.sampleRate);
    const d=buf.getChannelData(0);
    for(let i=0;i<d.length;i++) d[i]=(Math.random()*2-1)*Math.exp(-i/50)*0.3;
    const src=ac.createBufferSource(); src.buffer=buf;
    osc.connect(og); og.connect(g);
    osc2.connect(og2); og2.connect(g);
    src.connect(g);
    osc.start(); osc.stop(ac.currentTime+0.25);
    osc2.start(); osc2.stop(ac.currentTime+0.06);
    src.start(); src.stop(ac.currentTime+0.01);
  }},

  drum: {label:'🥁 Bęben', fn(ac,g){
    // Snare drum hit
    const buf=ac.createBuffer(1,ac.sampleRate*0.1,ac.sampleRate);
    const d=buf.getChannelData(0);
    for(let i=0;i<d.length;i++) d[i]=(Math.random()*2-1)*Math.exp(-i/600);
    const src=ac.createBufferSource(); src.buffer=buf;
    const hp=ac.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=1000;
    const body=ac.createOscillator(); body.type='triangle'; body.frequency.setValueAtTime(200,ac.currentTime); body.frequency.exponentialRampToValueAtTime(60,ac.currentTime+0.05);
    const bg=ac.createGain(); bg.gain.setValueAtTime(0.4,ac.currentTime); bg.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+0.06);
    src.connect(hp); hp.connect(g);
    body.connect(bg); bg.connect(g);
    src.start(); src.stop(ac.currentTime+0.1);
    body.start(); body.stop(ac.currentTime+0.06);
  }},

  vibraphone: {label:'✨ Wibrafon', fn(ac,g,freq){
    const f=freq||520;
    const osc=ac.createOscillator(); osc.type='sine'; osc.frequency.value=f;
    // vibrato
    const lfo=ac.createOscillator(); lfo.type='sine'; lfo.frequency.value=6;
    const lfog=ac.createGain(); lfog.gain.value=3;
    lfo.connect(lfog); lfog.connect(osc.frequency);
    const og=ac.createGain(); og.gain.setValueAtTime(0.35,ac.currentTime); og.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+0.5);
    osc.connect(og); og.connect(g);
    lfo.start(); osc.start(); osc.stop(ac.currentTime+0.5); lfo.stop(ac.currentTime+0.5);
  }},

  click8bit: {label:'👾 8-bit Click', fn(ac,g){
    // NES-style click
    const buf=ac.createBuffer(1,Math.floor(ac.sampleRate*0.015),ac.sampleRate);
    const d=buf.getChannelData(0);
    const period=Math.floor(ac.sampleRate/440);
    for(let i=0;i<d.length;i++) d[i]=(i%period < period/2 ? 0.4 : -0.4)*Math.exp(-i/300);
    const src=ac.createBufferSource(); src.buffer=buf;
    src.connect(g); src.start(); src.stop(ac.currentTime+0.015);
  }},

  glitch_k: {label:'💥 Glitch', fn(ac,g,freq){
    // Random pitch glitch burst
    const f=freq||400;
    for(let i=0;i<3;i++){
      const delay=i*0.012;
      const osc=ac.createOscillator(); osc.type=(['square','sawtooth','square'])[i];
      osc.frequency.value=f*(0.5+Math.random()*2);
      const og=ac.createGain(); og.gain.setValueAtTime(0.2,ac.currentTime+delay); og.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+delay+0.01);
      osc.connect(og); og.connect(g);
      osc.start(ac.currentTime+delay); osc.stop(ac.currentTime+delay+0.015);
    }
  }},

  whisper: {label:'🤫 Szept', fn(ac,g){
    // Ultra-soft breath-like press
    const buf=ac.createBuffer(1,ac.sampleRate*0.06,ac.sampleRate);
    const d=buf.getChannelData(0);
    for(let i=0;i<d.length;i++) d[i]=(Math.random()*2-1)*Math.exp(-i/800)*0.08;
    const src=ac.createBufferSource(); src.buffer=buf;
    const bp=ac.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=800; bp.Q.value=0.5;
    src.connect(bp); bp.connect(g);
    src.start(); src.stop(ac.currentTime+0.06);
  }},

  // ── NOWE DŹWIĘKI ──────────────────────────────────────

  vinyl: {label:'💿 Vinyl', fn(ac,g){
    // Vinyl record crackle + soft thud
    const buf=ac.createBuffer(1,ac.sampleRate*0.08,ac.sampleRate);
    const d=buf.getChannelData(0);
    for(let i=0;i<d.length;i++){
      const t=i/ac.sampleRate;
      d[i]=(Math.random()*2-1)*0.06*Math.exp(-t/0.05)
           +(Math.random()<0.03?(Math.random()*2-1)*0.8*Math.exp(-t/0.002):0);
    }
    const src=ac.createBufferSource(); src.buffer=buf;
    const lp=ac.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=3500;
    const hp=ac.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=200;
    const og=ac.createGain(); og.gain.value=0.9;
    src.connect(hp); hp.connect(lp); lp.connect(og); og.connect(g);
    src.start(); src.stop(ac.currentTime+0.08);
  }},

  droplet: {label:'🌧️ Kropla', fn(ac,g){
    // Water droplet — falling pitch plop
    const osc=ac.createOscillator(); osc.type='sine';
    osc.frequency.setValueAtTime(1800,ac.currentTime);
    osc.frequency.exponentialRampToValueAtTime(300,ac.currentTime+0.06);
    const osc2=ac.createOscillator(); osc2.type='sine';
    osc2.frequency.setValueAtTime(900,ac.currentTime);
    osc2.frequency.exponentialRampToValueAtTime(150,ac.currentTime+0.09);
    const og=ac.createGain(); og.gain.setValueAtTime(0.3,ac.currentTime); og.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+0.1);
    const og2=ac.createGain(); og2.gain.setValueAtTime(0.15,ac.currentTime); og2.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+0.1);
    osc.connect(og); og.connect(g);
    osc2.connect(og2); og2.connect(g);
    osc.start(); osc.stop(ac.currentTime+0.1);
    osc2.start(); osc2.stop(ac.currentTime+0.1);
  }},

  thud: {label:'🪨 Thud', fn(ac,g){
    // Heavy dull thud — very low freq body hit
    const buf=ac.createBuffer(1,ac.sampleRate*0.15,ac.sampleRate);
    const d=buf.getChannelData(0);
    for(let i=0;i<d.length;i++){
      const t=i/ac.sampleRate;
      d[i]=(Math.random()*2-1)*0.4*Math.exp(-t/0.025)
           +Math.sin(2*Math.PI*55*t)*0.7*Math.exp(-t/0.12);
    }
    const src=ac.createBufferSource(); src.buffer=buf;
    const lp=ac.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=300;
    const og=ac.createGain(); og.gain.value=0.8;
    src.connect(lp); lp.connect(og); og.connect(g);
    src.start(); src.stop(ac.currentTime+0.15);
  }},

  neon_ping: {label:'🔆 Neon', fn(ac,g,freq){
    // Bright neon sign buzz + high ping
    const f=freq||1400;
    const osc=ac.createOscillator(); osc.type='square'; osc.frequency.value=f;
    const og=ac.createGain(); og.gain.setValueAtTime(0.15,ac.currentTime); og.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+0.09);
    // buzz layer
    const buf=ac.createBuffer(1,ac.sampleRate*0.04,ac.sampleRate);
    const d=buf.getChannelData(0);
    for(let i=0;i<d.length;i++) d[i]=(Math.random()*2-1)*Math.exp(-i/120)*0.3;
    const src=ac.createBufferSource(); src.buffer=buf;
    const bp=ac.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=3000; bp.Q.value=4;
    osc.connect(og); og.connect(g);
    src.connect(bp); bp.connect(g);
    osc.start(); osc.stop(ac.currentTime+0.09);
    src.start(); src.stop(ac.currentTime+0.04);
  }},

  telegraph: {label:'📡 Telegraf', fn(ac,g){
    // Morse-style telegraph click — sharp mechanical
    const osc=ac.createOscillator(); osc.type='square'; osc.frequency.value=700;
    const og=ac.createGain(); og.gain.setValueAtTime(0,ac.currentTime);
    og.gain.linearRampToValueAtTime(0.4,ac.currentTime+0.003);
    og.gain.setValueAtTime(0.4,ac.currentTime+0.018);
    og.gain.linearRampToValueAtTime(0,ac.currentTime+0.022);
    const bp=ac.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=700; bp.Q.value=2;
    osc.connect(bp); bp.connect(og); og.connect(g);
    osc.start(); osc.stop(ac.currentTime+0.025);
  }},

  whoosh: {label:'💨 Whoosh', fn(ac,g){
    // Air whoosh — rising-falling filtered noise
    const buf=ac.createBuffer(1,ac.sampleRate*0.12,ac.sampleRate);
    const d=buf.getChannelData(0);
    for(let i=0;i<d.length;i++) d[i]=Math.random()*2-1;
    const src=ac.createBufferSource(); src.buffer=buf;
    const bp=ac.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=1200; bp.Q.value=0.8;
    const og=ac.createGain();
    og.gain.setValueAtTime(0,ac.currentTime);
    og.gain.linearRampToValueAtTime(0.5,ac.currentTime+0.04);
    og.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+0.12);
    src.connect(bp); bp.connect(og); og.connect(g);
    src.start(); src.stop(ac.currentTime+0.12);
  }},

  glass: {label:'🥂 Szkło', fn(ac,g,freq){
    // Crystal glass ring — pure high harmonics with long decay
    const f=freq||1760;
    [f, f*2.003, f*3.012].forEach((hz,i)=>{
      const osc=ac.createOscillator(); osc.type='sine'; osc.frequency.value=hz;
      const og=ac.createGain();
      og.gain.setValueAtTime(0.18/(i+1),ac.currentTime);
      og.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+0.6/(i*0.4+1));
      osc.connect(og); og.connect(g);
      osc.start(); osc.stop(ac.currentTime+0.7);
    });
  }},

  zap: {label:'⚡ Zap', fn(ac,g,freq){
    // Electric zap — descending noise burst
    const buf=ac.createBuffer(1,ac.sampleRate*0.05,ac.sampleRate);
    const d=buf.getChannelData(0);
    for(let i=0;i<d.length;i++) d[i]=(Math.random()*2-1)*Math.exp(-i/400);
    const src=ac.createBufferSource(); src.buffer=buf;
    const osc=ac.createOscillator(); osc.type='sawtooth';
    osc.frequency.setValueAtTime((freq||1800),ac.currentTime);
    osc.frequency.exponentialRampToValueAtTime(80,ac.currentTime+0.05);
    const og=ac.createGain(); og.gain.setValueAtTime(0.25,ac.currentTime); og.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+0.05);
    const hp=ac.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=1000;
    src.connect(hp); hp.connect(g);
    osc.connect(og); og.connect(g);
    src.start(); src.stop(ac.currentTime+0.05);
    osc.start(); osc.stop(ac.currentTime+0.05);
  }},

  bass_drum: {label:'🔊 Bass Drum', fn(ac,g){
    // Kick drum — punchy low thump
    const osc=ac.createOscillator(); osc.type='sine';
    osc.frequency.setValueAtTime(160,ac.currentTime);
    osc.frequency.exponentialRampToValueAtTime(40,ac.currentTime+0.06);
    const og=ac.createGain(); og.gain.setValueAtTime(0.9,ac.currentTime); og.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+0.12);
    const click=ac.createBuffer(1,ac.sampleRate*0.012,ac.sampleRate);
    const cd=click.getChannelData(0);
    for(let i=0;i<cd.length;i++) cd[i]=(Math.random()*2-1)*Math.exp(-i/100);
    const cs=ac.createBufferSource(); cs.buffer=click;
    const cg=ac.createGain(); cg.gain.value=0.5;
    osc.connect(og); og.connect(g);
    cs.connect(cg); cg.connect(g);
    osc.start(); osc.stop(ac.currentTime+0.12);
    cs.start(); cs.stop(ac.currentTime+0.012);
  }},

  hat: {label:'🎩 Hi-Hat', fn(ac,g){
    // Closed hi-hat — short metallic hiss
    const buf=ac.createBuffer(1,ac.sampleRate*0.05,ac.sampleRate);
    const d=buf.getChannelData(0);
    for(let i=0;i<d.length;i++) d[i]=Math.random()*2-1;
    const src=ac.createBufferSource(); src.buffer=buf;
    const hp=ac.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=7000;
    const bp=ac.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=10000; bp.Q.value=0.8;
    const og=ac.createGain(); og.gain.setValueAtTime(0.4,ac.currentTime); og.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+0.05);
    src.connect(hp); hp.connect(bp); bp.connect(og); og.connect(g);
    src.start(); src.stop(ac.currentTime+0.05);
  }},

  flute: {label:'🎵 Flet', fn(ac,g,freq){
    // Breathy flute note — sine + breath noise
    const f=freq||880;
    const osc=ac.createOscillator(); osc.type='sine'; osc.frequency.value=f;
    const og=ac.createGain(); og.gain.setValueAtTime(0,ac.currentTime);
    og.gain.linearRampToValueAtTime(0.3,ac.currentTime+0.02);
    og.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+0.22);
    // breath layer
    const buf=ac.createBuffer(1,ac.sampleRate*0.22,ac.sampleRate);
    const d=buf.getChannelData(0);
    for(let i=0;i<d.length;i++) d[i]=(Math.random()*2-1)*Math.exp(-i/3000)*0.1;
    const src=ac.createBufferSource(); src.buffer=buf;
    const bp=ac.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=f*1.5; bp.Q.value=1.5;
    osc.connect(og); og.connect(g);
    src.connect(bp); bp.connect(g);
    osc.start(); osc.stop(ac.currentTime+0.22);
    src.start(); src.stop(ac.currentTime+0.22);
  }},

  choir: {label:'🎤 Chór', fn(ac,g,freq){
    // Warm choir vowel — multiple detuned sines + slow attack
    const f=freq||440;
    [f*0.998, f, f*1.002, f*2*0.999, f*2*1.001].forEach((hz,i)=>{
      const osc=ac.createOscillator(); osc.type='sine'; osc.frequency.value=hz;
      const og=ac.createGain();
      og.gain.setValueAtTime(0,ac.currentTime);
      og.gain.linearRampToValueAtTime(0.12/(Math.floor(i/2)+1),ac.currentTime+0.04);
      og.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+0.35);
      osc.connect(og); og.connect(g);
      osc.start(); osc.stop(ac.currentTime+0.35);
    });
  }},

  // ── Nowe unikalne dźwięki ──
  guitar: {label:'🎸 Gitara', fn(ac,g,freq){
    // Karplus-Strong string synthesis
    const f=freq||220;
    const N=Math.round(ac.sampleRate/f);
    const buf=ac.createBuffer(1,ac.sampleRate*1.2,ac.sampleRate);
    const d=buf.getChannelData(0);
    for(let i=0;i<N;i++) d[i]=Math.random()*2-1;
    for(let i=N;i<d.length;i++) d[i]=0.495*(d[i-N]+d[i-N+1]);
    const s=ac.createBufferSource(); s.buffer=buf;
    const eg=ac.createGain(); eg.gain.setValueAtTime(0.9,ac.currentTime); eg.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+1.1);
    s.connect(eg); eg.connect(g); s.start();
  }},

  pingpong: {label:'🏓 Ping Pong', fn(ac,g){
    // bouncy ball — pitched blip with fast pitch drop
    const osc=ac.createOscillator(); osc.type='sine';
    osc.frequency.setValueAtTime(2400,ac.currentTime);
    osc.frequency.exponentialRampToValueAtTime(800,ac.currentTime+0.03);
    const eg=ac.createGain();
    eg.gain.setValueAtTime(0.8,ac.currentTime);
    eg.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+0.04);
    osc.connect(eg); eg.connect(g); osc.start(); osc.stop(ac.currentTime+0.045);
  }},

  djembe: {label:'🪘 Djembe', fn(ac,g){
    // hand drum — two sine layers + slap noise
    const buf=ac.createBuffer(1,ac.sampleRate*0.22,ac.sampleRate);
    const d=buf.getChannelData(0);
    for(let i=0;i<d.length;i++){
      const t=i/ac.sampleRate;
      d[i]=Math.sin(2*Math.PI*200*t)*0.9*Math.exp(-t/0.12)
          +Math.sin(2*Math.PI*320*t)*0.4*Math.exp(-t/0.05)
          +(Math.random()*2-1)*0.5*Math.exp(-t/0.004);
    }
    const bp=ac.createBiquadFilter(); bp.type='peaking'; bp.frequency.value=200; bp.gain.value=6;
    const s=ac.createBufferSource(); s.buffer=buf; s.connect(bp); bp.connect(g); s.start();
  }},

  brass: {label:'🎺 Brass', fn(ac,g,freq){
    // trumpet-like — saw + HP filter + fast attack
    const f=freq||440;
    const osc=ac.createOscillator(); osc.type='sawtooth'; osc.frequency.value=f;
    const hp=ac.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=300;
    const lp=ac.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=3000; lp.Q.value=2;
    const eg=ac.createGain();
    eg.gain.setValueAtTime(0,ac.currentTime);
    eg.gain.linearRampToValueAtTime(0.7,ac.currentTime+0.012);
    eg.gain.setTargetAtTime(0.3,ac.currentTime+0.012,0.03);
    eg.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+0.25);
    osc.connect(hp); hp.connect(lp); lp.connect(eg); eg.connect(g);
    osc.start(); osc.stop(ac.currentTime+0.26);
  }},

  radio: {label:'📻 Radio', fn(ac,g){
    // AM-modulated static burst — old radio key click
    const buf=ac.createBuffer(1,ac.sampleRate*0.04,ac.sampleRate);
    const d=buf.getChannelData(0);
    for(let i=0;i<d.length;i++){
      const t=i/ac.sampleRate;
      const carrier=Math.sin(2*Math.PI*8000*t);
      const am=(1+0.8*Math.sin(2*Math.PI*400*t));
      d[i]=carrier*am*(Math.random()*0.4+0.6)*Math.exp(-t/0.012);
    }
    const bp=ac.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=5000; bp.Q.value=1.5;
    const s=ac.createBufferSource(); s.buffer=buf; s.connect(bp); bp.connect(g); s.start();
  }},

  punch: {label:'🥊 Punch', fn(ac,g){
    // boxing punch — low thump + high crack layered
    const buf=ac.createBuffer(1,ac.sampleRate*0.1,ac.sampleRate);
    const d=buf.getChannelData(0);
    for(let i=0;i<d.length;i++){
      const t=i/ac.sampleRate;
      d[i]=Math.sin(2*Math.PI*80*t)*1.3*Math.exp(-t/0.035)
          +Math.sin(2*Math.PI*3200*t)*0.3*Math.exp(-t/0.004)
          +(Math.random()*2-1)*0.5*Math.exp(-t/0.003);
    }
    const s=ac.createBufferSource(); s.buffer=buf; s.connect(g); s.start();
  }},

  space: {label:'🌙 Space', fn(ac,g,freq){
    // reverby space echo — pitch-modulated sine + long tail
    const f=freq||330;
    const osc=ac.createOscillator(); osc.type='sine'; osc.frequency.value=f;
    const lfo=ac.createOscillator(); lfo.type='sine'; lfo.frequency.value=3.5;
    const lfoG=ac.createGain(); lfoG.gain.value=8;
    lfo.connect(lfoG); lfoG.connect(osc.frequency);
    const delay=ac.createDelay(0.5); delay.delayTime.value=0.18;
    const fb=ac.createGain(); fb.gain.value=0.45;
    const eg=ac.createGain();
    eg.gain.setValueAtTime(0.6,ac.currentTime);
    eg.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+0.7);
    osc.connect(eg); eg.connect(delay); delay.connect(fb); fb.connect(delay); delay.connect(g); eg.connect(g);
    lfo.start(); osc.start(); lfo.stop(ac.currentTime+0.71); osc.stop(ac.currentTime+0.71);
  }},

  dartboard: {label:'🎯 Dart', fn(ac,g){
    // sharp dart impact — very short high transient + woody body
    const buf=ac.createBuffer(1,ac.sampleRate*0.06,ac.sampleRate);
    const d=buf.getChannelData(0);
    for(let i=0;i<d.length;i++){
      const t=i/ac.sampleRate;
      d[i]=(Math.random()*2-1)*1.2*Math.exp(-t/0.002)
          +Math.sin(2*Math.PI*1100*t)*0.5*Math.exp(-t/0.015)
          +Math.sin(2*Math.PI*400*t)*0.4*Math.exp(-t/0.04);
    }
    const s=ac.createBufferSource(); s.buffer=buf; s.connect(g); s.start();
  }},

  frog: {label:'🐸 Żaba', fn(ac,g){
    // froggy ribbit — two fast pitch sweeps
    [0, 0.06].forEach(delay=>{
      const osc=ac.createOscillator(); osc.type='sine';
      osc.frequency.setValueAtTime(900,ac.currentTime+delay);
      osc.frequency.exponentialRampToValueAtTime(200,ac.currentTime+delay+0.05);
      const eg=ac.createGain();
      eg.gain.setValueAtTime(0,ac.currentTime+delay);
      eg.gain.linearRampToValueAtTime(0.65,ac.currentTime+delay+0.005);
      eg.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+delay+0.06);
      osc.connect(eg); eg.connect(g);
      osc.start(ac.currentTime+delay); osc.stop(ac.currentTime+delay+0.07);
    });
  }},

};

const KSZ = 42; // key size px
const KG  = 4;  // gap px

function makeKey(code, label, w, h) {
  const el = document.createElement('div');
  el.className = 'kb-key';
  el.id = 'kbkey-' + code;
  el.dataset.code = code;
  el.style.width  = (w * KSZ + (w - 1) * KG) + 'px';
  el.style.minWidth = el.style.width;
  el.style.height = (h * KSZ + (h - 1) * KG) + 'px';
  el.style.flexShrink = '0';
  // multiline label
  if (label.includes('\n')) {
    el.style.fontSize = '8px';
    el.style.whiteSpace = 'pre';
    el.style.lineHeight = '1.3';
  }
  el.textContent = label;
  return el;
}

function makeGap(w, h) {
  const el = document.createElement('div');
  el.style.width   = (w * KSZ + (w - 1) * KG) + 'px';
  el.style.minWidth = el.style.width;
  el.style.height  = (h * KSZ + (h - 1) * KG) + 'px';
  el.style.flexShrink = '0';
  return el;
}

function buildKbLayout() {
  const container = document.getElementById('kbLayout');
  container.innerHTML = '';

  // wrapper: main | nav | numpad  — all aligned to same row grid
  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'display:flex;gap:16px;align-items:flex-start;overflow-x:auto;';

  /* ── MAIN BLOCK ─────────────────────────────────── */
  const mainDiv = document.createElement('div');
  mainDiv.style.cssText = 'display:flex;flex-direction:column;gap:' + KG + 'px;flex-shrink:0;';

  KB_LAYOUT_MAIN.forEach((row, ri) => {
    const rowDiv = document.createElement('div');
    rowDiv.style.cssText = 'display:flex;gap:' + KG + 'px;';
    if (ri === 0) rowDiv.style.marginBottom = '6px'; // gap below F-row

    row.forEach(k => {
      if (!k.c) { rowDiv.appendChild(makeGap(k.w || 0.5, 1)); return; }
      const w = k.w || 1;
      const el = makeKey(k.c, k.l, w, 1);
      if (k.s) {
        const sh = document.createElement('span');
        sh.className = 'kb-shift-char'; sh.textContent = k.s;
        el.appendChild(sh);
      }
      rowDiv.appendChild(el);
    });
    mainDiv.appendChild(rowDiv);
  });
  wrapper.appendChild(mainDiv);

  /* ── NAV CLUSTER ────────────────────────────────── */
  // Layout (rows aligned with main block rows):
  // row0 (F-row)  : PrtSc ScrLk Pause
  // gap (= F-row bottom margin)
  // row1 (digits) : Ins   Home  PgUp
  // row2 (tab)    : Del   End   PgDn
  // row3 (caps)   : [empty]
  // row4 (shift)  : [empty]  ↑  [empty]
  // row5 (bottom) : ←  ↓  →

  const navDiv = document.createElement('div');
  navDiv.style.cssText = 'display:flex;flex-direction:column;gap:' + KG + 'px;flex-shrink:0;';

  const navRows = [
    // F-row: PrtSc ScrLk Pause
    () => {
      const r = document.createElement('div'); r.style.cssText='display:flex;gap:'+KG+'px;margin-bottom:6px;';
      ['PrintScreen','ScrollLock','Pause'].forEach((c,i)=>{
        r.appendChild(makeKey(c,['PrtSc','ScrLk','Pause'][i],1,1));
      });
      return r;
    },
    // digits row: Ins Home PgUp
    () => { const r=document.createElement('div'); r.style.cssText='display:flex;gap:'+KG+'px;';
      [['Insert','Ins'],['Home','Home'],['PageUp','PgUp']].forEach(([c,l])=>r.appendChild(makeKey(c,l,1,1))); return r; },
    // tab row: Del End PgDn
    () => { const r=document.createElement('div'); r.style.cssText='display:flex;gap:'+KG+'px;';
      [['Delete','Del'],['End','End'],['PageDown','PgDn']].forEach(([c,l])=>r.appendChild(makeKey(c,l,1,1))); return r; },
    // caps row: empty (spacer)
    () => { const r=document.createElement('div'); r.appendChild(makeGap(3,1)); return r; },
    // shift row: [gap] ↑ [gap]
    () => { const r=document.createElement('div'); r.style.cssText='display:flex;gap:'+KG+'px;';
      r.appendChild(makeGap(1,1)); r.appendChild(makeKey('ArrowUp','↑',1,1)); r.appendChild(makeGap(1,1)); return r; },
    // bottom row: ← ↓ →
    () => { const r=document.createElement('div'); r.style.cssText='display:flex;gap:'+KG+'px;';
      [['ArrowLeft','←'],['ArrowDown','↓'],['ArrowRight','→']].forEach(([c,l])=>r.appendChild(makeKey(c,l,1,1))); return r; },
  ];
  navRows.forEach(fn => navDiv.appendChild(fn()));
  wrapper.appendChild(navDiv);

  /* ── NUMPAD ─────────────────────────────────────── */
  // Uses position:relative container with absolute tall keys (+, Enter)
  // Rows aligned with main block (starts at digits row level)
  const npOuter = document.createElement('div');
  npOuter.style.cssText = 'display:flex;flex-direction:column;gap:' + KG + 'px;flex-shrink:0;';

  // Spacer to align numpad top with "digits" row (F-row height + gap + margin)
  const npTopSpacer = document.createElement('div');
  npTopSpacer.style.height = (KSZ + 6 + KG) + 'px'; // matches F-row + margin-bottom
  npOuter.appendChild(npTopSpacer);

  // Row 0: NumLk / * −   (no tall keys)
  const npR0 = document.createElement('div'); npR0.style.cssText='display:flex;gap:'+KG+'px;';
  [['NumLock','NumLk'],['NumpadDivide','/'],['NumpadMultiply','*'],['NumpadSubtract','−']].forEach(([c,l])=>npR0.appendChild(makeKey(c,l,1,1)));
  npOuter.appendChild(npR0);

  // Rows 1–4: use a relative container so tall keys can span rows
  const npGrid = document.createElement('div');
  npGrid.style.cssText = 'position:relative;display:flex;flex-direction:column;gap:'+KG+'px;';

  // Row 1: 7 8 9  (+tall key rendered absolutely)
  const npR1 = document.createElement('div'); npR1.style.cssText='display:flex;gap:'+KG+'px;';
  [['Numpad7','7'],['Numpad8','8'],['Numpad9','9']].forEach(([c,l])=>npR1.appendChild(makeKey(c,l,1,1)));
  npGrid.appendChild(npR1);

  // Row 2: 4 5 6
  const npR2 = document.createElement('div'); npR2.style.cssText='display:flex;gap:'+KG+'px;';
  [['Numpad4','4'],['Numpad5','5'],['Numpad6','6']].forEach(([c,l])=>npR2.appendChild(makeKey(c,l,1,1)));
  npGrid.appendChild(npR2);

  // Row 3: 1 2 3  (NumpadEnter tall key rendered absolutely)
  const npR3 = document.createElement('div'); npR3.style.cssText='display:flex;gap:'+KG+'px;';
  [['Numpad1','1'],['Numpad2','2'],['Numpad3','3']].forEach(([c,l])=>npR3.appendChild(makeKey(c,l,1,1)));
  npGrid.appendChild(npR3);

  // Row 4: 0(wide) .
  const npR4 = document.createElement('div'); npR4.style.cssText='display:flex;gap:'+KG+'px;';
  npR4.appendChild(makeKey('Numpad0','0',2,1));
  npR4.appendChild(makeKey('NumpadDecimal','.',1,1));
  npGrid.appendChild(npR4);

  // Tall keys — absolutely positioned on top of grid
  // + spans rows 1–2: top=0, height = 2*KSZ+KG
  const addKey = makeKey('NumpadAdd','+',1,2);
  addKey.style.position='absolute';
  addKey.style.top = '0px';
  addKey.style.right = '0px';
  npGrid.appendChild(addKey);

  // Enter spans rows 3–4: top = 2*(KSZ+KG)
  const entKey = makeKey('NumpadEnter','Ent',1,2);
  entKey.style.position='absolute';
  entKey.style.top = (2*(KSZ+KG)) + 'px';
  entKey.style.right = '0px';
  npGrid.appendChild(entKey);

  // set grid container height so it doesn't collapse
  npGrid.style.height = (4*KSZ + 3*KG) + 'px';

  npOuter.appendChild(npGrid);
  wrapper.appendChild(npOuter);

  container.appendChild(wrapper);
  buildModStatus();
  updateKbProgress();
}

function buildModStatus() {
  const el = document.getElementById('kbModStatus');
  const mods = [
    {name:'Shift',color:'#f5c400'},{name:'Ctrl',color:'#00b4d8'},
    {name:'Alt',color:'#a78bff'},{name:'Caps',color:'#ff4d6d'},{name:'Meta/Win',color:'#00f5a0'}
  ];
  el.innerHTML = mods.map(m=>`
    <div style="display:flex;align-items:center;gap:8px;">
      <div style="width:8px;height:8px;border-radius:50%;background:${m.color};opacity:0.3;transition:all 0.15s;" id="kbmod-${m.name}"></div>
      <div style="font-family:'Space Mono',monospace;font-size:10px;color:var(--muted);transition:color 0.15s;" id="kbmodlbl-${m.name}">${m.name}</div>
    </div>`).join('');
}

function kbSetMod(name, on) {
  const dot = document.getElementById('kbmod-'+name);
  const lbl = document.getElementById('kbmodlbl-'+name);
  if(dot) { dot.style.opacity=on?'1':'0.3'; dot.style.boxShadow=on?`0 0 8px ${dot.style.background}`:'none'; }
  if(lbl) lbl.style.color=on?'#fff':'var(--muted)';
}

function openKbTest() {
  document.getElementById('kbModal').classList.add('show');
  buildKbLayout();
  kbReset();
  document.addEventListener('keydown', kbOnKeyDown);
  document.addEventListener('keyup', kbOnKeyUp);
}

function closeKbTest() {
  document.getElementById('kbModal').classList.remove('show');
  document.removeEventListener('keydown', kbOnKeyDown);
  document.removeEventListener('keyup', kbOnKeyUp);
  clearInterval(kbTimerInterval);
  // disconnect audio to prevent leak (AudioContext stays alive for reuse, just disconnect gain)
  if(kbAudioCtxKb && kbAudioCtxKb._masterGain) {
    try { kbAudioCtxKb._masterGain.disconnect(); } catch(e){}
    kbAudioCtxKb._masterGain = null;
  }
}

function kbToggleTest() {
  kbActive = !kbActive;
  const btn = document.getElementById('kbBtnStart');
  if(kbActive) {
    btn.textContent='⏹ STOP'; btn.classList.add('active');
    if(!kbStartTime) kbStartTime = performance.now();
    kbTimerInterval = setInterval(kbUpdateTimer, 500);
    document.getElementById('kbHint').textContent='🟢 Aktywny — naciskaj klawisze!';
  } else {
    btn.textContent='▶ START'; btn.classList.remove('active');
    clearInterval(kbTimerInterval);
    document.getElementById('kbHint').textContent='Pauza — naciśnij START aby kontynuować';
  }
}

function kbReset() {
  kbActive=false; kbTested.clear(); kbPressed.clear();
  kbTotalPresses=0; kbStartTime=null; kbRecentTimes=[];
  clearInterval(kbTimerInterval);
  const btn=document.getElementById('kbBtnStart');
  btn.textContent='▶ START'; btn.classList.remove('active');
  ['kbStatPressed','kbStatTested','kbStatKpm'].forEach(id=>document.getElementById(id).textContent='0');
  document.getElementById('kbStatCoverage').textContent='0%';
  document.getElementById('kbStatTime').textContent='0:00';
  document.getElementById('kbLastKey').textContent='—';
  document.getElementById('kbLastCode').textContent='kod: —';
  document.getElementById('kbLastMods').textContent='';
  document.getElementById('kbLogInner').innerHTML='';
  document.getElementById('kbHint').textContent='Naciśnij START, potem naciskaj klawisze';
  updateKbProgress();
  document.querySelectorAll('.kb-key').forEach(el=>el.classList.remove('pressed','tested'));
}

function kbUpdateTimer() {
  if(!kbStartTime) return;
  const s=Math.floor((performance.now()-kbStartTime)/1000);
  document.getElementById('kbStatTime').textContent=`${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;
  const now=performance.now();
  kbRecentTimes=kbRecentTimes.filter(t=>now-t<10000);
  document.getElementById('kbStatKpm').textContent=Math.round(kbRecentTimes.length*6);
}

// key→musical note map for piano mode
const NOTE_FREQS = {
  KeyQ:261.6,KeyW:293.7,KeyE:329.6,KeyR:349.2,KeyT:392.0,KeyY:440.0,KeyU:493.9,KeyI:523.3,
  KeyA:277.2,KeyS:311.1,KeyD:349.2,KeyF:370.0,KeyG:415.3,KeyH:466.2,KeyJ:493.9,KeyK:554.4,KeyL:587.3,
  KeyZ:233.1,KeyX:246.9,KeyC:261.6,KeyV:293.7,KeyB:311.1,KeyN:349.2,KeyM:392.0,
};

function kbPlayClick(code) {
  if(!kbSoundOn) return;
  try {
    if(!kbAudioCtxKb) {
      kbAudioCtxKb = new AudioContext();
      kbAudioCtxKb._masterGain = kbAudioCtxKb.createGain();
      kbAudioCtxKb._masterGain.gain.value = 1.4;
      kbAudioCtxKb._masterGain.connect(kbAudioCtxKb.destination);
    }
    if(kbAudioCtxKb.state === 'suspended') kbAudioCtxKb.resume();
    const freq = NOTE_FREQS[code] || (300 + Math.random() * 500);
    KB_SOUNDS[kbSoundProfile].fn(kbAudioCtxKb, kbAudioCtxKb._masterGain, freq);
  } catch(e){}
}

function kbSetSound(profile) {
  kbSoundProfile=profile; kbSoundOn=true;
  document.querySelectorAll('.kb-sound-btn').forEach(b=>{
    b.classList.toggle('active', b.dataset.profile===profile);
  });
  document.getElementById('kbBtnSoundOff').classList.remove('active');
  kbPlayClick('KeyA'); // preview
}

function kbSoundOff() {
  kbSoundOn=false;
  document.querySelectorAll('.kb-sound-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('kbBtnSoundOff').classList.add('active');
}

function kbOnKeyDown(e) {
  e.preventDefault();
  if(e.shiftKey!==undefined){kbModsDown.Shift=e.shiftKey;kbSetMod('Shift',e.shiftKey);}
  if(e.ctrlKey!==undefined) {kbModsDown.Ctrl=e.ctrlKey;  kbSetMod('Ctrl',e.ctrlKey);}
  if(e.altKey!==undefined)  {kbModsDown.Alt=e.altKey;    kbSetMod('Alt',e.altKey);}
  if(e.metaKey!==undefined) {kbModsDown.Meta=e.metaKey;  kbSetMod('Meta/Win',e.metaKey);}
  if(e.code==='CapsLock'){kbModsDown.Caps=!kbModsDown.Caps;kbSetMod('Caps',kbModsDown.Caps);}

  const el=document.getElementById('kbkey-'+e.code);
  if(el && !kbPressed.has(e.code)){el.classList.add('pressed');kbPressed.add(e.code);}
  if(!kbActive) return;

  kbTotalPresses++;
  kbRecentTimes.push(performance.now());
  document.getElementById('kbStatPressed').textContent=kbTotalPresses;

  const dk=e.key===' '?'SPACJA':e.key.length===1?e.key.toUpperCase():e.key;
  document.getElementById('kbLastKey').textContent=dk;
  document.getElementById('kbLastCode').textContent=`code: ${e.code}  |  key: "${e.key}"`;
  const mods=[e.ctrlKey&&'Ctrl',e.shiftKey&&'Shift',e.altKey&&'Alt',e.metaKey&&'Win'].filter(Boolean);
  document.getElementById('kbLastMods').textContent=mods.length?'+ '+mods.join(' + '):'';

  const log=document.getElementById('kbLogInner');
  const entry=document.createElement('div');
  entry.className='kb-log-entry';
  entry.innerHTML=`<span class="kle-key">${dk}</span><span class="kle-code">${e.code}</span>`;
  log.insertBefore(entry,log.firstChild);
  if(log.children.length>20)log.removeChild(log.lastChild);

  kbPlayClick(e.code);
}

function kbOnKeyUp(e) {
  kbPressed.delete(e.code);
  if(e.shiftKey!==undefined) kbSetMod('Shift',e.shiftKey);
  if(e.ctrlKey!==undefined)  kbSetMod('Ctrl',e.ctrlKey);
  if(e.altKey!==undefined)   kbSetMod('Alt',e.altKey);
  if(e.metaKey!==undefined)  kbSetMod('Meta/Win',e.metaKey);
  const el=document.getElementById('kbkey-'+e.code);
  if(el){
    el.classList.remove('pressed');
    if(kbActive){el.classList.add('tested');kbTested.add(e.code);document.getElementById('kbStatTested').textContent=kbTested.size;updateKbProgress();}
  }
}

function updateKbProgress() {
  const pct=KB_TOTAL>0?Math.round((kbTested.size/KB_TOTAL)*100):0;
  document.getElementById('kbStatCoverage').textContent=pct+'%';
  document.getElementById('kbProgressBar').style.width=pct+'%';
  document.getElementById('kbProgressTxt').textContent=`${kbTested.size} / ${KB_TOTAL} klawiszy`;
  if(pct===100) document.getElementById('kbHint').textContent='🎉 Wszystkie klawisze przetestowane!';
}

// ─── MIC STUDIO ──────────────────────────────────────
let msAudioCtx = null;
let msSource = null;
let msGainNode = null;
let msEqNodes = [];
let msEffectNodes = [];
let msDestination = null;
let msMonitorNode = null;
let msAnalyser = null;
let msMonitorActive = false;
let msRafId = null;
let msCurrentFx = 'normal';
let msGateThreshold = 0;
let msPitchVal_v = 1.0;
let msGainVal_v = 1.0;
let msStream = null;

const MS_EQ_BANDS = [
  {f:32,label:'32Hz'},{f:64,label:'64Hz'},{f:125,label:'125Hz'},{f:250,label:'250Hz'},
  {f:500,label:'500Hz'},{f:1000,label:'1kHz'},{f:2000,label:'2kHz'},{f:4000,label:'4kHz'},
  {f:8000,label:'8kHz'},{f:16000,label:'16kHz'}
];

const EQ_PRESETS = {
  flat:     [ 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  bass:     [10,10, 8, 4, 0,-2,-2, 0, 0, 0],
  presence: [-2,-2, 0, 2, 3, 5, 6, 5, 3, 1],
  bright:   [ 0, 0, 0, 0, 2, 4, 6, 8,10,10],
  warmth:   [ 4, 6, 5, 3, 0,-2,-4,-4,-5,-6],
  scoop:    [ 4, 3, 0,-4,-6,-6,-4, 0, 3, 4],
  podcast:  [-4,-2, 0, 2, 4, 6, 5, 3, 2, 1],
};

function saveEqToStorage() {
  const vals = MS_EQ_BANDS.map((_,i) => parseFloat(document.getElementById(`eq-${i}`)?.value||0));
  try { localStorage.setItem('studioEq', JSON.stringify(vals)); } catch(e) {}
}

function loadEqFromStorage() {
  try {
    const raw = localStorage.getItem('studioEq');
    if(raw) return JSON.parse(raw);
  } catch(e) {}
  return null;
}

function buildEqUI() {
  const grid = document.getElementById('msEqGrid');
  grid.innerHTML = '';
  const saved = loadEqFromStorage();
  MS_EQ_BANDS.forEach((band, i) => {
    const v = saved ? saved[i] : 0;
    const div = document.createElement('div');
    div.className = 'ms-eq-band';
    div.innerHTML = `
      <div class="eq-val" id="eq-val-${i}">${(v>=0?'+':'')+v}dB</div>
      <input type="range" min="-18" max="18" step="1" value="${v}" id="eq-${i}"
        oninput="setEqBand(${i}, this.value)">
      <label>${band.label}</label>`;
    grid.appendChild(div);
  });
  drawEqCurve();
}

function applyEqPreset(name) {
  const vals = EQ_PRESETS[name] || EQ_PRESETS.flat;
  vals.forEach((v, i) => {
    const slider = document.getElementById(`eq-${i}`);
    if(slider) { slider.value = v; setEqBand(i, v); }
  });
  saveEqToStorage();
  drawEqCurve();
}

function resetEq() { applyEqPreset('flat'); }

function drawEqCurve() {
  const canvas = document.getElementById('msEqCanvas');
  if(!canvas) return;
  canvas.width = canvas.offsetWidth || 640;
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#08080e'; ctx.fillRect(0,0,W,H);

  // grid lines
  ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 1;
  [0.25,0.5,0.75].forEach(y => {
    ctx.beginPath(); ctx.moveTo(0,y*H); ctx.lineTo(W,y*H); ctx.stroke();
  });

  // EQ curve
  const gains = MS_EQ_BANDS.map((_,i) => parseFloat(document.getElementById(`eq-${i}`)?.value||0));
  const grad = ctx.createLinearGradient(0,0,W,0);
  grad.addColorStop(0,'#7b61ff'); grad.addColorStop(0.5,'#f5c400'); grad.addColorStop(1,'#00f5a0');

  ctx.beginPath(); ctx.strokeStyle = grad; ctx.lineWidth = 2.5;
  ctx.shadowBlur = 8; ctx.shadowColor = '#f5c400';
  gains.forEach((g,i) => {
    const x = (i/(gains.length-1))*W;
    const y = H/2 - (g/18)*(H/2-6);
    i===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
  });
  ctx.stroke();
  ctx.shadowBlur = 0;

  // fill under curve
  ctx.lineTo(W,H/2); ctx.lineTo(0,H/2); ctx.closePath();
  ctx.fillStyle = 'rgba(245,196,0,0.07)'; ctx.fill();

  // 0dB line
  ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.lineWidth = 1; ctx.setLineDash([4,4]);
  ctx.beginPath(); ctx.moveTo(0,H/2); ctx.lineTo(W,H/2); ctx.stroke();
  ctx.setLineDash([]);
}

async function openMicStudio() {
  document.getElementById('micStudioModal').classList.add('show');
  buildEqUI();
  await initMsAudio();
  updateMsDeviceInfo();
}

function closeMicStudio() {
  stopMonitor();
  if(msAudioCtx) { msAudioCtx.close(); msAudioCtx = null; }
  if(msStream && msStream !== micStream) { msStream.getTracks().forEach(t=>t.stop()); msStream = null; }
  document.getElementById('micStudioModal').classList.remove('show');
  if(msRafId) { cancelAnimationFrame(msRafId); msRafId = null; }
}

async function initMsAudio() {
  if(msAudioCtx) { msAudioCtx.close(); msAudioCtx = null; }

  try {
    // use existing micStream if available, otherwise request new
    msStream = micStream || await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, sampleRate: 48000 }
    });

    msAudioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
    msSource = msAudioCtx.createMediaStreamSource(msStream);

    // EQ nodes — 10 bands
    const savedEq = loadEqFromStorage();
    msEqNodes = MS_EQ_BANDS.map((band, i) => {
      const f = msAudioCtx.createBiquadFilter();
      f.type = i===0 ? 'lowshelf' : i===MS_EQ_BANDS.length-1 ? 'highshelf' : 'peaking';
      f.frequency.value = band.f;
      f.gain.value = savedEq ? (savedEq[i]||0) : parseFloat(document.getElementById(`eq-${i}`)?.value||0);
      f.Q.value = 1.4;
      return f;
    });

    // Gain node
    msGainNode = msAudioCtx.createGain();
    msGainNode.gain.value = msGainVal_v;

    // Analyser
    msAnalyser = msAudioCtx.createAnalyser();
    msAnalyser.fftSize = 4096;
    msAnalyser.smoothingTimeConstant = 0.8;
    msPeakDbMs = -100;
    msNoiseCalib = [];
    msClipCount_v = 0;
    msTipTimer = 0;

    // chain: source → eq chain → gain → analyser → (monitor destination)
    let node = msSource;
    msEqNodes.forEach(eq => { node.connect(eq); node = eq; });
    node.connect(msGainNode);
    msGainNode.connect(msAnalyser);

    buildEffectChainMs('normal');
    startMsVisualizer();
    updateMsDeviceInfo();
  } catch(e) {
    toast(t('toast_mic_no_access') + e.message, 'error');
  }
}

function buildEffectChainMs(name) {
  msCurrentFx = name;
  if(!msAudioCtx) return;

  // Full teardown — stop oscillators, disconnect everything
  msEffectNodes.forEach(n => {
    try { if(n._osc) n._osc.stop(); } catch(e){}
    try { n.disconnect(); } catch(e){}
  });
  msEffectNodes = [];
  if(msMonitorNode) { try { msMonitorNode.disconnect(); } catch(e){} msMonitorNode = null; }

  const nodes = [];

  if(name === 'robot') {
    // ring modulator — osc modulates gain, NOT feeding back
    const osc = msAudioCtx.createOscillator();
    osc.frequency.value = 80; osc.type = 'sawtooth'; osc.start();
    const ringCarrier = msAudioCtx.createGain();
    ringCarrier.gain.value = 0; // will be modulated
    osc.connect(ringCarrier.gain);
    const mix = msAudioCtx.createGain(); mix.gain.value = 0.6;
    ringCarrier._osc = osc;
    nodes.push(ringCarrier, mix);
  }
  if(name === 'deep') {
    const f = msAudioCtx.createBiquadFilter(); f.type='lowshelf'; f.frequency.value=200; f.gain.value=10;
    const g = msAudioCtx.createGain(); g.gain.value = 0.8;
    nodes.push(f, g);
  }
  if(name === 'chipmunk') {
    const f = msAudioCtx.createBiquadFilter(); f.type='highshelf'; f.frequency.value=2000; f.gain.value=10;
    const g = msAudioCtx.createGain(); g.gain.value = 0.7;
    nodes.push(f, g);
  }
  if(name === 'echo') {
    // echo without feedback into itself — separate wet/dry mixer
    const delay = msAudioCtx.createDelay(1.0); delay.delayTime.value = 0.30;
    const delayGain = msAudioCtx.createGain(); delayGain.gain.value = 0.35; // echo volume capped
    delay.connect(delayGain);
    // delayGain feeds back into delay but NOT into main path gain > 1
    delayGain.connect(delay);
    const limiter = msAudioCtx.createDynamicsCompressor();
    limiter.threshold.value = -6; limiter.knee.value = 3;
    limiter.ratio.value = 20; limiter.attack.value = 0.001; limiter.release.value = 0.1;
    nodes.push(delay, limiter);
  }
  if(name === 'phone') {
    const bp = msAudioCtx.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=1500; bp.Q.value=1.5;
    const hp = msAudioCtx.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=500;
    const g = msAudioCtx.createGain(); g.gain.value = 0.9;
    nodes.push(hp, bp, g);
  }
  if(name === 'radio') {
    const hp = msAudioCtx.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=300;
    const bp = msAudioCtx.createBiquadFilter(); bp.type='lowpass'; bp.frequency.value=3400;
    const dist = msAudioCtx.createWaveShaper();
    const c = new Float32Array(256);
    for(let i=0;i<256;i++){const x=i*2/256-1; c[i]=(Math.PI+80)*x/(Math.PI+80*Math.abs(x));}
    dist.curve = c;
    const g = msAudioCtx.createGain(); g.gain.value = 0.7;
    nodes.push(hp, dist, bp, g);
  }
  if(name === 'stadium') {
    const comp = msAudioCtx.createDynamicsCompressor();
    comp.threshold.value=-12; comp.ratio.value=4; comp.attack.value=0.003; comp.release.value=0.25;
    const delay1 = msAudioCtx.createDelay(1.0); delay1.delayTime.value=0.22;
    const delay2 = msAudioCtx.createDelay(1.0); delay2.delayTime.value=0.44;
    const g1 = msAudioCtx.createGain(); g1.gain.value=0.30;
    const g2 = msAudioCtx.createGain(); g2.gain.value=0.18;
    delay1.connect(g1); delay2.connect(g2);
    nodes.push(comp, delay1, delay2);
  }
  if(name === 'cave') {
    const hp = msAudioCtx.createBiquadFilter(); hp.type='lowpass'; hp.frequency.value=1200;
    const delay = msAudioCtx.createDelay(1.0); delay.delayTime.value=0.50;
    const echoGain = msAudioCtx.createGain(); echoGain.gain.value=0.28; // safe echo level
    delay.connect(echoGain); echoGain.connect(delay); // small loop but capped gain
    const g = msAudioCtx.createGain(); g.gain.value=0.8;
    const comp = msAudioCtx.createDynamicsCompressor();
    comp.threshold.value=-10; comp.ratio.value=8; comp.attack.value=0.001; comp.release.value=0.2;
    nodes.push(hp, delay, comp, g);
  }
  if(name === 'underwater') {
    const lp1 = msAudioCtx.createBiquadFilter(); lp1.type='lowpass'; lp1.frequency.value=500; lp1.Q.value=1.5;
    const lp2 = msAudioCtx.createBiquadFilter(); lp2.type='lowpass'; lp2.frequency.value=700;
    const g = msAudioCtx.createGain(); g.gain.value=0.8;
    nodes.push(lp1, lp2, g);
  }
  if(name === 'megaphone') {
    const hp = msAudioCtx.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=600;
    const lp = msAudioCtx.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=2800;
    const dist = msAudioCtx.createWaveShaper();
    const c = new Float32Array(256);
    for(let i=0;i<256;i++){const x=i*2/256-1; c[i]=(Math.PI+150)*x/(Math.PI+150*Math.abs(x));}
    dist.curve=c;
    const g = msAudioCtx.createGain(); g.gain.value=0.75;
    nodes.push(hp, dist, lp, g);
  }
  if(name === 'whisper') {
    const hp = msAudioCtx.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=1500;
    const hs = msAudioCtx.createBiquadFilter(); hs.type='highshelf'; hs.frequency.value=3500; hs.gain.value=6;
    const g = msAudioCtx.createGain(); g.gain.value=0.55;
    nodes.push(hp, hs, g);
  }
  if(name === 'alien') {
    // proper ring mod: osc modulates gain param
    const osc = msAudioCtx.createOscillator(); osc.frequency.value=180; osc.type='sawtooth'; osc.start();
    const ring = msAudioCtx.createGain(); ring.gain.value=0;
    osc.connect(ring.gain);
    ring._osc = osc;
    const bp = msAudioCtx.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=1800; bp.Q.value=0.8;
    const g = msAudioCtx.createGain(); g.gain.value=0.7;
    nodes.push(ring, bp, g);
  }
  if(name === 'demon') {
    const ls = msAudioCtx.createBiquadFilter(); ls.type='lowshelf'; ls.frequency.value=150; ls.gain.value=12;
    const lp = msAudioCtx.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=1500;
    const dist = msAudioCtx.createWaveShaper();
    const c = new Float32Array(256);
    for(let i=0;i<256;i++){const x=i*2/256-1; c[i]=x<0?-Math.pow(-x,0.7):Math.pow(x,0.7);}
    dist.curve=c;
    const g = msAudioCtx.createGain(); g.gain.value=0.75;
    nodes.push(ls, dist, lp, g);
  }
  if(name === 'tremolo') {
    const osc = msAudioCtx.createOscillator(); osc.frequency.value=6; osc.type='sine'; osc.start();
    const lfoGain = msAudioCtx.createGain(); lfoGain.gain.value=0.45;
    const amp = msAudioCtx.createGain(); amp.gain.value=0.55;
    osc.connect(lfoGain); lfoGain.connect(amp.gain);
    amp._osc = osc;
    nodes.push(amp);
  }
  if(name === 'chorus') {
    const d1 = msAudioCtx.createDelay(0.1); d1.delayTime.value=0.022;
    const d2 = msAudioCtx.createDelay(0.1); d2.delayTime.value=0.034;
    const lfo = msAudioCtx.createOscillator(); lfo.frequency.value=0.9; lfo.start();
    const lfoG = msAudioCtx.createGain(); lfoG.gain.value=0.004;
    lfo.connect(lfoG); lfoG.connect(d1.delayTime); lfoG.connect(d2.delayTime);
    const g = msAudioCtx.createGain(); g.gain.value=0.6;
    d1._osc = lfo;
    nodes.push(d1, d2, g);
  }

  msEffectNodes = nodes;
  if(msMonitorActive) connectMonitor();
}

function connectMonitor() {
  if(!msAudioCtx || !msGainNode || !msAnalyser) return;

  // Teardown output side only (analyser onwards) — keep source→eq→gain intact
  try { msAnalyser.disconnect(); } catch(e){}
  msEffectNodes.forEach(n => { try { n.disconnect(); } catch(e){} });
  if(msMonitorNode) { try { msMonitorNode.disconnect(); } catch(e){} msMonitorNode = null; }

  // Always reconnect gain → analyser (for visualiser)
  msGainNode.connect(msAnalyser);

  // Master output limiter prevents any clipping/feedback
  const limiter = msAudioCtx.createDynamicsCompressor();
  limiter.threshold.value = -3;
  limiter.knee.value = 1;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.05;
  msMonitorNode = limiter;

  // analyser → effects chain → limiter → speakers
  if(msEffectNodes.length > 0) {
    msAnalyser.connect(msEffectNodes[0]);
    for(let i = 1; i < msEffectNodes.length; i++) {
      try { msEffectNodes[i-1].connect(msEffectNodes[i]); } catch(e){}
    }
    msEffectNodes[msEffectNodes.length-1].connect(limiter);
  } else {
    msAnalyser.connect(limiter);
  }
  limiter.connect(msAudioCtx.destination);
}

function disconnectMonitor() {
  try { msAnalyser.disconnect(); } catch(e){}
  msEffectNodes.forEach(n => {
    try { if(n._osc) { n._osc.stop(); } } catch(e){}
    try { n.disconnect(); } catch(e){}
  });
  if(msMonitorNode) { try { msMonitorNode.disconnect(); } catch(e){} msMonitorNode = null; }
  // Restore gain → analyser so visualiser keeps working
  if(msGainNode && msAnalyser) {
    try { msGainNode.connect(msAnalyser); } catch(e){}
  }
}

async function toggleMonitor() {
  if(!msAudioCtx) await initMsAudio();
  // Browser suspends AudioContext until user interaction — resume it
  if(msAudioCtx.state === 'suspended') await msAudioCtx.resume();

  msMonitorActive = !msMonitorActive;
  const btn = document.getElementById('msMonitorBtn');
  if(msMonitorActive) {
    connectMonitor();
    btn.classList.add('active');
    document.getElementById('msMonitorIcon').textContent = '⏹';
    document.getElementById('msMonitorLabel').textContent = 'Wyłącz odsłuch głosu';
  } else {
    disconnectMonitor();
    btn.classList.remove('active');
    document.getElementById('msMonitorIcon').textContent = '▶';
    document.getElementById('msMonitorLabel').textContent = 'Włącz odsłuch głosu';
  }
}

function stopMonitor() {
  msMonitorActive = false;
  disconnectMonitor();
  const btn = document.getElementById('msMonitorBtn');
  if(btn) {
    btn.classList.remove('active');
    document.getElementById('msMonitorIcon').textContent = '▶';
    document.getElementById('msMonitorLabel').textContent = 'Włącz odsłuch głosu';
  }
}

function setEqBand(i, val) {
  const v = parseFloat(val);
  if(msEqNodes[i]) msEqNodes[i].gain.value = v;
  document.getElementById(`eq-val-${i}`).textContent = (v>=0?'+':'')+v+'dB';
  saveEqToStorage();
  drawEqCurve();
}

function setMsGain(val) {
  msGainVal_v = parseFloat(val);
  if(msGainNode) msGainNode.gain.value = msGainVal_v;
  document.getElementById('msGainVal').textContent = msGainVal_v.toFixed(2)+'×';
}

function setMsPitch(val) {
  msPitchVal_v = parseFloat(val);
  document.getElementById('msPitchVal').textContent = msPitchVal_v.toFixed(2)+'×';
  // pitch shift via playback rate is not directly possible in Web Audio
  // approximate via detune on a buffer source — for now update label only, effect applied via deep/chipmunk preset
}

function setMsGate(val) {
  msGateThreshold = parseFloat(val);
  document.getElementById('msGateVal').textContent = val>0 ? `-${val}dB` : 'Wyłącz';
}

function setMsFx(name, btn) {
  document.querySelectorAll('.ms-fx-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  buildEffectChainMs(name);
  if(msMonitorActive) connectMonitor();
}

let msNoiseFloor = -80;
let msNoiseCalib = [];
let msPeakDbMs = -100;
let msClipCount_v = 0;
let msTipTimer = 0;

function startMsVisualizer() {
  if(msRafId) cancelAnimationFrame(msRafId);
  const waveCanvas = document.getElementById('msWaveCanvas');
  const specCanvas = document.getElementById('msSpectrumCanvas');
  const wCtx = waveCanvas.getContext('2d');
  const sCtx = specCanvas ? specCanvas.getContext('2d') : null;
  const timeBuf = new Float32Array(msAnalyser.fftSize);
  const freqBuf = new Uint8Array(msAnalyser.frequencyBinCount);
  const freqFloat = new Float32Array(msAnalyser.frequencyBinCount);

  function draw() {
    msRafId = requestAnimationFrame(draw);
    if(!msAnalyser) return;

    waveCanvas.width = waveCanvas.offsetWidth || 640;
    const W = waveCanvas.width, H = waveCanvas.height;

    msAnalyser.getFloatTimeDomainData(timeBuf);
    msAnalyser.getByteFrequencyData(freqBuf);
    msAnalyser.getFloatFrequencyData(freqFloat);

    // ── RMS & peak ──
    let rms = 0, peak = 0;
    for(let i=0;i<timeBuf.length;i++) { rms+=timeBuf[i]*timeBuf[i]; peak=Math.max(peak,Math.abs(timeBuf[i])); }
    rms = Math.sqrt(rms/timeBuf.length);
    const dbRms  = rms>0 ? 20*Math.log10(rms) : -100;
    const dbPeak = peak>0 ? 20*Math.log10(peak) : -100;
    if(dbPeak > msPeakDbMs) msPeakDbMs = dbPeak;

    // noise floor calibration (quiet moments)
    if(dbRms < -40) { msNoiseCalib.push(dbRms); if(msNoiseCalib.length>60) msNoiseCalib.shift(); }
    if(msNoiseCalib.length>5) msNoiseFloor = msNoiseCalib.reduce((a,b)=>a+b,0)/msNoiseCalib.length;

    const snr = dbRms - msNoiseFloor;
    const gated = msGateThreshold > 0 && dbRms < -msGateThreshold;

    // ── Volume bar & numbers ──
    const pct = Math.min(100,Math.max(0,(dbRms+60)/60*100));
    document.getElementById('msVolBar').style.width = pct+'%';
    document.getElementById('msVolNum').textContent = Math.round(pct)+'%';

    // ── Live stats ──
    document.getElementById('msLiveRms').textContent  = dbRms > -90 ? dbRms.toFixed(1) : '—';
    document.getElementById('msLivePeak').textContent = msPeakDbMs > -90 ? msPeakDbMs.toFixed(1) : '—';

    // dominant frequency
    let maxBin=0, maxVal=0;
    for(let i=1;i<freqFloat.length;i++) if(freqFloat[i]>maxVal){maxVal=freqFloat[i];maxBin=i;}
    const sr = msAudioCtx ? msAudioCtx.sampleRate : 48000;
    const domFreq = Math.round(maxBin * sr / (msAnalyser.fftSize));
    if(dbRms > -50) {
      document.getElementById('msLiveFreq').textContent = domFreq >= 1000 ? (domFreq/1000).toFixed(1)+'k' : domFreq;
      // voice range classification
      const range = domFreq < 100 ? 'Bas' : domFreq < 300 ? 'Baryton' : domFreq < 500 ? 'Tenor' : domFreq < 1000 ? 'Sopran' : 'Jasny';
      document.getElementById('msLiveRange').textContent = range;
    } else {
      document.getElementById('msLiveFreq').textContent = '—';
      document.getElementById('msLiveRange').textContent = '—';
    }

    // SNR & noise bars
    const snrPct = Math.min(100,Math.max(0,(snr/60)*100));
    const noisePct = Math.min(100,Math.max(0,(msNoiseFloor+80)/40*100));
    document.getElementById('msSnrBar').style.width = snrPct+'%';
    document.getElementById('msSnrVal').textContent = snr.toFixed(1)+' dB';
    document.getElementById('msNoiseBar').style.width = noisePct+'%';
    document.getElementById('msNoiseVal').textContent = msNoiseFloor.toFixed(1)+' dB';

    // quality badge
    const qBadge = document.getElementById('msQualBadge');
    const qDesc  = document.getElementById('msQualDesc');
    if(rms < 0.001) {
      qBadge.style.cssText='padding:4px 14px;border-radius:20px;font-family:Space Mono,monospace;font-size:10px;font-weight:700;background:rgba(255,255,255,0.05);color:var(--muted);border:1px solid var(--border);';
      qBadge.textContent='🔇 Cisza'; qDesc.textContent='Brak sygnału';
    } else if(dbPeak > -1) {
      qBadge.style.cssText='padding:4px 14px;border-radius:20px;font-family:Space Mono,monospace;font-size:10px;font-weight:700;background:rgba(255,77,109,0.15);color:#ff4d6d;border:1px solid #ff4d6d;';
      qBadge.textContent='🔴 Przester'; qDesc.textContent='Za głośno — oddal się od mikrofonu';
    } else if(snr > 30) {
      qBadge.style.cssText='padding:4px 14px;border-radius:20px;font-family:Space Mono,monospace;font-size:10px;font-weight:700;background:rgba(0,245,160,0.15);color:var(--accent);border:1px solid var(--accent);';
      qBadge.textContent='✅ Świetny'; qDesc.textContent=`SNR ${snr.toFixed(0)} dB — profesjonalna jakość`;
    } else if(snr > 15) {
      qBadge.style.cssText='padding:4px 14px;border-radius:20px;font-family:Space Mono,monospace;font-size:10px;font-weight:700;background:rgba(0,180,216,0.15);color:#00b4d8;border:1px solid #00b4d8;';
      qBadge.textContent='⚡ Dobry'; qDesc.textContent=`SNR ${snr.toFixed(0)} dB — odpowiedni do nagrania`;
    } else {
      qBadge.style.cssText='padding:4px 14px;border-radius:20px;font-family:Space Mono,monospace;font-size:10px;font-weight:700;background:rgba(245,196,0,0.15);color:#f5c400;border:1px solid #f5c400;';
      qBadge.textContent='⚠️ Słaby'; qDesc.textContent='Dużo szumu tła — spróbuj wzmocnić głos';
    }

    // ── Frequency band breakdown ──
    if(msAudioCtx) {
      const sr = msAudioCtx.sampleRate;
      const binHz = sr / msAnalyser.fftSize;
      const bandRanges = [{lo:20,hi:200},{lo:200,hi:800},{lo:800,hi:3000},{lo:3000,hi:8000},{lo:8000,hi:20000}];
      const bandIds = ['msBandBass','msBandLoMid','msBandMid','msBandHiMid','msBandAir'];
      const bandDbIds = ['msBandBassDb','msBandLoMidDb','msBandMidDb','msBandHiMidDb','msBandAirDb'];

      bandRanges.forEach((r, bi) => {
        const loB = Math.floor(r.lo/binHz), hiB = Math.min(Math.floor(r.hi/binHz), freqFloat.length-1);
        let sum = 0, cnt = 0;
        for(let k=loB;k<=hiB;k++){sum+=freqFloat[k];cnt++;}
        const avg = cnt>0 ? sum/cnt : -100;
        const pct = Math.min(100,Math.max(0,(avg+100)/100*100));
        const el = document.getElementById(bandIds[bi]);
        const dbEl = document.getElementById(bandDbIds[bi]);
        if(el) el.style.height = pct+'%';
        if(dbEl) dbEl.textContent = avg>-90 ? avg.toFixed(0)+'dB' : '—';
      });
    }

    // ── Clip counter ──
    if(dbPeak > -1) {
      msClipCount_v++;
      document.getElementById('msClipCount').textContent = msClipCount_v;
    }

    // ── Dynamic range ──
    const dynRange = msPeakDbMs - msNoiseFloor;
    const drEl = document.getElementById('msDynamicRange');
    if(drEl) drEl.textContent = dynRange > 0 ? dynRange.toFixed(1) : '—';

    // ── Smart tips (update every ~3s) ──
    msTipTimer++;
    if(msTipTimer % 90 === 0) {
      const tips = [];
      if(msClipCount_v > 3)      tips.push('🔴 Przesterowanie! Oddal się od mikrofonu lub zmniejsz głośność wejścia.');
      if(snr < 10)               tips.push('🔇 Bardzo dużo szumu tła. Spróbuj nagrywać w cichszym miejscu lub użyj Bramki szumu.');
      if(snr >= 10 && snr < 20)  tips.push('⚠️ Widoczny szum tła. Zwiększ głośność głosu lub zbliż się do mikrofonu.');
      if(dbRms < -50 && rms>0)   tips.push('📢 Mówisz zbyt cicho. Zbliż się do mikrofonu lub zwiększ wzmocnienie.');
      if(msClipCount_v === 0 && snr > 25 && dbRms > -40) tips.push('✅ Doskonały sygnał! Jakość nagrania jest profesjonalna.');
      if(dynRange > 50)          tips.push('🎚️ Duży zakres dynamiki. Możesz użyć kompresora aby wyrównać głośność.');
      const panel = document.getElementById('msTipsPanel');
      const tipEl = document.getElementById('msTipText');
      if(panel && tipEl && tips.length > 0) {
        panel.style.display = 'block';
        tipEl.textContent = tips[0];
      }
    }
    wCtx.fillStyle='#08080e'; wCtx.fillRect(0,0,W,H);
    wCtx.beginPath();
    wCtx.strokeStyle = gated ? 'rgba(255,77,109,0.5)' : '#f5c400';
    wCtx.lineWidth=2; wCtx.shadowBlur=8; wCtx.shadowColor=gated?'#ff4d6d':'#f5c400';
    const step=Math.ceil(timeBuf.length/W);
    for(let x=0;x<W;x++){
      const v=timeBuf[x*step]||0;
      const y=(1-(v*(gated?0.1:1)+1)/2)*H;
      x===0?wCtx.moveTo(x,y):wCtx.lineTo(x,y);
    }
    wCtx.stroke(); wCtx.shadowBlur=0;
    if(msGateThreshold>0){
      wCtx.strokeStyle='rgba(255,77,109,0.4)'; wCtx.lineWidth=1; wCtx.setLineDash([4,4]);
      wCtx.beginPath(); wCtx.moveTo(0,H*0.5); wCtx.lineTo(W,H*0.5); wCtx.stroke(); wCtx.setLineDash([]);
    }

    // ── Spectrum ──
    if(sCtx && specCanvas) {
      specCanvas.width = specCanvas.offsetWidth || 640;
      const SW=specCanvas.width, SH=specCanvas.height;
      sCtx.fillStyle='#08080e'; sCtx.fillRect(0,0,SW,SH);
      const bars=Math.min(freqBuf.length, 128);
      const bw=SW/bars;
      for(let i=0;i<bars;i++){
        const v=freqBuf[i]/255;
        const bh=v*SH;
        const hue=Math.round(240-v*240);
        sCtx.fillStyle=`hsl(${hue},90%,55%)`;
        sCtx.fillRect(i*bw, SH-bh, bw-1, bh);
      }
    }
  }
  draw();
}

function updateMsDeviceInfo() {
  if(!msStream) return;
  const track = msStream.getAudioTracks()[0];
  if(!track) return;
  const s = track.getSettings();

  document.getElementById('msInfoDevice').innerHTML   = `<strong>Urządzenie</strong><br>${track.label || 'Nieznane'}`;
  document.getElementById('msInfoSample').innerHTML   = `<strong>Próbkowanie</strong><br>${(s.sampleRate||48000).toLocaleString()} Hz`;
  document.getElementById('msInfoChannels').innerHTML = `<strong>Kanały</strong><br>${s.channelCount||1} — ${(s.channelCount||1)>1?'Stereo':'Mono'}`;
  document.getElementById('msInfoLatency').innerHTML  = `<strong>Opóźnienie</strong><br>${s.latency?(s.latency*1000).toFixed(1)+' ms':'~5–20 ms'}`;
  document.getElementById('msInfoEchoCan').innerHTML  = `<strong>Redukcja echa</strong><br>${s.echoCancellation!=null?(s.echoCancellation?'✅ Włączona':'❌ Wyłączona'):'—'}`;
  document.getElementById('msInfoNoiseSup').innerHTML = `<strong>Tłumienie szumów</strong><br>${s.noiseSuppression!=null?(s.noiseSuppression?'✅ Włączone':'❌ Wyłączone'):'—'}`;
  document.getElementById('msInfoAgc').innerHTML      = `<strong>Auto-wzmocnienie</strong><br>${s.autoGainControl!=null?(s.autoGainControl?'✅ Włączone':'❌ Wyłączone'):'—'}`;
  document.getElementById('msInfoBitDepth').innerHTML = `<strong>Głębia bitowa</strong><br>${msAudioCtx ? msAudioCtx.sampleRate >= 44100 ? '32-bit float' : '16-bit' : '—'}`;
}

// ─── NAGRYWANIE ──────────────────────────────────────
let mediaRecorder = null;
let recChunks = [];
let recTimerInterval = null;
let recSeconds = 0;
let recBytesSoFar = 0;
let recFilterRafId = null; // rAF dla nagrywania CSS filtrów na canvas

async function toggleRecording() {
  // Bug fix: obsłuż wszystkie stany (nie tylko 'recording')
  if(mediaRecorder && (mediaRecorder.state === 'recording' || mediaRecorder.state === 'paused')) {
    stopRecording();
  } else if(!mediaRecorder) {
    await startRecording();
  }
  // jeśli mediaRecorder istnieje ale state='inactive' — ignoruj (onstop w toku)
}

async function startRecording() {
  // Bug fix: guard na double-start
  if(mediaRecorder) return;
  if(!cameraStream) { toast(t('toast_cam_first'), 'warn'); return; }
  if(typeof MediaRecorder === 'undefined') { toast(t('toast_video_rec_unsupported'), 'error'); return; }

  // Wybierz źródło wideo do nagrywania:
  // 1. Canvas FX aktywny → nagraj filterCanvas (już ma FX)
  // 2. CSS filter aktywny (bez canvas FX) → nagraj przez offscreen canvas z filtrem
  // 3. Brak filtrów → nagraj surowy cameraStream
  let videoTrack;
  const fxCanvas = document.getElementById('filterCanvas');
  const usingFxCanvas = currentFx !== 'none' && fxCanvas && fxCanvas.style.display !== 'none' && fxCanvas.width > 0;
  const usingCssFilter = !usingFxCanvas && filterStyle && filterStyle !== '';

  if (usingFxCanvas) {
    try {
      const canvasStream = fxCanvas.captureStream(camFps || 30);
      videoTrack = canvasStream.getVideoTracks()[0];
    } catch(e) {
      videoTrack = cameraStream.getVideoTracks()[0];
    }
  } else if (usingCssFilter) {
    // Bug fix BUG 6: CSS filter nie jest przechwytywany z <video> — rysuj na offscreen canvas
    try {
      const vid = document.getElementById('videoEl');
      const offCanvas = document.createElement('canvas');
      offCanvas.width  = vid.videoWidth  || 1280;
      offCanvas.height = vid.videoHeight || 720;
      const offCtx = offCanvas.getContext('2d');
      const cssFilter = buildCombinedFilter(filterStyle);
      // Render loop — rysuj klatki z filtrem CSS na canvas
      const renderFilterFrame = () => {
        if(!mediaRecorder || mediaRecorder.state !== 'recording') return;
        offCtx.filter = cssFilter || 'none';
        offCtx.save();
        offCtx.translate(offCanvas.width, 0);
        offCtx.scale(-1, 1);
        offCtx.drawImage(vid, 0, 0, offCanvas.width, offCanvas.height);
        offCtx.restore();
        recFilterRafId = requestAnimationFrame(renderFilterFrame);
      };
      recFilterRafId = requestAnimationFrame(renderFilterFrame);
      const offStream = offCanvas.captureStream(camFps || 30);
      videoTrack = offStream.getVideoTracks()[0];
    } catch(e) {
      videoTrack = cameraStream.getVideoTracks()[0];
    }
  } else {
    // Brak filtrów: nagraj surowy strumień, ale odbity poziomo (lustro), żeby pasował do podglądu na żywo
    try {
      const vid = document.getElementById('videoEl');
      const offCanvas = document.createElement('canvas');
      offCanvas.width  = vid.videoWidth  || 1280;
      offCanvas.height = vid.videoHeight || 720;
      const offCtx = offCanvas.getContext('2d');
      const renderMirrorFrame = () => {
        if(!mediaRecorder || mediaRecorder.state !== 'recording') return;
        offCtx.save();
        offCtx.translate(offCanvas.width, 0);
        offCtx.scale(-1, 1);
        offCtx.drawImage(vid, 0, 0, offCanvas.width, offCanvas.height);
        offCtx.restore();
        recFilterRafId = requestAnimationFrame(renderMirrorFrame);
      };
      recFilterRafId = requestAnimationFrame(renderMirrorFrame);
      const offStream = offCanvas.captureStream(camFps || 30);
      videoTrack = offStream.getVideoTracks()[0];
    } catch(e) {
      videoTrack = cameraStream.getVideoTracks()[0];
    }
  }

  const tracks = videoTrack ? [videoTrack] : [...cameraStream.getVideoTracks()];
  if(micStream) tracks.push(...micStream.getAudioTracks());
  const combined = new MediaStream(tracks);

  // Pick best supported format
  const mimeType = ['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm','video/mp4']
    .find(m => MediaRecorder.isTypeSupported(m)) || '';

  recChunks = [];
  recBytesSoFar = 0;
  mediaRecorder = new MediaRecorder(combined, mimeType ? {mimeType, videoBitsPerSecond: 4000000} : {});

  mediaRecorder.ondataavailable = e => {
    if(e.data.size > 0) {
      recChunks.push(e.data);
      recBytesSoFar += e.data.size;
      document.getElementById('recSize').textContent = (recBytesSoFar / 1048576).toFixed(1) + ' MB';
    }
  };

  mediaRecorder.onstop = () => {
    if(recFilterRafId) { cancelAnimationFrame(recFilterRafId); recFilterRafId = null; }
    const blob = new Blob(recChunks, {type: mimeType || 'video/webm'});
    const url  = URL.createObjectURL(blob);
    const ext  = mimeType.includes('mp4') ? 'mp4' : 'webm';

    // Pokaż podgląd w aplikacji zamiast od razu pobierać
    const previewWrap = document.getElementById('recPreviewWrap');
    const previewEl   = document.getElementById('recPreviewEl');
    const dlBtn       = document.getElementById('recDownloadBtn');

    // Zwolnij poprzedni URL jeśli istnieje
    if(previewEl && previewEl._blobUrl) URL.revokeObjectURL(previewEl._blobUrl);

    if(previewEl && previewWrap && dlBtn) {
      previewEl._blobUrl   = url;
      previewEl.src        = url;
      previewEl.load();
      dlBtn.href           = url;
      dlBtn.download       = `nagranie_${Date.now()}.${ext}`;
      previewWrap.style.display = 'block';
      // Autoplay podglądu
      previewEl.play().catch(() => {});
    } else {
      // Fallback — stare zachowanie
      const link = document.getElementById('recDownloadLink');
      link.href = url;
      link.download = `nagranie_${Date.now()}.${ext}`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    }
  };

  mediaRecorder.onerror = (e) => {
    toast(t('toast_rec_err') + (e.error?.message || t('toast_unknown')), 'error');
    stopRecording();
  };

  mediaRecorder.start(500);

  // UI — Bug fix: użyj i18n zamiast hardcoded
  recSeconds = 0;
  clearInterval(recTimerInterval);
  document.getElementById('recStatus').style.display = 'block';
  document.getElementById('recFmt').textContent = mimeType.includes('mp4') ? 'MP4' : 'WebM';
  const btn = document.getElementById('btnRec');
  btn.style.borderColor = 'var(--accent2)';
  btn.style.background  = 'rgba(255,77,109,0.12)';
  btn.style.boxShadow   = '0 0 20px rgba(255,77,109,0.25)';
  document.getElementById('recBtnLabel').textContent = t('rec_stop') || 'Zatrzymaj nagrywanie';
  document.getElementById('recTag').style.display = 'flex';

  recTimerInterval = setInterval(() => {
    recSeconds++;
    const m = Math.floor(recSeconds/60), s = recSeconds%60;
    document.getElementById('recTimer').textContent = `${m}:${String(s).padStart(2,'0')}`;
  }, 1000);
}

function stopRecording() {
  if(!mediaRecorder) return;
  if(recFilterRafId) { cancelAnimationFrame(recFilterRafId); recFilterRafId = null; }
  mediaRecorder.stop();
  mediaRecorder = null;
  clearInterval(recTimerInterval);

  document.getElementById('recStatus').style.display = 'none';
  const btn = document.getElementById('btnRec');
  btn.style.borderColor = 'var(--accent2)';
  btn.style.background  = '';
  btn.style.boxShadow   = '';
  document.getElementById('recBtnLabel').textContent = t('record') || 'Nagraj wideo';
  document.getElementById('recTag').style.display = 'none';
}

function recClearPreview() {
  const previewWrap = document.getElementById('recPreviewWrap');
  const previewEl   = document.getElementById('recPreviewEl');
  if(previewEl) {
    previewEl.pause();
    if(previewEl._blobUrl) { URL.revokeObjectURL(previewEl._blobUrl); previewEl._blobUrl = null; }
    previewEl.src = '';
  }
  if(previewWrap) previewWrap.style.display = 'none';
}

// ═══════════════════════════════════════════════════════════════
// i18n — System tłumaczeń
// ═══════════════════════════════════════════════════════════════
window.currentLang = 'pl';
let currentLang = window.currentLang;

const I18N = {
  pl: {
    // Loading
    ld_init: 'INICJALIZACJA...',
    ld_modules: 'ŁADOWANIE MODUŁÓW...',
    ld_camera: 'SPRAWDZANIE KAMERY...',
    ld_ready: 'GOTOWE!',
    // Header badge
    badge: 'PL',
    btn_network_scanner: 'Network Scanner',
    btn_chroma_key: 'Chroma Key',
    btn_dns_lookup: 'Wyszukiwarka DNS',
    btn_ai_asystent: 'AI Asystent',
    btn_fps: 'Test FPS',
    // Toolbar
    camera: 'Kamera',
    microphone: 'Mikrofon',
    mic_test: 'Test mikrofonu',
    mic_studio: 'Studio mikrofonu',
    net_test: 'Test internetu',
    kb_test: 'Test klawiatury',
    quality: 'Jakość:',
    fps_label: 'FPS:',
    // Quick tools
    mouse_test: 'Test myszy',
    sys_info: 'Info system',
    display: 'Wyświetlacz',
    wifi: 'WiFi',
    perf: 'Monitor wydajności', net_press_start: 'Naciśnij START', net_start_btn: '▶ START', net_testing: '⏳ Testowanie...', net_retest: '↺ TESTUJ PONOWNIE', net_score_great: '🏆 Doskonałe', net_phase_ping: '📡 Ping — 10 sek.', net_phase_down: '⬇️ Pobieranie — 25 sek.', net_phase_up: '⬆️ Wysyłanie — 25 sek.', net_phase_done: '✅ Test zakończony', net_unit_dl: 'Mb/s', net_rate_ok: '✅ OK', net_rate_weak: '❌ Za słabe', net_rate_great: '✅ Świetnie', net_rate_ok2: '⚡ Ujdzie', net_rate_lag: '❌ Lag', net_rate_smooth: '✅ Płynnie', net_rate_possible: '⚡ Możliwe', net_rate_buf: '❌ Buforuje', net_rate_fast: '✅ Szybko', net_rate_normal: '⚡ Normalnie', net_rate_slow: '❌ Wolno', net_score_good: '✅ Dobre', net_score_avg: '⚡ Przeciętne', net_score_poor: '❌ Słabe',
    speakers: 'Test głośników',
    // Sidebar
    voice_effects: 'Efekty głosu',
    normal: 'Normalny',
    robot: 'Robot',
    deep: 'Głęboki',
    squirrel: 'Wiewiórka',
    echo: 'Echo',
    phone: 'Telefon',
    pitch: 'Wysokość głosu',
    rate: 'Szybkość mówienia',
    // Filters
    css_filters: 'Filtry CSS',
    reset: 'Reset',
    brightness: 'Jasność',
    contrast: 'Kontrast',
    saturation: 'Nasycenie',
    hue: 'Obrót barw',
    blur: 'Rozmycie',
    // Special effects
    special_fx: 'Efekty specjalne',
    // Recording
    record: 'Nagraj wideo', rec_stop: 'Zatrzymaj nagrywanie', rec_download: 'Pobierz', rec_tag: 'NAGRYWANIE',
    snapshot: 'Zdjęcie',
    // Net test
    start: 'START',
    stop: 'STOP',
    testing: 'Testowanie...',
    retest: '↺ TESTUJ PONOWNIE',
    ping_phase: '📡 Ping — 10 sek.',
    dl_phase: '⬇️ Pobieranie — 25 sek.',
    ul_phase: '⬆️ Wysyłanie — 25 sek.',
    done_phase: '✅ Test zakończony',
    net_open: 'Panel otwarty — naciśnij START',
    offline: '❌ Urządzenie jest offline — sprawdź połączenie',
    // Mouse test
    clicks: 'KLIKNIĘCIA',
    cps: 'CPS',
    max_cps: 'MAX CPS',
    speed: 'PRĘDKOŚĆ',
    jitter: 'JITTER',
    distance: 'DYSTANS',
    position: 'POZYCJA',
    trail_on: 'Wł',
    trail_off: 'Wył',
    trail: 'Ślad:',
    move_tab: '🕹️ RUCH',
    heat_tab: '🔥 HEATMAPA',
    cel_tab: '🎯 CEL SHOOTING',
    heat_hint: 'HEATMAPA KLIKNIĘĆ — klikaj po polu żeby zobaczyć wzorzec',
    heat_clicks: 'Kliknięć: ',
    cel_hits: 'TRAFIENIA',
    cel_miss: 'CHYBIENIA',
    cel_acc: 'CELNOŚĆ',
    cel_avg: 'AVG CZAS',
    cel_score: 'WYNIK',
    cel_start: '▶ START',
    cel_stop: '■ STOP',
    cel_press_start: 'Naciśnij START żeby zacząć',
    cel_playing: 'Klikaj w tarcze!',
    time_label: 'CZAS:',
    time_left: 'Czas: ',
  
    cam_off: '— (wyłączona)',
    voice_fx: 'Efekty głosu',
    deep_voice: 'Głęboki',
    squirrel_v: 'Wiewiórka',
    pitch_lbl: 'Wysokość głosu',
    rate_lbl: 'Szybkość mówienia',
    brightness: 'Jasność',
    contrast: 'Kontrast',
    saturation: 'Nasycenie',
    hue_rot: 'Obrót barw',
    blur_lbl: 'Rozmycie',
    snapshot_btn: 'Zrób zdjęcie',
    cam_start_hint: 'Uruchom kamerę, aby zacząć', cam_on: 'Kamera ON', cam_off: 'Kamera OFF',
    fp_warm: '🌅 Ciepły',
    fp_sunset: '🌇 Zachód',
    fp_moon: '🌙 Księżyc',
    fp_soft: '☁️ Miękki',
    fx_snow: '❄️ Śnieg',
    fx_fire: '🔥 Ogień',
    fx_blur: '💫 Blur tło',
    fx_shake: '📳 Trzęsienie',
    fx_off: '✖ Wyłącz',
    fx_bubbles: '🫧 Bąbelki',
    fx_spring: '🌀 Sprężyna',
    spk_ch_test: '📢 TEST KANAŁÓW L/R',
    spk_center: 'Środek (C)',
    spk_click_hint: 'Kliknij kanał aby przetestować',
    spk_sweep: '📈 SWEEP CZĘSTOTLIWOŚCI',
    spk_freq: 'CZĘSTOTLIWOŚĆ',
    spk_channel: 'KANAŁ',
    spk_progress: 'POSTĘP',
    spk_both: '▶ Oba kanały',
    spk_tone_gen: '🎵 GENERATOR TONÓW',
    spk_own_freq: 'Własna freq:',
    spk_saw: 'Piła',
    spk_triangle: 'Trójkąt',
    spk_hearing: '👂 TEST SŁUCHU — zakres słyszalnych częstotliwości',
    spk_hear_hint: 'Kliknij przycisk, naciśnij ✓ jeśli słyszysz ton, ✗ jeśli nie',
    spk_hear_start: '▶ Uruchom test słuchu',
    spk_vol_lbl: '🔉 GŁOŚNOŚĆ:',
    mic_start_hint: 'Uruchom mikrofon aby rozpocząć test',
    mic_wait: 'Czekam na dźwięk...',
    mic_osc: 'Oscyloskop — kształt fali',
    mic_spectrum: 'Spektrum częstotliwości',
    mic_spk_lbl: 'Głośników',
    mic_voice_lbl: '🎙️ Głos',
    mic_vol_lbl: 'POZIOM GŁOSU',
    mic_freq_dom: 'DOMINUJĄCA FREQ.',
    mic_snr: 'SNR (stosunek sygnał/szum)',
    mic_noise: 'SZUM TŁA',
    mic_speak_t: 'CZAS MÓWIENIA',
    mic_noise_lbl: 'Szum tła',
    mic_reduction: 'Tłumienie szumów',
    mic_gate: 'Wyłącz',
    mic_too_loud: 'Za głośno',
    mic_monitor: 'Włącz odsłuch głosu',
    mic_samples: 'Próbkowanie',
    mic_channels: 'Kanały',
    mic_bitdepth: 'Głębia bitowa',
    mic_range: 'PASMO GŁOSU',
    mic_spec_lbl: 'SPEKTRUM CZĘSTOTLIWOŚCI',
    mic_qual_lbl: 'JAKOŚĆ SYGNAŁU',
    mic_high_avg: 'WYŻ-ŚR',
    mic_low_avg: 'NIŻ-ŚR',
    mic_kb_sound: 'DŹWIĘK KLAWISZY',
    pm_title: 'Wydajności',
    pm_ram_use: 'RAM UŻYCIE',
    pm_heap: '🧠 ZUŻYCIE JS HEAP (ostatnie 120 próbek)',
    pm_uptime: 'CZAS DZIAŁANIA',
    pm_res: 'ROZDZIELCZOŚĆ',
    pm_long_tasks: 'długich zadań (>50ms) — przeglądarka może się zacinać',
    pm_avg: 'ŚREDNIA',
    pm_transfer: '📦 ZUŻYCIE TRANSFERU',
    pm_total: 'ŁĄCZNIE',
    pm_refresh: '↺ Odśwież',
    pm_js_perf: '⚡ WYDAJNOŚĆ JAVASCRIPT',
    pm_fps_avg: 'śr. — fps',
    si_threads: 'wątki logiczne',
    si_res: 'rozdzielczość',
    si_batt_load: 'Ładowanie informacji...',
    si_lang: '🌍 JĘZYK / STREFA',
    si_browser: '🌐 PRZEGLĄDARKA',
    si_memory: 'PAMIĘĆ RAM',
    si_gb: 'GB (wg przeglądarki)',
    wifi_title: 'Urządzenia w sieci WiFi',
    wifi_limit: 'Ograniczenie przeglądarki:',
    wifi_my_dev: '📱 TWOJE URZĄDZENIE W SIECI',
    wifi_type: 'TYP POŁĄCZENIA',
    wifi_dl_spd: 'PRĘDKOŚĆ POBIERANIA',
    wifi_rtt: 'OPÓŹNIENIE RTT',
    wifi_protocol: 'PROTOKÓŁ',
    wifi_ua: 'USER AGENT (skrót)',
    wifi_webrtc: 'WebRTC może ujawnić lokalne adresy IP (nawet przez VPN):',
    wifi_gateway: 'BRAMA DOMYŚLNA (typowa)',
    wifi_refresh: '↺ Odśwież',
    wifi_gps: 'WSPÓŁRZĘDNE GPS',
    wifi_speed_decl: 'DEKLAROWANA PRĘDKOŚĆ',
    wifi_rtt_api: 'RTT (OPÓŹNIENIE API)',
    wifi_std: 'STANDARD / PROTOKÓŁ',
    net_start_lbl: 'Naciśnij START',
    net_spd_live: '📊 Prędkość live',
    mouse_move_hint: 'Ruszaj myszą po polu',
    mouse_btn_test: 'TEST PRZYCISKÓW',
    mouse_scroll: 'Ślad:',
    mouse_mid: 'Środkowy',
    dt_pattern: 'WZÓR',
    dt_solid: '⬛ Pełny',
    dt_crosshair: '✛ Krzyżyk',
    dt_brightness: 'JASNOŚĆ',
    dt_nav: '🖱 Najedź aby zobaczyć panel • ESC = zamknij • strzałki = zmiana koloru',
    kb_press_hint: 'Naciśnij START, potem naciskaj klawisze',
    kb_pressed: 'WCIŚNIĘTE',
    kb_delay: 'Opóźnienie',
    kb_sound_off: '🔇 Wył',
    ms_pitch: '🎵 Wysokość tonu',
    ms_deep: '👹 Głęboki',
    ms_chipmunk: '🐿️ Wiewiórka',
    ms_underwater: '🌊 Pod wodą',
    ms_chorus: '👥 Chór',
    ms_drum: '🥁 Bęben',
    clear: '↺ Wyczyść',
    perf_prog: 'Postęp testu',
    wifi_net_dev: '📡 Urządzenia w sieci',
    touch_label: '📱 DOTYK / WSKAŹNIKI',
    dev_label: 'Urządzenie',
    connect_lbl: '🔌 Połączenie',
    middle_lbl: 'ŚRODEK',
    avg_lbl: 'Średnia',
    vol_output: '🔊 Głośność wyjścia',
    net_connect: '🔌 POŁĄCZENIE',
    spd_lbl: 'PRĘDKOŚĆ',
    many_lbl: 'dużo',
    few_lbl: 'mało',
    avg_val: 'średnio',
    pm_files: 'plików',
    wifi_all_hint: 'Aby zobaczyć wszystkie urządzenia w sieci - użyj aplikacji',
    wifi_local_ip: 'IP LOKALNE (LAN)',
    wifi_public_ip: 'IP PUBLICZNE (WAN)',
    wifi_hostname: 'NAZWA HOSTA',
    wifi_mask: 'MASKA PODSIECI (typowa)',
    wifi_class: 'KLASA SIECI',
    wifi_private_range: 'ZAKRES PRYWATNY',
    wifi_webrtc_hdr: '🔍 LOKALNE IP PRZEZ WebRTC',
    wifi_net_info: '🌐 INFORMACJE O SIECI',
    wifi_timezone: 'STREFA CZASOWA',
    wifi_isp: 'DOSTAWCA INTERNETU (ISP)',
    wifi_org: 'ORGANIZACJA / AS',
    wifi_asn: 'NUMER AS (ASN)',
    wifi_vpn: 'VPN / PROXY / TOR',
    wifi_test_time: 'CZAS TESTU',
    wifi_isp_hdr: '📶 Dostawca WiFi / ISP',
    wifi_detecting: 'Wykrywanie przez WebRTC...',
    wifi_unavail: '❌ Niedostępne (VPN blokuje?)',
    wifi_detecting2: 'Wykrywanie...',
    react_btn: 'Test reakcji', vr_btn: 'Zmieniacze głosu', vr_click_rec: 'Kliknij aby nagrywać', vr_click_play: 'Nagrano — kliknij ▶ aby odtworzyć', vr_presets: 'PRESET GŁOSU', vr_pitch: '🎵 Ton', vr_speed: '⚡ Tempo', vr_bass: '🔉 Bas', vr_treble: '🔈 Sopran',
    rt_wait: 'Kliknij, aby zacząć',
    rt_wait_green: 'Czekaj na zielony sygnał…',
    rt_click_now: 'KLIKNIJ TERAZ!',
    rt_early: 'Za wcześnie! Poczekaj na zielony',
    rt_again: 'Kliknij, aby spróbować ponownie',
    rt_last: 'OSTATNI',
    rt_best: 'NAJLEPSZY',
    rt_avg: 'ŚREDNIA',
    rt_tries: 'PRÓB',
    rt_hist: 'HISTOGRAM WYNIKÓW (ms)',
    rt_reset: '↺ RESETUJ WYNIKI',
    rt_streak_lbl: 'SERIA PONIŻEJ ŚREDNIEJ',
    rt_streak_cur: ' w trakcie',
    rt_streak_best_lbl: 'maks',
    rt_rank_title: 'TWOJA OCENA',
    rt_avg_label: 'Średnia',
    rt_progress: 'POSTĘP PRÓB',
    rt_chart_empty: 'Brak danych — zrób kilka prób',
    rt_attempt: 'Próba 1',
    toast_fps_err: 'Nie można zmienić FPS: ',
    toast_res_err: 'Nie można zmienić rozdzielczości: ',
    toast_cam_unsupported: 'Przeglądarka nie obsługuje kamery lub strona nie jest na HTTPS',
    toast_cam_res_warn: '📷 Kamera: %W%×%H% (prosiłeś o %RW%×%RH% — nieobsługiwana)',
    toast_cam_no_access: 'Brak dostępu do kamery: ',
    toast_mic_unsupported: 'Przeglądarka nie obsługuje mikrofonu lub strona nie jest na HTTPS',
    toast_mic_no_access: 'Brak dostępu do mikrofonu: ',
    toast_cam_first: 'Najpierw uruchom kamerę! 📷',
    toast_no_internet: 'Brak połączenia z internetem!',
    toast_speed_err: 'Błąd testu prędkości: ',
    toast_unknown: 'nieznany',
    toast_tts_on: 'TTS włączone 🔊',
    toast_tts_off: 'TTS wyłączone',
    toast_no_uk_voice: 'Brak głosu uk-UA w tej przeglądarce. Użyj Chrome lub Edge.',
    toast_no_fps_data: 'Brak danych — najpierw uruchom test FPS',
    toast_fps_csv_downloaded: 'Pobrano fps_data.csv',
    toast_report_downloaded: 'Raport pobrany!',
    toast_copied: 'Skopiowano!',
    toast_copy_err: 'Błąd kopiowania',
    toast_decode_err: 'Nie można zdekodować nagrania: ',
    toast_no_recording: 'Brak nagrania',
    toast_downloaded_fx: 'Pobrano z efektami ✅',
    toast_downloaded_orig_err: 'Pobrano oryginał (błąd renderowania)',
    toast_record_voice_first: 'Najpierw nagraj głos',
    toast_video_rec_unsupported: 'Przeglądarka nie obsługuje nagrywania wideo',
    toast_rec_err: 'Błąd nagrywania: ',
    toast_csp_header_copied: 'Skopiowano nagłówek CSP',
    toast_headers_copied: 'Skopiowano plik _headers dla Netlify',
    toast_err_generic: 'Błąd',
  },
  en: {
    ld_init: 'INITIALIZING...', ld_modules: 'LOADING MODULES...', ld_camera: 'CHECKING CAMERA...', ld_ready: 'READY!',
    badge: 'EN',
    btn_network_scanner: 'Network Scanner',
    btn_chroma_key: 'Chroma Key',
    btn_dns_lookup: 'DNS Lookup',
    btn_ai_asystent: 'AI Assistant',
    btn_fps: 'FPS Test', camera: 'Camera', microphone: 'Microphone', mic_test: 'Mic test', mic_studio: 'Studio mic',
    net_test: 'Internet test', kb_test: 'Keyboard test', quality: 'Quality:', fps_label: 'FPS:',
    mouse_test: 'Mouse test', sys_info: 'System info', display: 'Display', wifi: 'WiFi',
    perf: 'Performance', net_press_start: 'Press START', net_start_btn: '▶ START', net_testing: '⏳ Testing...', net_retest: '↺ TEST AGAIN', net_score_great: '🏆 Excellent', net_phase_ping: '📡 Ping — 10 sec.', net_phase_down: '⬇️ Download — 25 sec.', net_phase_up: '⬆️ Upload — 25 sec.', net_phase_done: '✅ Test complete', net_unit_dl: 'Mb/s', net_rate_ok: '✅ OK', net_rate_weak: '❌ Too slow', net_rate_great: '✅ Great', net_rate_ok2: '⚡ Acceptable', net_rate_lag: '❌ Lag', net_rate_smooth: '✅ Smooth', net_rate_possible: '⚡ Possible', net_rate_buf: '❌ Buffering', net_rate_fast: '✅ Fast', net_rate_normal: '⚡ Normal', net_rate_slow: '❌ Slow', net_score_good: '✅ Good', net_score_avg: '⚡ Average', net_score_poor: '❌ Poor', speakers: 'Speaker test', voice_effects: 'Voice effects',
    normal: 'Normal', robot: 'Robot', deep: 'Deep', squirrel: 'Squirrel', echo: 'Echo', phone: 'Phone',
    pitch: 'Pitch', rate: 'Speech rate', css_filters: 'CSS Filters', reset: 'Reset',
    brightness: 'Brightness', contrast: 'Contrast', saturation: 'Saturation', hue: 'Hue rotate', blur: 'Blur',
    special_fx: 'Special effects', record: 'Record video', rec_stop: 'Stop recording', rec_download: 'Download', rec_tag: 'RECORDING', snapshot: 'Snapshot',
    start: 'START', stop: 'STOP', testing: 'Testing...', retest: '↺ TEST AGAIN',
    ping_phase: '📡 Ping — 10 sec.', dl_phase: '⬇️ Download — 25 sec.', ul_phase: '⬆️ Upload — 25 sec.',
    done_phase: '✅ Test complete', net_open: 'Panel open — press START', offline: '❌ Device offline — check connection',
    clicks: 'CLICKS', cps: 'CPS', max_cps: 'MAX CPS', speed: 'SPEED', jitter: 'JITTER',
    distance: 'DISTANCE', position: 'POSITION', trail_on: 'On', trail_off: 'Off', trail: 'Trail:',
    move_tab: '🕹️ MOVE', heat_tab: '🔥 HEATMAP', cel_tab: '🎯 CEL SHOOTING',
    heat_hint: 'CLICK HEATMAP — click the area to see your pattern', heat_clicks: 'Clicks: ',
    cel_hits: 'HITS', cel_miss: 'MISSES', cel_acc: 'ACCURACY', cel_avg: 'AVG TIME', cel_score: 'SCORE',
    cel_start: '▶ START', cel_stop: '◼ STOP', cel_press_start: 'Press START to begin',
    cel_playing: 'Click the targets!', time_label: 'TIME:', time_left: 'Time: ',
    cam_off: '— (off)', voice_fx: 'Voice effects', deep_voice: 'Deep', squirrel_v: 'Squirrel',
    pitch_lbl: 'Pitch', rate_lbl: 'Speech rate', hue_rot: 'Hue rotate', blur_lbl: 'Blur',
    snapshot_btn: 'Take photo', cam_start_hint: 'Start camera to begin', cam_on: 'Camera ON', cam_off: 'Camera OFF',
    fp_warm: '🌅 Warm', fp_sunset: '🌇 Sunset', fp_moon: '🌙 Moon', fp_soft: '☁️ Soft',
    fx_snow: '❄️ Snow', fx_fire: '🔥 Fire', fx_blur: '💫 Blur bg', fx_shake: '📳 Shake', fx_off: '✖ Off',
    fx_bubbles: '🫧 Bubbles', fx_spring: '🌀 Spring',
    spk_ch_test: '📢 CHANNEL L/R TEST', spk_center: 'Center (C)', spk_click_hint: 'Click channel to test',
    spk_sweep: '📈 FREQUENCY SWEEP', spk_freq: 'FREQUENCY', spk_channel: 'CHANNEL', spk_progress: 'PROGRESS',
    spk_both: '▶ Both channels', spk_tone_gen: '🎵 TONE GENERATOR', spk_own_freq: 'Custom freq:',
    spk_saw: 'Saw', spk_triangle: 'Triangle', spk_hearing: '👂 HEARING TEST — audible frequency range',
    spk_hear_hint: 'Click button, press ✓ if you hear tone, ✗ if not',
    spk_hear_start: '▶ Start hearing test', spk_vol_lbl: '🔉 VOLUME:',
    mic_start_hint: 'Start microphone to begin test', mic_wait: 'Waiting for sound...',
    mic_osc: 'Oscilloscope — waveform', mic_spectrum: 'Frequency spectrum',
    mic_spk_lbl: '🔊 Output volume', mic_voice_lbl: '🎙️ Voice', mic_vol_lbl: 'VOICE LEVEL',
    mic_freq_dom: 'DOMINANT FREQ.', mic_snr: 'SNR (signal/noise ratio)', mic_noise: 'Background noise',
    mic_speak_t: 'SPEAKING TIME', mic_noise_lbl: 'BACKGROUND NOISE', mic_reduction: 'Noise reduction',
    mic_gate: 'Noise gate', mic_too_loud: 'Too loud', mic_monitor: 'Enable voice monitor',
    mic_samples: 'Sample rate', mic_channels: 'Channels', mic_bitdepth: 'Bit depth',
    mic_range: 'VOICE BAND', mic_spec_lbl: 'FREQUENCY SPECTRUM', mic_qual_lbl: 'SIGNAL QUALITY',
    mic_high_avg: 'HI-MID', mic_low_avg: 'LO-MID', mic_kb_sound: 'KEY SOUNDS',
    pm_title: 'Performance', pm_ram_use: 'RAM USAGE', pm_heap: '🧠 JS HEAP USAGE (last 120 samples)',
    pm_uptime: 'UPTIME', pm_res: 'RESOLUTION', pm_long_tasks: 'long tasks (>50ms) — browser may stutter',
    pm_avg: 'AVG', pm_transfer: '📦 TRANSFER USAGE', pm_total: 'TOTAL', pm_refresh: '↺ Refresh',
    pm_js_perf: '⚡ JAVASCRIPT PERFORMANCE', pm_fps_avg: 'avg — fps',
    si_threads: 'logical threads', si_res: 'resolution', si_batt_load: 'Loading info...',
    si_lang: '🌍 LANGUAGE / TIMEZONE', si_browser: '🌐 BROWSER', si_memory: 'RAM MEMORY',
    si_gb: 'GB (per browser)', wifi_title: 'WiFi Network Devices', wifi_limit: 'Browser limitation:',
    wifi_my_dev: '📱 YOUR DEVICE ON NETWORK', wifi_type: 'CONNECTION TYPE', wifi_dl_spd: 'DOWNLOAD SPEED',
    wifi_rtt: 'RTT LATENCY', wifi_protocol: 'PROTOCOL', wifi_ua: 'USER AGENT (short)',
    wifi_webrtc: 'WebRTC may reveal local IPs (even through VPN):',
    wifi_gateway: 'DEFAULT GATEWAY (typical)', wifi_refresh: '↺ Refresh', wifi_gps: 'GPS COORDINATES',
    wifi_speed_decl: 'DECLARED SPEED', wifi_rtt_api: 'RTT (API LATENCY)', wifi_std: 'STANDARD / PROTOCOL',
    net_start_lbl: 'Press START', net_spd_live: '📊 Live speed',
    mouse_move_hint: 'Move mouse over the area', mouse_btn_test: 'BUTTON TEST', mouse_scroll: 'Scroll',
    mouse_mid: 'Middle', dt_pattern: 'PATTERN', dt_solid: '⬛ Solid', dt_crosshair: '✛ Crosshair',
    dt_brightness: 'BRIGHTNESS', dt_nav: '🖱 Hover to see panel • ESC = close • arrows = color change',
    kb_press_hint: 'Press START, then press keys', kb_pressed: 'PRESSED', kb_delay: 'Latency',
    kb_sound_off: 'Off', ms_pitch: '🎵 Pitch', ms_deep: '👹 Deep', ms_chipmunk: '🐿️ Chipmunk',
    ms_underwater: '🌊 Underwater', ms_chorus: '👥 Chorus', ms_drum: '🥁 Drum',
    clear: '↺ Clear', perf_prog: 'Test progress', wifi_net_dev: '📡 Network devices',
    touch_label: '📱 TOUCH / POINTERS', dev_label: 'Device', connect_lbl: '🔌 Connection',
    middle_lbl: 'MIDDLE', avg_lbl: 'Average', vol_output: '🔊 Output volume',
    net_connect: '🔌 CONNECTION', spd_lbl: 'Upload', many_lbl: 'many', few_lbl: 'few', avg_val: 'avg',
    pm_files: 'files', wifi_all_hint: 'To see all network devices - use an app',
    wifi_local_ip: 'LOCAL IP (LAN)', wifi_public_ip: 'PUBLIC IP (WAN)', wifi_hostname: 'HOSTNAME',
    wifi_mask: 'SUBNET MASK (typical)', wifi_class: 'NETWORK CLASS', wifi_private_range: 'PRIVATE RANGE',
    wifi_webrtc_hdr: '🔍 LOCAL IP VIA WebRTC', wifi_net_info: '🌐 NETWORK INFORMATION',
    wifi_timezone: 'TIMEZONE', wifi_isp: 'INTERNET PROVIDER (ISP)', wifi_org: 'ORGANIZATION / AS',
    wifi_asn: 'AS NUMBER (ASN)', wifi_vpn: 'VPN / PROXY / TOR', wifi_test_time: 'TEST TIME',
    wifi_isp_hdr: '📶 WiFi Provider / ISP', wifi_detecting: 'Detecting via WebRTC...',
    wifi_unavail: '❌ Unavailable (VPN blocking?)', wifi_detecting2: 'Detecting...',
    react_btn: 'Reaction test', vr_btn: 'Voice Changer', vr_click_rec: 'Click to record', vr_click_play: 'Recorded — click ▶ to play', vr_presets: 'VOICE PRESET', vr_pitch: '🎵 Pitch', vr_speed: '⚡ Speed', vr_bass: '🔉 Bass', vr_treble: '🔈 Treble', rt_wait: 'Click to start', rt_wait_green: 'Wait for green signal…',
    rt_click_now: 'CLICK NOW!', rt_early: 'Too early! Wait for green', rt_again: 'Click to try again',
    rt_last: 'LAST', rt_best: 'BEST', rt_avg: 'AVERAGE', rt_tries: 'TRIES',
    rt_hist: 'RESULTS HISTOGRAM (ms)', rt_reset: '↺ RESET RESULTS', rt_streak_lbl: 'STREAK BELOW AVERAGE', rt_streak_cur: ' current', rt_streak_best_lbl: 'best', rt_rank_title: 'YOUR RATING', rt_avg_label: 'Average',
    rt_progress: 'PROGRESS OF ATTEMPTS',
    rt_chart_empty: 'No data — make a few attempts',
    rt_attempt: 'Attempt 1',
  },
  de: {
    ld_init: 'INITIALISIERUNG...', ld_modules: 'MODULE LADEN...', ld_camera: 'KAMERA PRÜFEN...', ld_ready: 'BEREIT!',
    badge: 'DE',
    btn_network_scanner: 'Netzwerk-Scanner',
    btn_chroma_key: 'Chroma Key',
    btn_dns_lookup: 'DNS-Suche',
    btn_ai_asystent: 'KI-Assistent',
    btn_fps: 'FPS-Test', camera: 'Kamera', microphone: 'Mikrofon', mic_test: 'Mikrofon-Test', mic_studio: 'Studio-Mikrofon',
    net_test: 'Internet-Test', kb_test: 'Tastatur-Test', quality: 'Qualität:', fps_label: 'FPS:',
    mouse_test: 'Maus-Test', sys_info: 'System-Info', display: 'Anzeige', wifi: 'WLAN',
    perf: 'Leistungsmonitor', net_press_start: 'START drücken', net_start_btn: '▶ START', net_testing: '⏳ Teste...', net_retest: '↺ ERNEUT TESTEN', net_score_great: '🏆 Ausgezeichnet', net_phase_ping: '📡 Ping — 10 Sek.', net_phase_down: '⬇️ Download — 25 Sek.', net_phase_up: '⬆️ Upload — 25 Sek.', net_phase_done: '✅ Test abgeschlossen', net_unit_dl: 'Mb/s', net_rate_ok: '✅ OK', net_rate_weak: '❌ Zu langsam', net_rate_great: '✅ Super', net_rate_ok2: '⚡ Geht so', net_rate_lag: '❌ Lag', net_rate_smooth: '✅ Flüssig', net_rate_possible: '⚡ Möglich', net_rate_buf: '❌ Puffert', net_rate_fast: '✅ Schnell', net_rate_normal: '⚡ Normal', net_rate_slow: '❌ Langsam', net_score_good: '✅ Gut', net_score_avg: '⚡ Durchschnittlich', net_score_poor: '❌ Schlecht', speakers: 'Lautsprecher-Test', voice_effects: 'Stimmeffekte',
    normal: 'Normal', robot: 'Roboter', deep: 'Tief', squirrel: 'Eichhörnchen', echo: 'Echo', phone: 'Telefon',
    pitch: 'Tonhöhe', rate: 'Sprechgeschw.', css_filters: 'CSS-Filter', reset: 'Zurücksetzen',
    brightness: 'Helligkeit', contrast: 'Kontrast', saturation: 'Sättigung', hue: 'Farbton', blur: 'Unschärfe',
    special_fx: 'Spezialeffekte', record: 'Video aufnehmen', rec_stop: 'Aufnahme stoppen', rec_download: 'Herunterladen', rec_tag: 'AUFNAHME', snapshot: 'Schnappschuss',
    start: 'START', stop: 'STOP', testing: 'Teste...', retest: '↺ ERNEUT TESTEN',
    ping_phase: '📡 Ping — 10 Sek.', dl_phase: '⬇️ Download — 25 Sek.', ul_phase: '⬆️ Upload — 25 Sek.',
    done_phase: '✅ Test abgeschlossen', net_open: 'Panel geöffnet — START drücken',
    offline: '❌ Gerät offline — Verbindung prüfen',
    clicks: 'KLICKS', cps: 'KPS', max_cps: 'MAX KPS', speed: 'GESCHW.', jitter: 'JITTER',
    distance: 'DISTANZ', position: 'POSITION', trail_on: 'An', trail_off: 'Aus', trail: 'Spur:',
    move_tab: '🕹️ BEWEGUNG', heat_tab: '🔥 HEATMAP', cel_tab: '🎯 ZIELSCHIESSEN',
    heat_hint: 'KLICK-HEATMAP — klicke um Muster zu sehen', heat_clicks: 'Klicks: ',
    cel_hits: 'TREFFER', cel_miss: 'FEHLSCHÜSSE', cel_acc: 'GENAUIGKEIT', cel_avg: 'Ø ZEIT', cel_score: 'PUNKTE',
    cel_start: '▶ START', cel_stop: '◼ STOP', cel_press_start: 'START drücken',
    cel_playing: 'Ziele anklicken!', time_label: 'ZEIT:', time_left: 'Zeit: ',
    cam_off: '— (aus)', voice_fx: 'Stimmeffekte', deep_voice: 'Tief', squirrel_v: 'Eichhörnchen',
    pitch_lbl: 'Tonhöhe', rate_lbl: 'Sprechgeschw.', hue_rot: 'Farbton', blur_lbl: 'Unschärfe',
    snapshot_btn: 'Foto aufnehmen', cam_start_hint: 'Kamera starten', cam_on: 'Kamera AN', cam_off: 'Kamera AUS',
    fp_warm: '🌅 Warm', fp_sunset: '🌇 Sonnenuntergang', fp_moon: '🌙 Mond', fp_soft: '☁️ Weich',
    fx_snow: '❄️ Schnee', fx_fire: '🔥 Feuer', fx_blur: '💫 Blur bg', fx_shake: '📳 Schütteln', fx_off: '✖ Aus',
    fx_bubbles: '🫧 Blasen', fx_spring: '🌀 Feder',
    spk_ch_test: '📢 KANAL L/R TEST', spk_center: 'Mitte (C)', spk_click_hint: 'Kanal anklicken',
    spk_sweep: '📈 FREQUENZ-SWEEP', spk_freq: 'FREQUENZ', spk_channel: 'KANAL', spk_progress: 'FORTSCHRITT',
    spk_both: '▶ Beide Kanäle', spk_tone_gen: '🎵 TONGENERATOR', spk_own_freq: 'Eigene Freq:',
    spk_saw: 'Säge', spk_triangle: 'Dreieck', spk_hearing: '👂 HÖRTEST — Hörfrequenzbereich',
    spk_hear_hint: 'Taste drücken, ✓ wenn hörbar, ✗ wenn nicht',
    spk_hear_start: '▶ Hörtest starten', spk_vol_lbl: '🔉 LAUTSTÄRKE:',
    mic_start_hint: 'Mikrofon starten', mic_wait: 'Warte auf Ton...',
    mic_osc: 'Oszilloskop — Wellenform', mic_spectrum: 'Frequenzspektrum',
    mic_spk_lbl: '🔊 Ausgangslautstärke', mic_voice_lbl: '🎙️ Stimme', mic_vol_lbl: 'STIMMPEGEL',
    mic_freq_dom: 'DOMINANTE FREQ.', mic_snr: 'SNR (Signal/Rausch)', mic_noise: 'Hintergrundrauschen',
    mic_speak_t: 'SPRECHZEIT', mic_noise_lbl: 'HINTERGRUNDRAUSCHEN', mic_reduction: 'Rauschunterdrückung',
    mic_gate: 'Noise Gate', mic_too_loud: 'Zu laut', mic_monitor: 'Stimmmonitor aktivieren',
    mic_samples: 'Abtastrate', mic_channels: 'Kanäle', mic_bitdepth: 'Bittiefe',
    mic_range: 'STIMMBAND', mic_spec_lbl: 'FREQUENZSPEKTRUM', mic_qual_lbl: 'SIGNALQUALITÄT',
    mic_high_avg: 'HI-MID', mic_low_avg: 'LO-MID', mic_kb_sound: 'TASTENGERÄUSCHE',
    pm_title: 'Leistung', pm_ram_use: 'RAM-NUTZUNG', pm_heap: '🧠 JS-HEAP (letzte 120 Proben)',
    pm_uptime: 'BETRIEBSZEIT', pm_res: 'AUFLÖSUNG', pm_long_tasks: 'lange Tasks (>50ms)',
    pm_avg: 'DURCHSCHN.', pm_transfer: '📦 TRANSFERNUTZUNG', pm_total: 'GESAMT', pm_refresh: '↺ Aktualisieren',
    pm_js_perf: '⚡ JAVASCRIPT-LEISTUNG', pm_fps_avg: 'Ø — fps',
    si_threads: 'logische Threads', si_res: 'Auflösung', si_batt_load: 'Lade Informationen...',
    si_lang: '🌍 SPRACHE / ZEITZONE', si_browser: '🌐 BROWSER', si_memory: 'ARBEITSSPEICHER',
    si_gb: 'GB (laut Browser)', wifi_title: 'WLAN-Netzwerkgeräte', wifi_limit: 'Browser-Einschränkung:',
    wifi_my_dev: '📱 IHR GERÄT IM NETZ', wifi_type: 'VERBINDUNGSTYP', wifi_dl_spd: 'DOWNLOADGESCHW.',
    wifi_rtt: 'RTT-LATENZ', wifi_protocol: 'PROTOKOLL', wifi_ua: 'USER AGENT (kurz)',
    wifi_webrtc: 'WebRTC kann lokale IPs verraten (auch durch VPN):',
    wifi_gateway: 'STANDARDGATEWAY (typisch)', wifi_refresh: '↺ Aktualisieren', wifi_gps: 'GPS-KOORDINATEN',
    wifi_speed_decl: 'DEKLARIERTE GESCHW.', wifi_rtt_api: 'RTT (API-LATENZ)', wifi_std: 'STANDARD / PROTOKOLL',
    net_start_lbl: 'START drücken', net_spd_live: '📊 Live-Geschwindigkeit',
    mouse_move_hint: 'Maus über das Feld bewegen', mouse_btn_test: 'TASTENTEST', mouse_scroll: 'Scrollen',
    mouse_mid: 'Mitte', dt_pattern: 'MUSTER', dt_solid: '⬛ Vollflächig', dt_crosshair: '✛ Fadenkreuz',
    dt_brightness: 'HELLIGKEIT', dt_nav: '🖱 Hover für Panel • ESC = schließen • Pfeile = Farbe',
    kb_press_hint: 'START drücken, dann Tasten drücken', kb_pressed: 'GEDRÜCKT', kb_delay: 'Latenz',
    kb_sound_off: 'Aus', ms_pitch: '🎵 Tonhöhe', ms_deep: '👹 Tief', ms_chipmunk: '🐿️ Chipmunk',
    ms_underwater: '🌊 Unterwasser', ms_chorus: '👥 Chor', ms_drum: '🥁 Trommel',
    clear: '↺ Löschen', perf_prog: 'Testfortschritt', wifi_net_dev: '📡 Netzwerkgeräte',
    touch_label: '📱 TOUCH / ZEIGER', dev_label: 'Gerät', connect_lbl: '🔌 Verbindung',
    middle_lbl: 'MITTE', avg_lbl: 'Durchschnitt', vol_output: '🔊 Ausgangslautstärke',
    net_connect: '🔌 VERBINDUNG', spd_lbl: 'Upload', many_lbl: 'viel', few_lbl: 'wenig', avg_val: 'mittel',
    pm_files: 'Dateien', wifi_all_hint: 'Für alle Netzwerkgeräte eine App verwenden',
    wifi_local_ip: 'LOKALE IP (LAN)', wifi_public_ip: 'ÖFFENTLICHE IP (WAN)', wifi_hostname: 'HOSTNAME',
    wifi_mask: 'SUBNETZMASKE (typisch)', wifi_class: 'NETZWERKKLASSE', wifi_private_range: 'PRIVATER BEREICH',
    wifi_webrtc_hdr: '🔍 LOKALE IP ÜBER WebRTC', wifi_net_info: '🌐 NETZWERKINFORMATIONEN',
    wifi_timezone: 'ZEITZONE', wifi_isp: 'INTERNETANBIETER (ISP)', wifi_org: 'ORGANISATION / AS',
    wifi_asn: 'AS-NUMMER (ASN)', wifi_vpn: 'VPN / PROXY / TOR', wifi_test_time: 'TESTZEIT',
    wifi_isp_hdr: '📶 WLAN-Anbieter / ISP', wifi_detecting: 'Erkennung über WebRTC...',
    wifi_unavail: '❌ Nicht verfügbar (VPN blockiert?)', wifi_detecting2: 'Wird erkannt...',
    react_btn: 'Reaktionstest', vr_btn: 'Stimmveränderer', vr_click_rec: 'Klicken zum Aufnehmen', vr_click_play: 'Aufgenommen — ▶ drücken', vr_presets: 'STIMM-PRESET', vr_pitch: '🎵 Ton', vr_speed: '⚡ Tempo', vr_bass: '🔉 Bass', vr_treble: '🔈 Höhen', rt_wait: 'Klicken zum Starten', rt_wait_green: 'Warte auf grünes Signal…',
    rt_click_now: 'JETZT KLICKEN!', rt_early: 'Zu früh! Auf Grün warten', rt_again: 'Klicken zum Wiederholen',
    rt_last: 'LETZTER', rt_best: 'BESTER', rt_avg: 'DURCHSCHN.', rt_tries: 'VERSUCHE',
    rt_hist: 'ERGEBNIS-HISTOGRAMM (ms)', rt_reset: '↺ ERGEBNISSE ZURÜCKSETZEN', rt_streak_lbl: 'SERIE UNTER DURCHSCHNITT', rt_streak_cur: ' aktuell', rt_streak_best_lbl: 'max', rt_rank_title: 'DEINE BEWERTUNG', rt_avg_label: 'Durchschn.',
    rt_progress: 'VERSUCHSFORTSCHRITT',
    rt_chart_empty: 'Keine Daten — ein paar Versuche machen',
    rt_attempt: 'Versuch 1',
    freq: 'FREQUENZ',
  },
  ru: {
    ld_init: 'ИНИЦИАЛИЗАЦИЯ...', ld_modules: 'ЗАГРУЗКА МОДУЛЕЙ...', ld_camera: 'ПРОВЕРКА КАМЕРЫ...', ld_ready: 'ГОТОВО!',
    badge: 'RU',
    btn_network_scanner: 'Сетевой сканер',
    btn_chroma_key: 'Хромакей',
    btn_dns_lookup: 'DNS-поиск',
    btn_ai_asystent: 'ИИ-ассистент',
    btn_fps: 'Тест FPS', camera: 'Камера', microphone: 'Микрофон', mic_test: 'Тест микрофона', mic_studio: 'Студ. микрофон',
    net_test: 'Тест интернета', kb_test: 'Тест клавиатуры', quality: 'Качество:', fps_label: 'FPS:',
    mouse_test: 'Тест мыши', sys_info: 'Система', display: 'Дисплей', wifi: 'WiFi',
    perf: 'Монитор', net_press_start: 'Нажмите СТАРТ', net_start_btn: '▶ СТАРТ', net_testing: '⏳ Тестирование...', net_retest: '↺ ТЕСТИРОВАТЬ СНОВА', net_score_great: '🏆 Отлично', net_phase_ping: '📡 Пинг — 10 сек.', net_phase_down: '⬇️ Загрузка — 25 сек.', net_phase_up: '⬆️ Отправка — 25 сек.', net_phase_done: '✅ Тест завершён', net_unit_dl: 'Мб/с', net_rate_ok: '✅ ОК', net_rate_weak: '❌ Слабое', net_rate_great: '✅ Отлично', net_rate_ok2: '⚡ Сойдёт', net_rate_lag: '❌ Лаг', net_rate_smooth: '✅ Плавно', net_rate_possible: '⚡ Возможно', net_rate_buf: '❌ Буферизация', net_rate_fast: '✅ Быстро', net_rate_normal: '⚡ Нормально', net_rate_slow: '❌ Медленно', net_score_good: '✅ Хорошо', net_score_avg: '⚡ Среднее', net_score_poor: '❌ Плохо', speakers: 'Тест звука', voice_effects: 'Эффекты голоса',
    normal: 'Обычный', robot: 'Робот', deep: 'Бас', squirrel: 'Бурундук', echo: 'Эхо', phone: 'Телефон',
    pitch: 'Высота тона', rate: 'Скорость речи', css_filters: 'CSS Фильтры', reset: 'Сброс',
    brightness: 'Яркость', contrast: 'Контраст', saturation: 'Насыщенность', hue: 'Тон', blur: 'Размытие',
    special_fx: 'Спецэффекты', record: 'Запись видео', rec_stop: 'Остановить запись', rec_download: 'Скачать', rec_tag: 'ЗАПИСЬ', snapshot: 'Снимок',
    start: 'СТАРТ', stop: 'СТОП', testing: 'Тестирую...', retest: '↺ ПОВТОРИТЬ ТЕСТ',
    ping_phase: '📡 Пинг — 10 сек.', dl_phase: '⬇️ Загрузка — 25 сек.', ul_phase: '⬆️ Отдача — 25 сек.',
    done_phase: '✅ Тест завершён', net_open: 'Панель открыта — нажмите СТАРТ',
    offline: '❌ Устройство офлайн — проверьте соединение',
    clicks: 'КЛИКИ', cps: 'КПС', max_cps: 'МАКС КПС', speed: 'СКОРОСТЬ', jitter: 'ДЖИТТЕР',
    distance: 'ДИСТАНЦИЯ', position: 'ПОЗИЦИЯ', trail_on: 'Вкл', trail_off: 'Выкл', trail: 'След:',
    move_tab: '🕹️ ДВИЖЕНИЕ', heat_tab: '🔥 ТЕПЛОВАЯ КАРТА', cel_tab: '🎯 СТРЕЛЬБА',
    heat_hint: 'ТЕПЛОВАЯ КАРТА — кликайте чтобы увидеть паттерн', heat_clicks: 'Кликов: ',
    cel_hits: 'ПОПАДАНИЙ', cel_miss: 'ПРОМАХОВ', cel_acc: 'ТОЧНОСТЬ', cel_avg: 'СР. ВРЕМЯ', cel_score: 'ОЧКИ',
    cel_start: '▶ СТАРТ', cel_stop: '◼ СТОП', cel_press_start: 'Нажмите СТАРТ для начала',
    cel_playing: 'Кликайте по целям!', time_label: 'ВРЕМЯ:', time_left: 'Время: ',
    cam_off: '— (выкл)', voice_fx: 'Эффекты голоса', deep_voice: 'Бас', squirrel_v: 'Бурундук',
    pitch_lbl: 'Высота тона', rate_lbl: 'Скорость речи', hue_rot: 'Тон', blur_lbl: 'Размытие',
    snapshot_btn: 'Сделать фото', cam_start_hint: 'Включите камеру для начала', cam_on: 'Камера ВКЛ', cam_off: 'Камера ВЫКЛ',
    fp_warm: '🌅 Тёплый', fp_sunset: '🌇 Закат', fp_moon: '🌙 Луна', fp_soft: '☁️ Мягкий',
    fx_snow: '❄️ Снег', fx_fire: '🔥 Огонь', fx_blur: '💫 Blur фон', fx_shake: '📳 Дрожание', fx_off: '✖ Выкл',
    fx_bubbles: '🫧 Пузыри', fx_spring: '🌀 Пружина',
    spk_ch_test: '📢 ТЕСТ КАНАЛОВ L/R', spk_center: 'Центр (C)', spk_click_hint: 'Нажмите канал для теста',
    spk_sweep: '📈 SWEEP ЧАСТОТ', spk_freq: 'ЧАСТОТА', spk_channel: 'КАНАЛ', spk_progress: 'ПРОГРЕСС',
    spk_both: '▶ Оба канала', spk_tone_gen: '🎵 ГЕНЕРАТОР ТОНОВ', spk_own_freq: 'Своя частота:',
    spk_saw: 'Пила', spk_triangle: 'Треугольник', spk_hearing: '👂 ТЕСТ СЛУХА — диапазон слышимых частот',
    spk_hear_hint: 'Нажмите кнопку, ✓ если слышите, ✗ если нет',
    spk_hear_start: '▶ Запустить тест слуха', spk_vol_lbl: '🔉 ГРОМКОСТЬ:',
    mic_start_hint: 'Включите микрофон для начала теста', mic_wait: 'Жду звук...',
    mic_osc: 'Осциллоскоп — форма волны', mic_spectrum: 'Спектр частот',
    mic_spk_lbl: '🔊 Громкость выхода', mic_voice_lbl: '🎙️ Голос', mic_vol_lbl: 'УРОВЕНЬ ГОЛОСА',
    mic_freq_dom: 'ДОМИНАНТ. ЧАСТОТА', mic_snr: 'SNR (сигнал/шум)', mic_noise: 'Фоновый шум',
    mic_speak_t: 'ВРЕМЯ РЕЧИ', mic_noise_lbl: 'ФОН. ШУМ', mic_reduction: 'Подавление шума',
    mic_gate: 'Шумовой гейт', mic_too_loud: 'Слишком громко', mic_monitor: 'Включить мониторинг голоса',
    mic_samples: 'Частота дискретиз.', mic_channels: 'Каналы', mic_bitdepth: 'Битглубина',
    mic_range: 'ПОЛОСА ГОЛОСА', mic_spec_lbl: 'СПЕКТР ЧАСТОТ', mic_qual_lbl: 'КАЧЕСТВО СИГНАЛА',
    mic_high_avg: 'ВЫС-СР', mic_low_avg: 'НИЗ-СР', mic_kb_sound: 'ЗВУК КЛАВИШ',
    pm_title: 'Производительность', pm_ram_use: 'ИСПОЛЬЗОВАНИЕ RAM',
    pm_heap: '🧠 ПОТРЕБЛЕНИЕ JS HEAP (последние 120 проб)',
    pm_uptime: 'ВРЕМЯ РАБОТЫ', pm_res: 'РАЗРЕШЕНИЕ', pm_long_tasks: 'длинных задач (>50мс)',
    pm_avg: 'СРЕДНЕЕ', pm_transfer: '📦 ИСПОЛЬЗОВАНИЕ ТРАФИКА', pm_total: 'ВСЕГО',
    pm_refresh: '↺ Обновить', pm_js_perf: '⚡ ПРОИЗВОДИТЕЛЬНОСТЬ JS', pm_fps_avg: 'ср. — fps',
    si_threads: 'логических потоков', si_res: 'разрешение', si_batt_load: 'Загрузка информации...',
    si_lang: '🌍 ЯЗЫК / ЧАСОВОЙ ПОЯС', si_browser: '🌐 БРАУЗЕР', si_memory: 'ОПЕРАТИВНАЯ ПАМЯТЬ',
    si_gb: 'ГБ (по данным браузера)', wifi_title: 'Устройства в сети WiFi', wifi_limit: 'Ограничение браузера:',
    wifi_my_dev: '📱 ВАШЕ УСТРОЙСТВО В СЕТИ', wifi_type: 'ТИП СОЕДИНЕНИЯ', wifi_dl_spd: 'СКОРОСТЬ ЗАГРУЗКИ',
    wifi_rtt: 'RTT ЗАДЕРЖКА', wifi_protocol: 'ПРОТОКОЛ', wifi_ua: 'USER AGENT (кратко)',
    wifi_webrtc: 'WebRTC может раскрыть локальные IP (даже через VPN):',
    wifi_gateway: 'ШЛЮЗ ПО УМОЛЧАНИЮ (типичный)', wifi_refresh: '↺ Обновить', wifi_gps: 'GPS-КООРДИНАТЫ',
    wifi_speed_decl: 'ЗАЯВЛЕННАЯ СКОРОСТЬ', wifi_rtt_api: 'RTT (ЗАДЕРЖКА API)', wifi_std: 'СТАНДАРТ / ПРОТОКОЛ',
    net_start_lbl: 'Нажмите СТАРТ', net_spd_live: '📊 Скорость в реальном времени',
    mouse_move_hint: 'Двигайте мышь по полю', mouse_btn_test: 'ТЕСТ КНОПОК', mouse_scroll: 'Прокрутка',
    mouse_mid: 'Средняя', dt_pattern: 'УЗОР', dt_solid: '⬛ Заливка', dt_crosshair: '✛ Прицел',
    dt_brightness: 'ЯРКОСТЬ', dt_nav: '🖱 Наведите для панели • ESC = закрыть • стрелки = цвет',
    kb_press_hint: 'Нажмите СТАРТ, затем нажимайте клавиши', kb_pressed: 'НАЖАТО', kb_delay: 'Задержка',
    kb_sound_off: 'Выкл', ms_pitch: '🎵 Высота тона', ms_deep: '👹 Бас', ms_chipmunk: '🐿️ Бурундук',
    ms_underwater: '🌊 Под водой', ms_chorus: '👥 Хор', ms_drum: '🥁 Барабан',
    clear: '↺ Очистить', perf_prog: 'Прогресс теста', wifi_net_dev: '📡 Устройства в сети',
    touch_label: '📱 КАСАНИЯ / УКАЗАТЕЛИ', dev_label: 'Устройство', connect_lbl: '🔌 Соединение',
    middle_lbl: 'СРЕДНЯЯ', avg_lbl: 'Среднее', vol_output: '🔊 Громкость выхода',
    net_connect: '🔌 СОЕДИНЕНИЕ', spd_lbl: 'Отдача', many_lbl: 'много', few_lbl: 'мало', avg_val: 'средне',
    pm_files: 'файлов', wifi_all_hint: 'Для просмотра всех устройств используйте приложение',
    wifi_local_ip: 'ЛОКАЛЬНЫЙ IP (LAN)', wifi_public_ip: 'ПУБЛИЧНЫЙ IP (WAN)', wifi_hostname: 'ИМЯ ХОСТА',
    wifi_mask: 'МАСКА ПОДСЕТИ (типичная)', wifi_class: 'КЛАСС СЕТИ', wifi_private_range: 'ЧАСТНЫЙ ДИАПАЗОН',
    wifi_webrtc_hdr: '🔍 ЛОКАЛЬНЫЙ IP ЧЕРЕЗ WebRTC', wifi_net_info: '🌐 ИНФОРМАЦИЯ О СЕТИ',
    wifi_timezone: 'ЧАСОВОЙ ПОЯС', wifi_isp: 'ИНТЕРНЕТ-ПРОВАЙДЕР (ISP)', wifi_org: 'ОРГАНИЗАЦИЯ / AS',
    wifi_asn: 'НОМЕР AS (ASN)', wifi_vpn: 'VPN / ПРОКСИ / TOR', wifi_test_time: 'ВРЕМЯ ТЕСТА',
    wifi_isp_hdr: '📶 Провайдер WiFi / ISP', wifi_detecting: 'Определение через WebRTC...',
    wifi_unavail: '❌ Недоступно (VPN блокирует?)', wifi_detecting2: 'Определение...',
    react_btn: 'Тест реакции', vr_btn: 'Изменитель голоса', vr_click_rec: 'Нажмите для записи', vr_click_play: 'Записано — нажмите ▶', vr_presets: 'ПРЕСЕТ ГОЛОСА', vr_pitch: '🎵 Тон', vr_speed: '⚡ Скорость', vr_bass: '🔉 Бас', vr_treble: '🔈 Высокие', rt_wait: 'Нажмите для начала', rt_wait_green: 'Ждите зелёного сигнала…',
    rt_click_now: 'НАЖМИТЕ СЕЙЧАС!', rt_early: 'Слишком рано!', rt_again: 'Нажмите для повтора',
    rt_last: 'ПОСЛЕДНИЙ', rt_best: 'ЛУЧШИЙ', rt_avg: 'СРЕДНЕЕ', rt_tries: 'ПОПЫТОК',
    rt_hist: 'ГИСТОГРАММА (мс)', rt_reset: '↺ СБРОСИТЬ', rt_streak_lbl: 'СЕРИЯ НИЖЕ СРЕДНЕГО', rt_streak_cur: ' сейчас', rt_streak_best_lbl: 'макс', rt_rank_title: 'ТВОЯ ОЦЕНКА', rt_avg_label: 'Среднее',
    rt_progress: 'ПРОГРЕСС ПОПЫТОК',
    rt_chart_empty: 'Нет данных — сделайте несколько попыток',
    rt_attempt: 'Попытка 1',
    freq: 'ЧАСТОТА',
    toast_fps_err: 'Не удалось изменить FPS: ',
    toast_res_err: 'Не удалось изменить разрешение: ',
    toast_cam_unsupported: 'Браузер не поддерживает камеру или сайт не на HTTPS',
    toast_cam_res_warn: '📷 Камера: %W%×%H% (запрошено %RW%×%RH% — не поддерживается)',
    toast_cam_no_access: 'Нет доступа к камере: ',
    toast_mic_unsupported: 'Браузер не поддерживает микрофон или сайт не на HTTPS',
    toast_mic_no_access: 'Нет доступа к микрофону: ',
    toast_cam_first: 'Сначала включите камеру! 📷',
    toast_no_internet: 'Нет подключения к интернету!',
    toast_speed_err: 'Ошибка теста скорости: ',
    toast_unknown: 'неизвестно',
    toast_tts_on: 'TTS включён 🔊',
    toast_tts_off: 'TTS выключен',
    toast_no_uk_voice: 'Нет голоса uk-UA в этом браузере. Используйте Chrome или Edge.',
    toast_no_fps_data: 'Нет данных — сначала запустите тест FPS',
    toast_fps_csv_downloaded: 'fps_data.csv скачан',
    toast_report_downloaded: 'Отчёт скачан!',
    toast_copied: 'Скопировано!',
    toast_copy_err: 'Ошибка копирования',
    toast_decode_err: 'Не удалось декодировать запись: ',
    toast_no_recording: 'Нет записи',
    toast_downloaded_fx: 'Скачано с эффектами ✅',
    toast_downloaded_orig_err: 'Скачан оригинал (ошибка рендеринга)',
    toast_record_voice_first: 'Сначала запишите голос',
    toast_video_rec_unsupported: 'Браузер не поддерживает запись видео',
    toast_rec_err: 'Ошибка записи: ',
    toast_csp_header_copied: 'CSP-заголовок скопирован',
    toast_headers_copied: 'Файл _headers для Netlify скопирован',
    toast_err_generic: 'Ошибка',
  },
  zh: {
    ld_init: '正在初始化...', ld_modules: '正在加载模块...', ld_camera: '正在检测摄像头...', ld_ready: '准备就绪！',
    badge: 'ZH',
    btn_network_scanner: '网络扫描',
    btn_chroma_key: '绿幕抠图',
    btn_dns_lookup: 'DNS查询',
    btn_ai_asystent: 'AI助手',
    btn_fps: 'FPS测试', camera: '摄像头', microphone: '麦克风', mic_test: '麦克风测试', mic_studio: '录音室麦克风',
    net_test: '网络测试', kb_test: '键盘测试', quality: '画质：', fps_label: 'FPS：',
    mouse_test: '鼠标测试', sys_info: '系统信息', display: '显示器', wifi: 'WiFi',
    perf: '性能监视器', net_press_start: '按下开始', net_start_btn: '▶ 开始', net_testing: '⏳ 测试中...', net_retest: '↺ 重新测试', net_score_great: '🏆 极好', net_phase_ping: '📡 Ping — 10秒', net_phase_down: '⬇️ 下载 — 25秒', net_phase_up: '⬆️ 上传 — 25秒', net_phase_done: '✅ 测试完成', net_unit_dl: 'Mb/s', net_rate_ok: '✅ 正常', net_rate_weak: '❌ 太慢', net_rate_great: '✅ 极好', net_rate_ok2: '⚡ 可以', net_rate_lag: '❌ 延迟', net_rate_smooth: '✅ 流畅', net_rate_possible: '⚡ 勉强', net_rate_buf: '❌ 缓冲', net_rate_fast: '✅ 快速', net_rate_normal: '⚡ 正常', net_rate_slow: '❌ 慢', net_score_good: '✅ 好', net_score_avg: '⚡ 一般', net_score_poor: '❌ 差', speakers: '扬声器测试', voice_effects: '变声效果',
    normal: '正常', robot: '机器人', deep: '低沉', squirrel: '松鼠', echo: '回声', phone: '电话',
    pitch: '音调', rate: '语速', css_filters: 'CSS 滤镜', reset: '重置',
    brightness: '亮度', contrast: '对比度', saturation: '饱和度', hue: '色相', blur: '模糊',
    special_fx: '特效', record: '录制视频', rec_stop: '停止录制', rec_download: '下载', rec_tag: '录制中', snapshot: '截图',
    start: '开始', stop: '停止', testing: '测试中...', retest: '↺ 重新测试',
    ping_phase: '📡 延迟 — 10秒', dl_phase: '⬇️ 下载 — 25秒', ul_phase: '⬆️ 上传 — 25秒',
    done_phase: '✅ 测试完成', net_open: '面板已打开 — 按开始', offline: '❌ 设备离线 — 请检查连接',
    clicks: '点击次数', cps: '每秒点击', max_cps: '最高每秒', speed: '速度', jitter: '抖动',
    distance: '距离', position: '位置', trail_on: '开', trail_off: '关', trail: '轨迹：',
    move_tab: '🕹️ 移动', heat_tab: '🔥 热力图', cel_tab: '🎯 射击训练',
    heat_hint: '点击热力图 — 点击区域查看分布', heat_clicks: '点击数：',
    cel_hits: '命中', cel_miss: '未命中', cel_acc: '准确率', cel_avg: '平均时间', cel_score: '得分',
    cel_start: '▶ 开始', cel_stop: '◼ 停止', cel_press_start: '按开始键开始游戏',
    cel_playing: '点击目标！', time_label: '时间：', time_left: '时间：',
    cam_off: '— (关闭)', voice_fx: '变声效果', deep_voice: '低沉', squirrel_v: '松鼠',
    pitch_lbl: '音调', rate_lbl: '语速', hue_rot: '色相', blur_lbl: '模糊',
    snapshot_btn: '拍照', cam_start_hint: '启动摄像头以开始', cam_on: '摄像头开启', cam_off: '摄像头关闭',
    fp_warm: '🌅 暖色', fp_sunset: '🌇 日落', fp_moon: '🌙 月光', fp_soft: '☁️ 柔和',
    fx_snow: '❄️ 雪', fx_fire: '🔥 火', fx_blur: '💫 背景模糊', fx_shake: '📳 抖动', fx_off: '✖ 关闭',
    fx_bubbles: '🫧 气泡', fx_spring: '🌀 弹簧',
    spk_ch_test: '📢 声道L/R测试', spk_center: '中央声道(C)', spk_click_hint: '点击声道进行测试',
    spk_sweep: '📈 频率扫描', spk_freq: '频率', spk_channel: '声道', spk_progress: '进度',
    spk_both: '▶ 双声道', spk_tone_gen: '🎵 音调生成器', spk_own_freq: '自定义频率:',
    spk_saw: '锯齿波', spk_triangle: '三角波', spk_hearing: '👂 听力测试 — 可听频率范围',
    spk_hear_hint: '点击按钮，✓ 如果听到声音，✗ 如果没有',
    spk_hear_start: '▶ 开始听力测试', spk_vol_lbl: '🔉 音量:',
    mic_start_hint: '启动麦克风开始测试', mic_wait: '等待声音...', freq: '频率',
    mic_osc: '示波器 — 波形', mic_spectrum: '频谱',
    mic_spk_lbl: '🔊 输出音量', mic_voice_lbl: '🎙️ 声音', mic_vol_lbl: '声音电平',
    mic_freq_dom: '主频率', mic_snr: 'SNR（信噪比）', mic_noise: '背景噪声',
    mic_speak_t: '说话时间', mic_noise_lbl: '背景噪声', mic_reduction: '降噪',
    mic_gate: '噪声门', mic_too_loud: '太响', mic_monitor: '启用语音监听',
    mic_samples: '采样率', mic_channels: '声道', mic_bitdepth: '位深度',
    mic_range: '语音频段', mic_spec_lbl: '频谱', mic_qual_lbl: '信号质量',
    mic_high_avg: '高中频', mic_low_avg: '低中频', mic_kb_sound: '按键声音',
    pm_title: '性能', pm_ram_use: 'RAM使用', pm_heap: '🧠 JS堆使用（最近120样本）',
    pm_uptime: '运行时间', pm_res: '分辨率', pm_long_tasks: '长任务（>50ms）',
    pm_avg: '平均', pm_transfer: '📦 流量使用', pm_total: '总计', pm_refresh: '↺ 刷新',
    pm_js_perf: '⚡ JAVASCRIPT性能', pm_fps_avg: '平均 — fps',
    si_threads: '逻辑线程', si_res: '分辨率', si_batt_load: '加载信息...',
    si_lang: '🌍 语言 / 时区', si_browser: '🌐 浏览器', si_memory: '内存',
    si_gb: 'GB（浏览器数据）', wifi_title: 'WiFi网络设备', wifi_limit: '浏览器限制：',
    wifi_my_dev: '📱 您的网络设备', wifi_type: '连接类型', wifi_dl_spd: '下载速度',
    wifi_rtt: 'RTT延迟', wifi_protocol: '协议', wifi_ua: 'USER AGENT（简短）',
    wifi_webrtc: 'WebRTC可能会泄露本地IP地址（即使通过VPN）：',
    wifi_gateway: '默认网关（典型）', wifi_refresh: '↺ 刷新', wifi_gps: 'GPS坐标',
    wifi_speed_decl: '声明速度', wifi_rtt_api: 'RTT（API延迟）', wifi_std: '标准 / 协议',
    net_start_lbl: '按开始', net_spd_live: '📊 实时速度',
    mouse_move_hint: '在区域内移动鼠标', mouse_btn_test: '按键测试', mouse_scroll: '滚动',
    mouse_mid: '中键', dt_pattern: '图案', dt_solid: '⬛ 纯色', dt_crosshair: '✛ 十字准星',
    dt_brightness: '亮度', dt_nav: '🖱 悬停查看面板 • ESC=关闭 • 箭头=颜色',
    kb_press_hint: '按START，然后按键', kb_pressed: '已按下', kb_delay: '延迟',
    kb_sound_off: '关', ms_pitch: '🎵 音调', ms_deep: '👹 低沉', ms_chipmunk: '🐿️ 花栗鼠',
    ms_underwater: '🌊 水下', ms_chorus: '👥 合唱', ms_drum: '🥁 鼓',
    clear: '↺ 清除', perf_prog: '测试进度', wifi_net_dev: '📡 网络设备',
    touch_label: '📱 触摸 / 指针', dev_label: '设备', connect_lbl: '🔌 连接',
    middle_lbl: '中间', avg_lbl: '平均', vol_output: '🔊 输出音量',
    net_connect: '🔌 连接', spd_lbl: '上传', many_lbl: '多', few_lbl: '少', avg_val: '中等',
    pm_files: '文件', wifi_all_hint: '要查看所有网络设备，请使用应用程序',
    wifi_local_ip: '本地IP（局域网）', wifi_public_ip: '公网IP（广域网）', wifi_hostname: '主机名',
    wifi_mask: '子网掩码（典型）', wifi_class: '网络类别', wifi_private_range: '私有地址范围',
    wifi_webrtc_hdr: '🔍 通过WebRTC获取本地IP', wifi_net_info: '🌐 网络信息',
    wifi_timezone: '时区', wifi_isp: '互联网服务提供商（ISP）', wifi_org: '组织 / AS',
    wifi_asn: 'AS编号（ASN）', wifi_vpn: 'VPN / 代理 / TOR', wifi_test_time: '测试时间',
    wifi_isp_hdr: '📶 WiFi提供商 / ISP', wifi_detecting: '正在通过WebRTC检测...',
    wifi_unavail: '❌ 不可用（VPN屏蔽？）', wifi_detecting2: '正在检测...',
    react_btn: '反应测试', vr_btn: '变声器', vr_click_rec: '点击录音', vr_click_play: '已录制 — 点击▶播放', vr_presets: '语音预设', vr_pitch: '🎵 音调', vr_speed: '⚡ 速度', vr_bass: '🔉 低音', vr_treble: '🔈 高音', rt_wait: '点击开始', rt_wait_green: '等待绿色信号…',
    rt_click_now: '现在点击！', rt_early: '太早了！', rt_again: '点击再试',
    rt_last: '上次', rt_best: '最佳', rt_avg: '平均', rt_tries: '次数',
    rt_hist: '结果直方图 (ms)', rt_reset: '↺ 重置结果', rt_streak_lbl: '低于平均的连续次数', rt_streak_cur: ' 当前', rt_streak_best_lbl: '最高', rt_rank_title: '你的评级', rt_avg_label: '平均',
    rt_progress: '尝试进度',
    rt_chart_empty: '暂无数据 — 先做几次尝试',
    rt_attempt: '第1次',
  },

  fr: {
    ld_init: 'INITIALISATION...', ld_modules: 'CHARGEMENT DES MODULES...', ld_camera: 'VÉRIFICATION CAMÉRA...', ld_ready: 'PRÊT !',
    badge: 'FR',
    btn_network_scanner: 'Scanner réseau',
    btn_chroma_key: 'Fond vert',
    btn_dns_lookup: 'Recherche DNS',
    btn_ai_asystent: 'Assistant IA',
    btn_fps: 'Test FPS', camera: 'Caméra', microphone: 'Microphone', mic_test: 'Test micro', mic_studio: 'Studio micro',
    net_test: 'Test internet', kb_test: 'Test clavier', quality: 'Qualité :', fps_label: 'FPS :',
    mouse_test: 'Test souris', sys_info: 'Infos système', display: 'Écran', wifi: 'WiFi',
    perf: 'Moniteur perf.', net_press_start: 'Appuyez sur START', net_start_btn: '▶ START', net_testing: '⏳ Test en cours...', net_retest: '↺ RETESTER',
    net_score_great: '🏆 Excellent', net_score_good: '✅ Bon', net_score_avg: '⚡ Moyen', net_score_poor: '❌ Faible',
    net_phase_ping: '📡 Ping — 10 sec.', net_phase_down: '⬇️ Téléchargement — 25 sec.', net_phase_up: '⬆️ Envoi — 25 sec.', net_phase_done: '✅ Test terminé', net_unit_dl: 'Mb/s',
    net_rate_ok: '✅ OK', net_rate_weak: '❌ Trop lent', net_rate_great: '✅ Excellent', net_rate_ok2: '⚡ Acceptable', net_rate_lag: '❌ Lag',
    net_rate_smooth: '✅ Fluide', net_rate_possible: '⚡ Possible', net_rate_buf: '❌ Buffering', net_rate_fast: '✅ Rapide', net_rate_normal: '⚡ Normal', net_rate_slow: '❌ Lent',
    speakers: 'Test haut-parleurs', voice_effects: 'Effets voix',
    normal: 'Normal', robot: 'Robot', deep: 'Grave', squirrel: 'Écureuil', echo: 'Écho', phone: 'Téléphone',
    pitch: 'Tonalité', rate: 'Vitesse', css_filters: 'Filtres CSS', reset: 'Réinitialiser',
    brightness: 'Luminosité', contrast: 'Contraste', saturation: 'Saturation', hue: 'Teinte', blur: 'Flou',
    special_fx: 'Effets spéciaux', record: 'Enregistrer vidéo', rec_stop: 'Arrêter enreg.', rec_download: 'Télécharger', rec_tag: 'ENREG.', snapshot: 'Capture',
    start: 'Démarrer', stop: 'Arrêter', testing: 'Test en cours...', retest: '↺ Retester',
    ping_phase: '📡 Ping — 10 sec.', dl_phase: '⬇️ Téléchargement — 25 sec.', ul_phase: '⬆️ Envoi — 25 sec.',
    done_phase: '✅ Test terminé', net_open: 'Panneau ouvert — appuyez sur START', offline: '❌ Hors ligne — vérifiez la connexion',
    clicks: 'Clics', cps: 'Clics/sec', max_cps: 'Max clics/sec', speed: 'Vitesse', jitter: 'Gigue',
    distance: 'Distance', position: 'Position', trail_on: 'On', trail_off: 'Off', trail: 'Tracé :',
    move_tab: '🕹️ Mouvement', heat_tab: '🔥 Carte de chaleur', cel_tab: '🎯 Entraînement visée',
    heat_hint: 'Heatmap — cliquez pour voir la distribution', heat_clicks: 'Clics :',
    cel_hits: 'Touches', cel_miss: 'Ratés', cel_acc: 'Précision', cel_avg: 'Temps moy.', cel_score: 'Score',
    cel_start: '▶ Démarrer', cel_stop: '◼ Arrêter', cel_press_start: 'Appuyez sur START pour commencer',
    cel_playing: 'Cliquez sur les cibles !', time_label: 'Temps :', time_left: 'Temps :',
    cam_off: '— (éteint)', cam_on: 'Caméra ON', voice_fx: 'Effets voix', deep_voice: 'Grave', squirrel_v: 'Écureuil',
    pitch_lbl: 'Tonalité', rate_lbl: 'Vitesse', hue_rot: 'Teinte', blur_lbl: 'Flou',
    snapshot_btn: 'Prendre photo', cam_start_hint: 'Démarrez la caméra pour commencer',
    fp_warm: '🌅 Chaud', fp_sunset: '🌇 Coucher', fp_moon: '🌙 Lune', fp_soft: '☁️ Doux',
    fx_snow: '❄️ Neige', fx_fire: '🔥 Feu', fx_blur: '💫 Flou fond', fx_shake: '📳 Tremblement', fx_off: '✖ Désactiver',
    fx_bubbles: '🫧 Bulles', fx_spring: '🌀 Ressort',
    spk_ch_test: '📢 Test canaux G/D', spk_center: 'Canal central (C)', spk_click_hint: 'Cliquez sur un canal',
    spk_sweep: '📈 Balayage fréquences', spk_freq: 'Fréquence', spk_channel: 'Canal', spk_progress: 'Progression',
    spk_both: '▶ Les deux canaux', spk_tone_gen: '🎵 Générateur de tons', spk_own_freq: 'Fréquence personnalisée :',
    spk_saw: 'Dent de scie', spk_triangle: 'Triangle', spk_hearing: '👂 Test audition — plage audible',
    spk_hear_hint: 'Cliquez ✓ si vous entendez, ✗ sinon', spk_hear_start: '▶ Lancer test audition', spk_vol_lbl: '🔉 Volume :',
    mic_start_hint: 'Activez le micro pour commencer', mic_wait: 'En attente de son...',
    mic_osc: 'Oscilloscope — forme d’onde', mic_spectrum: 'Spectre',
    mic_spk_lbl: '🔊 Volume sortie', mic_voice_lbl: '🎙️ Voix', mic_vol_lbl: 'Niveau sonore',
    mic_freq_dom: 'Fréquence dominante', mic_snr: 'SNR (rapport signal/bruit)', mic_noise: 'Bruit de fond',
    mic_speak_t: 'Temps de parole', mic_noise_lbl: 'Bruit ambiant', mic_reduction: 'Réduction bruit',
    mic_gate: 'Seuil de bruit', mic_too_loud: 'Trop fort', mic_monitor: 'Moniteur voix actif',
    mic_samples: 'Taux d’échantillonnage', mic_channels: 'Canaux', mic_bitdepth: 'Profondeur',
    mic_range: 'Plage vocale', mic_spec_lbl: 'Spectre', mic_qual_lbl: 'Qualité signal',
    mic_high_avg: 'Moy. hautes freq.', mic_low_avg: 'Moy. basses freq.', mic_kb_sound: 'Son clavier',
    pm_title: 'Performance', pm_ram_use: 'Utilisation RAM', pm_heap: '🧠 Heap JS (120 derniers éch.)',
    pm_uptime: 'Uptime', pm_res: 'Résolution', pm_long_tasks: 'Tâches longues (>50ms)',
    pm_avg: 'Moyenne', pm_transfer: '📦 Utilisation transfert', pm_total: 'Total', pm_refresh: '↺ Actualiser',
    pm_js_perf: '⚡ PERFORMANCE JAVASCRIPT', pm_fps_avg: 'moy. — fps',
    si_threads: 'Threads logiques', si_res: 'Résolution', si_batt_load: 'Chargement...',
    si_lang: '🌍 Langue / Fuseau', si_browser: '🌐 Navigateur', si_memory: 'Mémoire RAM',
    si_gb: 'Go (données nav.)', wifi_title: 'Appareils réseau WiFi', wifi_limit: 'Limite navigateur :',
    wifi_my_dev: '📱 VOTRE APPAREIL RÉSEAU', wifi_type: 'Type connexion', wifi_dl_spd: 'Vitesse téléch.',
    wifi_rtt: 'Latence RTT', wifi_protocol: 'Protocole', wifi_ua: 'USER AGENT (abrégé)',
    wifi_webrtc: 'WebRTC peut exposer l’IP locale (même via VPN) :',
    wifi_gateway: 'Passerelle par défaut (typique)', wifi_refresh: '↺ Actualiser', wifi_gps: 'Coordonnées GPS',
    wifi_speed_decl: 'Vitesse déclarée', wifi_rtt_api: 'RTT (latence API)', wifi_std: 'Standard / Protocole',
    net_start_lbl: 'Appuyer sur START', net_spd_live: '📊 Vitesse en direct',
    mouse_move_hint: 'Bougez la souris dans la zone', mouse_btn_test: 'Test boutons', mouse_scroll: 'Défilement',
    mouse_mid: 'Bouton central', dt_pattern: 'Motif', dt_solid: '⬛ Uni', dt_crosshair: '✛ Réticule',
    dt_brightness: 'Luminosité', dt_nav: '🖱 Survoler pour voir panneaux • ESC=Fermer • Flèches=Couleurs',
    kb_press_hint: 'Appuyez sur START puis tapez', kb_pressed: 'Appuyé', kb_delay: 'Délai',
    kb_sound_off: 'Off', ms_pitch: '🎵 Tonalité', ms_deep: '👹 Grave', ms_chipmunk: '🐿️ Écureuil',
    ms_underwater: '🌊 Sous l’eau', ms_chorus: '👥 Chœur', ms_drum: '🥁 Batterie',
    clear: '↺ Effacer', perf_prog: 'Progression test', wifi_net_dev: '📡 Appareil réseau',
    touch_label: '📱 Tactile / Pointeurs', dev_label: 'Appareil', connect_lbl: '🔌 Connexion',
    middle_lbl: 'Milieu', avg_lbl: 'Moyenne', vol_output: '🔊 Volume sortie',
    net_connect: '🔌 Connexion', spd_lbl: 'Envoi', many_lbl: 'Beaucoup', few_lbl: 'Peu', avg_val: 'Moyen',
    pm_files: 'fichiers', wifi_all_hint: 'Pour voir tous les appareils, utilisez une appli native',
    wifi_local_ip: 'IP locale (LAN)', wifi_public_ip: 'IP publique (WAN)', wifi_hostname: 'Nom d’hôte',
    wifi_mask: 'Masque sous-réseau (typique)', wifi_class: 'Classe réseau', wifi_private_range: 'Plage privée',
    wifi_webrtc_hdr: '🔍 IP locale via WebRTC', wifi_net_info: '🌐 Infos réseau',
    wifi_timezone: 'Fuseau horaire', wifi_isp: 'Fournisseur (FAI)', wifi_org: 'Organisation / AS',
    wifi_asn: 'Numéro AS (ASN)', wifi_vpn: 'VPN / Proxy / TOR', wifi_test_time: 'Heure du test',
    wifi_isp_hdr: '📶 FAI / Fournisseur WiFi', wifi_detecting: 'Détection via WebRTC...',
    wifi_unavail: '❌ Indisponible (VPN bloque ?)', wifi_detecting2: 'Détection...',
    react_btn: 'Test de réaction', vr_btn: 'Modificateur voix', vr_click_rec: 'Cliquer pour enregistrer',
    vr_click_play: 'Enregistré — cliquez ▶ pour écouter', vr_presets: 'PRÉSET VOIX',
    vr_pitch: '🎵 Tonalité', vr_speed: '⚡ Vitesse', vr_bass: '🔉 Basses', vr_treble: '🔈 Aigus',
    rt_wait: 'Cliquez pour commencer', rt_wait_green: 'Attendez le signal vert…',
    rt_click_now: 'CLIQUEZ MAINTENANT !', rt_early: 'Trop tôt ! Attendez le vert', rt_again: 'Cliquez pour réessayer',
    rt_last: 'DERNIER', rt_best: 'MEILLEUR', rt_avg: 'MOYENNE', rt_tries: 'ESSAIS',
    rt_hist: 'HISTOGRAMME DES RÉSULTATS (ms)', rt_reset: '↺ RÉINITIALISER',
    rt_streak_lbl: 'SÉRIE EN DESSOUS DE LA MOYENNE', rt_streak_cur: ' en cours', rt_streak_best_lbl: 'max',
    rt_rank_title: 'VOTRE ÉVALUATION', rt_avg_label: 'Moyenne',
    rt_progress: 'PROGRESSION DES ESSAIS', rt_chart_empty: 'Pas de données — faites quelques essais', rt_attempt: 'Essai 1',
    net_score_great: '🏆 Excellent', net_score_good: '✅ Bon', net_score_avg: '⚡ Moyen', net_score_poor: '❌ Faible',
    wifi_detecting2: 'Détection...', cam_on: 'Caméra ON', cam_off: 'Caméra OFF',
    record: 'Enregistrer', rec_stop: 'Arrêter', rec_tag: 'ENREG.', rec_download: 'Télécharger',
    freq: 'FRÉQUENCE',
  },
  es: {
    ld_init: 'INICIALIZANDO...', ld_modules: 'CARGANDO MÓDULOS...', ld_camera: 'VERIFICANDO CÁMARA...', ld_ready: '¡LISTO!',
    badge: 'ES',
    btn_network_scanner: 'Escáner de red',
    btn_chroma_key: 'Croma',
    btn_dns_lookup: 'Búsqueda DNS',
    btn_ai_asystent: 'Asistente IA',
    btn_fps: 'Test FPS', camera: 'Cámara', microphone: 'Micrófono', mic_test: 'Test micro', mic_studio: 'Estudio micro',
    net_test: 'Test internet', kb_test: 'Test teclado', quality: 'Calidad:', fps_label: 'FPS:',
    mouse_test: 'Test ratón', sys_info: 'Info sistema', display: 'Pantalla', wifi: 'WiFi',
    perf: 'Monitor rend.', net_press_start: 'Pulse START', net_start_btn: '▶ START', net_testing: '⏳ Probando...', net_retest: '↺ REINTENTAR',
    net_score_great: '🏆 Excelente', net_score_good: '✅ Bueno', net_score_avg: '⚡ Regular', net_score_poor: '❌ Malo',
    net_phase_ping: '📡 Ping — 10 seg.', net_phase_down: '⬇️ Descarga — 25 seg.', net_phase_up: '⬆️ Subida — 25 seg.', net_phase_done: '✅ Test terminado', net_unit_dl: 'Mb/s',
    net_rate_ok: '✅ OK', net_rate_weak: '❌ Muy lento', net_rate_great: '✅ Excelente', net_rate_ok2: '⚡ Aceptable', net_rate_lag: '❌ Lag',
    net_rate_smooth: '✅ Fluido', net_rate_possible: '⚡ Posible', net_rate_buf: '❌ Buffering', net_rate_fast: '✅ Rápido', net_rate_normal: '⚡ Normal', net_rate_slow: '❌ Lento',
    speakers: 'Test altavoces', voice_effects: 'Efectos de voz', normal: 'Normal', robot: 'Robot', deep: 'Grave', squirrel: 'Ardilla', echo: 'Eco', phone: 'Teléfono',
    pitch: 'Tono', rate: 'Velocidad', css_filters: 'Filtros CSS', reset: 'Restablecer',
    brightness: 'Brillo', contrast: 'Contraste', saturation: 'Saturación', hue: 'Matiz', blur: 'Desenfoque',
    special_fx: 'Efectos especiales', record: 'Grabar vídeo', rec_stop: 'Detener grab.', rec_download: 'Descargar', rec_tag: 'GRABANDO', snapshot: 'Captura',
    start: 'Iniciar', stop: 'Detener', cam_on: 'Cámara ON', cam_off: 'Cámara OFF',
    snapshot_btn: 'Tomar foto', cam_start_hint: 'Inicie la cámara para comenzar',
    react_btn: 'Test de reacción', vr_btn: 'Modificador de voz', vr_click_rec: 'Clic para grabar',
    vr_click_play: 'Grabado — clic ▶ para escuchar', vr_presets: 'PRESET VOZ',
    vr_pitch: '🎵 Tono', vr_speed: '⚡ Velocidad', vr_bass: '🔉 Graves', vr_treble: '🔈 Agudos',
    rt_wait: 'Haz clic para empezar', rt_wait_green: 'Espera la señal verde…',
    rt_click_now: '¡HAZ CLIC AHORA!', rt_early: '¡Demasiado pronto!', rt_again: 'Haz clic para reintentar',
    rt_last: 'ÚLTIMO', rt_best: 'MEJOR', rt_avg: 'MEDIA', rt_tries: 'INTENTOS',
    rt_hist: 'HISTOGRAMA DE RESULTADOS (ms)', rt_reset: '↺ REINICIAR',
    rt_streak_lbl: 'RACHA POR DEBAJO DE LA MEDIA', rt_streak_cur: ' actual', rt_streak_best_lbl: 'máx',
    rt_rank_title: 'TU PUNTUACIÓN', rt_avg_label: 'Media', rt_progress: 'PROGRESO DE INTENTOS',
    rt_chart_empty: 'Sin datos — haz algunos intentos', rt_attempt: 'Intento 1',
    wifi_detecting2: 'Detectando...', pm_refresh: '↺ Actualizar', pm_files: 'archivos',
    clear: '↺ Limpiar', wifi_local_ip: 'IP local (LAN)', wifi_public_ip: 'IP pública (WAN)',
    spk_both: '▶ Ambos canales', spk_hear_start: '▶ Iniciar test audición', spk_vol_lbl: '🔉 Volumen:',
    si_memory: 'Memoria RAM', si_browser: '🌐 Navegador', touch_label: '📱 Táctil / Punteros',
    mic_start_hint: 'Active el micrófono para empezar', kb_press_hint: 'Pulse START y escriba',
    distance: 'Distancia',
    cps: 'Clics/seg',
    spk_hear_hint: '✓ si oyes, ✗ si no',
    kb_pressed: 'Presionado',
    fx_bubbles: '🫧 Burbujas',
    pm_ram_use: 'Uso RAM',
    cel_press_start: 'Presiona START para comenzar',
    spk_hearing: '👂 Test audición',
    avg_val: 'Medio',
    fx_snow: '❄️ Nieve',
    cel_acc: 'Precisión',
    si_res: 'Resolución',
    trail_on: 'On',
    fx_off: '✖ Desactivar',
    mic_snr: 'SNR',
    net_open: 'Panel abierto — pulsa START',
    testing: 'Probando...',
    si_gb: 'GB (datos nav.)',
    wifi_speed_decl: 'Velocidad declarada',
    spd_lbl: 'Subida',
    speed: 'Velocidad',
    wifi_class: 'Clase red',
    fx_spring: '🌀 Resorte',
    rate_lbl: 'Velocidad',
    connect_lbl: '🔌 Conexión',
    wifi_org: 'Organización / AS',
    dt_pattern: 'Patrón',
    wifi_type: 'Tipo conexión',
    mouse_move_hint: 'Mueve el ratón',
    mic_vol_lbl: 'Nivel sonido',
    offline: '❌ Sin conexión',
    pitch_lbl: 'Tono',
    perf_prog: 'Progreso test',
    wifi_my_dev: '📱 TU DISPOSITIVO',
    spk_progress: 'Progreso',
    wifi_ua: 'USER AGENT (abreviado)',
    pm_total: 'Total',
    mic_voice_lbl: '🎙️ Voz',
    many_lbl: 'Mucho',
    mic_high_avg: 'Med. agudos',
    mic_channels: 'Canales',
    voice_fx: 'Efectos voz',
    spk_own_freq: 'Frecuencia personalizada:',
    cel_hits: 'Impactos',
    heat_clicks: 'Clics:',
    cel_avg: 'T. med.',
    mic_reduction: 'Reducción ruido',
    net_spd_live: '📊 Velocidad live',
    blur_lbl: 'Desenfoque',
    mouse_btn_test: 'Test botones',
    wifi_asn: 'Número AS (ASN)',
    fp_sunset: '🌇 Atardecer',
    avg_lbl: 'Promedio',
    wifi_mask: 'Máscara subred',
    mic_low_avg: 'Med. graves',
    dt_solid: '⬛ Sólido',
    spk_tone_gen: '🎵 Generador tonos',
    pm_js_perf: '⚡ RENDIMIENTO JS',
    ms_underwater: '🌊 Bajo el agua',
    fx_blur: '💫 Desenfoque',
    wifi_rtt: 'Latencia RTT',
    trail: 'Rastro:',
    net_connect: '🔌 Conexión',
    ms_pitch: '🎵 Tono',
    spk_channel: 'Canal',
    done_phase: '✅ Test terminado',
    dev_label: 'Dispositivo',
    pm_avg: 'Promedio',
    mic_samples: 'Muestreo',
    wifi_protocol: 'Protocolo',
    si_lang: '🌍 Idioma / Zona',
    spk_freq: 'Frecuencia',
    si_threads: 'Hilos lógicos',
    dt_brightness: 'Brillo',
    fp_moon: '🌙 Luna',
    wifi_test_time: 'Hora del test',
    cel_tab: '🎯 Tiro al blanco',
    mic_gate: 'Umbral ruido',
    mic_too_loud: 'Muy alto',
    ms_drum: '🥁 Batería',
    spk_triangle: 'Triangular',
    wifi_isp_hdr: '📶 ISP / WiFi',
    retest: '↺ Reintentar',
    fx_shake: '📳 Temblor',
    pm_uptime: 'Tiempo activo',
    wifi_dl_spd: 'Velocidad desc.',
    middle_lbl: 'Centro',
    wifi_net_dev: '📡 Dispositivo red',
    wifi_isp: 'Proveedor (ISP)',
    clicks: 'Clics',
    spk_sweep: '📈 Barrido frecuencias',
    mic_speak_t: 'Tiempo habla',
    wifi_all_hint: 'Usa una app para todos los dispositivos',
    wifi_webrtc: 'WebRTC puede exponer IP local:',
    spk_ch_test: '📢 Test canales I/D',
    pm_heap: '🧠 JS Heap',
    deep_voice: 'Grave',
    max_cps: 'Máx clics/seg',
    position: 'Posición',
    hue_rot: 'Matiz',
    wifi_webrtc_hdr: '🔍 IP local via WebRTC',
    mic_kb_sound: 'Sonido teclado',
    pm_res: 'Resolución',
    heat_tab: '🔥 Mapa de calor',
    wifi_gateway: 'Puerta enlace (típica)',
    mouse_mid: 'Botón central',
    wifi_rtt_api: 'RTT (API)',
    wifi_title: 'Dispositivos red WiFi',
    vol_output: '🔊 Vol. salida',
    mic_freq_dom: 'Freq. dominante',
    mic_monitor: 'Monitor activo',
    kb_delay: 'Retraso',
    pm_fps_avg: 'prom. — fps',
    wifi_private_range: 'Rango privado',
    wifi_unavail: '❌ No disponible',
    spk_click_hint: 'Haz clic en un canal',
    squirrel_v: 'Ardilla',
    dt_nav: '🖱 Menú al pasar • ESC=Cerrar',
    ul_phase: '⬆️ Subida — 25 seg.',
    mic_range: 'Rango vocal',
    cel_playing: '¡Haz clic en los objetivos!',
    mic_spk_lbl: '🔊 Vol. salida',
    ms_chipmunk: '🐿️ Ardilla',
    few_lbl: 'Poco',
    cel_stop: '◼ Detener',
    mic_qual_lbl: 'Calidad señal',
    fx_fire: '🔥 Fuego',
    pm_long_tasks: 'Tareas largas (>50ms)',
    wifi_refresh: '↺ Actualizar',
    mic_noise_lbl: 'Ruido ambiente',
    wifi_gps: 'Coordenadas GPS',
    wifi_std: 'Estándar / Protocolo',
    wifi_vpn: 'VPN / Proxy / TOR',
    move_tab: '🕹️ Movimiento',
    spk_center: 'Canal central (C)',
    mic_osc: 'Osciloscopio',
    wifi_net_info: '🌐 Info red',
    ms_chorus: '👥 Coro',
    wifi_hostname: 'Nombre host',
    wifi_timezone: 'Zona horaria',
    cel_start: '▶ Iniciar',
    spk_saw: 'Diente de sierra',
    dl_phase: '⬇️ Descarga — 25 seg.',
    time_left: 'Tiempo:',
    pm_title: 'Rendimiento',
    wifi_detecting: 'Detectando via WebRTC...',
    pm_transfer: '📦 Transferencia',
    dt_crosshair: '✛ Mira',
    mic_spec_lbl: 'Espectro',
    mic_wait: 'Esperando...',
    mouse_scroll: 'Desplazamiento',
    net_start_lbl: 'Pulsar START',
    mic_bitdepth: 'Bits',
    ping_phase: '📡 Ping — 10 seg.',
    mic_spectrum: 'Espectro',
    cel_miss: 'Fallos',
    mic_noise: 'Ruido fondo',
    si_batt_load: 'Cargando...',
    jitter: 'Jitter',
    cel_score: 'Puntuación',
    heat_hint: 'Heatmap — haz clic para ver',
    fp_soft: '☁️ Suave',
    trail_off: 'Off',
    fp_warm: '🌅 Cálido',
    ms_deep: '👹 Grave',
    kb_sound_off: 'Off',
    time_label: 'Tiempo:',
    wifi_limit: 'Límite navegador:',
    Clicks: 'Clics',
    Quality: 'Calidad',
    TIME: 'TIEMPO',
    Time: 'Tiempo',
    Trail: 'Rastro',
    VOLUME: 'VOLUMEN',
    freq: 'Frecuencia',
    limitation: 'Límite navegador:'
  },
  it: {
    ld_init: 'INIZIALIZZAZIONE...', ld_modules: 'CARICAMENTO MODULI...', ld_camera: 'VERIFICA FOTOCAMERA...', ld_ready: 'PRONTO!',
    badge: 'IT',
    btn_network_scanner: 'Scanner di rete',
    btn_chroma_key: 'Chroma Key',
    btn_dns_lookup: 'Ricerca DNS',
    btn_ai_asystent: 'Assistente IA',
    btn_fps: 'Test FPS', camera: 'Fotocamera', microphone: 'Microfono', mic_test: 'Test microfono', mic_studio: 'Studio microfono',
    net_test: 'Test internet', kb_test: 'Test tastiera', quality: 'Qualità:', fps_label: 'FPS:',
    mouse_test: 'Test mouse', sys_info: 'Info sistema', display: 'Schermo', wifi: 'WiFi',
    perf: 'Monitor prestaz.', net_press_start: 'Premi START', net_start_btn: '▶ START', net_testing: '⏳ Test in corso...', net_retest: '↺ RIPROVA',
    net_score_great: '🏆 Eccellente', net_score_good: '✅ Buono', net_score_avg: '⚡ Medio', net_score_poor: '❌ Scarso',
    net_phase_ping: '📡 Ping — 10 sec.', net_phase_down: '⬇️ Download — 25 sec.', net_phase_up: '⬆️ Upload — 25 sec.', net_phase_done: '✅ Test completato', net_unit_dl: 'Mb/s',
    net_rate_ok: '✅ OK', net_rate_weak: '❌ Troppo lento', net_rate_great: '✅ Eccellente', net_rate_ok2: '⚡ Accettabile', net_rate_lag: '❌ Lag',
    net_rate_smooth: '✅ Fluido', net_rate_possible: '⚡ Possibile', net_rate_buf: '❌ Buffering', net_rate_fast: '✅ Veloce', net_rate_normal: '⚡ Normale', net_rate_slow: '❌ Lento',
    speakers: 'Test altoparlanti', voice_effects: 'Effetti voce', normal: 'Normale', robot: 'Robot', deep: 'Basso', squirrel: 'Scoiattolo', echo: 'Eco', phone: 'Telefono',
    pitch: 'Tonalità', rate: 'Velocità', css_filters: 'Filtri CSS', reset: 'Ripristina',
    brightness: 'Luminosità', contrast: 'Contrasto', saturation: 'Saturazione', hue: 'Tonalità', blur: 'Sfocatura',
    special_fx: 'Effetti speciali', record: 'Registra video', rec_stop: 'Ferma regist.', rec_download: 'Scarica', rec_tag: 'REC', snapshot: 'Istantanea',
    start: 'Avvia', stop: 'Ferma', cam_on: 'Camera ON', cam_off: 'Camera OFF',
    snapshot_btn: 'Scatta foto', cam_start_hint: 'Avvia la fotocamera per iniziare',
    react_btn: 'Test di reazione', vr_btn: 'Modificatore voce', vr_click_rec: 'Clicca per registrare',
    vr_click_play: 'Registrato — clicca ▶ per ascoltare', vr_presets: 'PRESET VOCE',
    vr_pitch: '🎵 Tonalità', vr_speed: '⚡ Velocità', vr_bass: '🔉 Bassi', vr_treble: '🔈 Alti',
    rt_wait: 'Clicca per iniziare', rt_wait_green: 'Aspetta il segnale verde…',
    rt_click_now: 'CLICCA ORA!', rt_early: 'Troppo presto!', rt_again: 'Clicca per riprovare',
    rt_last: 'ULTIMO', rt_best: 'MIGLIORE', rt_avg: 'MEDIA', rt_tries: 'TENTATIVI',
    rt_hist: 'ISTOGRAMMA RISULTATI (ms)', rt_reset: '↺ AZZERA',
    rt_streak_lbl: 'SERIE SOTTO LA MEDIA', rt_streak_cur: ' in corso', rt_streak_best_lbl: 'max',
    rt_rank_title: 'IL TUO PUNTEGGIO', rt_avg_label: 'Media', rt_progress: 'PROGRESSIONE TENTATIVI',
    rt_chart_empty: 'Nessun dato — fai qualche tentativo', rt_attempt: 'Tentativo 1',
    wifi_detecting2: 'Rilevamento...', pm_refresh: '↺ Aggiorna', pm_files: 'file',
    clear: '↺ Cancella', wifi_local_ip: 'IP locale (LAN)', wifi_public_ip: 'IP pubblica (WAN)',
    spk_both: '▶ Entrambi i canali', spk_hear_start: '▶ Avvia test udito', spk_vol_lbl: '🔉 Volume:',
    si_memory: 'Memoria RAM', si_browser: '🌐 Browser', touch_label: '📱 Touch / Puntatori',
    mic_start_hint: 'Attiva il microfono per iniziare', kb_press_hint: 'Premi START poi digita',
    distance: 'Distanza',
    cps: 'Clic/sec',
    spk_hear_hint: '✓ se senti, ✗ se no',
    kb_pressed: 'Premuto',
    fx_bubbles: '🫧 Bolle',
    pm_ram_use: 'Uso RAM',
    cel_press_start: 'Premi START per iniziare',
    spk_hearing: '👂 Test udito',
    avg_val: 'Medio',
    fx_snow: '❄️ Neve',
    cel_acc: 'Precisione',
    si_res: 'Risoluzione',
    trail_on: 'On',
    fx_off: '✖ Disattiva',
    mic_snr: 'SNR',
    net_open: 'Pannello aperto — premi START',
    testing: 'Test in corso...',
    si_gb: 'GB (dati nav.)',
    wifi_speed_decl: 'Velocità dichiarata',
    spd_lbl: 'Upload',
    speed: 'Velocità',
    wifi_class: 'Classe rete',
    fx_spring: '🌀 Molla',
    rate_lbl: 'Velocità',
    connect_lbl: '🔌 Connessione',
    wifi_org: 'Organizzazione / AS',
    dt_pattern: 'Schema',
    wifi_type: 'Tipo connessione',
    mouse_move_hint: 'Muovi il mouse',
    mic_vol_lbl: 'Livello audio',
    offline: '❌ Offline',
    pitch_lbl: 'Tonalità',
    perf_prog: 'Progresso test',
    wifi_my_dev: '📱 IL TUO DISPOSITIVO',
    spk_progress: 'Progresso',
    wifi_ua: 'USER AGENT (abbreviato)',
    pm_total: 'Totale',
    mic_voice_lbl: '🎙️ Voce',
    many_lbl: 'Molto',
    mic_high_avg: 'Med. alti',
    mic_channels: 'Canali',
    voice_fx: 'Effetti voce',
    spk_own_freq: 'Frequenza personalizzata:',
    cel_hits: 'Colpi',
    heat_clicks: 'Clic:',
    cel_avg: 'T. med.',
    mic_reduction: 'Riduzione rumore',
    net_spd_live: '📊 Velocità live',
    blur_lbl: 'Sfocatura',
    mouse_btn_test: 'Test pulsanti',
    wifi_asn: 'Numero AS (ASN)',
    fp_sunset: '🌇 Tramonto',
    avg_lbl: 'Media',
    wifi_mask: 'Maschera sottorete',
    mic_low_avg: 'Med. bassi',
    dt_solid: '⬛ Pieno',
    spk_tone_gen: '🎵 Generatore toni',
    pm_js_perf: '⚡ PRESTAZIONI JS',
    ms_underwater: '🌊 Sott’acqua',
    fx_blur: '💫 Sfocatura',
    wifi_rtt: 'Latenza RTT',
    trail: 'Traccia:',
    net_connect: '🔌 Connessione',
    ms_pitch: '🎵 Tonalità',
    spk_channel: 'Canale',
    done_phase: '✅ Test completato',
    dev_label: 'Dispositivo',
    pm_avg: 'Media',
    mic_samples: 'Campionamento',
    wifi_protocol: 'Protocollo',
    si_lang: '🌍 Lingua / Fuso',
    spk_freq: 'Frequenza',
    si_threads: 'Thread logici',
    dt_brightness: 'Luminosità',
    fp_moon: '🌙 Luna',
    wifi_test_time: 'Ora del test',
    cel_tab: '🎯 Tiro al bersaglio',
    mic_gate: 'Soglia rumore',
    mic_too_loud: 'Troppo forte',
    ms_drum: '🥁 Tamburo',
    spk_triangle: 'Triangolare',
    wifi_isp_hdr: '📶 ISP / WiFi',
    retest: '↺ Riprova',
    fx_shake: '📳 Vibrazione',
    pm_uptime: 'Uptime',
    wifi_dl_spd: 'Velocità download',
    middle_lbl: 'Centro',
    wifi_net_dev: '📡 Dispositivo rete',
    wifi_isp: 'Provider (ISP)',
    clicks: 'Clic',
    spk_sweep: '📈 Scansione frequenze',
    mic_speak_t: 'Tempo parola',
    wifi_all_hint: 'Usa un’app per tutti i dispositivi',
    wifi_webrtc: 'WebRTC può esporre IP locale:',
    spk_ch_test: '📢 Test canali S/D',
    pm_heap: '🧠 JS Heap',
    deep_voice: 'Basso',
    max_cps: 'Max clic/sec',
    position: 'Posizione',
    hue_rot: 'Tonalità',
    wifi_webrtc_hdr: '🔍 IP locale via WebRTC',
    mic_kb_sound: 'Suono tastiera',
    pm_res: 'Risoluzione',
    heat_tab: '🔥 Mappa calore',
    wifi_gateway: 'Gateway (tipico)',
    mouse_mid: 'Pulsante centrale',
    wifi_rtt_api: 'RTT (API)',
    wifi_title: 'Dispositivi rete WiFi',
    vol_output: '🔊 Vol. uscita',
    mic_freq_dom: 'Freq. dominante',
    mic_monitor: 'Monitor attivo',
    kb_delay: 'Ritardo',
    pm_fps_avg: 'med. — fps',
    wifi_private_range: 'Intervallo privato',
    wifi_unavail: '❌ Non disponibile',
    spk_click_hint: 'Clicca un canale',
    squirrel_v: 'Scoiattolo',
    dt_nav: '🖱 Menu al passaggio • ESC=Chiudi',
    ul_phase: '⬆️ Upload — 25 sec.',
    mic_range: 'Gamma vocale',
    cel_playing: 'Clicca i bersagli!',
    mic_spk_lbl: '🔊 Vol. uscita',
    ms_chipmunk: '🐿️ Scoiattolo',
    few_lbl: 'Poco',
    cel_stop: '◼ Stop',
    mic_qual_lbl: 'Qualità segnale',
    fx_fire: '🔥 Fuoco',
    pm_long_tasks: 'Task lunghi (>50ms)',
    wifi_refresh: '↺ Aggiorna',
    mic_noise_lbl: 'Rumore ambiente',
    wifi_gps: 'Coordinate GPS',
    wifi_std: 'Standard / Protocollo',
    wifi_vpn: 'VPN / Proxy / TOR',
    move_tab: '🕹️ Movimento',
    spk_center: 'Canale centrale (C)',
    mic_osc: 'Oscilloscopio',
    wifi_net_info: '🌐 Info rete',
    ms_chorus: '👥 Coro',
    wifi_hostname: 'Nome host',
    wifi_timezone: 'Fuso orario',
    cel_start: '▶ Avvia',
    spk_saw: 'Dente di sega',
    dl_phase: '⬇️ Download — 25 sec.',
    time_left: 'Tempo:',
    pm_title: 'Prestazioni',
    wifi_detecting: 'Rilevamento via WebRTC...',
    pm_transfer: '📦 Trasferimento',
    dt_crosshair: '✛ Mirino',
    mic_spec_lbl: 'Spettro',
    mic_wait: 'Attesa...',
    mouse_scroll: 'Scorrimento',
    net_start_lbl: 'Premere START',
    mic_bitdepth: 'Bit depth',
    ping_phase: '📡 Ping — 10 sec.',
    mic_spectrum: 'Spettro',
    cel_miss: 'Mancati',
    mic_noise: 'Rumore fondo',
    si_batt_load: 'Caricamento...',
    jitter: 'Jitter',
    cel_score: 'Punteggio',
    heat_hint: 'Heatmap — clicca per vedere',
    fp_soft: '☁️ Morbido',
    trail_off: 'Off',
    fp_warm: '🌅 Caldo',
    ms_deep: '👹 Basso',
    kb_sound_off: 'Off',
    time_label: 'Tempo:',
    wifi_limit: 'Limite browser:',
    Clicks: 'Clic',
    Quality: 'Qualità',
    TIME: 'TEMPO',
    Time: 'Tempo',
    Trail: 'Traccia',
    VOLUME: 'VOLUME',
    freq: 'Frequenza',
    limitation: 'Limite browser:'
  },
  ja: {
    ld_init: '初期化中...', ld_modules: 'モジュール読込中...', ld_camera: 'カメラ確認中...', ld_ready: '準備完了！',
    badge: 'JA',
    btn_network_scanner: 'ネットワークスキャン',
    btn_chroma_key: 'クロマキー',
    btn_dns_lookup: 'DNS検索',
    btn_ai_asystent: 'AIアシスタント',
    btn_fps: 'FPSテスト', camera: 'カメラ', microphone: 'マイク', mic_test: 'マイクテスト', mic_studio: 'マイクスタジオ',
    net_test: 'インターネットテスト', kb_test: 'キーボードテスト', quality: '画質：', fps_label: 'FPS：',
    mouse_test: 'マウステスト', sys_info: 'システム情報', display: 'ディスプレイ', wifi: 'WiFi',
    perf: 'パフォーマンス', net_press_start: 'STARTを押してください', net_start_btn: '▶ START', net_testing: '⏳ テスト中...', net_retest: '↺ 再テスト',
    net_score_great: '🏆 優秀', net_score_good: '✅ 良好', net_score_avg: '⚡ 普通', net_score_poor: '❌ 不良',
    net_phase_ping: '📡 Ping — 10秒', net_phase_down: '⬇️ ダウンロード — 25秒', net_phase_up: '⬆️ アップロード — 25秒', net_phase_done: '✅ テスト完了', net_unit_dl: 'Mb/s',
    net_rate_ok: '✅ OK', net_rate_weak: '❌ 遅すぎる', net_rate_great: '✅ 優秀', net_rate_ok2: '⚡ 許容範囲', net_rate_lag: '❌ ラグ',
    net_rate_smooth: '✅ スムーズ', net_rate_possible: '⚡ 可能', net_rate_buf: '❌ バッファリング', net_rate_fast: '✅ 速い', net_rate_normal: '⚡ 普通', net_rate_slow: '❌ 遅い',
    speakers: 'スピーカーテスト', voice_effects: '音声エフェクト', normal: '通常', robot: 'ロボット', deep: '低音', squirrel: 'リス', echo: 'エコー', phone: '電話',
    pitch: 'ピッチ', rate: '速度', css_filters: 'CSSフィルター', reset: 'リセット',
    brightness: '明度', contrast: 'コントラスト', saturation: '彩度', hue: '色相', blur: 'ぼかし',
    special_fx: 'スペシャルエフェクト', record: '動画録画', rec_stop: '録画停止', rec_download: 'ダウンロード', rec_tag: '録画中', snapshot: 'スナップショット',
    start: '開始', stop: '停止', cam_on: 'カメラ ON', cam_off: 'カメラ OFF',
    snapshot_btn: '写真を撮る', cam_start_hint: 'カメラを起動してください',
    react_btn: '反応テスト', vr_btn: '音声変換', vr_click_rec: 'クリックして録音',
    vr_click_play: '録音済み — ▶ をクリックして再生', vr_presets: '音声プリセット',
    vr_pitch: '🎵 ピッチ', vr_speed: '⚡ 速度', vr_bass: '🔉 低音', vr_treble: '🔈 高音',
    rt_wait: 'クリックして開始', rt_wait_green: '緑のシグナルを待ってください…',
    rt_click_now: '今すぐクリック！', rt_early: '早すぎます！', rt_again: 'クリックして再試行',
    rt_last: '最後', rt_best: '最高', rt_avg: '平均', rt_tries: '試行回数',
    rt_hist: '結果ヒストグラム (ms)', rt_reset: '↺ リセット',
    rt_streak_lbl: '平均以下の連続回数', rt_streak_cur: ' 進行中', rt_streak_best_lbl: '最高',
    rt_rank_title: 'あなたの評価', rt_avg_label: '平均', rt_progress: '試行の進捗',
    rt_chart_empty: 'データなし — いくつか試行してください', rt_attempt: '試行 1',
    wifi_detecting2: '検出中...', pm_refresh: '↺ 更新', pm_files: 'ファイル',
    clear: '↺ クリア', wifi_local_ip: 'ローカル IP (LAN)', wifi_public_ip: 'パブリック IP (WAN)',
    spk_both: '▶ 両チャンネル', spk_hear_start: '▶ 聴力テスト開始', spk_vol_lbl: '🔉 音量：',
    si_memory: 'メモリ RAM', si_browser: '🌐 ブラウザ', touch_label: '📱 タッチ / ポインター',
    mic_start_hint: 'マイクを有効にして開始', kb_press_hint: 'STARTを押してから入力',
    distance: 'DISTANCE',
    cps: 'CPS',
    spk_hear_hint: 'Click button, press ✓ if you hear tone, ✗ if not',
    kb_pressed: 'PRESSED',
    fx_bubbles: '🫧 Bubbles',
    pm_ram_use: 'RAM USAGE',
    cel_press_start: 'Press START to begin',
    spk_hearing: '👂 HEARING TEST — audible frequency range',
    avg_val: 'avg',
    fx_snow: '❄️ Snow',
    cel_acc: 'ACCURACY',
    si_res: 'resolution',
    trail_on: 'On',
    fx_off: '✖ Off',
    mic_snr: 'SNR (signal/noise ratio)',
    net_open: 'Panel open — press START',
    testing: 'Testing...',
    si_gb: 'GB (per browser)',
    wifi_speed_decl: 'DECLARED SPEED',
    spd_lbl: 'Upload',
    speed: 'SPEED',
    wifi_class: 'NETWORK CLASS',
    fx_spring: '🌀 Spring',
    rate_lbl: 'Speech rate',
    connect_lbl: '🔌 Connection',
    wifi_org: 'ORGANIZATION / AS',
    dt_pattern: 'PATTERN',
    wifi_type: 'CONNECTION TYPE',
    mouse_move_hint: 'Move mouse over the area',
    mic_vol_lbl: 'VOICE LEVEL',
    offline: '❌ Device offline — check connection',
    pitch_lbl: 'Pitch',
    perf_prog: 'Test progress',
    wifi_my_dev: '📱 YOUR DEVICE ON NETWORK',
    spk_progress: 'PROGRESS',
    wifi_ua: 'USER AGENT (short)',
    pm_total: 'TOTAL',
    mic_voice_lbl: '🎙️ Voice',
    many_lbl: 'many',
    mic_high_avg: 'HI-MID',
    mic_channels: 'Channels',
    voice_fx: 'Voice effects',
    spk_own_freq: 'Custom freq:',
    cel_hits: 'HITS',
    heat_clicks: 'Clicks: ',
    cel_avg: 'AVG TIME',
    mic_reduction: 'Noise reduction',
    net_spd_live: '📊 Live speed',
    blur_lbl: 'Blur',
    mouse_btn_test: 'BUTTON TEST',
    wifi_asn: 'AS NUMBER (ASN)',
    fp_sunset: '🌇 Sunset',
    avg_lbl: 'Average',
    wifi_mask: 'SUBNET MASK (typical)',
    mic_low_avg: 'LO-MID',
    dt_solid: '⬛ Solid',
    spk_tone_gen: '🎵 TONE GENERATOR',
    pm_js_perf: '⚡ JAVASCRIPT PERFORMANCE',
    ms_underwater: '🌊 Underwater',
    fx_blur: '💫 Blur bg',
    wifi_rtt: 'RTT LATENCY',
    trail: 'Trail:',
    net_connect: '🔌 CONNECTION',
    ms_pitch: '🎵 Pitch',
    spk_channel: 'CHANNEL',
    done_phase: '✅ Test complete',
    dev_label: 'Device',
    pm_avg: 'AVG',
    mic_samples: 'Sample rate',
    wifi_protocol: 'PROTOCOL',
    si_lang: '🌍 LANGUAGE / TIMEZONE',
    spk_freq: 'FREQUENCY',
    si_threads: 'logical threads',
    dt_brightness: 'BRIGHTNESS',
    fp_moon: '🌙 Moon',
    wifi_test_time: 'TEST TIME',
    cel_tab: '🎯 CEL SHOOTING',
    mic_gate: 'Noise gate',
    mic_too_loud: 'Too loud',
    ms_drum: '🥁 Drum',
    spk_triangle: 'Triangle',
    wifi_isp_hdr: '📶 WiFi Provider / ISP',
    retest: '↺ TEST AGAIN',
    fx_shake: '📳 Shake',
    pm_uptime: 'UPTIME',
    wifi_dl_spd: 'DOWNLOAD SPEED',
    middle_lbl: 'MIDDLE',
    wifi_net_dev: '📡 Network devices',
    wifi_isp: 'INTERNET PROVIDER (ISP)',
    clicks: 'CLICKS',
    spk_sweep: '📈 FREQUENCY SWEEP',
    mic_speak_t: 'SPEAKING TIME',
    wifi_all_hint: 'To see all network devices - use an app',
    wifi_webrtc: 'WebRTC may reveal local IPs (even through VPN):',
    spk_ch_test: '📢 CHANNEL L/R TEST',
    pm_heap: '🧠 JS HEAP USAGE (last 120 samples)',
    deep_voice: 'Deep',
    max_cps: 'MAX CPS',
    position: 'POSITION',
    hue_rot: 'Hue rotate',
    wifi_webrtc_hdr: '🔍 LOCAL IP VIA WebRTC',
    mic_kb_sound: 'KEY SOUNDS',
    pm_res: 'RESOLUTION',
    heat_tab: '🔥 HEATMAP',
    wifi_gateway: 'DEFAULT GATEWAY (typical)',
    mouse_mid: 'Middle',
    wifi_rtt_api: 'RTT (API LATENCY)',
    wifi_title: 'WiFi Network Devices',
    vol_output: '🔊 Output volume',
    mic_freq_dom: 'DOMINANT FREQ.',
    mic_monitor: 'Enable voice monitor',
    kb_delay: 'Latency',
    pm_fps_avg: 'avg — fps',
    wifi_private_range: 'PRIVATE RANGE',
    wifi_unavail: '❌ Unavailable (VPN blocking?)',
    spk_click_hint: 'Click channel to test',
    squirrel_v: 'Squirrel',
    dt_nav: '🖱 Hover to see panel • ESC = close • arrows = color change',
    ul_phase: '⬆️ Upload — 25 sec.',
    mic_range: 'VOICE BAND',
    cel_playing: 'Click the targets!',
    mic_spk_lbl: '🔊 Output volume',
    ms_chipmunk: '🐿️ Chipmunk',
    few_lbl: 'few',
    cel_stop: '◼ STOP',
    mic_qual_lbl: 'SIGNAL QUALITY',
    fx_fire: '🔥 Fire',
    pm_long_tasks: 'long tasks (>50ms) — browser may stutter',
    wifi_refresh: '↺ Refresh',
    mic_noise_lbl: 'BACKGROUND NOISE',
    wifi_gps: 'GPS COORDINATES',
    wifi_std: 'STANDARD / PROTOCOL',
    wifi_vpn: 'VPN / PROXY / TOR',
    move_tab: '🕹️ MOVE',
    spk_center: 'Center (C)',
    mic_osc: 'Oscilloscope — waveform',
    wifi_net_info: '🌐 NETWORK INFORMATION',
    ms_chorus: '👥 Chorus',
    wifi_hostname: 'HOSTNAME',
    wifi_timezone: 'TIMEZONE',
    cel_start: '▶ START',
    spk_saw: 'Saw',
    dl_phase: '⬇️ Download — 25 sec.',
    time_left: 'Time: ',
    pm_title: 'Performance',
    wifi_detecting: 'Detecting via WebRTC...',
    pm_transfer: '📦 TRANSFER USAGE',
    dt_crosshair: '✛ Crosshair',
    mic_spec_lbl: 'FREQUENCY SPECTRUM',
    mic_wait: 'Waiting for sound...',
    mouse_scroll: 'Scroll',
    net_start_lbl: 'Press START',
    mic_bitdepth: 'Bit depth',
    ping_phase: '📡 Ping — 10 sec.',
    mic_spectrum: 'Frequency spectrum',
    cel_miss: 'MISSES',
    mic_noise: 'Background noise',
    si_batt_load: 'Loading info...',
    jitter: 'JITTER',
    cel_score: 'SCORE',
    heat_hint: 'CLICK HEATMAP — click the area to see your pattern',
    fp_soft: '☁️ Soft',
    trail_off: 'Off',
    fp_warm: '🌅 Warm',
    ms_deep: '👹 Deep',
    kb_sound_off: 'Off',
    time_label: 'TIME:',
    wifi_limit: 'Browser limitation:'
  },
  ko: {
    ld_init: '초기화 중...', ld_modules: '모듈 로딩 중...', ld_camera: '카메라 확인 중...', ld_ready: '준비 완료！',
    badge: 'KO',
    btn_network_scanner: '네트워크 스캐너',
    btn_chroma_key: '크로마키',
    btn_dns_lookup: 'DNS 조회',
    btn_ai_asystent: 'AI 어시스턴트',
    btn_fps: 'FPS 테스트', camera: '카메라', microphone: '마이크', mic_test: '마이크 테스트', mic_studio: '마이크 스튜디오',
    net_test: '인터넷 테스트', kb_test: '키보드 테스트', quality: '화질：', fps_label: 'FPS：',
    mouse_test: '마우스 테스트', sys_info: '시스템 정보', display: '디스플레이', wifi: 'WiFi',
    perf: '성능 모니터', net_press_start: 'START를 누르세요', net_start_btn: '▶ START', net_testing: '⏳ 테스트 중...', net_retest: '↺ 재테스트',
    net_score_great: '🏆 우수', net_score_good: '✅ 양호', net_score_avg: '⚡ 보통', net_score_poor: '❌ 불량',
    net_phase_ping: '📡 Ping — 10초', net_phase_down: '⬇️ 다운로드 — 25초', net_phase_up: '⬆️ 업로드 — 25초', net_phase_done: '✅ 테스트 완료', net_unit_dl: 'Mb/s',
    net_rate_ok: '✅ OK', net_rate_weak: '❌ 너무 느림', net_rate_great: '✅ 우수', net_rate_ok2: '⚡ 허용 가능', net_rate_lag: '❌ 지연',
    net_rate_smooth: '✅ 원활', net_rate_possible: '⚡ 가능', net_rate_buf: '❌ 버퍼링', net_rate_fast: '✅ 빠름', net_rate_normal: '⚡ 보통', net_rate_slow: '❌ 느림',
    speakers: '스피커 테스트', voice_effects: '음성 효과', normal: '정상', robot: '로봇', deep: '저음', squirrel: '다람쥐', echo: '에코', phone: '전화',
    pitch: '음정', rate: '속도', css_filters: 'CSS 필터', reset: '초기화',
    brightness: '밝기', contrast: '대비', saturation: '채도', hue: '색조', blur: '흐림',
    special_fx: '특수 효과', record: '동영상 녹화', rec_stop: '녹화 중지', rec_download: '다운로드', rec_tag: '녹화 중', snapshot: '스냅샷',
    start: '시작', stop: '정지', cam_on: '카메라 ON', cam_off: '카메라 OFF',
    snapshot_btn: '사진 촬영', cam_start_hint: '카메라를 시작하세요',
    react_btn: '반응 테스트', vr_btn: '음성 변조기', vr_click_rec: '클릭하여 녹음',
    vr_click_play: '녹음됨 — ▶를 클릭하여 재생', vr_presets: '음성 프리셋',
    vr_pitch: '🎵 음정', vr_speed: '⚡ 속도', vr_bass: '🔉 저음', vr_treble: '🔈 고음',
    rt_wait: '클릭하여 시작', rt_wait_green: '녹색 신호를 기다리세요…',
    rt_click_now: '지금 클릭！', rt_early: '너무 빨리！', rt_again: '클릭하여 재시도',
    rt_last: '마지막', rt_best: '최고', rt_avg: '평균', rt_tries: '시도 횟수',
    rt_hist: '결과 히스토그램 (ms)', rt_reset: '↺ 초기화',
    rt_streak_lbl: '평균 이하 연속 횟수', rt_streak_cur: ' 진행 중', rt_streak_best_lbl: '최고',
    rt_rank_title: '당신의 평가', rt_avg_label: '평균', rt_progress: '시도 진행률',
    rt_chart_empty: '데이터 없음 — 몇 번 시도하세요', rt_attempt: '시도 1',
    wifi_detecting2: '감지 중...', pm_refresh: '↺ 새로고침', pm_files: '파일',
    clear: '↺ 지우기', wifi_local_ip: '로컬 IP (LAN)', wifi_public_ip: '공용 IP (WAN)',
    spk_both: '▶ 양쪽 채널', spk_hear_start: '▶ 청력 테스트 시작', spk_vol_lbl: '🔉 볼륨：',
    si_memory: 'RAM 메모리', si_browser: '🌐 브라우저', touch_label: '📱 터치 / 포인터',
    mic_start_hint: '마이크를 활성화하여 시작', kb_press_hint: 'START를 누른 후 입력',
    distance: 'DISTANCE',
    cps: 'CPS',
    spk_hear_hint: 'Click button, press ✓ if you hear tone, ✗ if not',
    kb_pressed: 'PRESSED',
    fx_bubbles: '🫧 Bubbles',
    pm_ram_use: 'RAM USAGE',
    cel_press_start: 'Press START to begin',
    spk_hearing: '👂 HEARING TEST — audible frequency range',
    avg_val: 'avg',
    fx_snow: '❄️ Snow',
    cel_acc: 'ACCURACY',
    si_res: 'resolution',
    trail_on: 'On',
    fx_off: '✖ Off',
    mic_snr: 'SNR (signal/noise ratio)',
    net_open: 'Panel open — press START',
    testing: 'Testing...',
    si_gb: 'GB (per browser)',
    wifi_speed_decl: 'DECLARED SPEED',
    spd_lbl: 'Upload',
    speed: 'SPEED',
    wifi_class: 'NETWORK CLASS',
    fx_spring: '🌀 Spring',
    rate_lbl: 'Speech rate',
    connect_lbl: '🔌 Connection',
    wifi_org: 'ORGANIZATION / AS',
    dt_pattern: 'PATTERN',
    wifi_type: 'CONNECTION TYPE',
    mouse_move_hint: 'Move mouse over the area',
    mic_vol_lbl: 'VOICE LEVEL',
    offline: '❌ Device offline — check connection',
    pitch_lbl: 'Pitch',
    perf_prog: 'Test progress',
    wifi_my_dev: '📱 YOUR DEVICE ON NETWORK',
    spk_progress: 'PROGRESS',
    wifi_ua: 'USER AGENT (short)',
    pm_total: 'TOTAL',
    mic_voice_lbl: '🎙️ Voice',
    many_lbl: 'many',
    mic_high_avg: 'HI-MID',
    mic_channels: 'Channels',
    voice_fx: 'Voice effects',
    spk_own_freq: 'Custom freq:',
    cel_hits: 'HITS',
    heat_clicks: 'Clicks: ',
    cel_avg: 'AVG TIME',
    mic_reduction: 'Noise reduction',
    net_spd_live: '📊 Live speed',
    blur_lbl: 'Blur',
    mouse_btn_test: 'BUTTON TEST',
    wifi_asn: 'AS NUMBER (ASN)',
    fp_sunset: '🌇 Sunset',
    avg_lbl: 'Average',
    wifi_mask: 'SUBNET MASK (typical)',
    mic_low_avg: 'LO-MID',
    dt_solid: '⬛ Solid',
    spk_tone_gen: '🎵 TONE GENERATOR',
    pm_js_perf: '⚡ JAVASCRIPT PERFORMANCE',
    ms_underwater: '🌊 Underwater',
    fx_blur: '💫 Blur bg',
    wifi_rtt: 'RTT LATENCY',
    trail: 'Trail:',
    net_connect: '🔌 CONNECTION',
    ms_pitch: '🎵 Pitch',
    spk_channel: 'CHANNEL',
    done_phase: '✅ Test complete',
    dev_label: 'Device',
    pm_avg: 'AVG',
    mic_samples: 'Sample rate',
    wifi_protocol: 'PROTOCOL',
    si_lang: '🌍 LANGUAGE / TIMEZONE',
    spk_freq: 'FREQUENCY',
    si_threads: 'logical threads',
    dt_brightness: 'BRIGHTNESS',
    fp_moon: '🌙 Moon',
    wifi_test_time: 'TEST TIME',
    cel_tab: '🎯 CEL SHOOTING',
    mic_gate: 'Noise gate',
    mic_too_loud: 'Too loud',
    ms_drum: '🥁 Drum',
    spk_triangle: 'Triangle',
    wifi_isp_hdr: '📶 WiFi Provider / ISP',
    retest: '↺ TEST AGAIN',
    fx_shake: '📳 Shake',
    pm_uptime: 'UPTIME',
    wifi_dl_spd: 'DOWNLOAD SPEED',
    middle_lbl: 'MIDDLE',
    wifi_net_dev: '📡 Network devices',
    wifi_isp: 'INTERNET PROVIDER (ISP)',
    clicks: 'CLICKS',
    spk_sweep: '📈 FREQUENCY SWEEP',
    mic_speak_t: 'SPEAKING TIME',
    wifi_all_hint: 'To see all network devices - use an app',
    wifi_webrtc: 'WebRTC may reveal local IPs (even through VPN):',
    spk_ch_test: '📢 CHANNEL L/R TEST',
    pm_heap: '🧠 JS HEAP USAGE (last 120 samples)',
    deep_voice: 'Deep',
    max_cps: 'MAX CPS',
    position: 'POSITION',
    hue_rot: 'Hue rotate',
    wifi_webrtc_hdr: '🔍 LOCAL IP VIA WebRTC',
    mic_kb_sound: 'KEY SOUNDS',
    pm_res: 'RESOLUTION',
    heat_tab: '🔥 HEATMAP',
    wifi_gateway: 'DEFAULT GATEWAY (typical)',
    mouse_mid: 'Middle',
    wifi_rtt_api: 'RTT (API LATENCY)',
    wifi_title: 'WiFi Network Devices',
    vol_output: '🔊 Output volume',
    mic_freq_dom: 'DOMINANT FREQ.',
    mic_monitor: 'Enable voice monitor',
    kb_delay: 'Latency',
    pm_fps_avg: 'avg — fps',
    wifi_private_range: 'PRIVATE RANGE',
    wifi_unavail: '❌ Unavailable (VPN blocking?)',
    spk_click_hint: 'Click channel to test',
    squirrel_v: 'Squirrel',
    dt_nav: '🖱 Hover to see panel • ESC = close • arrows = color change',
    ul_phase: '⬆️ Upload — 25 sec.',
    mic_range: 'VOICE BAND',
    cel_playing: 'Click the targets!',
    mic_spk_lbl: '🔊 Output volume',
    ms_chipmunk: '🐿️ Chipmunk',
    few_lbl: 'few',
    cel_stop: '◼ STOP',
    mic_qual_lbl: 'SIGNAL QUALITY',
    fx_fire: '🔥 Fire',
    pm_long_tasks: 'long tasks (>50ms) — browser may stutter',
    wifi_refresh: '↺ Refresh',
    mic_noise_lbl: 'BACKGROUND NOISE',
    wifi_gps: 'GPS COORDINATES',
    wifi_std: 'STANDARD / PROTOCOL',
    wifi_vpn: 'VPN / PROXY / TOR',
    move_tab: '🕹️ MOVE',
    spk_center: 'Center (C)',
    mic_osc: 'Oscilloscope — waveform',
    wifi_net_info: '🌐 NETWORK INFORMATION',
    ms_chorus: '👥 Chorus',
    wifi_hostname: 'HOSTNAME',
    wifi_timezone: 'TIMEZONE',
    cel_start: '▶ START',
    spk_saw: 'Saw',
    dl_phase: '⬇️ Download — 25 sec.',
    time_left: 'Time: ',
    pm_title: 'Performance',
    wifi_detecting: 'Detecting via WebRTC...',
    pm_transfer: '📦 TRANSFER USAGE',
    dt_crosshair: '✛ Crosshair',
    mic_spec_lbl: 'FREQUENCY SPECTRUM',
    mic_wait: 'Waiting for sound...',
    mouse_scroll: 'Scroll',
    net_start_lbl: 'Press START',
    mic_bitdepth: 'Bit depth',
    ping_phase: '📡 Ping — 10 sec.',
    mic_spectrum: 'Frequency spectrum',
    cel_miss: 'MISSES',
    mic_noise: 'Background noise',
    si_batt_load: 'Loading info...',
    jitter: 'JITTER',
    cel_score: 'SCORE',
    heat_hint: 'CLICK HEATMAP — click the area to see your pattern',
    fp_soft: '☁️ Soft',
    trail_off: 'Off',
    fp_warm: '🌅 Warm',
    ms_deep: '👹 Deep',
    kb_sound_off: 'Off',
    time_label: 'TIME:',
    wifi_limit: 'Browser limitation:'
  },
  nl: {
    ld_init: 'INITIALISEREN...', ld_modules: 'MODULES LADEN...', ld_camera: 'CAMERA CONTROLEREN...', ld_ready: 'KLAAR!',
    badge: 'NL',
    btn_network_scanner: 'Netwerkscanner',
    btn_chroma_key: 'Chroma Key',
    btn_dns_lookup: 'DNS-opzoeking',
    btn_ai_asystent: 'AI-assistent',
    btn_fps: 'FPS-test', camera: 'Camera', microphone: 'Microfoon', mic_test: 'Microfoontest', mic_studio: 'Microfoon studio',
    net_test: 'Internettest', kb_test: 'Toetsenbordtest', quality: 'Kwaliteit:', fps_label: 'FPS:',
    mouse_test: 'Muistest', sys_info: 'Systeeminfo', display: 'Beeldscherm', wifi: 'WiFi',
    perf: 'Prestatiemonitor', net_press_start: 'Druk op START', net_start_btn: '▶ START', net_testing: '⏳ Testen...', net_retest: '↺ OPNIEUW TESTEN',
    net_score_great: '🏆 Uitstekend', net_score_good: '✅ Goed', net_score_avg: '⚡ Gemiddeld', net_score_poor: '❌ Slecht',
    net_phase_ping: '📡 Ping — 10 sec.', net_phase_down: '⬇️ Downloaden — 25 sec.', net_phase_up: '⬆️ Uploaden — 25 sec.', net_phase_done: '✅ Test voltooid', net_unit_dl: 'Mb/s',
    net_rate_ok: '✅ OK', net_rate_weak: '❌ Te traag', net_rate_great: '✅ Uitstekend', net_rate_ok2: '⚡ Acceptabel', net_rate_lag: '❌ Lag',
    net_rate_smooth: '✅ Vloeiend', net_rate_possible: '⚡ Mogelijk', net_rate_buf: '❌ Buffering', net_rate_fast: '✅ Snel', net_rate_normal: '⚡ Normaal', net_rate_slow: '❌ Traag',
    speakers: 'Luidspreker test', voice_effects: 'Stemeffecten', normal: 'Normaal', robot: 'Robot', deep: 'Diep', squirrel: 'Eekhoorn', echo: 'Echo', phone: 'Telefoon',
    pitch: 'Toonhoogte', rate: 'Snelheid', css_filters: 'CSS Filters', reset: 'Resetten',
    brightness: 'Helderheid', contrast: 'Contrast', saturation: 'Verzadiging', hue: 'Tint', blur: 'Vervaging',
    special_fx: 'Speciale effecten', record: 'Video opnemen', rec_stop: 'Opname stoppen', rec_download: 'Downloaden', rec_tag: 'OPNAME', snapshot: 'Momentopname',
    start: 'Starten', stop: 'Stoppen', cam_on: 'Camera AAN', cam_off: 'Camera UIT',
    snapshot_btn: 'Foto maken', cam_start_hint: 'Start de camera om te beginnen',
    react_btn: 'Reactietest', vr_btn: 'Stemvervormer', vr_click_rec: 'Klik om op te nemen',
    vr_click_play: 'Opgenomen — klik ▶ om te spelen', vr_presets: 'STEM PRESET',
    vr_pitch: '🎵 Toonhoogte', vr_speed: '⚡ Snelheid', vr_bass: '🔉 Bas', vr_treble: '🔈 Hoog',
    rt_wait: 'Klik om te beginnen', rt_wait_green: 'Wacht op groen signaal…',
    rt_click_now: 'KLIK NU!', rt_early: 'Te vroeg!', rt_again: 'Klik om opnieuw te proberen',
    rt_last: 'LAATSTE', rt_best: 'BESTE', rt_avg: 'GEMIDDELD', rt_tries: 'POGINGEN',
    rt_hist: 'HISTOGRAM RESULTATEN (ms)', rt_reset: '↺ RESET',
    rt_streak_lbl: 'REEKS ONDER GEMIDDELDE', rt_streak_cur: ' huidig', rt_streak_best_lbl: 'max',
    rt_rank_title: 'JOUW BEOORDELING', rt_avg_label: 'Gemiddeld', rt_progress: 'VOORTGANG POGINGEN',
    rt_chart_empty: 'Geen data — doe een paar pogingen', rt_attempt: 'Poging 1',
    wifi_detecting2: 'Detecteren...', pm_refresh: '↺ Vernieuwen', pm_files: 'bestanden',
    clear: '↺ Wissen', wifi_local_ip: 'Lokaal IP (LAN)', wifi_public_ip: 'Openbaar IP (WAN)',
    spk_both: '▶ Beide kanalen', spk_hear_start: '▶ Gehoortest starten', spk_vol_lbl: '🔉 Volume:',
    si_memory: 'RAM geheugen', si_browser: '🌐 Browser', touch_label: '📱 Touch / Aanwijzer',
    mic_start_hint: 'Activeer microfoon om te beginnen', kb_press_hint: 'Druk START dan typ',
    distance: 'Afstand',
    cps: 'Klik/sec',
    spk_hear_hint: '✓ als je hoort, ✗ als niet',
    kb_pressed: 'Ingedrukt',
    fx_bubbles: '🫧 Bellen',
    pm_ram_use: 'RAM-gebruik',
    cel_press_start: 'Druk START om te beginnen',
    spk_hearing: '👂 Gehoortest',
    avg_val: 'Gemiddeld',
    fx_snow: '❄️ Sneeuw',
    cel_acc: 'Nauwkeurigheid',
    si_res: 'Resolutie',
    trail_on: 'Aan',
    fx_off: '✖ Uitschakelen',
    mic_snr: 'SNR',
    net_open: 'Paneel open — druk START',
    testing: 'Testen...',
    si_gb: 'GB (browsergegevens)',
    wifi_speed_decl: 'Opgegeven snelheid',
    spd_lbl: 'Upload',
    speed: 'Snelheid',
    wifi_class: 'Netwerkklasse',
    fx_spring: '🌀 Veer',
    rate_lbl: 'Snelheid',
    connect_lbl: '🔌 Verbinding',
    wifi_org: 'Organisatie / AS',
    dt_pattern: 'Patroon',
    wifi_type: 'Verbindingstype',
    mouse_move_hint: 'Beweeg muis in het gebied',
    mic_vol_lbl: 'Geluidsniveau',
    offline: '❌ Offline',
    pitch_lbl: 'Toonhoogte',
    perf_prog: 'Testvoortgang',
    wifi_my_dev: '📱 UW NETWERKAPPARAAT',
    spk_progress: 'Voortgang',
    wifi_ua: 'USER AGENT (afgekorte)',
    pm_total: 'Totaal',
    mic_voice_lbl: '🎙️ Stem',
    many_lbl: 'Veel',
    mic_high_avg: 'Gem. hoog',
    mic_channels: 'Kanalen',
    voice_fx: 'Stemeffecten',
    spk_own_freq: 'Aangepaste frequentie:',
    cel_hits: 'Treffers',
    heat_clicks: 'Klikken:',
    cel_avg: 'Gem. tijd',
    mic_reduction: 'Ruisonderdrukking',
    net_spd_live: '📊 Snelheid live',
    blur_lbl: 'Vervaging',
    mouse_btn_test: 'Knoppentest',
    wifi_asn: 'AS-nummer (ASN)',
    fp_sunset: '🌇 Zonsondergang',
    avg_lbl: 'Gemiddeld',
    wifi_mask: 'Subnetmasker',
    mic_low_avg: 'Gem. laag',
    dt_solid: '⬛ Effen',
    spk_tone_gen: '🎵 Toongenerator',
    pm_js_perf: '⚡ JS PRESTATIES',
    ms_underwater: '🌊 Onderwater',
    fx_blur: '💫 Vervaging',
    wifi_rtt: 'RTT-latentie',
    trail: 'Spoor:',
    net_connect: '🔌 Verbinding',
    ms_pitch: '🎵 Toonhoogte',
    spk_channel: 'Kanaal',
    done_phase: '✅ Test voltooid',
    dev_label: 'Apparaat',
    pm_avg: 'Gemiddeld',
    mic_samples: 'Samplerate',
    wifi_protocol: 'Protocol',
    si_lang: '🌍 Taal / Tijdzone',
    spk_freq: 'Frequentie',
    si_threads: 'Logische threads',
    dt_brightness: 'Helderheid',
    fp_moon: '🌙 Maan',
    wifi_test_time: 'Testtijd',
    cel_tab: '🎯 Schiettraining',
    mic_gate: 'Ruisdrempel',
    mic_too_loud: 'Te luid',
    ms_drum: '🥁 Drums',
    spk_triangle: 'Driehoek',
    wifi_isp_hdr: '📶 ISP / WiFi-provider',
    retest: '↺ Opnieuw',
    fx_shake: '📳 Schudden',
    pm_uptime: 'Uptime',
    wifi_dl_spd: 'Downloadsnelheid',
    middle_lbl: 'Midden',
    wifi_net_dev: '📡 Netwerkapparaat',
    wifi_isp: 'Provider (ISP)',
    clicks: 'Klikken',
    spk_sweep: '📈 Frequentiesweep',
    mic_speak_t: 'Spreektijd',
    wifi_all_hint: 'Gebruik een app voor alle apparaten',
    wifi_webrtc: 'WebRTC kan lokaal IP tonen:',
    spk_ch_test: '📢 Test kanalen L/R',
    pm_heap: '🧠 JS Heap',
    deep_voice: 'Diep',
    max_cps: 'Max klik/sec',
    position: 'Positie',
    hue_rot: 'Tint',
    wifi_webrtc_hdr: '🔍 Lokaal IP via WebRTC',
    mic_kb_sound: 'Toetsenbordgeluid',
    pm_res: 'Resolutie',
    heat_tab: '🔥 Warmtekaart',
    wifi_gateway: 'Standaardgateway',
    mouse_mid: 'Middelste knop',
    wifi_rtt_api: 'RTT (API)',
    wifi_title: 'WiFi-netwerkapparaten',
    vol_output: '🔊 Uitgangsvolume',
    mic_freq_dom: 'Dom. frequentie',
    mic_monitor: 'Stemmonitor actief',
    kb_delay: 'Vertraging',
    pm_fps_avg: 'gem. — fps',
    wifi_private_range: 'Privé-bereik',
    wifi_unavail: '❌ Niet beschikbaar',
    spk_click_hint: 'Klik op een kanaal',
    squirrel_v: 'Eekhoorn',
    dt_nav: '🖱 Menu bij hover • ESC=Sluiten',
    ul_phase: '⬆️ Uploaden — 25 sec.',
    mic_range: 'Vocaal bereik',
    cel_playing: 'Klik op de doelwitten!',
    mic_spk_lbl: '🔊 Uitgangsvolume',
    ms_chipmunk: '🐿️ Eekhoorn',
    few_lbl: 'Weinig',
    cel_stop: '◼ Stop',
    mic_qual_lbl: 'Signaalkwaliteit',
    fx_fire: '🔥 Vuur',
    pm_long_tasks: 'Lange taken (>50ms)',
    wifi_refresh: '↺ Vernieuwen',
    mic_noise_lbl: 'Omgevingsgeluid',
    wifi_gps: 'GPS-coördinaten',
    wifi_std: 'Standaard / Protocol',
    wifi_vpn: 'VPN / Proxy / TOR',
    move_tab: '🕹️ Beweging',
    spk_center: 'Middelste kanaal (C)',
    mic_osc: 'Oscilloscoop',
    wifi_net_info: '🌐 Netwerkinfo',
    ms_chorus: '👥 Koor',
    wifi_hostname: 'Hostnaam',
    wifi_timezone: 'Tijdzone',
    cel_start: '▶ Starten',
    spk_saw: 'Zaagtand',
    dl_phase: '⬇️ Downloaden — 25 sec.',
    time_left: 'Tijd:',
    pm_title: 'Prestaties',
    wifi_detecting: 'Detecteren via WebRTC...',
    pm_transfer: '📦 Verbruik overdracht',
    dt_crosshair: '✛ Vizier',
    mic_spec_lbl: 'Spectrum',
    mic_wait: 'Wachten...',
    mouse_scroll: 'Scrollen',
    net_start_lbl: 'Druk op START',
    mic_bitdepth: 'Bitdiepte',
    ping_phase: '📡 Ping — 10 sec.',
    mic_spectrum: 'Spectrum',
    cel_miss: 'Gemist',
    mic_noise: 'Achtergrondgeluid',
    si_batt_load: 'Laden...',
    jitter: 'Jitter',
    cel_score: 'Score',
    heat_hint: 'Heatmap — klik voor distributie',
    fp_soft: '☁️ Zacht',
    trail_off: 'Uit',
    fp_warm: '🌅 Warm',
    ms_deep: '👹 Diep',
    kb_sound_off: 'Uit',
    time_label: 'Tijd:',
    wifi_limit: 'Browserlimiet:',
    Clicks: 'Klikken',
    Quality: 'Kwaliteit',
    TIME: 'TIJD',
    Time: 'Tijd',
    Trail: 'Spoor',
    VOLUME: 'VOLUME',
    freq: 'Frequentie',
    limitation: 'Browserlimiet:'
  },
  pt: {
    ld_init: 'INICIALIZANDO...', ld_modules: 'CARREGANDO MÓDULOS...', ld_camera: 'VERIFICANDO CÂMERA...', ld_ready: 'PRONTO!',
    badge: 'PT',
    btn_network_scanner: 'Scanner de rede',
    btn_chroma_key: 'Chroma Key',
    btn_dns_lookup: 'Pesquisa DNS',
    btn_ai_asystent: 'Assistente IA',
    btn_fps: 'Teste FPS', camera: 'Câmera', microphone: 'Microfone', mic_test: 'Teste microfone', mic_studio: 'Estúdio microfone',
    net_test: 'Teste internet', kb_test: 'Teste teclado', quality: 'Qualidade:', fps_label: 'FPS:',
    mouse_test: 'Teste rato', sys_info: 'Info sistema', display: 'Ecrã', wifi: 'WiFi',
    perf: 'Monitor desemp.', net_press_start: 'Prima START', net_start_btn: '▶ START', net_testing: '⏳ A testar...', net_retest: '↺ REPETIR TESTE',
    net_score_great: '🏆 Excelente', net_score_good: '✅ Bom', net_score_avg: '⚡ Médio', net_score_poor: '❌ Mau',
    net_phase_ping: '📡 Ping — 10 seg.', net_phase_down: '⬇️ Download — 25 seg.', net_phase_up: '⬆️ Upload — 25 seg.', net_phase_done: '✅ Teste concluído', net_unit_dl: 'Mb/s',
    net_rate_ok: '✅ OK', net_rate_weak: '❌ Muito lento', net_rate_great: '✅ Excelente', net_rate_ok2: '⚡ Aceitável', net_rate_lag: '❌ Lag',
    net_rate_smooth: '✅ Fluido', net_rate_possible: '⚡ Possível', net_rate_buf: '❌ Buffering', net_rate_fast: '✅ Rápido', net_rate_normal: '⚡ Normal', net_rate_slow: '❌ Lento',
    speakers: 'Teste altifalantes', voice_effects: 'Efeitos de voz', normal: 'Normal', robot: 'Robot', deep: 'Grave', squirrel: 'Esquilo', echo: 'Eco', phone: 'Telefone',
    pitch: 'Tom', rate: 'Velocidade', css_filters: 'Filtros CSS', reset: 'Repor',
    brightness: 'Brilho', contrast: 'Contraste', saturation: 'Saturação', hue: 'Matiz', blur: 'Desfoque',
    special_fx: 'Efeitos especiais', record: 'Gravar vídeo', rec_stop: 'Parar grav.', rec_download: 'Descarregar', rec_tag: 'A GRAVAR', snapshot: 'Captura',
    start: 'Iniciar', stop: 'Parar', cam_on: 'Câmera ON', cam_off: 'Câmera OFF',
    snapshot_btn: 'Tirar foto', cam_start_hint: 'Inicie a câmera para começar',
    react_btn: 'Teste de reação', vr_btn: 'Modificador de voz', vr_click_rec: 'Clique para gravar',
    vr_click_play: 'Gravado — clique ▶ para ouvir', vr_presets: 'PREDEFINIÇÃO VOZ',
    vr_pitch: '🎵 Tom', vr_speed: '⚡ Velocidade', vr_bass: '🔉 Graves', vr_treble: '🔈 Agudos',
    rt_wait: 'Clique para começar', rt_wait_green: 'Aguarde o sinal verde…',
    rt_click_now: 'CLIQUE AGORA!', rt_early: 'Cedo demais!', rt_again: 'Clique para tentar novamente',
    rt_last: 'ÚLTIMO', rt_best: 'MELHOR', rt_avg: 'MÉDIA', rt_tries: 'TENTATIVAS',
    rt_hist: 'HISTOGRAMA RESULTADOS (ms)', rt_reset: '↺ REINICIAR',
    rt_streak_lbl: 'SÉRIE ABAIXO DA MÉDIA', rt_streak_cur: ' atual', rt_streak_best_lbl: 'máx',
    rt_rank_title: 'A SUA PONTUAÇÃO', rt_avg_label: 'Média', rt_progress: 'PROGRESSO TENTATIVAS',
    rt_chart_empty: 'Sem dados — faça algumas tentativas', rt_attempt: 'Tentativa 1',
    wifi_detecting2: 'A detetar...', pm_refresh: '↺ Atualizar', pm_files: 'ficheiros',
    clear: '↺ Limpar', wifi_local_ip: 'IP local (LAN)', wifi_public_ip: 'IP público (WAN)',
    spk_both: '▶ Ambos os canais', spk_hear_start: '▶ Iniciar teste audição', spk_vol_lbl: '🔉 Volume:',
    si_memory: 'Memória RAM', si_browser: '🌐 Browser', touch_label: '📱 Toque / Ponteiros',
    mic_start_hint: 'Ative o microfone para começar', kb_press_hint: 'Prima START e depois escreva',
    distance: 'Distância',
    cps: 'Cliques/seg',
    spk_hear_hint: '✓ se ouvir, ✗ se não',
    kb_pressed: 'Premido',
    fx_bubbles: '🫧 Bolhas',
    pm_ram_use: 'Uso RAM',
    cel_press_start: 'Prima START para começar',
    spk_hearing: '👂 Teste audição',
    avg_val: 'Médio',
    fx_snow: '❄️ Neve',
    cel_acc: 'Precisão',
    si_res: 'Resolução',
    trail_on: 'Lig',
    fx_off: '✖ Desativar',
    mic_snr: 'SNR',
    net_open: 'Painel aberto — prima START',
    testing: 'A testar...',
    si_gb: 'GB (dados nav.)',
    wifi_speed_decl: 'Velocidade declarada',
    spd_lbl: 'Upload',
    speed: 'Velocidade',
    wifi_class: 'Classe rede',
    fx_spring: '🌀 Mola',
    rate_lbl: 'Velocidade',
    connect_lbl: '🔌 Ligação',
    wifi_org: 'Organização / AS',
    dt_pattern: 'Padrão',
    wifi_type: 'Tipo de ligação',
    mouse_move_hint: 'Mova o rato na área',
    mic_vol_lbl: 'Nível sonoro',
    offline: '❌ Offline',
    pitch_lbl: 'Tom',
    perf_prog: 'Progresso teste',
    wifi_my_dev: '📱 O SEU DISPOSITIVO',
    spk_progress: 'Progresso',
    wifi_ua: 'USER AGENT (abreviado)',
    pm_total: 'Total',
    mic_voice_lbl: '🎙️ Voz',
    many_lbl: 'Muito',
    mic_high_avg: 'Méd. agudos',
    mic_channels: 'Canais',
    voice_fx: 'Efeitos de voz',
    spk_own_freq: 'Frequência personalizada:',
    cel_hits: 'Acertos',
    heat_clicks: 'Cliques:',
    cel_avg: 'T. méd.',
    mic_reduction: 'Redução ruído',
    net_spd_live: '📊 Velocidade live',
    blur_lbl: 'Desfoque',
    mouse_btn_test: 'Teste botões',
    wifi_asn: 'Número AS (ASN)',
    fp_sunset: '🌇 Pôr do sol',
    avg_lbl: 'Média',
    wifi_mask: 'Máscara sub-rede',
    mic_low_avg: 'Méd. graves',
    dt_solid: '⬛ Sólido',
    spk_tone_gen: '🎵 Gerador tons',
    pm_js_perf: '⚡ DESEMPENHO JS',
    ms_underwater: '🌊 Debaixo da água',
    fx_blur: '💫 Desfoque',
    wifi_rtt: 'Latência RTT',
    trail: 'Rasto:',
    net_connect: '🔌 Ligação',
    ms_pitch: '🎵 Tom',
    spk_channel: 'Canal',
    done_phase: '✅ Teste concluído',
    dev_label: 'Dispositivo',
    pm_avg: 'Média',
    mic_samples: 'Taxa amostragem',
    wifi_protocol: 'Protocolo',
    si_lang: '🌍 Língua / Fuso',
    spk_freq: 'Frequência',
    si_threads: 'Threads lógicas',
    dt_brightness: 'Brilho',
    fp_moon: '🌙 Lua',
    wifi_test_time: 'Hora do teste',
    cel_tab: '🎯 Treino de mira',
    mic_gate: 'Limiar ruído',
    mic_too_loud: 'Demasiado alto',
    ms_drum: '🥁 Bateria',
    spk_triangle: 'Triangular',
    wifi_isp_hdr: '📶 ISP / WiFi',
    retest: '↺ Repetir',
    fx_shake: '📳 Tremor',
    pm_uptime: 'Tempo ativo',
    wifi_dl_spd: 'Velocidade download',
    middle_lbl: 'Centro',
    wifi_net_dev: '📡 Dispositivo rede',
    wifi_isp: 'Fornecedor (ISP)',
    clicks: 'Cliques',
    spk_sweep: '📈 Varrimento frequências',
    mic_speak_t: 'Tempo fala',
    wifi_all_hint: 'Para todos os dispositivos use uma app',
    wifi_webrtc: 'WebRTC pode expor IP local:',
    spk_ch_test: '📢 Teste canais E/D',
    pm_heap: '🧠 JS Heap',
    deep_voice: 'Grave',
    max_cps: 'Máx cliques/seg',
    position: 'Posição',
    hue_rot: 'Matiz',
    wifi_webrtc_hdr: '🔍 IP local via WebRTC',
    mic_kb_sound: 'Som teclado',
    pm_res: 'Resolução',
    heat_tab: '🔥 Mapa de calor',
    wifi_gateway: 'Gateway (típico)',
    mouse_mid: 'Botão central',
    wifi_rtt_api: 'RTT (API)',
    wifi_title: 'Dispositivos rede WiFi',
    vol_output: '🔊 Vol. saída',
    mic_freq_dom: 'Freq. dominante',
    mic_monitor: 'Monitor ativo',
    kb_delay: 'Atraso',
    pm_fps_avg: 'méd. — fps',
    wifi_private_range: 'Gama privada',
    wifi_unavail: '❌ Indisponível',
    spk_click_hint: 'Clique num canal',
    squirrel_v: 'Esquilo',
    dt_nav: '🖱 Menu ao passar • ESC=Fechar',
    ul_phase: '⬆️ Upload — 25 seg.',
    mic_range: 'Gama vocal',
    cel_playing: 'Clique nos alvos!',
    mic_spk_lbl: '🔊 Vol. saída',
    ms_chipmunk: '🐿️ Esquilo',
    few_lbl: 'Pouco',
    cel_stop: '◼ Parar',
    mic_qual_lbl: 'Qualidade sinal',
    fx_fire: '🔥 Fogo',
    pm_long_tasks: 'Tarefas longas (>50ms)',
    wifi_refresh: '↺ Atualizar',
    mic_noise_lbl: 'Ruído ambiente',
    wifi_gps: 'Coordenadas GPS',
    wifi_std: 'Padrão / Protocolo',
    wifi_vpn: 'VPN / Proxy / TOR',
    move_tab: '🕹️ Movimento',
    spk_center: 'Canal central (C)',
    mic_osc: 'Osciloscópio',
    wifi_net_info: '🌐 Info rede',
    ms_chorus: '👥 Coro',
    wifi_hostname: 'Nome do host',
    wifi_timezone: 'Fuso horário',
    cel_start: '▶ Iniciar',
    spk_saw: 'Dente de serra',
    dl_phase: '⬇️ Download — 25 seg.',
    time_left: 'Tempo:',
    pm_title: 'Desempenho',
    wifi_detecting: 'A detetar via WebRTC...',
    pm_transfer: '📦 Transferência',
    dt_crosshair: '✛ Mira',
    mic_spec_lbl: 'Espectro',
    mic_wait: 'Aguardando...',
    mouse_scroll: 'Deslocamento',
    net_start_lbl: 'Premir START',
    mic_bitdepth: 'Profundidade bits',
    ping_phase: '📡 Ping — 10 seg.',
    mic_spectrum: 'Espectro',
    cel_miss: 'Erros',
    mic_noise: 'Ruído fundo',
    si_batt_load: 'Carregando...',
    jitter: 'Jitter',
    cel_score: 'Pontuação',
    heat_hint: 'Heatmap — clique para distribuição',
    fp_soft: '☁️ Suave',
    trail_off: 'Desl',
    fp_warm: '🌅 Quente',
    ms_deep: '👹 Grave',
    kb_sound_off: 'Desl',
    time_label: 'Tempo:',
    wifi_limit: 'Limite browser:',
    Clicks: 'Cliques',
    Quality: 'Qualidade',
    TIME: 'TEMPO',
    Time: 'Tempo',
    Trail: 'Rasto',
    VOLUME: 'VOLUME',
    freq: 'Frequência',
    limitation: 'Limite browser:'
  },
  ua: {
    ld_init: 'ІНІЦІАЛІЗАЦІЯ...', ld_modules: 'ЗАВАНТАЖЕННЯ МОДУЛІВ...', ld_camera: 'ПЕРЕВІРКА КАМЕРИ...', ld_ready: 'ГОТОВО!',
    badge: 'UA',
    btn_network_scanner: 'Мережевий сканер',
    btn_chroma_key: 'Хромакей',
    btn_dns_lookup: 'DNS-пошук',
    btn_ai_asystent: 'ШІ-асистент',
    btn_fps: 'Тест FPS', camera: 'Камера', microphone: 'Мікрофон', mic_test: 'Тест мікрофона', mic_studio: 'Студія мікрофона',
    net_test: 'Тест інтернету', kb_test: 'Тест клавіатури', quality: 'Якість:', fps_label: 'FPS:',
    mouse_test: 'Тест миші', sys_info: 'Інфо система', display: 'Екран', wifi: 'WiFi',
    perf: 'Монітор продукт.', net_press_start: 'Натисніть START', net_start_btn: '▶ START', net_testing: '⏳ Тестування...', net_retest: '↺ ПОВТОРИТИ',
    net_score_great: '🏆 Відмінно', net_score_good: '✅ Добре', net_score_avg: '⚡ Середньо', net_score_poor: '❌ Погано',
    net_phase_ping: '📡 Ping — 10 сек.', net_phase_down: '⬇️ Завантаження — 25 сек.', net_phase_up: '⬆️ Вивантаження — 25 сек.', net_phase_done: '✅ Тест завершено', net_unit_dl: 'Мб/с',
    net_rate_ok: '✅ OK', net_rate_weak: '❌ Занадто повільно', net_rate_great: '✅ Відмінно', net_rate_ok2: '⚡ Прийнятно', net_rate_lag: '❌ Затримка',
    net_rate_smooth: '✅ Плавно', net_rate_possible: '⚡ Можливо', net_rate_buf: '❌ Буферизація', net_rate_fast: '✅ Швидко', net_rate_normal: '⚡ Нормально', net_rate_slow: '❌ Повільно',
    speakers: 'Тест гучномовців', voice_effects: 'Ефекти голосу', normal: 'Звичайний', robot: 'Робот', deep: 'Глибокий', squirrel: 'Білка', echo: 'Луна', phone: 'Телефон',
    pitch: 'Тон', rate: 'Швидкість', css_filters: 'CSS фільтри', reset: 'Скинути',
    brightness: 'Яскравість', contrast: 'Контраст', saturation: 'Насиченість', hue: 'Відтінок', blur: 'Розмиття',
    special_fx: 'Спецефекти', record: 'Записати відео', rec_stop: 'Зупинити запис', rec_download: 'Завантажити', rec_tag: 'ЗАПИС', snapshot: 'Знімок',
    start: 'Почати', stop: 'Зупинити', cam_on: 'Камера ON', cam_off: 'Камера OFF',
    snapshot_btn: 'Зробити фото', cam_start_hint: 'Запустіть камеру щоб почати',
    react_btn: 'Тест реакції', vr_btn: 'Змінювач голосу', vr_click_rec: 'Клікніть для запису',
    vr_click_play: 'Записано — клікніть ▶ для відтворення', vr_presets: 'ПРЕСЕТИ ГОЛОСУ',
    vr_pitch: '🎵 Тон', vr_speed: '⚡ Швидкість', vr_bass: '🔉 Баси', vr_treble: '🔈 Верхи',
    rt_wait: 'Клікніть щоб почати', rt_wait_green: 'Чекайте зеленого сигналу…',
    rt_click_now: 'КЛІКАЙТЕ ЗАРАЗ!', rt_early: 'Занадто рано!', rt_again: 'Клікніть щоб спробувати знову',
    rt_last: 'ОСТАННІЙ', rt_best: 'НАЙКРАЩИЙ', rt_avg: 'СЕРЕДНЄ', rt_tries: 'СПРОБИ',
    rt_hist: 'ГІСТОГРАМА РЕЗУЛЬТАТІВ (мс)', rt_reset: '↺ СКИНУТИ',
    rt_streak_lbl: 'СЕРІЯ НИЖЧЕ СЕРЕДНЬОГО', rt_streak_cur: ' поточна', rt_streak_best_lbl: 'макс',
    rt_rank_title: 'ВАША ОЦІНКА', rt_avg_label: 'Середнє', rt_progress: 'ПРОГРЕС СПРОБ',
    rt_chart_empty: 'Немає даних — зробіть кілька спроб', rt_attempt: 'Спроба 1',
    wifi_detecting2: 'Визначення...', pm_refresh: '↺ Оновити', pm_files: 'файлів',
    clear: '↺ Очистити', wifi_local_ip: 'Локальний IP (LAN)', wifi_public_ip: 'Публічний IP (WAN)',
    spk_both: '▶ Обидва канали', spk_hear_start: '▶ Почати тест слуху', spk_vol_lbl: '🔉 Гучність:',
    si_memory: 'Оперативна память', si_browser: '🌐 Браузер', touch_label: '📱 Дотик / Вказівники',
    mic_start_hint: 'Увімкніть мікрофон щоб почати', kb_press_hint: 'Натисніть START і друкуйте',
    distance: 'Відстань',
    cps: 'Клік/сек',
    spk_hear_hint: '✓ якщо чуєш, ✗ якщо ні',
    kb_pressed: 'Натиснуто',
    fx_bubbles: '🫧 Бульбашки',
    pm_ram_use: 'Використання RAM',
    cel_press_start: 'Натисніть START щоб почати',
    spk_hearing: '👂 Тест слуху',
    avg_val: 'Середній',
    fx_snow: '❄️ Сніг',
    cel_acc: 'Точність',
    si_res: 'Роздільна здатність',
    trail_on: 'Увімк',
    fx_off: '✖ Вимкнути',
    mic_snr: 'SNR',
    net_open: 'Панель відкрита — натисніть START',
    testing: 'Тестування...',
    si_gb: 'ГБ (дані браузера)',
    wifi_speed_decl: 'Задекларована швидкість',
    spd_lbl: 'Вивантаження',
    speed: 'Швидкість',
    wifi_class: 'Клас мережі',
    fx_spring: '🌀 Пружина',
    rate_lbl: 'Швидкість',
    connect_lbl: '🔌 Підключення',
    wifi_org: 'Організація / AS',
    dt_pattern: 'Шаблон',
    wifi_type: 'Тип підключення',
    mouse_move_hint: 'Рухайте мишею по полю',
    mic_vol_lbl: 'Рівень звуку',
    offline: '❌ Немає мережі',
    pitch_lbl: 'Тон',
    perf_prog: 'Прогрес тесту',
    wifi_my_dev: '📱 ВАШ ПРИСТРІЙ',
    spk_progress: 'Прогрес',
    wifi_ua: 'USER AGENT (скорочено)',
    pm_total: 'Всього',
    mic_voice_lbl: '🎙️ Голос',
    many_lbl: 'Багато',
    mic_high_avg: 'Сер. верхів',
    mic_channels: 'Канали',
    voice_fx: 'Ефекти голосу',
    spk_own_freq: 'Власна частота:',
    cel_hits: 'Влучань',
    heat_clicks: 'Кліків:',
    cel_avg: 'Сер. час',
    mic_reduction: 'Шумозаглушення',
    net_spd_live: '📊 Швидкість в реальному часі',
    blur_lbl: 'Розмиття',
    mouse_btn_test: 'Тест кнопок',
    wifi_asn: 'Номер AS (ASN)',
    fp_sunset: '🌇 Захід',
    avg_lbl: 'Середнє',
    wifi_mask: 'Маска підмережі',
    mic_low_avg: 'Сер. низів',
    dt_solid: '⬛ Однотонний',
    spk_tone_gen: '🎵 Генератор тонів',
    pm_js_perf: '⚡ ПРОДУКТИВНІСТЬ JS',
    ms_underwater: '🌊 Під водою',
    fx_blur: '💫 Розмиття',
    wifi_rtt: 'Затримка RTT',
    trail: 'Слід:',
    net_connect: '🔌 Підключення',
    ms_pitch: '🎵 Тон',
    spk_channel: 'Канал',
    done_phase: '✅ Тест завершено',
    dev_label: 'Пристрій',
    pm_avg: 'Середнє',
    mic_samples: 'Частота дискретизації',
    wifi_protocol: 'Протокол',
    si_lang: '🌍 Мова / Часовий пояс',
    spk_freq: 'Частота',
    si_threads: 'Логічні потоки',
    dt_brightness: 'Яскравість',
    fp_moon: '🌙 Місяць',
    wifi_test_time: 'Час тесту',
    cel_tab: '🎯 Тир',
    mic_gate: 'Поріг шуму',
    mic_too_loud: 'Занадто голосно',
    ms_drum: '🥁 Барабан',
    spk_triangle: 'Трикутна',
    wifi_isp_hdr: '📶 ISP / WiFi',
    retest: '↺ Повторити',
    fx_shake: '📳 Тремтіння',
    pm_uptime: 'Час роботи',
    wifi_dl_spd: 'Швидкість завант.',
    middle_lbl: 'Середина',
    wifi_net_dev: '📡 Мережевий пристрій',
    wifi_isp: 'Провайдер (ISP)',
    clicks: 'Кліків',
    spk_sweep: '📈 Частотне сканування',
    mic_speak_t: 'Час мовлення',
    wifi_all_hint: 'Для всіх пристроїв використовуйте додаток',
    wifi_webrtc: 'WebRTC може розкрити IP:',
    spk_ch_test: '📢 Тест каналів Л/П',
    pm_heap: '🧠 JS Heap',
    deep_voice: 'Глибокий',
    max_cps: 'Макс клік/сек',
    position: 'Позиція',
    hue_rot: 'Відтінок',
    wifi_webrtc_hdr: '🔍 Локальний IP через WebRTC',
    mic_kb_sound: 'Звук клавіш',
    pm_res: 'Роздільна здатність',
    heat_tab: '🔥 Теплова карта',
    wifi_gateway: 'Шлюз (типовий)',
    mouse_mid: 'Середня кнопка',
    wifi_rtt_api: 'RTT (API)',
    wifi_title: 'Мережеві пристрої WiFi',
    vol_output: '🔊 Гучність виходу',
    mic_freq_dom: 'Домін. частота',
    mic_monitor: 'Моніторинг голосу',
    kb_delay: 'Затримка',
    pm_fps_avg: 'сер. — fps',
    wifi_private_range: 'Приватний діапазон',
    wifi_unavail: '❌ Недоступно',
    spk_click_hint: 'Клікніть на канал',
    squirrel_v: 'Білка',
    dt_nav: '🖱 Меню при наведенні • ESC=Закрити',
    ul_phase: '⬆️ Вивантаження — 25 сек.',
    mic_range: 'Голосовий діапазон',
    cel_playing: 'Клікайте по цілях!',
    mic_spk_lbl: '🔊 Гучність виходу',
    ms_chipmunk: '🐿️ Бурундук',
    few_lbl: 'Мало',
    cel_stop: '◼ Стоп',
    mic_qual_lbl: 'Якість сигналу',
    fx_fire: '🔥 Вогонь',
    pm_long_tasks: 'Довгі задачі (>50мс)',
    wifi_refresh: '↺ Оновити',
    mic_noise_lbl: 'Навколишній шум',
    wifi_gps: 'Координати GPS',
    wifi_std: 'Стандарт / Протокол',
    wifi_vpn: 'VPN / Проксі / TOR',
    move_tab: '🕹️ Рух',
    spk_center: 'Центральний канал (C)',
    mic_osc: 'Осцилограф',
    wifi_net_info: '🌐 Інфо мережі',
    ms_chorus: '👥 Хор',
    wifi_hostname: 'Ім’я хоста',
    wifi_timezone: 'Часовий пояс',
    cel_start: '▶ Почати',
    spk_saw: 'Пилкоподібна',
    dl_phase: '⬇️ Завантаження — 25 сек.',
    time_left: 'Час:',
    pm_title: 'Продуктивність',
    wifi_detecting: 'Визначення через WebRTC...',
    pm_transfer: '📦 Трафік',
    dt_crosshair: '✛ Приціл',
    mic_spec_lbl: 'Спектр',
    mic_wait: 'Очікування...',
    mouse_scroll: 'Прокрутка',
    net_start_lbl: 'Натиснути START',
    mic_bitdepth: 'Бітова глибина',
    ping_phase: '📡 Ping — 10 сек.',
    mic_spectrum: 'Спектр',
    cel_miss: 'Промахів',
    mic_noise: 'Фоновий шум',
    si_batt_load: 'Завантаження...',
    jitter: 'Нестабільність',
    cel_score: 'Рахунок',
    heat_hint: 'Heatmap — клікайте для розподілу',
    fp_soft: '☁️ М’який',
    trail_off: 'Вимк',
    fp_warm: '🌅 Теплий',
    ms_deep: '👹 Глибокий',
    kb_sound_off: 'Вимк',
    time_label: 'Час:',
    wifi_limit: 'Обмеження браузера:',
    Clicks: 'Кліків',
    Quality: 'Якість',
    TIME: 'ЧАС',
    Time: 'Час',
    Trail: 'Слід',
    VOLUME: 'ГУЧНІСТЬ',
    freq: 'Частота',
    limitation: 'Обмеження браузера:'
  },
};

function t(key) {
  return (I18N[currentLang] && I18N[currentLang][key]) || I18N.pl[key] || key;
}

function ldPickLang(lang) {
  currentLang = lang;
  document.querySelectorAll('.ld-lang').forEach(b => b.classList.toggle('active', b.dataset.l === lang));
  const status = document.getElementById('ldStatus');
  if(status) status.textContent = t('ld_init');
}

function setLang(lang) {
  currentLang = lang;
  window.currentLang = lang;
  document.querySelectorAll('.lang-btn').forEach(b => b.classList.toggle('active', b.dataset.l === lang));
  document.querySelectorAll('.ld-lang').forEach(b => b.classList.toggle('active', b.dataset.l === lang));
  const badge = document.getElementById('versionBadge');
  if(badge) badge.textContent = 'v7.8 / ' + t('badge');
  applyI18n();
  applySettingsI18n();
  // Odśwież About jeśli otwarty
  const aboutModal = document.getElementById('aboutModal');
  if(aboutModal && aboutModal.classList.contains('show')) openAbout();
  // Re-render AI bot quick questions in new language
  if(document.getElementById('aiBotQuickBtns')) aiBotRenderQuick();
}

function applyI18n() {
  // ID-map dla elementów bez data-i18n
  const map = {
    'camLabel':      t('camera'),
    'micLabel':      t('microphone'),
    'camResInfo':    t('camResInfo') || '',
    'kbBtnSoundOff': t('kb_sound_off'),
    'msMonitorLabel':t('mic_monitor'),
    'spkChStatus':   t('spk_ch_test'),
    'spkBtnBoth':    t('spk_both'),
    'netPhaseLabel': t('net_open'),
    'mTrailBtn':     t('trail_on'),
    'kbHint':        t('kb_press_hint'),
  };
  Object.entries(map).forEach(([id, text]) => {
    const el = document.getElementById(id);
    if(el && text) el.textContent = text;
  });
  // data-i18n elements
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    const val = t(key);
    if(val && val !== key) el.textContent = val;
  });
  // data-i18n-placeholder
  document.querySelectorAll('[data-i18n-ph]').forEach(el => {
    const val = t(el.dataset.i18nPh);
    if(val) el.placeholder = val;
  });
  // wifiLimitText – innerHTML
  const wlt = document.getElementById('wifiLimitText');
  if(wlt) {
    const msgs = {
      pl: '⚠️ <strong>Ograniczenie przeglądarki:</strong> Strona nie może uzyskać listy urządzeń sieciowych. Widoczne jest tylko Twoje połączenie.',
      en: '⚠️ <strong>Browser limitation:</strong> The page cannot access the network device list. Only your own connection is visible.',
      de: '⚠️ <strong>Browser-Einschränkung:</strong> Die Seite kann nicht auf die Netzwerkgeräteliste zugreifen.',
      ru: '⚠️ <strong>Ограничение браузера:</strong> Страница не может получить список сетевых устройств.',
      zh: '⚠️ <strong>浏览器限制：</strong> 网站无法访问网络设备列表。只能看到您自己的连接信息。',
    };
    wlt.innerHTML = msgs[currentLang] || msgs.pl;
  }
}

// —— Button ripple effect ——
document.addEventListener('click', function(e) {
  const btn = e.target.closest('.btn');
  if (!btn) return;
  const r = document.createElement('span');
  r.className = 'btn-ripple';
  const rect = btn.getBoundingClientRect();
  r.style.left = (e.clientX - rect.left) + 'px';
  r.style.top  = (e.clientY - rect.top)  + 'px';
  btn.appendChild(r);
  r.addEventListener('animationend', () => r.remove());
}, true);

// —— Loading sequence ——
(function initLoading() {
  const bar    = document.getElementById('ldBar');
  const status = document.getElementById('ldStatus');
  const screen = document.getElementById('loadingScreen');
  if(!screen) return;

  const steps = [
    [5,  'ld_init',    200],
    [20, 'ld_modules', 1500],
    [40, 'ld_modules', 3500],
    [60, 'ld_camera',  5500],
    [80, 'ld_camera',  7500],
    [95, 'ld_ready',   9000],
  ];
  steps.forEach(([pct, key, delay]) => {
    setTimeout(() => {
      if(bar) bar.style.width = pct + '%';
      if(status) status.textContent = t(key);
    }, delay);
  });

  function hideLoader() {
    setTimeout(() => {
      if(bar) bar.style.width = '100%';
      if(status) status.textContent = t('ld_ready');
      setTimeout(() => {
        screen.style.opacity = '0';
        screen.style.visibility = 'hidden';
        setLang(currentLang);
      }, 600);
    }, 10000); // 10 sekund
  }

  if(document.readyState === 'complete') {
    hideLoader();
  } else {
    window.addEventListener('load', hideLoader);
    setTimeout(hideLoader, 10500);
  }
})();

// ══════════════════════════════════════════════════════
// CSP TESTER
// ══════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════
// DNS LOOKUP
// ══════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════
// O APLIKACJI (ABOUT)
// ══════════════════════════════════════════════════════
const ABOUT_I18N = {
  pl: {
    desc: 'Kompleksowe narzędzie diagnostyczne przeglądarki. Testuj kamerę, mikrofon, głośniki, sieć, klawiaturę, mysz, wydajność i wiele więcej — wszystko w jednym pliku HTML, bez instalacji.',
    mainCreator: 'GŁÓWNY TWÓRCA', mainSub: 'Koncepcja · Design · Wizja',
    aiLabel: 'AI DEVELOPER', aiSub: 'Kod · Logika · AI',
    langs: 'JĘZYKÓW', infoBtn: 'ℹ️ INFO', modules: 'MODUŁÓW', files: 'PLIK HTML', deps: 'ZALEŻNOŚCI', size: 'ROZMIAR', lines: 'LINII KODU', themes: 'MOTYWÓW',
    modulesLabel: '📋 MODUŁY', techLabel: '⚙️ TECHNOLOGIE', privacyLabel: '🔒 PRYWATNOŚĆ', changelogLabel: '📝 CHANGELOG',
    modulesList: ['📷 Kamera + filtry + Chroma Key','🎙️ Mikrofon + VU + spektrum','🎵 Zmieniacze głosu (28 presetów)','🔊 Test głośników + generator tonów','🌐 Test internetu + ping + mapa','🎮 Test FPS + VSync + histogram','⚡ Test reakcji + statystyki','🖱️ Test myszy + heatmapa + CPS','⌨️ Test klawiatury + 30 dźwięków','📊 Monitor wydajności + JS bench','ℹ️ Info systemowe + GPU + bateria','🖥️ Test wyświetlacza + 40 kolorów','📡 Network Scanner + NAT + ISP','🔍 DNS Lookup + 31 presetów','🛡️ CSP Tester + Generator + Proxy','🤖 AI Asystent (13 języków + TTS)','📊 Raport sesji + eksport HTML','⚙️ Ustawienia · 11 motywów'],
    techList: [['Web Audio API','WebRTC','Canvas 2D / WebGL','MediaDevices API'],['Speech Synthesis API','Geolocation API','Battery API','Network Information API'],['Anthropic Claude API','Leaflet.js (mapy)','Google DNS over HTTPS'],['Karplus-Strong synthesis','FM / AM synthesis','localStorage','UA Client Hints API'],['CSS Custom Properties','CSS data-theme']],
    changelog: [['v7.8','11 motywów · Pełna integracja motywów · Loading screen z motywem · Przycisk Ustawienia'],['v7.7','GPS współrzędne · FPS percentyle/VSync/CSV · Nowe dźwięki klawiatury · CSP Proxy+Generator · Network Scanner v2 · DNS Lookup'],['v7.5','FPS histogram 60s · 1%/0.1% Low · CSP Tester · Szyfrowanie sieci · Raport sesji'],['v7.x','AI Asystent · Chroma Key · Monitor wydajności · DNS Lookup · 13 języków · TTS']],
    privacy: '✅ Brak serwera — wszystko działa lokalnie w przeglądarce\n✅ Żadne dane nie są wysyłane na zewnętrzne serwery\n✅ Kamera i mikrofon używane tylko lokalnie, nigdy nie nagrywane\n✅ Lokalizacja GPS używana tylko do wyświetlenia mapy — nie zapisywana\n⚠️ AI Asystent wysyła wiadomości do API Anthropic (Claude)',
    footer: 'Działa offline · Zero instalacji · Darmowy',
    settingsTitle: 'Ustawienia', settingsSubtitle: 'STUDIO TEST',
    themeLabel: '🎨 Motyw kolorystyczny', themesSectionHint: 'Zapisywany automatycznie',
    themeNames: { dark:'🌑 Dark', light:'☀️ Light', midnight:'🌌 Midnight Blue', forest:'🌿 Forest', sunset:'🌅 Sunset', ocean:'🌊 Ocean', rose:'🌸 Rose', nordic:'❄️ Nordic', latte:'☕ Latte', hacker:'💻 Hacker', candy:'🍬 Candy' }
  },
  en: {
    desc: 'A comprehensive browser diagnostic tool. Test your camera, microphone, speakers, network, keyboard, mouse, performance and more — all in a single HTML file, no installation needed.',
    mainCreator: 'LEAD CREATOR', mainSub: 'Concept · Design · Vision',
    aiLabel: 'AI DEVELOPER', aiSub: 'Code · Logic · AI',
    langs: 'LANGUAGES', infoBtn: 'ℹ️ INFO', modules: 'MODULES', files: 'HTML FILE', deps: 'DEPENDENCIES', size: 'SIZE', lines: 'LINES OF CODE', themes: 'THEMES',
    modulesLabel: '📋 MODULES', techLabel: '⚙️ TECHNOLOGIES', privacyLabel: '🔒 PRIVACY', changelogLabel: '📝 CHANGELOG',
    modulesList: ['📷 Camera + filters + Chroma Key','🎙️ Microphone + VU + spectrum','🎵 Voice changers (28 presets)','🔊 Speaker test + tone generator','🌐 Internet test + ping + map','🎮 FPS test + VSync + histogram','⚡ Reaction test + statistics','🖱️ Mouse test + heatmap + CPS','⌨️ Keyboard test + 30 sounds','📊 Performance monitor + JS bench','ℹ️ System info + GPU + battery','🖥️ Display test + 40 colors','📡 Network Scanner + NAT + ISP','🔍 DNS Lookup + 31 presets','🛡️ CSP Tester + Generator + Proxy','🤖 AI Assistant (13 languages + TTS)','📊 Session report + HTML export','⚙️ Settings · 11 themes'],
    techList: [['Web Audio API','WebRTC','Canvas 2D / WebGL','MediaDevices API'],['Speech Synthesis API','Geolocation API','Battery API','Network Information API'],['Anthropic Claude API','Leaflet.js (maps)','Google DNS over HTTPS'],['Karplus-Strong synthesis','FM / AM synthesis','localStorage','UA Client Hints API'],['CSS Custom Properties','CSS data-theme']],
    changelog: [['v7.8','11 themes · Full theme integration · Loading screen theming · Settings button'],['v7.7','GPS coords · FPS percentiles/VSync/CSV · New keyboard sounds · CSP Proxy+Generator · Network Scanner v2 · DNS Lookup'],['v7.5','FPS histogram 60s · 1%/0.1% Low · CSP Tester · Network encryption · Session report'],['v7.x','AI Assistant · Chroma Key · Performance monitor · DNS Lookup · 13 languages · TTS']],
    privacy: '✅ No server — everything runs locally in the browser\n✅ No data is sent to external servers\n✅ Camera and microphone used locally only, never recorded\n✅ GPS location used only to display the map — not stored\n⚠️ AI Assistant sends messages to Anthropic API (Claude)',
    footer: 'Works offline · Zero installation · Free',
    settingsTitle: 'Settings', settingsSubtitle: 'STUDIO TEST',
    themeLabel: '🎨 Color theme', themesSectionHint: 'Saved automatically',
    themeNames: { dark:'🌑 Dark', light:'☀️ Light', midnight:'🌌 Midnight Blue', forest:'🌿 Forest', sunset:'🌅 Sunset', ocean:'🌊 Ocean', rose:'🌸 Rose', nordic:'❄️ Nordic', latte:'☕ Latte', hacker:'💻 Hacker', candy:'🍬 Candy' }
  },
  de: {
    desc: 'Ein umfassendes Browser-Diagnosetool. Teste Kamera, Mikrofon, Lautsprecher, Netzwerk, Tastatur, Maus, Leistung und mehr — alles in einer HTML-Datei, ohne Installation.',
    mainCreator: 'HAUPTENTWICKLER', mainSub: 'Konzept · Design · Vision',
    aiLabel: 'KI-ENTWICKLER', aiSub: 'Code · Logik · KI',
    langs: 'SPRACHEN', infoBtn: 'ℹ️ INFO', modules: 'MODULE', files: 'HTML-DATEI', deps: 'ABHÄNGIGKEITEN', size: 'GRÖßE', lines: 'CODEZEILEN', themes: 'THEMES',
    modulesLabel: '📋 MODULE', techLabel: '⚙️ TECHNOLOGIEN', privacyLabel: '🔒 DATENSCHUTZ', changelogLabel: '📝 CHANGELOG',
    modulesList: ['📷 Kamera + Filter + Chroma Key','🎙️ Mikrofon + VU + Spektrum','🎵 Stimmwechsler (28 Presets)','🔊 Lautsprechertest + Tongenerator','🌐 Internettest + Ping + Karte','🎮 FPS-Test + VSync + Histogramm','⚡ Reaktionstest + Statistiken','🖱️ Maustest + Heatmap + CPS','⌨️ Tastaturtest + 30 Sounds','📊 Leistungsmonitor + JS-Bench','ℹ️ Systeminfo + GPU + Batterie','🖥️ Displaytest + 40 Farben','📡 Netzwerkscanner + NAT + ISP','🔍 DNS-Lookup + 31 Presets','🛡️ CSP-Tester + Generator + Proxy','🤖 KI-Assistent (13 Sprachen + TTS)','📊 Sitzungsbericht + HTML-Export','⚙️ Einstellungen · 11 Themes'],
    techList: [['Web Audio API','WebRTC','Canvas 2D / WebGL','MediaDevices API'],['Speech Synthesis API','Geolocation API','Battery API','Network Information API'],['Anthropic Claude API','Leaflet.js (Karten)','Google DNS over HTTPS'],['Karplus-Strong synthesis','FM / AM synthesis','localStorage','UA Client Hints API'],['CSS Custom Properties','CSS data-theme']],
    changelog: [['v7.8','11 Themes · Vollständige Theme-Integration · Loading Screen Theming · Einstellungen'],['v7.7','GPS-Koordinaten · FPS-Perzentile/VSync/CSV · Neue Tastaturgeräusche · CSP Proxy+Generator'],['v7.5','FPS-Histogramm 60s · 1%/0,1% Low · CSP-Tester · Netzwerkverschlüsselung · Sitzungsbericht'],['v7.x','KI-Assistent · Chroma Key · Leistungsmonitor · DNS-Lookup · 13 Sprachen · TTS']],
    privacy: '✅ Kein Server — alles läuft lokal im Browser\n✅ Keine Daten werden an externe Server gesendet\n✅ Kamera und Mikrofon nur lokal verwendet, nie aufgezeichnet\n✅ GPS-Standort nur zur Kartenanzeige — nicht gespeichert\n⚠️ KI-Assistent sendet Nachrichten an Anthropic API (Claude)',
    footer: 'Funktioniert offline · Keine Installation · Kostenlos',
    settingsTitle: 'Einstellungen', settingsSubtitle: 'STUDIO TEST',
    themeLabel: '🎨 Farbschema', themesSectionHint: 'Automatisch gespeichert',
    themeNames: { dark:'🌑 Dunkel', light:'☀️ Hell', midnight:'🌌 Midnight Blue', forest:'🌿 Wald', sunset:'🌅 Sonnenuntergang', ocean:'🌊 Ozean', rose:'🌸 Rose', nordic:'❄️ Nordisch', latte:'☕ Latte', hacker:'💻 Hacker', candy:'🍬 Candy' }
  },
  ru: {
    desc: 'Комплексный инструмент диагностики браузера. Тестируйте камеру, микрофон, динамики, сеть, клавиатуру, мышь, производительность и многое другое — всё в одном HTML-файле, без установки.',
    mainCreator: 'ГЛАВНЫЙ АВТОР', mainSub: 'Концепция · Дизайн · Видение',
    aiLabel: 'AI-РАЗРАБОТЧИК', aiSub: 'Код · Логика · ИИ',
    langs: 'ЯЗЫКОВ', infoBtn: 'ℹ️ ИНФО', modules: 'МОДУЛЕЙ', files: 'HTML ФАЙЛ', deps: 'ЗАВИСИМОСТЕЙ', size: 'РАЗМЕР', lines: 'СТРОК КОДА', themes: 'ТЕМ',
    modulesLabel: '📋 МОДУЛИ', techLabel: '⚙️ ТЕХНОЛОГИИ', privacyLabel: '🔒 КОНФИДЕНЦИАЛЬНОСТЬ', changelogLabel: '📝 ИСТОРИЯ ВЕРСИЙ',
    modulesList: ['📷 Камера + фильтры + Хромакей','🎙️ Микрофон + VU + спектр','🎵 Изменители голоса (28 пресетов)','🔊 Тест динамиков + генератор тонов','🌐 Тест интернета + пинг + карта','🎮 Тест FPS + VSync + гистограмма','⚡ Тест реакции + статистика','🖱️ Тест мыши + тепловая карта + CPS','⌨️ Тест клавиатуры + 30 звуков','📊 Монитор производительности + JS','ℹ️ Системная информация + GPU + батарея','🖥️ Тест дисплея + 40 цветов','📡 Сканер сети + NAT + ISP','🔍 DNS Lookup + 31 пресет','🛡️ CSP Тестер + Генератор + Прокси','🤖 ИИ Ассистент (13 языков + TTS)','📊 Отчёт сессии + экспорт HTML','⚙️ Настройки · 11 тем'],
    techList: [['Web Audio API','WebRTC','Canvas 2D / WebGL','MediaDevices API'],['Speech Synthesis API','Geolocation API','Battery API','Network Information API'],['Anthropic Claude API','Leaflet.js (карты)','Google DNS over HTTPS'],['Karplus-Strong synthesis','FM / AM synthesis','localStorage','UA Client Hints API'],['CSS Custom Properties','CSS data-theme']],
    changelog: [['v7.8','11 тем · Полная интеграция тем · Экран загрузки с темой · Кнопка настроек'],['v7.7','GPS-координаты · Перцентили FPS/VSync/CSV · Новые звуки клавиатуры · CSP Proxy+Generator'],['v7.5','Гистограмма FPS 60с · 1%/0.1% Low · CSP Тестер · Шифрование сети · Отчёт сессии'],['v7.x','ИИ Ассистент · Хромакей · Монитор · DNS · 13 языков · TTS']],
    privacy: '✅ Нет сервера — всё работает локально в браузере\n✅ Никакие данные не отправляются на внешние серверы\n✅ Камера и микрофон используются только локально\n✅ GPS-локация используется только для карты — не сохраняется\n⚠️ ИИ-ассистент отправляет сообщения в API Anthropic (Claude)',
    footer: 'Работает офлайн · Без установки · Бесплатно',
    settingsTitle: 'Настройки', settingsSubtitle: 'STUDIO TEST',
    themeLabel: '🎨 Цветовая тема', themesSectionHint: 'Сохраняется автоматически',
    themeNames: { dark:'🌑 Тёмная', light:'☀️ Светлая', midnight:'🌌 Полночь', forest:'🌿 Лес', sunset:'🌅 Закат', ocean:'🌊 Океан', rose:'🌸 Роза', nordic:'❄️ Нордик', latte:'☕ Латте', hacker:'💻 Хакер', candy:'🍬 Конфета' }
  },
  zh: {
    desc: '全面的浏览器诊断工具。测试摄像头、麦克风、扬声器、网络、键盘、鼠标、性能等等——所有功能集成在一个HTML文件中，无需安装。',
    mainCreator: '首席创作者', mainSub: '概念 · 设计 · 愿景',
    aiLabel: 'AI开发者', aiSub: '代码 · 逻辑 · AI',
    langs: '语言', infoBtn: 'ℹ️ 信息', modules: '模块', files: 'HTML文件', deps: '依赖项', size: '大小', lines: '代码行数', themes: '主题',
    modulesLabel: '📋 模块', techLabel: '⚙️ 技术', privacyLabel: '🔒 隐私', changelogLabel: '📝 更新日志',
    modulesList: ['📷 摄像头+滤镜+绿幕','🎙️ 麦克风+VU+频谱','🎵 变声器（28种预设）','🔊 扬声器测试+音调生成器','🌐 网速测试+延迟+地图','🎮 FPS测试+VSync+直方图','⚡ 反应测试+统计','🖱️ 鼠标测试+热图+CPS','⌨️ 键盘测试+30种音效','📊 性能监视器+JS基准','ℹ️ 系统信息+GPU+电池','🖥️ 显示器测试+40种颜色','📡 网络扫描仪+NAT+ISP','🔍 DNS查询+31种预设','🛡️ CSP测试+生成器+代理','🤖 AI助手（13语言+TTS）','📊 会话报告+HTML导出','⚙️ 设置 · 11种主题'],
    techList: [['Web Audio API','WebRTC','Canvas 2D / WebGL','MediaDevices API'],['Speech Synthesis API','Geolocation API','Battery API','Network Information API'],['Anthropic Claude API','Leaflet.js (地图)','Google DNS over HTTPS'],['Karplus-Strong synthesis','FM / AM synthesis','localStorage','UA Client Hints API'],['CSS Custom Properties','CSS data-theme']],
    changelog: [['v7.8','11种主题 · 完整主题集成 · 加载屏幕主题 · 设置按钮'],['v7.7','GPS坐标 · FPS百分位/VSync/CSV · 新键盘音效 · CSP代理+生成器'],['v7.5','FPS直方图60s · 1%/0.1%低帧 · CSP测试器 · 网络加密 · 会话报告'],['v7.x','AI助手 · 绿幕 · 性能监视器 · DNS查询 · 13语言 · TTS']],
    privacy: '✅ 无服务器 — 一切在浏览器本地运行\n✅ 不向外部服务器发送任何数据\n✅ 摄像头和麦克风仅本地使用，从不录制\n✅ GPS位置仅用于显示地图 — 不存储\n⚠️ AI助手向Anthropic API发送消息（Claude）',
    footer: '离线可用 · 无需安装 · 免费',
    settingsTitle: '设置', settingsSubtitle: 'STUDIO TEST',
    themeLabel: '🎨 颜色主题', themesSectionHint: '自动保存',
    themeNames: { dark:'🌑 深色', light:'☀️ 浅色', midnight:'🌌 午夜蓝', forest:'🌿 森林', sunset:'🌅 日落', ocean:'🌊 海洋', rose:'🌸 玫瑰', nordic:'❄️ 北欧', latte:'☕ 拿铁', hacker:'💻 黑客', candy:'🍬 糖果' }
  },
  fr: {
    desc: 'Un outil de diagnostic complet pour navigateur. Testez votre caméra, microphone, haut-parleurs, réseau, clavier, souris, performances et plus — le tout dans un seul fichier HTML, sans installation.',
    mainCreator: 'CRÉATEUR PRINCIPAL', mainSub: 'Concept · Design · Vision',
    aiLabel: 'DÉVELOPPEUR IA', aiSub: 'Code · Logique · IA',
    langs: 'LANGUES', infoBtn: 'ℹ️ INFO', modules: 'MODULES', files: 'FICHIER HTML', deps: 'DÉPENDANCES', size: 'TAILLE', lines: 'LIGNES DE CODE', themes: 'THÈMES',
    modulesLabel: '📋 MODULES', techLabel: '⚙️ TECHNOLOGIES', privacyLabel: '🔒 CONFIDENTIALITÉ', changelogLabel: '📝 HISTORIQUE',
    modulesList: ['📷 Caméra + filtres + Chroma Key','🎙️ Micro + VU + spectre','🎵 Changeurs de voix (28 présets)','🔊 Test enceintes + générateur de tons','🌐 Test internet + ping + carte','🎮 Test FPS + VSync + histogramme','⚡ Test de réaction + statistiques','🖱️ Test souris + carte de chaleur + CPS','⌨️ Test clavier + 30 sons','📊 Moniteur de performances + JS bench','ℹ️ Info système + GPU + batterie','🖥️ Test écran + 40 couleurs','📡 Scanner réseau + NAT + ISP','🔍 Recherche DNS + 31 présets','🛡️ Testeur CSP + Générateur + Proxy','🤖 Assistant IA (13 langues + TTS)','📊 Rapport de session + export HTML','⚙️ Paramètres · 11 thèmes'],
    techList: [['Web Audio API','WebRTC','Canvas 2D / WebGL','MediaDevices API'],['Speech Synthesis API','Geolocation API','Battery API','Network Information API'],['Anthropic Claude API','Leaflet.js (cartes)','Google DNS over HTTPS'],['Karplus-Strong synthesis','FM / AM synthesis','localStorage','UA Client Hints API'],['CSS Custom Properties','CSS data-theme']],
    changelog: [['v7.8','11 thèmes · Intégration complète des thèmes · Écran de chargement thématisé · Bouton Paramètres'],['v7.7','Coordonnées GPS · Percentiles FPS/VSync/CSV · Nouveaux sons clavier · CSP Proxy+Générateur'],['v7.5','Histogramme FPS 60s · 1%/0,1% Low · Testeur CSP · Chiffrement réseau · Rapport de session'],['v7.x','Assistant IA · Chroma Key · Moniteur · DNS · 13 langues · TTS']],
    privacy: '✅ Pas de serveur — tout fonctionne localement dans le navigateur\n✅ Aucune donnée n\'est envoyée à des serveurs externes\n✅ Caméra et micro utilisés localement uniquement, jamais enregistrés\n✅ Position GPS utilisée uniquement pour la carte — non stockée\n⚠️ L\'assistant IA envoie des messages à l\'API Anthropic (Claude)',
    footer: 'Fonctionne hors ligne · Zéro installation · Gratuit',
    settingsTitle: 'Paramètres', settingsSubtitle: 'STUDIO TEST',
    themeLabel: '🎨 Thème de couleur', themesSectionHint: 'Sauvegarde automatique',
    themeNames: { dark:'🌑 Sombre', light:'☀️ Clair', midnight:'🌌 Minuit', forest:'🌿 Forêt', sunset:'🌅 Coucher de soleil', ocean:'🌊 Océan', rose:'🌸 Rose', nordic:'❄️ Nordique', latte:'☕ Latte', hacker:'💻 Hacker', candy:'🍬 Bonbon' }
  },
  es: {
    desc: 'Una herramienta de diagnóstico completa para el navegador. Prueba tu cámara, micrófono, altavoces, red, teclado, ratón, rendimiento y más — todo en un solo archivo HTML, sin instalación.',
    mainCreator: 'CREADOR PRINCIPAL', mainSub: 'Concepto · Diseño · Visión',
    aiLabel: 'DESARROLLADOR IA', aiSub: 'Código · Lógica · IA',
    langs: 'IDIOMAS', infoBtn: 'ℹ️ INFO', modules: 'MÓDULOS', files: 'ARCHIVO HTML', deps: 'DEPENDENCIAS', size: 'TAMAÑO', lines: 'LÍNEAS DE CÓDIGO', themes: 'TEMAS',
    modulesLabel: '📋 MÓDULOS', techLabel: '⚙️ TECNOLOGÍAS', privacyLabel: '🔒 PRIVACIDAD', changelogLabel: '📝 REGISTRO DE CAMBIOS',
    modulesList: ['📷 Cámara + filtros + Chroma Key','🎙️ Micrófono + VU + espectro','🎵 Cambiadores de voz (28 presets)','🔊 Test de altavoces + generador de tonos','🌐 Test de internet + ping + mapa','🎮 Test de FPS + VSync + histograma','⚡ Test de reacción + estadísticas','🖱️ Test de ratón + mapa de calor + CPS','⌨️ Test de teclado + 30 sonidos','📊 Monitor de rendimiento + JS bench','ℹ️ Info del sistema + GPU + batería','🖥️ Test de pantalla + 40 colores','📡 Escáner de red + NAT + ISP','🔍 Búsqueda DNS + 31 presets','🛡️ Tester CSP + Generador + Proxy','🤖 Asistente IA (13 idiomas + TTS)','📊 Informe de sesión + exportar HTML','⚙️ Configuración · 11 temas'],
    techList: [['Web Audio API','WebRTC','Canvas 2D / WebGL','MediaDevices API'],['Speech Synthesis API','Geolocation API','Battery API','Network Information API'],['Anthropic Claude API','Leaflet.js (mapas)','Google DNS over HTTPS'],['Karplus-Strong synthesis','FM / AM synthesis','localStorage','UA Client Hints API'],['CSS Custom Properties','CSS data-theme']],
    changelog: [['v7.8','11 temas · Integración completa de temas · Pantalla de carga temática · Botón Configuración'],['v7.7','Coordenadas GPS · Percentiles FPS/VSync/CSV · Nuevos sonidos de teclado · CSP Proxy+Generador'],['v7.5','Histograma FPS 60s · 1%/0,1% Low · Tester CSP · Cifrado de red · Informe de sesión'],['v7.x','Asistente IA · Chroma Key · Monitor · DNS · 13 idiomas · TTS']],
    privacy: '✅ Sin servidor — todo funciona localmente en el navegador\n✅ No se envían datos a servidores externos\n✅ Cámara y micrófono usados solo localmente, nunca grabados\n✅ Ubicación GPS usada solo para mostrar el mapa — no almacenada\n⚠️ El asistente IA envía mensajes a la API de Anthropic (Claude)',
    footer: 'Funciona sin conexión · Sin instalación · Gratis',
    settingsTitle: 'Configuración', settingsSubtitle: 'STUDIO TEST',
    themeLabel: '🎨 Tema de color', themesSectionHint: 'Guardado automáticamente',
    themeNames: { dark:'🌑 Oscuro', light:'☀️ Claro', midnight:'🌌 Medianoche', forest:'🌿 Bosque', sunset:'🌅 Atardecer', ocean:'🌊 Océano', rose:'🌸 Rosa', nordic:'❄️ Nórdico', latte:'☕ Latte', hacker:'💻 Hacker', candy:'🍬 Dulce' }
  },
  it: {
    desc: 'Uno strumento diagnostico completo per browser. Testa fotocamera, microfono, altoparlanti, rete, tastiera, mouse, prestazioni e altro — tutto in un singolo file HTML, senza installazione.',
    mainCreator: 'CREATORE PRINCIPALE', mainSub: 'Concept · Design · Visione',
    aiLabel: 'SVILUPPATORE IA', aiSub: 'Codice · Logica · IA',
    langs: 'LINGUE', infoBtn: 'ℹ️ INFO', modules: 'MODULI', files: 'FILE HTML', deps: 'DIPENDENZE', size: 'DIMENSIONE', lines: 'RIGHE DI CODICE', themes: 'TEMI',
    modulesLabel: '📋 MODULI', techLabel: '⚙️ TECNOLOGIE', privacyLabel: '🔒 PRIVACY', changelogLabel: '📝 CHANGELOG',
    modulesList: ['📷 Fotocamera + filtri + Chroma Key','🎙️ Microfono + VU + spettro','🎵 Modulatori vocali (28 preset)','🔊 Test altoparlanti + generatore di toni','🌐 Test internet + ping + mappa','🎮 Test FPS + VSync + istogramma','⚡ Test di reazione + statistiche','🖱️ Test mouse + mappa di calore + CPS','⌨️ Test tastiera + 30 suoni','📊 Monitor prestazioni + JS bench','ℹ️ Info sistema + GPU + batteria','🖥️ Test display + 40 colori','📡 Scanner di rete + NAT + ISP','🔍 Ricerca DNS + 31 preset','🛡️ Tester CSP + Generatore + Proxy','🤖 Assistente IA (13 lingue + TTS)','📊 Report sessione + export HTML','⚙️ Impostazioni · 11 temi'],
    techList: [['Web Audio API','WebRTC','Canvas 2D / WebGL','MediaDevices API'],['Speech Synthesis API','Geolocation API','Battery API','Network Information API'],['Anthropic Claude API','Leaflet.js (mappe)','Google DNS over HTTPS'],['Karplus-Strong synthesis','FM / AM synthesis','localStorage','UA Client Hints API'],['CSS Custom Properties','CSS data-theme']],
    changelog: [['v7.8','11 temi · Integrazione completa temi · Loading screen tematizzato · Pulsante Impostazioni'],['v7.7','Coordinate GPS · Percentili FPS/VSync/CSV · Nuovi suoni tastiera · CSP Proxy+Generatore'],['v7.5','Istogramma FPS 60s · 1%/0,1% Low · Tester CSP · Crittografia rete · Report sessione'],['v7.x','Assistente IA · Chroma Key · Monitor · DNS · 13 lingue · TTS']],
    privacy: '✅ Nessun server — tutto funziona localmente nel browser\n✅ Nessun dato viene inviato a server esterni\n✅ Fotocamera e microfono usati solo localmente, mai registrati\n✅ Posizione GPS usata solo per la mappa — non salvata\n⚠️ L\'assistente IA invia messaggi all\'API Anthropic (Claude)',
    footer: 'Funziona offline · Zero installazione · Gratuito',
    settingsTitle: 'Impostazioni', settingsSubtitle: 'STUDIO TEST',
    themeLabel: '🎨 Tema colori', themesSectionHint: 'Salvataggio automatico',
    themeNames: { dark:'🌑 Scuro', light:'☀️ Chiaro', midnight:'🌌 Mezzanotte', forest:'🌿 Foresta', sunset:'🌅 Tramonto', ocean:'🌊 Oceano', rose:'🌸 Rosa', nordic:'❄️ Nordico', latte:'☕ Latte', hacker:'💻 Hacker', candy:'🍬 Caramella' }
  },
  ja: {
    desc: '包括的なブラウザ診断ツールです。カメラ、マイク、スピーカー、ネットワーク、キーボード、マウス、パフォーマンスなどをテストできます。インストール不要の単一HTMLファイルです。',
    mainCreator: 'メイン制作者', mainSub: 'コンセプト · デザイン · ビジョン',
    aiLabel: 'AI開発者', aiSub: 'コード · ロジック · AI',
    langs: '言語', infoBtn: 'ℹ️ 情報', modules: 'モジュール', files: 'HTMLファイル', deps: '依存関係', size: 'サイズ', lines: 'コード行数', themes: 'テーマ',
    modulesLabel: '📋 モジュール', techLabel: '⚙️ 技術', privacyLabel: '🔒 プライバシー', changelogLabel: '📝 更新履歴',
    modulesList: ['📷 カメラ+フィルター+クロマキー','🎙️ マイク+VU+スペクトラム','🎵 ボイスチェンジャー（28プリセット）','🔊 スピーカーテスト+トーンジェネレーター','🌐 インターネットテスト+ping+マップ','🎮 FPSテスト+VSync+ヒストグラム','⚡ 反応テスト+統計','🖱️ マウステスト+ヒートマップ+CPS','⌨️ キーボードテスト+30サウンド','📊 パフォーマンスモニター+JSベンチ','ℹ️ システム情報+GPU+バッテリー','🖥️ ディスプレイテスト+40色','📡 ネットワークスキャナー+NAT+ISP','🔍 DNS検索+31プリセット','🛡️ CSPテスター+ジェネレーター+プロキシ','🤖 AIアシスタント（13言語+TTS）','📊 セッションレポート+HTMLエクスポート','⚙️ 設定 · 11テーマ'],
    techList: [['Web Audio API','WebRTC','Canvas 2D / WebGL','MediaDevices API'],['Speech Synthesis API','Geolocation API','Battery API','Network Information API'],['Anthropic Claude API','Leaflet.js (マップ)','Google DNS over HTTPS'],['Karplus-Strong synthesis','FM / AM synthesis','localStorage','UA Client Hints API'],['CSS Custom Properties','CSS data-theme']],
    changelog: [['v7.8','11テーマ · 完全テーマ統合 · ローディング画面テーマ · 設定ボタン'],['v7.7','GPS座標 · FPSパーセンタイル/VSync/CSV · 新キーボードサウンド · CSP Proxy+Generator'],['v7.5','FPSヒストグラム60s · 1%/0.1% Low · CSPテスター · ネットワーク暗号化'],['v7.x','AIアシスタント · クロマキー · パフォーマンスモニター · DNS · 13言語 · TTS']],
    privacy: '✅ サーバーなし — ブラウザでローカルに動作\n✅ 外部サーバーへのデータ送信なし\n✅ カメラとマイクはローカルのみ使用、録音なし\n✅ GPS位置は地図表示のみに使用 — 保存なし\n⚠️ AIアシスタントはAnthropicAPI（Claude）にメッセージを送信',
    footer: 'オフライン動作 · インストール不要 · 無料',
    settingsTitle: '設定', settingsSubtitle: 'STUDIO TEST',
    themeLabel: '🎨 カラーテーマ', themesSectionHint: '自動保存',
    themeNames: { dark:'🌑 ダーク', light:'☀️ ライト', midnight:'🌌 ミッドナイト', forest:'🌿 フォレスト', sunset:'🌅 サンセット', ocean:'🌊 オーシャン', rose:'🌸 ローズ', nordic:'❄️ ノルディック', latte:'☕ ラテ', hacker:'💻 ハッカー', candy:'🍬 キャンディ' }
  },
  ko: {
    desc: '종합적인 브라우저 진단 도구입니다. 카메라, 마이크, 스피커, 네트워크, 키보드, 마우스, 성능 등을 테스트하세요 — 설치 없이 단일 HTML 파일로 모든 기능을 제공합니다.',
    mainCreator: '주요 제작자', mainSub: '개념 · 디자인 · 비전',
    aiLabel: 'AI 개발자', aiSub: '코드 · 로직 · AI',
    langs: '언어', infoBtn: 'ℹ️ 정보', modules: '모듈', files: 'HTML 파일', deps: '종속성', size: '크기', lines: '코드 줄수', themes: '테마',
    modulesLabel: '📋 모듈', techLabel: '⚙️ 기술', privacyLabel: '🔒 개인정보', changelogLabel: '📝 변경 기록',
    modulesList: ['📷 카메라+필터+크로마키','🎙️ 마이크+VU+스펙트럼','🎵 음성 변환기 (28 프리셋)','🔊 스피커 테스트+톤 생성기','🌐 인터넷 테스트+핑+지도','🎮 FPS 테스트+VSync+히스토그램','⚡ 반응 테스트+통계','🖱️ 마우스 테스트+히트맵+CPS','⌨️ 키보드 테스트+30 사운드','📊 성능 모니터+JS 벤치','ℹ️ 시스템 정보+GPU+배터리','🖥️ 디스플레이 테스트+40 색상','📡 네트워크 스캐너+NAT+ISP','🔍 DNS 조회+31 프리셋','🛡️ CSP 테스터+생성기+프록시','🤖 AI 어시스턴트 (13 언어+TTS)','📊 세션 보고서+HTML 내보내기','⚙️ 설정 · 11 테마'],
    techList: [['Web Audio API','WebRTC','Canvas 2D / WebGL','MediaDevices API'],['Speech Synthesis API','Geolocation API','Battery API','Network Information API'],['Anthropic Claude API','Leaflet.js (지도)','Google DNS over HTTPS'],['Karplus-Strong synthesis','FM / AM synthesis','localStorage','UA Client Hints API'],['CSS Custom Properties','CSS data-theme']],
    changelog: [['v7.8','11 테마 · 완전한 테마 통합 · 로딩 화면 테마 · 설정 버튼'],['v7.7','GPS 좌표 · FPS 백분위/VSync/CSV · 새 키보드 사운드 · CSP Proxy+Generator'],['v7.5','FPS 히스토그램 60s · 1%/0.1% Low · CSP 테스터 · 네트워크 암호화'],['v7.x','AI 어시스턴트 · 크로마키 · 성능 모니터 · DNS · 13 언어 · TTS']],
    privacy: '✅ 서버 없음 — 브라우저에서 로컬로 실행\n✅ 외부 서버로 데이터 전송 없음\n✅ 카메라와 마이크는 로컬에서만 사용, 녹화 없음\n✅ GPS 위치는 지도 표시에만 사용 — 저장 안 함\n⚠️ AI 어시스턴트는 Anthropic API(Claude)로 메시지 전송',
    footer: '오프라인 작동 · 설치 불필요 · 무료',
    settingsTitle: '설정', settingsSubtitle: 'STUDIO TEST',
    themeLabel: '🎨 색상 테마', themesSectionHint: '자동 저장',
    themeNames: { dark:'🌑 다크', light:'☀️ 라이트', midnight:'🌌 미드나잇', forest:'🌿 포레스트', sunset:'🌅 선셋', ocean:'🌊 오션', rose:'🌸 로즈', nordic:'❄️ 노르딕', latte:'☕ 라떼', hacker:'💻 해커', candy:'🍬 캔디' }
  },
  nl: {
    desc: 'Een uitgebreid diagnostisch hulpmiddel voor browsers. Test je camera, microfoon, luidsprekers, netwerk, toetsenbord, muis, prestaties en meer — alles in één HTML-bestand, zonder installatie.',
    mainCreator: 'HOOFDMAKER', mainSub: 'Concept · Design · Visie',
    aiLabel: 'AI-ONTWIKKELAAR', aiSub: 'Code · Logica · AI',
    langs: 'TALEN', infoBtn: 'ℹ️ INFO', modules: "MODULE'S", files: 'HTML-BESTAND', deps: 'AFHANKELIJKHEDEN', size: 'GROOTTE', lines: 'REGELS CODE', themes: "THEMA'S",
    modulesLabel: "📋 MODULE'S", techLabel: '⚙️ TECHNOLOGIEËN', privacyLabel: '🔒 PRIVACY', changelogLabel: '📝 WIJZIGINGSLOG',
    modulesList: ["📷 Camera + filters + Chroma Key","🎙️ Microfoon + VU + spectrum","🎵 Stemmodulators (28 presets)","🔊 Luidsprekerstest + toongenerator","🌐 Internettest + ping + kaart","🎮 FPS-test + VSync + histogram","⚡ Reactietest + statistieken","🖱️ Muistest + heatmap + CPS","⌨️ Toetsenbordtest + 30 geluiden","📊 Prestatiemonitor + JS bench","ℹ️ Systeeminfo + GPU + batterij","🖥️ Displaytest + 40 kleuren","📡 Netwerkscanner + NAT + ISP","🔍 DNS-opzoeking + 31 presets","🛡️ CSP-tester + Generator + Proxy","🤖 AI-assistent (13 talen + TTS)","📊 Sessierapport + HTML-export","⚙️ Instellingen · 11 thema's"],
    techList: [['Web Audio API','WebRTC','Canvas 2D / WebGL','MediaDevices API'],['Speech Synthesis API','Geolocation API','Battery API','Network Information API'],['Anthropic Claude API','Leaflet.js (kaarten)','Google DNS over HTTPS'],['Karplus-Strong synthesis','FM / AM synthesis','localStorage','UA Client Hints API'],['CSS Custom Properties','CSS data-theme']],
    changelog: [["v7.8","11 thema's · Volledige thema-integratie · Laadscherm thema · Instellingen knop"],['v7.7','GPS-coördinaten · FPS-percentielen/VSync/CSV · Nieuwe toetsenbordgeluiden · CSP Proxy+Generator'],['v7.5','FPS-histogram 60s · 1%/0,1% Low · CSP-tester · Netwerkversleuteling'],['v7.x','AI-assistent · Chroma Key · Prestatiemonitor · DNS · 13 talen · TTS']],
    privacy: '✅ Geen server — alles werkt lokaal in de browser\n✅ Geen gegevens worden naar externe servers gestuurd\n✅ Camera en microfoon alleen lokaal gebruikt, nooit opgenomen\n✅ GPS-locatie alleen voor kaartweergave — niet opgeslagen\n⚠️ AI-assistent stuurt berichten naar Anthropic API (Claude)',
    footer: 'Werkt offline · Geen installatie · Gratis',
    settingsTitle: 'Instellingen', settingsSubtitle: 'STUDIO TEST',
    themeLabel: '🎨 Kleurthema', themesSectionHint: 'Automatisch opgeslagen',
    themeNames: { dark:'🌑 Donker', light:'☀️ Licht', midnight:'🌌 Middernacht', forest:'🌿 Woud', sunset:'🌅 Zonsondergang', ocean:'🌊 Oceaan', rose:'🌸 Roos', nordic:'❄️ Nordisch', latte:'☕ Latte', hacker:'💻 Hacker', candy:'🍬 Snoep' }
  },
  pt: {
    desc: 'Uma ferramenta de diagnóstico completa para navegadores. Teste sua câmera, microfone, alto-falantes, rede, teclado, mouse, desempenho e mais — tudo em um único arquivo HTML, sem instalação.',
    mainCreator: 'CRIADOR PRINCIPAL', mainSub: 'Conceito · Design · Visão',
    aiLabel: 'DESENVOLVEDOR IA', aiSub: 'Código · Lógica · IA',
    langs: 'IDIOMAS', infoBtn: 'ℹ️ INFO', modules: 'MÓDULOS', files: 'ARQUIVO HTML', deps: 'DEPENDÊNCIAS', size: 'TAMANHO', lines: 'LINHAS DE CÓDIGO', themes: 'TEMAS',
    modulesLabel: '📋 MÓDULOS', techLabel: '⚙️ TECNOLOGIAS', privacyLabel: '🔒 PRIVACIDADE', changelogLabel: '📝 REGISTRO DE ALTERAÇÕES',
    modulesList: ['📷 Câmera + filtros + Chroma Key','🎙️ Microfone + VU + espectro','🎵 Modificadores de voz (28 presets)','🔊 Teste de alto-falantes + gerador de tons','🌐 Teste de internet + ping + mapa','🎮 Teste de FPS + VSync + histograma','⚡ Teste de reação + estatísticas','🖱️ Teste de mouse + mapa de calor + CPS','⌨️ Teste de teclado + 30 sons','📊 Monitor de desempenho + JS bench','ℹ️ Info do sistema + GPU + bateria','🖥️ Teste de tela + 40 cores','📡 Scanner de rede + NAT + ISP','🔍 Pesquisa DNS + 31 presets','🛡️ Testador CSP + Gerador + Proxy','🤖 Assistente IA (13 idiomas + TTS)','📊 Relatório de sessão + exportar HTML','⚙️ Configurações · 11 temas'],
    techList: [['Web Audio API','WebRTC','Canvas 2D / WebGL','MediaDevices API'],['Speech Synthesis API','Geolocation API','Battery API','Network Information API'],['Anthropic Claude API','Leaflet.js (mapas)','Google DNS over HTTPS'],['Karplus-Strong synthesis','FM / AM synthesis','localStorage','UA Client Hints API'],['CSS Custom Properties','CSS data-theme']],
    changelog: [['v7.8','11 temas · Integração completa de temas · Tela de carregamento temática · Botão Configurações'],['v7.7','Coordenadas GPS · Percentis FPS/VSync/CSV · Novos sons de teclado · CSP Proxy+Gerador'],['v7.5','Histograma FPS 60s · 1%/0,1% Low · Testador CSP · Criptografia de rede'],['v7.x','Assistente IA · Chroma Key · Monitor · DNS · 13 idiomas · TTS']],
    privacy: '✅ Sem servidor — tudo funciona localmente no navegador\n✅ Nenhum dado é enviado para servidores externos\n✅ Câmera e microfone usados apenas localmente, nunca gravados\n✅ Localização GPS usada apenas para exibir o mapa — não armazenada\n⚠️ O assistente IA envia mensagens para a API Anthropic (Claude)',
    footer: 'Funciona offline · Zero instalação · Gratuito',
    settingsTitle: 'Configurações', settingsSubtitle: 'STUDIO TEST',
    themeLabel: '🎨 Tema de cores', themesSectionHint: 'Salvo automaticamente',
    themeNames: { dark:'🌑 Escuro', light:'☀️ Claro', midnight:'🌌 Meia-noite', forest:'🌿 Floresta', sunset:'🌅 Pôr do sol', ocean:'🌊 Oceano', rose:'🌸 Rosa', nordic:'❄️ Nórdico', latte:'☕ Latte', hacker:'💻 Hacker', candy:'🍬 Doce' }
  },
  ua: {
    desc: 'Комплексний інструмент діагностики браузера. Тестуйте камеру, мікрофон, динаміки, мережу, клавіатуру, мишу, продуктивність та багато іншого — все в одному HTML-файлі, без встановлення.',
    mainCreator: 'ГОЛОВНИЙ АВТОР', mainSub: 'Концепція · Дизайн · Бачення',
    aiLabel: 'AI-РОЗРОБНИК', aiSub: 'Код · Логіка · ШІ',
    langs: 'МОВ', infoBtn: 'ℹ️ ІНФО', modules: 'МОДУЛІВ', files: 'HTML ФАЙЛ', deps: 'ЗАЛЕЖНОСТЕЙ', size: 'РОЗМІР', lines: 'РЯДКІВ КОДУ', themes: 'ТЕМ',
    modulesLabel: '📋 МОДУЛІ', techLabel: '⚙️ ТЕХНОЛОГІЇ', privacyLabel: '🔒 КОНФІДЕНЦІЙНІСТЬ', changelogLabel: '📝 ЖУРНАЛ ЗМІН',
    modulesList: ['📷 Камера + фільтри + Хромакей','🎙️ Мікрофон + VU + спектр','🎵 Змінювачі голосу (28 пресетів)','🔊 Тест динаміків + генератор тонів','🌐 Тест інтернету + пінг + карта','🎮 Тест FPS + VSync + гістограма','⚡ Тест реакції + статистика','🖱️ Тест миші + теплова карта + CPS','⌨️ Тест клавіатури + 30 звуків','📊 Монітор продуктивності + JS','ℹ️ Системна інформація + GPU + батарея','🖥️ Тест дисплея + 40 кольорів','📡 Сканер мережі + NAT + ISP','🔍 DNS Lookup + 31 пресет','🛡️ CSP Тестер + Генератор + Проксі','🤖 ШІ Асистент (13 мов + TTS)','📊 Звіт сесії + експорт HTML','⚙️ Налаштування · 11 тем'],
    techList: [['Web Audio API','WebRTC','Canvas 2D / WebGL','MediaDevices API'],['Speech Synthesis API','Geolocation API','Battery API','Network Information API'],['Anthropic Claude API','Leaflet.js (карти)','Google DNS over HTTPS'],['Karplus-Strong synthesis','FM / AM synthesis','localStorage','UA Client Hints API'],['CSS Custom Properties','CSS data-theme']],
    changelog: [['v7.8','11 тем · Повна інтеграція тем · Екран завантаження з темою · Кнопка налаштувань'],['v7.7','GPS-координати · Перцентилі FPS/VSync/CSV · Нові звуки клавіатури · CSP Proxy+Generator'],['v7.5','Гістограма FPS 60с · 1%/0.1% Low · CSP Тестер · Шифрування мережі'],['v7.x','ШІ Асистент · Хромакей · Монітор · DNS · 13 мов · TTS']],
    privacy: '✅ Немає сервера — все працює локально у браузері\n✅ Жодні дані не надсилаються на зовнішні сервери\n✅ Камера та мікрофон використовуються лише локально\n✅ GPS-локація використовується лише для карти — не зберігається\n⚠️ ШІ-асистент надсилає повідомлення до API Anthropic (Claude)',
    footer: 'Працює офлайн · Без встановлення · Безкоштовно',
    settingsTitle: 'Налаштування', settingsSubtitle: 'STUDIO TEST',
    themeLabel: '🎨 Кольорова тема', themesSectionHint: 'Зберігається автоматично',
    themeNames: { dark:'🌑 Темна', light:'☀️ Світла', midnight:'🌌 Північ', forest:'🌿 Ліс', sunset:'🌅 Захід', ocean:'🌊 Океан', rose:'🌸 Роза', nordic:'❄️ Нордік', latte:'☕ Латте', hacker:'💻 Хакер', candy:'🍬 Цукерка' }
  }
};

function openAbout() {
  document.getElementById('aboutModal').classList.add('show');
  const lang = currentLang || 'pl';
  const i = ABOUT_I18N[lang] || ABOUT_I18N.pl;

  const TECH_COLORS = ['#00f5a0','#00b4d8','#a855f7','#f59e0b','#f472b6'];

  const html = `
    <div style="font-family:'Space Mono',monospace;font-size:10px;color:rgba(255,255,255,0.55);line-height:1.9;text-align:center;margin-bottom:20px;padding:0 8px;">${i.desc}</div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:18px;">
      <div style="padding:12px 14px;border-radius:10px;background:rgba(168,85,247,0.07);border:1px solid rgba(168,85,247,0.2);text-align:center;">
        <div style="font-family:'Space Mono',monospace;font-size:7px;color:rgba(168,85,247,0.6);letter-spacing:2px;margin-bottom:6px;">${i.mainCreator}</div>
        <div style="font-family:'Syne',sans-serif;font-size:18px;font-weight:900;color:#a855f7;">REV01</div>
        <div style="font-family:'Space Mono',monospace;font-size:8px;color:rgba(255,255,255,0.3);margin-top:3px;">${i.mainSub}</div>
      </div>
      <div style="padding:12px 14px;border-radius:10px;background:rgba(0,180,216,0.07);border:1px solid rgba(0,180,216,0.2);text-align:center;">
        <div style="font-family:'Space Mono',monospace;font-size:7px;color:rgba(0,180,216,0.6);letter-spacing:2px;margin-bottom:6px;">${i.aiLabel}</div>
        <div style="font-family:'Syne',sans-serif;font-size:13px;font-weight:900;color:#00b4d8;line-height:1.4;">CLAUDE OPUS<br>CLAUDE SONNET</div>
        <div style="font-family:'Space Mono',monospace;font-size:8px;color:rgba(255,255,255,0.3);margin-top:3px;">${i.aiSub}</div>
      </div>
    </div>

    <div style="display:flex;gap:8px;margin-bottom:18px;flex-wrap:wrap;">
      ${[['13','#00f5a0',i.langs],['20+','#a855f7',i.modules],['1','#f59e0b',i.files],['0','#00b4d8',i.deps],['~1.2MB','#ec4899',i.size],['20k+','#f59e0b',i.lines],['11','#f472b6',i.themes||'THEMES']].map(([val,col,lbl])=>`
      <div style="flex:1;min-width:70px;padding:8px;border-radius:8px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);text-align:center;">
        <div style="font-family:'Syne',sans-serif;font-size:16px;font-weight:800;color:${col};">${val}</div>
        <div style="font-family:'Space Mono',monospace;font-size:7px;color:rgba(255,255,255,0.3);">${lbl}</div>
      </div>`).join('')}
    </div>

    <div style="margin-bottom:16px;">
      <div style="font-family:'Space Mono',monospace;font-size:8px;color:rgba(255,255,255,0.3);letter-spacing:2px;margin-bottom:10px;">${i.modulesLabel}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;">
        ${(i.modulesList||[]).map((m,idx)=>idx===i.modulesList.length-1?
          `<div style="padding:6px 10px;border-radius:7px;background:rgba(168,85,247,0.05);border:1px solid rgba(168,85,247,0.2);font-family:'Space Mono',monospace;font-size:9px;color:#a855f7;">${m}</div>`:
          `<div style="padding:6px 10px;border-radius:7px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);font-family:'Space Mono',monospace;font-size:9px;color:rgba(255,255,255,0.6);">${m}</div>`
        ).join('')}
      </div>
    </div>

    <div style="margin-bottom:16px;">
      <div style="font-family:'Space Mono',monospace;font-size:8px;color:rgba(255,255,255,0.3);letter-spacing:2px;margin-bottom:10px;">${i.techLabel}</div>
      <div style="display:flex;flex-wrap:wrap;gap:5px;">
        ${(i.techList||[]).flatMap((group,gi)=>group.map(tech=>`
          <span style="padding:3px 9px;border-radius:20px;background:${TECH_COLORS[gi]}18;border:1px solid ${TECH_COLORS[gi]}44;font-family:'Space Mono',monospace;font-size:8px;color:${TECH_COLORS[gi]};">${tech}</span>`
        )).join('')}
      </div>
    </div>

    <div style="margin-bottom:16px;padding:12px 14px;border-radius:10px;background:rgba(0,245,160,0.04);border:1px solid rgba(0,245,160,0.12);">
      <div style="font-family:'Space Mono',monospace;font-size:8px;color:rgba(0,245,160,0.6);letter-spacing:2px;margin-bottom:8px;">${i.privacyLabel}</div>
      <div style="font-family:'Space Mono',monospace;font-size:9px;color:rgba(255,255,255,0.5);line-height:1.8;">
        ${(i.privacy||'').split('\n').map(l=>`<div>${l}</div>`).join('')}
      </div>
    </div>

    <div style="margin-bottom:16px;">
      <div style="font-family:'Space Mono',monospace;font-size:8px;color:rgba(255,255,255,0.3);letter-spacing:2px;margin-bottom:10px;">${i.changelogLabel||'📝 CHANGELOG'}</div>
      <div style="display:flex;flex-direction:column;gap:5px;">
        ${(i.changelog||[]).map((entry,idx)=>idx===0?
          `<div style="display:flex;gap:10px;align-items:baseline;padding:8px 10px;border-radius:8px;background:rgba(168,85,247,0.07);border:1px solid rgba(168,85,247,0.2);">
            <span style="font-family:'Space Mono',monospace;font-size:8px;color:#a855f7;white-space:nowrap;font-weight:700;">${entry[0]} ★</span>
            <span style="font-family:'Space Mono',monospace;font-size:8px;color:rgba(255,255,255,0.7);">${entry[1]}</span>
          </div>`:
          `<div style="display:flex;gap:10px;align-items:baseline;">
            <span style="font-family:'Space Mono',monospace;font-size:8px;color:rgba(255,255,255,0.4);white-space:nowrap;">${entry[0]}</span>
            <span style="font-family:'Space Mono',monospace;font-size:8px;color:rgba(255,255,255,0.4);">${entry[1]}</span>
          </div>`
        ).join('')}
      </div>
    </div>

    <div style="text-align:center;margin-bottom:6px;">
      <a href="https://charming-concha-550970.netlify.app" target="_blank" rel="noopener"
        style="font-family:'Space Mono',monospace;font-size:9px;color:#00f5a0;text-decoration:none;border:1px solid rgba(0,245,160,0.2);border-radius:6px;padding:5px 14px;transition:all .15s;display:inline-block;"
        onmouseover="this.style.background='rgba(0,245,160,0.08)'" onmouseout="this.style.background='transparent'">
        🌐 charming-concha-550970.netlify.app
      </a>
    </div>
    <div style="font-family:'Space Mono',monospace;font-size:7px;color:rgba(255,255,255,0.15);text-align:center;margin-top:8px;">${i.footer}</div>
  `;

  document.getElementById('aboutDynamicContent').innerHTML = html;
}

function closeAbout() {
  document.getElementById('aboutModal').classList.remove('show');
}

function dnsQuick(domain) {
  document.getElementById('dnsInput').value = domain;
  dnsLookup();
}

function openDnsLookup() {
  document.getElementById('dnsModal').classList.add('show');
  document.getElementById('dnsInput').focus();
}
function closeDnsLookup() {
  document.getElementById('dnsModal').classList.remove('show');
}

async function dnsLookup() {
  const raw = document.getElementById('dnsInput').value.trim();
  if(!raw) return;
  const resultsEl = document.getElementById('dnsResults');
  const btn = document.getElementById('dnsBtn');
  resultsEl.innerHTML = '';
  btn.disabled = true;
  btn.textContent = '⏳';

  const domains = raw.split(/[\s,;]+/).filter(Boolean).slice(0, 8);
  const TYPES = ['A','AAAA','MX','NS','TXT','CNAME'];

  function card(label, color, rows) {
    const el = document.createElement('div');
    el.style.cssText = `padding:12px 14px;border-radius:10px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-left:3px solid ${color};`;
    el.innerHTML = `<div style="font-family:'Syne',sans-serif;font-size:13px;font-weight:800;color:${color};margin-bottom:8px;">${label}</div>`
      + rows.map(r => `<div style="font-family:'Space Mono',monospace;font-size:9px;color:rgba(255,255,255,0.6);margin-bottom:4px;line-height:1.6;">${r}</div>`).join('');
    resultsEl.appendChild(el);
  }

  const TYPE_COLORS = { A:'#06b6d4', AAAA:'#818cf8', MX:'#f59e0b', NS:'#10b981', TXT:'#a78bfa', CNAME:'#f97316' };

  // Detect if IP → reverse lookup
  const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(domains[0]);

  for(const domain of domains) {
    if(/^\d{1,3}(\.\d{1,3}){3}$/.test(domain)) {
      // Reverse DNS (PTR)
      try {
        const rev = domain.split('.').reverse().join('.') + '.in-addr.arpa';
        const r = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(rev)}&type=PTR`, { cache: 'no-store' });
        const d = await r.json();
        const answers = (d.Answer || []).map(a => `PTR: ${a.data}`);
        card('🔍 ' + domain, '#06b6d4', answers.length ? answers : ['— brak rekordu PTR']);
      } catch(e) {
        card('🔍 ' + domain, '#ef4444', ['❌ Błąd: ' + (e.message||'timeout')]);
      }
      continue;
    }

    const allRows = [];
    await Promise.all(TYPES.map(async type => {
      try {
        const r = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=${type}&cd=false`, { cache: 'no-store' });
        const d = await r.json();
        if(d.Answer && d.Answer.length) {
          d.Answer.forEach(a => {
            const ttl = a.TTL ? ` <span style="color:rgba(255,255,255,0.25);">TTL ${a.TTL}s</span>` : '';
            allRows.push({ type, text: `<span style="color:${TYPE_COLORS[type]||'#fff'};min-width:40px;display:inline-block;">${type}</span>  ${a.data}${ttl}` });
          });
        }
      } catch(e) {}
    }));

    if(!allRows.length) {
      card('🌐 ' + domain, '#ef4444', ['❌ Brak rekordów lub domena nie istnieje']);
    } else {
      // Sort: A first, then others
      const ORDER = ['A','AAAA','CNAME','MX','NS','TXT'];
      allRows.sort((a,b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type));
      card('🌐 ' + domain, '#06b6d4', allRows.map(r => r.text));
    }
  }

  btn.disabled = false;
  btn.textContent = '🔍 Lookup';
}


let _cspActiveProxy = 'corsproxy';

const CSP_GEN_CHECKBOXES = [
  'g_def_self','g_def_none',
  'g_scr_self','g_scr_inline','g_scr_eval','g_scr_dynamic','g_scr_nonce',
  'g_sty_self','g_sty_inline','g_sty_fonts',
  'g_img_self','g_img_data','g_img_all',
  'g_con_self','g_con_api_anth','g_con_ws',
  'g_fnt_self','g_fnt_gstatic','g_fnt_data',
  'g_opt_upgrade','g_opt_objnone','g_opt_baseself','g_opt_frameself','g_opt_framenone','g_opt_reportonly'
];
const CSP_GEN_INPUTS = ['g_def_custom','g_scr_custom','g_sty_custom','g_img_custom','g_con_custom','g_fnt_custom'];
const CSP_GEN_KEY = 'csp_generator_v1';

function cspGenSave() {
  const state = {};
  CSP_GEN_CHECKBOXES.forEach(id => { const el=document.getElementById(id); if(el) state[id]=el.checked; });
  CSP_GEN_INPUTS.forEach(id => { const el=document.getElementById(id); if(el) state[id]=el.value; });
  try { localStorage.setItem(CSP_GEN_KEY, JSON.stringify(state)); } catch(e) {}
}

function cspGenLoad() {
  try {
    const raw = localStorage.getItem(CSP_GEN_KEY);
    if(!raw) return false;
    const state = JSON.parse(raw);
    CSP_GEN_CHECKBOXES.forEach(id => {
      const el=document.getElementById(id);
      if(el && id in state) el.checked = state[id];
    });
    CSP_GEN_INPUTS.forEach(id => {
      const el=document.getElementById(id);
      if(el && id in state) el.value = state[id];
    });
    return true;
  } catch(e) { return false; }
}

function cspSwitchTab(tab) {
  ['scan','proxy','gen'].forEach(t => {
    document.getElementById('cspPanel_'+t).style.display = t===tab?'block':'none';
    const btn=document.getElementById('cspTab_'+t);
    if(t===tab){btn.style.borderColor='rgba(16,185,129,0.5)';btn.style.background='rgba(16,185,129,0.12)';btn.style.color='#10b981';}
    else{btn.style.borderColor='rgba(255,255,255,0.1)';btn.style.background='transparent';btn.style.color='rgba(255,255,255,0.4)';}
  });
  document.getElementById('cspScoreBadge').style.display='none';
  if(tab==='gen') { cspGenLoad(); cspGenUpdate(); }
}

// ── CSP Generator ──
function cspGenUpdate() {
  const g=id=>document.getElementById(id);
  const chk=id=>g(id)&&g(id).checked;
  const cust=id=>g(id)?g(id).value.trim():'';
  const dirs=[];
  let def=[]; if(chk('g_def_self'))def.push("'self'"); if(chk('g_def_none'))def.push("'none'");
  if(cust('g_def_custom'))def.push(...cust('g_def_custom').split(/\s+/).filter(Boolean));
  if(def.length)dirs.push('default-src '+def.join(' '));
  let scr=[]; if(chk('g_scr_self'))scr.push("'self'"); if(chk('g_scr_inline'))scr.push("'unsafe-inline'");
  if(chk('g_scr_eval'))scr.push("'unsafe-eval'"); if(chk('g_scr_dynamic'))scr.push("'strict-dynamic'");
  if(chk('g_scr_nonce'))scr.push("'nonce-REPLACE_ME'");
  if(cust('g_scr_custom'))scr.push(...cust('g_scr_custom').split(/\s+/).filter(Boolean));
  if(scr.length)dirs.push('script-src '+scr.join(' '));
  let sty=[]; if(chk('g_sty_self'))sty.push("'self'"); if(chk('g_sty_inline'))sty.push("'unsafe-inline'");
  if(chk('g_sty_fonts'))sty.push('https://fonts.googleapis.com');
  if(cust('g_sty_custom'))sty.push(...cust('g_sty_custom').split(/\s+/).filter(Boolean));
  if(sty.length)dirs.push('style-src '+sty.join(' '));
  let img=[]; if(chk('g_img_self'))img.push("'self'"); if(chk('g_img_data'))img.push('data:');
  if(chk('g_img_all'))img.push('*');
  if(cust('g_img_custom'))img.push(...cust('g_img_custom').split(/\s+/).filter(Boolean));
  if(img.length)dirs.push('img-src '+img.join(' '));
  let con=[]; if(chk('g_con_self'))con.push("'self'"); if(chk('g_con_api_anth'))con.push('https://api.anthropic.com');
  if(chk('g_con_ws'))con.push('wss:');
  if(cust('g_con_custom'))con.push(...cust('g_con_custom').split(/\s+/).filter(Boolean));
  if(con.length)dirs.push('connect-src '+con.join(' '));
  let fnt=[]; if(chk('g_fnt_self'))fnt.push("'self'"); if(chk('g_fnt_gstatic'))fnt.push('https://fonts.gstatic.com');
  if(chk('g_fnt_data'))fnt.push('data:');
  if(cust('g_fnt_custom'))fnt.push(...cust('g_fnt_custom').split(/\s+/).filter(Boolean));
  if(fnt.length)dirs.push('font-src '+fnt.join(' '));
  if(chk('g_opt_objnone'))dirs.push("object-src 'none'");
  if(chk('g_opt_baseself'))dirs.push("base-uri 'self'");
  if(chk('g_opt_framenone'))dirs.push("frame-ancestors 'none'");
  else if(chk('g_opt_frameself'))dirs.push("frame-ancestors 'self'");
  if(chk('g_opt_upgrade'))dirs.push('upgrade-insecure-requests');
  const headerName=chk('g_opt_reportonly')?'Content-Security-Policy-Report-Only':'Content-Security-Policy';
  const cspVal=dirs.join('; ');
  g('cspGenOutput').textContent=cspVal||'(nic nie zaznaczono)';
  const warns=[];
  if(chk('g_scr_inline'))warns.push("⚠️ 'unsafe-inline' osłabia ochronę XSS");
  if(chk('g_scr_eval'))warns.push("⚠️ 'unsafe-eval' — ryzyko XSS przez eval()");
  if(chk('g_img_all'))warns.push("⚠️ img-src * — obrazy z dowolnego serwera");
  if(!chk('g_opt_objnone'))warns.push("⚠️ Brak object-src 'none'");
  g('cspGenScore').innerHTML=warns.length?warns.map(w=>`<div style="color:#f59e0b;">${w}</div>`).join(''):'<div style="color:#10b981;">✅ Dobra konfiguracja — brak oczywistych problemów</div>';
  window._cspGenHeader=headerName; window._cspGenVal=cspVal;
  cspGenSave();
}
function cspCopyHeader() {
  if(!window._cspGenVal)return;
  navigator.clipboard.writeText(window._cspGenHeader+': '+window._cspGenVal).then(()=>toast(t('toast_csp_header_copied'),'success')).catch(()=>toast(t('toast_copy_err'),'error'));
}
function cspCopyNetlify() {
  if(!window._cspGenVal)return;
  const txt=`/*\n  ${window._cspGenHeader}: ${window._cspGenVal}\n  X-Frame-Options: DENY\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin`;
  navigator.clipboard.writeText(txt).then(()=>toast(t('toast_headers_copied'),'success')).catch(()=>toast(t('toast_err_generic'),'error'));
}

// ── CSP Proxy ──
function cspSelectProxy(name) {
  _cspActiveProxy=name;
  ['corsproxy','allorigins','htmldriven'].forEach(p=>{
    const btn=document.getElementById('cspProxy_'+p);
    if(p===name){btn.style.borderColor='rgba(99,102,241,0.5)';btn.style.background='rgba(99,102,241,0.15)';btn.style.color='#a5b4fc';}
    else{btn.style.borderColor='rgba(255,255,255,0.1)';btn.style.background='transparent';btn.style.color='rgba(255,255,255,0.35)';}
  });
}
function cspCopyProxyRaw() {
  const txt=document.getElementById('cspProxyRaw').textContent;
  navigator.clipboard.writeText(txt).then(()=>toast(t('toast_copied'),'success')).catch(()=>toast(t('toast_err_generic'),'error'));
}
async function runCspProxy() {
  const url=document.getElementById('cspProxyUrl').value.trim();
  if(!url){document.getElementById('cspProxyStatus').textContent='⚠️ Wpisz URL';return;}
  const btn=document.getElementById('cspProxyBtn');
  btn.disabled=true; btn.textContent='⏳ Skanowanie...';
  ['cspProxyRawWrap','cspProxyAnalysisWrap','cspProxyHeadersWrap'].forEach(id=>document.getElementById(id).style.display='none');
  ['cspProxyAnalysis','cspProxyHeaders'].forEach(id=>document.getElementById(id).innerHTML='');
  const status=document.getElementById('cspProxyStatus');
  status.textContent=`🌐 Przez ${_cspActiveProxy}...`;
  const SEC=['content-security-policy','content-security-policy-report-only','strict-transport-security',
    'x-frame-options','x-content-type-options','referrer-policy','permissions-policy',
    'cross-origin-opener-policy','cross-origin-embedder-policy','x-powered-by','server'];
  try {
    let headers={}, httpStatus='?';
    if(_cspActiveProxy==='corsproxy') {
      const resp=await fetch('https://corsproxy.io/?'+encodeURIComponent(url),{ cache: 'no-store' });
      httpStatus=resp.status;
      SEC.forEach(h=>{const v=resp.headers.get(h);if(v)headers[h]=v;});
    } else if(_cspActiveProxy==='allorigins') {
      const resp=await fetch('https://api.allorigins.win/get?url='+encodeURIComponent(url),{ cache: 'no-store' });
      const json=await resp.json();
      httpStatus=json.status?.http_code||'?';
      const m=(json.contents||'').match(/<meta\s+http-equiv=["']Content-Security-Policy["']\s+content=["']([^"']+)["']/i);
      if(m)headers['content-security-policy']=m[1];
    } else if(_cspActiveProxy==='htmldriven') {
      const resp=await fetch('https://jsonp.afeld.me/?url='+encodeURIComponent(url),{ cache: 'no-store' });
      httpStatus=resp.status;
      SEC.forEach(h=>{const v=resp.headers.get(h);if(v)headers[h]=v;});
    }
    status.textContent=`✅ HTTP ${httpStatus} — przez ${_cspActiveProxy}`;
    const csp=headers['content-security-policy']||headers['content-security-policy-report-only']||null;
    const rawEl=document.getElementById('cspProxyRaw');
    rawEl.textContent=csp||('⚠️ Brak CSP.\n'+(Object.keys(headers).length?'Znalezione: '+Object.keys(headers).join(', '):'Żadnych nagłówków security.'));
    document.getElementById('cspProxyRawWrap').style.display='block';
    if(csp) {
      const parsed={};
      csp.split(';').map(d=>d.trim()).filter(Boolean).forEach(d=>{const p=d.split(/\s+/);parsed[p[0].toLowerCase()]=p.slice(1);});
      const checks=[
        {label:"Brak 'unsafe-inline' w script-src",pass:!((parsed['script-src']||parsed['default-src']||[]).includes("'unsafe-inline'"))},
        {label:"Brak 'unsafe-eval' w script-src",pass:!((parsed['script-src']||parsed['default-src']||[]).includes("'unsafe-eval'"))},
        {label:"object-src 'none'",pass:(parsed['object-src']||[]).includes("'none'")||(parsed['default-src']||[]).includes("'none'")},
        {label:"frame-ancestors zdefiniowane",pass:!!(parsed['frame-ancestors'])},
        {label:"base-uri zdefiniowane",pass:!!(parsed['base-uri'])},
      ];
      const aEl=document.getElementById('cspProxyAnalysis');
      checks.forEach(c=>{
        const row=document.createElement('div');
        row.style.cssText=`display:flex;align-items:center;gap:8px;padding:5px 10px;border-radius:6px;background:${c.pass?'rgba(16,185,129,0.04)':'rgba(239,68,68,0.04)'};border:1px solid ${c.pass?'rgba(16,185,129,0.1)':'rgba(239,68,68,0.1)'};font-family:'Space Mono',monospace;font-size:8px;color:${c.pass?'rgba(255,255,255,0.6)':'rgba(255,255,255,0.4)'};`;
        row.innerHTML=`<span>${c.pass?'✅':'❌'}</span>${c.label}`;
        aEl.appendChild(row);
      });
      document.getElementById('cspProxyAnalysisWrap').style.display='block';
    }
    const hEl=document.getElementById('cspProxyHeaders');
    [{k:'strict-transport-security',l:'HSTS',good:true},{k:'x-frame-options',l:'X-Frame-Options',good:true},
     {k:'x-content-type-options',l:'X-Content-Type-Options',good:true},{k:'referrer-policy',l:'Referrer-Policy',good:true},
     {k:'x-powered-by',l:'X-Powered-By (leak)',good:false}].forEach(h=>{
      const val=headers[h.k],present=!!val,ok=h.good?present:!present;
      const row=document.createElement('div');
      row.style.cssText='display:flex;align-items:center;gap:8px;padding:5px 10px;border-radius:6px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.05);';
      row.innerHTML=`<span style="font-size:10px;">${ok?'✅':h.good?'⚠️':'✅'}</span><span style="font-family:'Space Mono',monospace;font-size:8px;color:rgba(255,255,255,0.5);flex:1;">${h.l}</span><span style="font-family:'Space Mono',monospace;font-size:8px;color:${present?(h.good?'#10b981':'#ef4444'):'rgba(255,255,255,0.2)'};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:200px;">${val?val.slice(0,40)+(val.length>40?'…':''):(h.good?'— brak':'✅ ukryty')}</span>`;
      hEl.appendChild(row);
    });
    document.getElementById('cspProxyHeadersWrap').style.display='block';
  } catch(err) {
    const msg=err.message||String(err);
    status.textContent=msg.includes('timeout')||msg.includes('Abort')?'⏱ Timeout — proxy nie odpowiedział':msg.includes('fetch')||msg.includes('CORS')?'❌ Proxy niedostępne — spróbuj innego':'❌ '+msg.slice(0,100);
  }
  btn.disabled=false; btn.textContent='🌐 Skanuj przez proxy';
}

function openCspTester() {
  document.getElementById('cspModal').classList.add('show');
  document.getElementById('cspUrlInput').value = window.location.href;
  cspReset();
  setTimeout(() => { cspGenLoad(); cspGenUpdate(); }, 50);
}
function closeCspTester() { document.getElementById('cspModal').classList.remove('show'); }
function cspScanSelf() { document.getElementById('cspUrlInput').value = window.location.href; runCspTest(); }
function cspReset() {
  document.getElementById('cspStatus').textContent = '';
  ['cspRawWrap','cspDirectivesWrap','cspAnalysisWrap','cspHeadersWrap'].forEach(id=>document.getElementById(id).style.display='none');
  document.getElementById('cspScoreBadge').style.display='none';
  ['cspDirectives','cspAnalysis','cspHeaders'].forEach(id=>document.getElementById(id).innerHTML='');
}
async function runCspTest() {
  const url = document.getElementById('cspUrlInput').value.trim();
  if (!url) { document.getElementById('cspStatus').textContent='⚠️ Wpisz URL'; return; }
  cspReset();
  const btn = document.getElementById('cspRunBtn');
  btn.disabled=true; btn.textContent='⏳ Skanowanie...';
  document.getElementById('cspStatus').textContent='🔍 Pobieram nagłówki...';
  const SEC_HEADERS=[
    {name:'strict-transport-security',label:'HSTS',good:true},
    {name:'x-frame-options',label:'X-Frame-Options',good:true},
    {name:'x-content-type-options',label:'X-Content-Type-Options',good:true},
    {name:'referrer-policy',label:'Referrer-Policy',good:true},
    {name:'permissions-policy',label:'Permissions-Policy',good:true},
    {name:'cross-origin-opener-policy',label:'COOP',good:true},
    {name:'cross-origin-embedder-policy',label:'COEP',good:true},
    {name:'x-powered-by',label:'X-Powered-By (info leak)',good:false},
    {name:'server',label:'Server header (info leak)',good:false},
  ];
  try {
    const resp = await fetch(url,{method:'HEAD',cache:'no-store'});
    document.getElementById('cspStatus').textContent=`✅ HTTP ${resp.status} ${resp.statusText}`;
    // Zapisz wynik do raportu
    window._cspLastResult = { url, status: resp.status, time: new Date().toLocaleString() };
    const cspHeader = resp.headers.get('content-security-policy') || resp.headers.get('content-security-policy-report-only');
    const isReportOnly = !resp.headers.get('content-security-policy') && !!resp.headers.get('content-security-policy-report-only');
    if (cspHeader) {
      document.getElementById('cspRaw').textContent=(isReportOnly?'[Report-Only] ':'')+cspHeader;
      document.getElementById('cspRawWrap').style.display='block';
      const directives=cspHeader.split(';').map(d=>d.trim()).filter(Boolean);
      const parsed={};
      directives.forEach(d=>{const p=d.split(/\s+/);parsed[p[0].toLowerCase()]=p.slice(1);});
      const DINFO={
        'default-src':{icon:'🔵',desc:'Fallback dla pozostałych dyrektyw'},
        'script-src':{icon:'⚡',desc:'Skąd można ładować JavaScript'},
        'style-src':{icon:'🎨',desc:'Skąd można ładować CSS'},
        'img-src':{icon:'🖼️',desc:'Skąd można ładować obrazy'},
        'connect-src':{icon:'🌐',desc:'Dozwolone połączenia (fetch, XHR, WebSocket)'},
        'font-src':{icon:'🔤',desc:'Skąd można ładować czcionki'},
        'frame-src':{icon:'🪟',desc:'Dozwolone źródła dla <iframe>'},
        'object-src':{icon:'📦',desc:'Pluginy (Flash itp.)'},
        'base-uri':{icon:'🏠',desc:'Dozwolone wartości <base href>'},
        'form-action':{icon:'📤',desc:'Gdzie formularz może POST'},
        'frame-ancestors':{icon:'🗂️',desc:'Kto może osadzić tę stronę w iframe'},
        'upgrade-insecure-requests':{icon:'🔒',desc:'Automatyczny upgrade HTTP→HTTPS'},
        'report-uri':{icon:'📊',desc:'Endpoint raportów (stary)'},
        'report-to':{icon:'📊',desc:'Endpoint raportów (nowy)'},
      };
      const dirEl=document.getElementById('cspDirectives'); dirEl.innerHTML='';
      Object.entries(parsed).forEach(([key,values])=>{
        const info=DINFO[key]||{icon:'❓',desc:key};
        const dangerous=values.some(v=>v==="'unsafe-inline'"||v==="'unsafe-eval'"||v==='*');
        const hasNonce=values.some(v=>v.startsWith("'nonce-")||v.startsWith("'sha"));
        const highlighted=values.map(v=>{
          if(v==="'unsafe-inline'"||v==="'unsafe-eval'") return `<span style="color:#ef4444;font-weight:700;">${v}</span>`;
          if(v==='*') return `<span style="color:#f97316;font-weight:700;">${v}</span>`;
          if(v.startsWith("'nonce-")||v.startsWith("'sha")) return `<span style="color:#10b981;">${v}</span>`;
          if(v==="'strict-dynamic'") return `<span style="color:#a78bfa;">${v}</span>`;
          if(v==="'none'") return `<span style="color:#6b7280;">${v}</span>`;
          return `<span style="color:rgba(255,255,255,0.7);">${v}</span>`;
        }).join(' ');
        const row=document.createElement('div');
        row.style.cssText=`display:flex;align-items:flex-start;gap:10px;padding:8px 10px;border-radius:8px;background:${dangerous?'rgba(239,68,68,0.06)':'rgba(255,255,255,0.03)'};border:1px solid ${dangerous?'rgba(239,68,68,0.2)':'rgba(255,255,255,0.06)'};`;
        row.innerHTML=`<span style="font-size:14px;margin-top:1px;">${info.icon}</span><div style="flex:1;min-width:0;"><div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;"><span style="font-family:'Space Mono',monospace;font-size:9px;color:#10b981;font-weight:700;">${key}</span>${dangerous?'<span style="font-family:\'Space Mono\',monospace;font-size:7px;color:#ef4444;border:1px solid rgba(239,68,68,0.4);padding:1px 5px;border-radius:4px;">NIEBEZPIECZNE</span>':''}${hasNonce?'<span style="font-family:\'Space Mono\',monospace;font-size:7px;color:#10b981;border:1px solid rgba(16,185,129,0.4);padding:1px 5px;border-radius:4px;">HASH/NONCE ✓</span>':''}</div><div style="font-family:'Space Mono',monospace;font-size:9px;margin-top:3px;line-height:1.6;word-break:break-all;">${highlighted}</div><div style="font-family:'Space Mono',monospace;font-size:7px;color:rgba(255,255,255,0.25);margin-top:2px;">${info.desc}</div></div>`;
        dirEl.appendChild(row);
      });
      document.getElementById('cspDirectivesWrap').style.display='block';
      // Analysis
      const checks=[
        {label:"Brak 'unsafe-inline' w script-src",pass:!((parsed['script-src']||parsed['default-src']||[]).includes("'unsafe-inline'")),tip:"'unsafe-inline' pozwala wstrzyknąć dowolny JS — zastąp nonce/hash"},
        {label:"Brak 'unsafe-eval' w script-src",pass:!((parsed['script-src']||parsed['default-src']||[]).includes("'unsafe-eval'")),tip:"'unsafe-eval' pozwala uruchamiać eval() — niebezpieczne dla XSS"},
        {label:"Brak wildcard (*) w script-src",pass:!((parsed['script-src']||parsed['default-src']||[]).includes('*')),tip:"Wildcard * = brak ograniczeń źródła skryptów"},
        {label:"object-src 'none'",pass:(parsed['object-src']||[]).includes("'none'")||(parsed['default-src']||[]).includes("'none'"),tip:"Ustaw 'none' by zablokować Flash/pluginy"},
        {label:"base-uri zdefiniowane",pass:!!(parsed['base-uri']),tip:"Brak base-uri pozwala zmienić bazowy URL (atak)"},
        {label:"frame-ancestors zdefiniowane",pass:!!(parsed['frame-ancestors']),tip:"Chroni przed clickjackingiem — ustaw 'none' lub 'self'"},
        {label:"upgrade-insecure-requests lub HSTS",pass:!!(parsed['upgrade-insecure-requests'])||!!resp.headers.get('strict-transport-security'),tip:"Automatyczny upgrade HTTP→HTTPS dla zasobów"},
        {label:"Nonce lub hash w script-src",pass:(parsed['script-src']||parsed['default-src']||[]).some(v=>v.startsWith("'nonce-")||v.startsWith("'sha")),tip:"Nowoczesne podejście zamiast 'unsafe-inline'"},
        {label:"Tryb egzekwowania (nie report-only)",pass:!isReportOnly,tip:"Report-Only tylko raportuje, nie blokuje — zmień na CSP"},
      ];
      const score=checks.filter(c=>c.pass).length;
      const pct=Math.round(score/checks.length*100);
      if(window._cspLastResult) {
        window._cspLastResult.score = pct;
        window._cspLastResult.scoreRaw = score + '/' + checks.length;
        window._cspLastResult.hasCsp = true;
        window._cspLastResult.reportOnly = isReportOnly;
        window._cspLastResult.failedChecks = checks.filter(c=>!c.pass).map(c=>c.label);
      }
      const badge=document.getElementById('cspScoreBadge');
      badge.style.display='block'; badge.textContent=pct+'%';
      badge.style.color=pct>=80?'#10b981':pct>=50?'#f59e0b':'#ef4444';
      badge.style.borderColor=pct>=80?'rgba(16,185,129,0.3)':pct>=50?'rgba(245,158,11,0.3)':'rgba(239,68,68,0.3)';
      badge.style.background=pct>=80?'rgba(16,185,129,0.08)':pct>=50?'rgba(245,158,11,0.08)':'rgba(239,68,68,0.08)';
      const analysisEl=document.getElementById('cspAnalysis'); analysisEl.innerHTML='';
      checks.forEach(c=>{
        const row=document.createElement('div');
        row.style.cssText=`display:flex;align-items:flex-start;gap:8px;padding:6px 10px;border-radius:7px;background:${c.pass?'rgba(16,185,129,0.04)':'rgba(239,68,68,0.04)'};border:1px solid ${c.pass?'rgba(16,185,129,0.1)':'rgba(239,68,68,0.12)'};`;
        row.innerHTML=`<span style="font-size:12px;margin-top:1px;">${c.pass?'✅':'❌'}</span><div><div style="font-family:'Space Mono',monospace;font-size:9px;color:${c.pass?'rgba(255,255,255,0.7)':'rgba(255,255,255,0.5)'};">${c.label}</div>${!c.pass?`<div style="font-family:'Space Mono',monospace;font-size:7px;color:rgba(255,255,255,0.3);margin-top:2px;">${c.tip}</div>`:''}</div>`;
        analysisEl.appendChild(row);
      });
      document.getElementById('cspAnalysisWrap').style.display='block';
    } else {
      document.getElementById('cspRaw').textContent='❌ Brak nagłówka Content-Security-Policy!';
      document.getElementById('cspRawWrap').style.display='block';
      document.getElementById('cspStatus').textContent=`✅ HTTP ${resp.status} — ⚠️ Brak CSP!`;
      const badge=document.getElementById('cspScoreBadge');
      if(window._cspLastResult) { window._cspLastResult.hasCsp = false; window._cspLastResult.score = 0; window._cspLastResult.scoreRaw = '0/9'; }
      badge.style.display='block'; badge.textContent='0%'; badge.style.color='#ef4444';
      badge.style.borderColor='rgba(239,68,68,0.3)'; badge.style.background='rgba(239,68,68,0.08)';
      document.getElementById('cspAnalysis').innerHTML=`<div style="padding:12px;border-radius:8px;background:rgba(239,68,68,0.07);border:1px solid rgba(239,68,68,0.2);font-family:'Space Mono',monospace;font-size:9px;color:#ef4444;line-height:1.8;">❌ Strona nie ma nagłówka Content-Security-Policy.<br><span style="color:rgba(255,255,255,0.4);">Dla Netlify dodaj plik <strong style="color:rgba(255,255,255,0.6);">_headers</strong> w katalogu public.</span></div><div style="margin-top:8px;padding:10px 12px;border-radius:8px;background:rgba(16,185,129,0.05);border:1px solid rgba(16,185,129,0.15);font-family:'Space Mono',monospace;font-size:8px;color:#10b981;line-height:2;">💡 Przykład (_headers):<br><span style="color:rgba(255,255,255,0.5);">/*<br>&nbsp;&nbsp;Content-Security-Policy: default-src 'self'; script-src 'self'; object-src 'none'<br>&nbsp;&nbsp;X-Frame-Options: DENY<br>&nbsp;&nbsp;X-Content-Type-Options: nosniff</span></div>`;
      document.getElementById('cspAnalysisWrap').style.display='block';
    }
    // Other security headers
    const headersEl=document.getElementById('cspHeaders'); headersEl.innerHTML='';
    SEC_HEADERS.forEach(h=>{
      const val=resp.headers.get(h.name); const present=!!val;
      const ok=h.good?present:!present;
      const row=document.createElement('div');
      row.style.cssText='display:flex;align-items:center;gap:10px;padding:6px 10px;border-radius:7px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.05);';
      row.innerHTML=`<span style="font-size:11px;">${ok?'✅':h.good?'⚠️':'✅'}</span><span style="font-family:'Space Mono',monospace;font-size:8px;color:${ok?'rgba(255,255,255,0.6)':'rgba(255,255,255,0.35)'};flex:1;">${h.label}</span><span style="font-family:'Space Mono',monospace;font-size:8px;color:${present?(h.good?'#10b981':'#ef4444'):'rgba(255,255,255,0.2)'};max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${val||''}">${val?val.slice(0,50)+(val.length>50?'…':''):(h.good?'— brak':'✅ ukryty')}</span>`;
      headersEl.appendChild(row);
    });
    document.getElementById('cspHeadersWrap').style.display='block';
  } catch(err) {
    const msg=err.message||String(err);
    if(msg.includes('fetch')||msg.includes('CORS')||msg.includes('Network')) {
      document.getElementById('cspStatus').textContent='⚠️ CORS blokuje dostęp — serwer nie zezwala na cross-origin HEAD';
      document.getElementById('cspRaw').textContent='Nie można odczytać nagłówków.\n\nSerwer blokuje żądania HEAD z innych domen.\nDziała zawsze dla tej samej domeny (np. Twoja strona na Netlify).';
      document.getElementById('cspRawWrap').style.display='block';
    } else if(msg.includes('timeout')||msg.includes('AbortError')) {
      document.getElementById('cspStatus').textContent='⏱ Timeout — serwer nie odpowiedział w 8 sekund';
    } else {
      document.getElementById('cspStatus').textContent='❌ Błąd: '+msg.slice(0,100);
    }
  }
  btn.disabled=false; btn.textContent='🔍 Skanuj';
}
// ── SETTINGS ──────────────────────────────────────────
function openSettings() {
  document.getElementById('settingsModal').style.display = 'flex';
  applySettingsI18n();
  updateThemeUI();
}

function applySettingsI18n() {
  const lang = window.currentLang || 'pl';
  const i = ABOUT_I18N[lang] || ABOUT_I18N.pl;
  const el = (id) => document.getElementById(id);
  if(el('settingsTitle'))    el('settingsTitle').textContent    = i.settingsTitle    || 'Ustawienia';
  if(el('settingsSubtitle')) el('settingsSubtitle').textContent = i.settingsSubtitle || 'STUDIO TEST';
  if(el('settingsThemeLabel')) el('settingsThemeLabel').textContent = i.themeLabel || '🎨 Motyw kolorystyczny';
  if(el('settingsThemeHint'))  el('settingsThemeHint').textContent  = i.themesSectionHint || 'Zapisywany automatycznie';
  if(el('btnInfoLabel')) el('btnInfoLabel').textContent = i.infoBtn || 'ℹ️ INFO';
  // Translate theme button labels
  const themeNames = i.themeNames || i.themes || {};
  document.querySelectorAll('.theme-opt').forEach(btn => {
    const key = btn.dataset.theme;
    if(key && themeNames[key]) {
      const span = btn.querySelector('span:not(.theme-check)');
      if(span) span.textContent = themeNames[key];
    }
  });
}
function closeSettings() {
  document.getElementById('settingsModal').style.display = 'none';
}
function applyTheme(name) {
  if (name === 'dark') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', name);
  }
  localStorage.setItem('st_theme', name);
  updateThemeUI();
}
function updateThemeUI() {
  const current = localStorage.getItem('st_theme') || 'dark';
  document.querySelectorAll('.theme-opt').forEach(btn => {
    const isActive = btn.dataset.theme === current;
    btn.classList.toggle('active', isActive);
    btn.querySelector('.theme-check').style.display = isActive ? 'block' : 'none';
  });
}
// Apply saved theme on load
(function() {
  const saved = localStorage.getItem('st_theme');
  if (saved && saved !== 'dark') {
    document.documentElement.setAttribute('data-theme', saved);
  }
})();

