(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const els = {
    video: $('video'),
    overlay: $('overlay'),
    status: $('status'),
    countIn: $('countIn'),
    countOut: $('countOut'),
    countNet: $('countNet'),
    fps: $('fps'),
    people: $('people'),
    empty: $('emptyState'),
    btnStart: $('btnStart'),
    btnStop: $('btnStop'),
    btnReset: $('btnReset'),
    btnExport: $('btnExport'),
    btnSettings: $('btnSettings'),
    settings: $('settingsPanel'),
    lineOrient: $('lineOrient'),
    linePos: $('linePos'),
    linePosVal: $('linePosVal'),
    entryDir: $('entryDir'),
    confThreshold: $('confThreshold'),
    confVal: $('confVal'),
    cameraFacing: $('cameraFacing'),
    historyList: $('historyList'),
  };

  const STORE_KEY = 'door-counter-state-v1';
  const HISTORY_KEY = 'door-counter-history-v1';

  const state = {
    model: null,
    stream: null,
    running: false,
    rafId: null,
    inferring: false,
    countIn: 0,
    countOut: 0,
    tracks: [],
    nextTrackId: 1,
    lastDetectionAt: 0,
    detectionIntervalMs: 100,
    fpsSamples: [],
    history: [],
    settings: {
      lineOrient: 'horizontal',
      linePos: 50,
      entryDir: 'positive',
      confThreshold: 0.55,
      cameraFacing: 'environment',
    },
  };

  function setStatus(text, kind = '') {
    els.status.textContent = text;
    els.status.className = 'status' + (kind ? ' ' + kind : '');
  }

  function loadState() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
      if (s.settings) Object.assign(state.settings, s.settings);
      const today = new Date().toDateString();
      if (s.date === today) {
        state.countIn = s.countIn || 0;
        state.countOut = s.countOut || 0;
      }
    } catch {}
    try {
      const h = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
      const today = new Date().toDateString();
      state.history = h.filter(e => new Date(e.t).toDateString() === today);
    } catch {}
  }

  function saveState() {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      date: new Date().toDateString(),
      countIn: state.countIn,
      countOut: state.countOut,
      settings: state.settings,
    }));
    localStorage.setItem(HISTORY_KEY, JSON.stringify(state.history));
  }

  function syncUIFromSettings() {
    els.lineOrient.value = state.settings.lineOrient;
    els.linePos.value = String(state.settings.linePos);
    els.linePosVal.textContent = state.settings.linePos + '%';
    els.entryDir.value = state.settings.entryDir;
    els.confThreshold.value = String(Math.round(state.settings.confThreshold * 100));
    els.confVal.textContent = Math.round(state.settings.confThreshold * 100) + '%';
    els.cameraFacing.value = state.settings.cameraFacing;
    updateCounters();
    renderHistory();
  }

  function updateCounters() {
    els.countIn.textContent = state.countIn;
    els.countOut.textContent = state.countOut;
    els.countNet.textContent = Math.max(0, state.countIn - state.countOut);
  }

  function renderHistory() {
    if (!state.history.length) {
      els.historyList.innerHTML = '<li class="empty">لا توجد أحداث بعد</li>';
      return;
    }
    const fmt = new Intl.DateTimeFormat('ar-SA', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    els.historyList.innerHTML = state.history.slice(-50).reverse().map(e => `
      <li>
        <span class="${e.type === 'in' ? 'ev-in' : 'ev-out'}">${e.type === 'in' ? 'دخول' : 'خروج'}</span>
        <span class="ev-time">${fmt.format(new Date(e.t))}</span>
      </li>
    `).join('');
  }

  function logEvent(type) {
    state.history.push({ t: Date.now(), type });
    if (state.history.length > 1000) state.history.shift();
    renderHistory();
    saveState();
  }

  async function loadModel() {
    setStatus('تحميل نموذج الكشف...');
    try {
      await tf.ready();
      state.model = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
      setStatus('النموذج جاهز', 'ok');
    } catch (err) {
      setStatus('فشل تحميل النموذج', 'error');
      console.error(err);
      throw err;
    }
  }

  async function startCamera() {
    if (state.stream) stopCamera();
    setStatus('طلب الإذن للكاميرا...');
    try {
      const constraints = {
        audio: false,
        video: {
          facingMode: { ideal: state.settings.cameraFacing },
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
      };
      state.stream = await navigator.mediaDevices.getUserMedia(constraints);
      els.video.srcObject = state.stream;
      await new Promise(res => {
        if (els.video.readyState >= 2) res();
        else els.video.onloadedmetadata = () => res();
      });
      await els.video.play();
      resizeOverlay();
      els.empty.classList.add('hidden');
      setStatus('الكاميرا تعمل', 'ok');
    } catch (err) {
      setStatus('تعذّر فتح الكاميرا: ' + (err.message || err.name), 'error');
      throw err;
    }
  }

  function stopCamera() {
    if (state.stream) {
      state.stream.getTracks().forEach(t => t.stop());
      state.stream = null;
    }
    els.video.srcObject = null;
  }

  function resizeOverlay() {
    const v = els.video;
    const o = els.overlay;
    const rect = v.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    o.width = Math.round(rect.width * dpr);
    o.height = Math.round(rect.height * dpr);
    o.style.width = rect.width + 'px';
    o.style.height = rect.height + 'px';
  }
  window.addEventListener('resize', resizeOverlay);

  function getLineCoords(w, h) {
    const pos = state.settings.linePos / 100;
    if (state.settings.lineOrient === 'horizontal') {
      const y = h * pos;
      return { x1: 0, y1: y, x2: w, y2: y, axis: 'y', value: y };
    } else {
      const x = w * pos;
      return { x1: x, y1: 0, x2: x, y2: h, axis: 'x', value: x };
    }
  }

  function drawOverlay(detections, lineCrossings) {
    const ctx = els.overlay.getContext('2d');
    const W = els.overlay.width, H = els.overlay.height;
    ctx.clearRect(0, 0, W, H);

    const v = els.video;
    const vw = v.videoWidth, vh = v.videoHeight;
    if (!vw || !vh) return;

    const cw = els.overlay.clientWidth, ch = els.overlay.clientHeight;
    const scale = Math.max(cw / vw, ch / vh);
    const dw = vw * scale, dh = vh * scale;
    const ox = (cw - dw) / 2;
    const oy = (ch - dh) / 2;
    const dpr = W / cw;

    const transform = (x, y) => [(ox + x * scale) * dpr, (oy + y * scale) * dpr];

    const line = getLineCoords(vw, vh);
    const [lx1, ly1] = transform(line.x1, line.y1);
    const [lx2, ly2] = transform(line.x2, line.y2);
    ctx.strokeStyle = 'rgba(59,130,246,0.95)';
    ctx.lineWidth = 3 * dpr;
    ctx.setLineDash([12 * dpr, 8 * dpr]);
    ctx.beginPath();
    ctx.moveTo(lx1, ly1);
    ctx.lineTo(lx2, ly2);
    ctx.stroke();
    ctx.setLineDash([]);

    for (const t of state.tracks) {
      const [bx, by, bw, bh] = t.bbox;
      const [x1, y1] = transform(bx, by);
      const [x2, y2] = transform(bx + bw, by + bh);
      const color = t.counted ? 'rgba(16,185,129,0.9)' : 'rgba(255,255,255,0.85)';
      ctx.strokeStyle = color;
      ctx.lineWidth = 2 * dpr;
      ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);

      ctx.fillStyle = color;
      ctx.font = `${12 * dpr}px system-ui`;
      const label = `#${t.id} ${(t.score * 100).toFixed(0)}%`;
      const tw = ctx.measureText(label).width + 8 * dpr;
      ctx.fillRect(x1, y1 - 18 * dpr, tw, 18 * dpr);
      ctx.fillStyle = '#0f172a';
      ctx.fillText(label, x1 + 4 * dpr, y1 - 5 * dpr);

      const [cx, cy] = transform(t.cx, t.cy);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(cx, cy, 4 * dpr, 0, Math.PI * 2);
      ctx.fill();
    }

    if (lineCrossings && lineCrossings.length) {
      ctx.fillStyle = 'rgba(59,130,246,0.18)';
      ctx.fillRect(0, 0, W, H);
    }
  }

  function iou(a, b) {
    const [ax, ay, aw, ah] = a;
    const [bx, by, bw, bh] = b;
    const x1 = Math.max(ax, bx);
    const y1 = Math.max(ay, by);
    const x2 = Math.min(ax + aw, bx + bw);
    const y2 = Math.min(ay + ah, by + bh);
    const iw = Math.max(0, x2 - x1);
    const ih = Math.max(0, y2 - y1);
    const inter = iw * ih;
    const union = aw * ah + bw * bh - inter;
    return union > 0 ? inter / union : 0;
  }

  function dist(a, b) {
    const dx = a[0] - b[0], dy = a[1] - b[1];
    return Math.hypot(dx, dy);
  }

  function updateTracks(detections, vw, vh) {
    const TRACK_TIMEOUT = 1500;
    const MIN_IOU = 0.2;
    const MAX_DIST = Math.min(vw, vh) * 0.25;
    const now = Date.now();

    const used = new Set();
    for (const t of state.tracks) {
      let bestIdx = -1, bestScore = -1;
      for (let i = 0; i < detections.length; i++) {
        if (used.has(i)) continue;
        const d = detections[i];
        const o = iou(t.bbox, d.bbox);
        const cd = dist([t.cx, t.cy], [d.cx, d.cy]);
        if (o > MIN_IOU || cd < MAX_DIST) {
          const score = o + (1 - cd / MAX_DIST) * 0.5;
          if (score > bestScore) { bestScore = score; bestIdx = i; }
        }
      }
      if (bestIdx >= 0) {
        const d = detections[bestIdx];
        used.add(bestIdx);
        t.prevCx = t.cx; t.prevCy = t.cy;
        t.bbox = d.bbox;
        t.cx = d.cx; t.cy = d.cy;
        t.score = d.score;
        t.lastSeen = now;
        t.history.push([d.cx, d.cy, now]);
        if (t.history.length > 30) t.history.shift();
      }
    }

    for (let i = 0; i < detections.length; i++) {
      if (used.has(i)) continue;
      const d = detections[i];
      state.tracks.push({
        id: state.nextTrackId++,
        bbox: d.bbox,
        cx: d.cx, cy: d.cy,
        prevCx: d.cx, prevCy: d.cy,
        score: d.score,
        lastSeen: now,
        history: [[d.cx, d.cy, now]],
        counted: false,
        side: null,
      });
    }

    state.tracks = state.tracks.filter(t => now - t.lastSeen < TRACK_TIMEOUT);
  }

  function checkLineCrossings(vw, vh) {
    const line = getLineCoords(vw, vh);
    const crossings = [];
    for (const t of state.tracks) {
      const cur = line.axis === 'y' ? t.cy : t.cx;
      const prev = line.axis === 'y' ? t.prevCy : t.prevCx;
      const curSide = cur < line.value ? 'neg' : 'pos';

      if (t.side === null) {
        t.side = curSide;
        continue;
      }
      if (t.side !== curSide && !t.counted) {
        const movingPositive = (prev < line.value && cur >= line.value);
        const movingNegative = (prev > line.value && cur <= line.value);
        if (movingPositive || movingNegative) {
          const isEntry = (state.settings.entryDir === 'positive' && movingPositive)
                       || (state.settings.entryDir === 'negative' && movingNegative);
          if (isEntry) {
            state.countIn++;
            logEvent('in');
          } else {
            state.countOut++;
            logEvent('out');
          }
          t.counted = true;
          crossings.push({ id: t.id, type: isEntry ? 'in' : 'out' });
          updateCounters();
        }
        t.side = curSide;
      }
    }
    return crossings;
  }

  async function detectLoop() {
    if (!state.running) return;

    const now = performance.now();
    const v = els.video;
    const vw = v.videoWidth, vh = v.videoHeight;

    if (vw && vh && !state.inferring && (now - state.lastDetectionAt) >= state.detectionIntervalMs) {
      state.inferring = true;
      state.lastDetectionAt = now;
      try {
        const t0 = performance.now();
        const preds = await state.model.detect(v, 8);
        const t1 = performance.now();

        state.fpsSamples.push(t1 - t0);
        if (state.fpsSamples.length > 10) state.fpsSamples.shift();
        const avg = state.fpsSamples.reduce((a, b) => a + b, 0) / state.fpsSamples.length;
        els.fps.textContent = `${(1000 / Math.max(avg, 1)).toFixed(1)} FPS`;

        const persons = preds
          .filter(p => p.class === 'person' && p.score >= state.settings.confThreshold)
          .map(p => ({
            bbox: p.bbox,
            cx: p.bbox[0] + p.bbox[2] / 2,
            cy: p.bbox[1] + p.bbox[3] / 2,
            score: p.score,
          }));

        els.people.textContent = `${persons.length} شخص`;
        updateTracks(persons, vw, vh);
        const crossings = checkLineCrossings(vw, vh);
        drawOverlay(persons, crossings);
      } catch (err) {
        console.error('detect error', err);
      } finally {
        state.inferring = false;
      }
    } else if (vw && vh) {
      drawOverlay([], []);
    }

    state.rafId = requestAnimationFrame(detectLoop);
  }

  async function start() {
    if (state.running) return;
    els.btnStart.disabled = true;
    try {
      if (!state.model) await loadModel();
      await startCamera();
      state.running = true;
      els.btnStop.disabled = false;
      detectLoop();
    } catch {
      els.btnStart.disabled = false;
    }
  }

  function stop() {
    state.running = false;
    if (state.rafId) cancelAnimationFrame(state.rafId);
    stopCamera();
    state.tracks = [];
    els.empty.classList.remove('hidden');
    els.btnStart.disabled = false;
    els.btnStop.disabled = true;
    setStatus('متوقف');
    const ctx = els.overlay.getContext('2d');
    ctx.clearRect(0, 0, els.overlay.width, els.overlay.height);
  }

  function reset() {
    if (!confirm('تصفير العدّاد وسجل اليوم؟')) return;
    state.countIn = 0;
    state.countOut = 0;
    state.history = [];
    state.tracks = [];
    updateCounters();
    renderHistory();
    saveState();
  }

  function exportCSV() {
    if (!state.history.length) {
      alert('لا توجد بيانات للتصدير');
      return;
    }
    const rows = [['التاريخ', 'الوقت', 'الحدث']];
    for (const e of state.history) {
      const d = new Date(e.t);
      rows.push([
        d.toLocaleDateString('en-CA'),
        d.toLocaleTimeString('en-GB'),
        e.type === 'in' ? 'دخول' : 'خروج',
      ]);
    }
    rows.push([]);
    rows.push(['إجمالي الدخول', state.countIn]);
    rows.push(['إجمالي الخروج', state.countOut]);
    rows.push(['داخل الآن', Math.max(0, state.countIn - state.countOut)]);

    const csv = '﻿' + rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `door-counter-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function bindEvents() {
    els.btnStart.addEventListener('click', start);
    els.btnStop.addEventListener('click', stop);
    els.btnReset.addEventListener('click', reset);
    els.btnExport.addEventListener('click', exportCSV);
    els.btnSettings.addEventListener('click', () => {
      els.settings.open = !els.settings.open;
    });

    els.lineOrient.addEventListener('change', e => {
      state.settings.lineOrient = e.target.value;
      saveState();
    });
    els.linePos.addEventListener('input', e => {
      state.settings.linePos = +e.target.value;
      els.linePosVal.textContent = state.settings.linePos + '%';
      saveState();
    });
    els.entryDir.addEventListener('change', e => {
      state.settings.entryDir = e.target.value;
      saveState();
    });
    els.confThreshold.addEventListener('input', e => {
      state.settings.confThreshold = +e.target.value / 100;
      els.confVal.textContent = e.target.value + '%';
      saveState();
    });
    els.cameraFacing.addEventListener('change', async e => {
      state.settings.cameraFacing = e.target.value;
      saveState();
      if (state.running) {
        stopCamera();
        try { await startCamera(); } catch {}
      }
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden && state.running) {
        // keep running but lower rate could be added; iOS may pause anyway
      }
    });
  }

  function checkSupport() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus('المتصفح لا يدعم الكاميرا', 'error');
      els.btnStart.disabled = true;
      return false;
    }
    if (!window.isSecureContext) {
      setStatus('يجب فتح الموقع عبر HTTPS', 'error');
      els.btnStart.disabled = true;
      return false;
    }
    return true;
  }

  function init() {
    loadState();
    syncUIFromSettings();
    bindEvents();
    if (!checkSupport()) return;
    setStatus('جاهز — اضغط تشغيل');

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  init();
})();
