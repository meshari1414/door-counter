(() => {
  'use strict';

  // ─────────────────────────────────────────────────────────────────────────────
  // Element refs
  // ─────────────────────────────────────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);
  const els = {
    body: document.body,
    video: $('video'),
    overlay: $('overlay'),
    cameraWrap: $('cameraWrap'),
    lineHandle: $('lineHandle'),
    status: $('status'),
    modeBadge: $('modeBadge'),
    countIn: $('countIn'),
    countOut: $('countOut'),
    countNet: $('countNet'),
    netCard: $('netCard'),
    capacityHint: $('capacityHint'),
    capacityBar: $('capacityBar'),
    capacityFill: $('capacityFill'),
    capacityText: $('capacityText'),
    capacityFlash: $('capacityFlash'),
    fps: $('fps'),
    people: $('people'),
    dragHint: $('dragHint'),
    empty: $('emptyState'),
    btnStart: $('btnStart'),
    btnStop: $('btnStop'),
    btnReset: $('btnReset'),
    btnExport: $('btnExport'),
    btnPDF: $('btnPDF'),
    btnShare: $('btnShare'),
    btnSettings: $('btnSettings'),
    settings: $('settingsPanel'),
    lineOrient: $('lineOrient'),
    linePos: $('linePos'),
    linePosVal: $('linePosVal'),
    entryDir: $('entryDir'),
    confThreshold: $('confThreshold'),
    confVal: $('confVal'),
    bufferZone: $('bufferZone'),
    bufferVal: $('bufferVal'),
    minConfirmFrames: $('minConfirmFrames'),
    minFramesVal: $('minFramesVal'),
    cameraFacing: $('cameraFacing'),
    capacityMax: $('capacityMax'),
    hapticOn: $('hapticOn'),
    soundOn: $('soundOn'),
    historyList: $('historyList'),
    chartSvg: $('hourlyChart'),
    chartEmpty: $('chartEmpty'),
    chartSub: $('chartSub'),
    shareModal: $('shareModal'),
    shareClose: $('shareClose'),
    shareStatus: $('shareStatus'),
    tabHost: $('tabHost'),
    tabJoin: $('tabJoin'),
    paneHost: $('paneHost'),
    paneJoin: $('paneJoin'),
    btnHostStart: $('btnHostStart'),
    btnHostStop: $('btnHostStop'),
    shareResult: $('shareResult'),
    shareCode: $('shareCode'),
    shareQR: $('shareQR'),
    shareLink: $('shareLink'),
    btnCopyLink: $('btnCopyLink'),
    joinCode: $('joinCode'),
    btnJoin: $('btnJoin'),
    alertModal: $('alertModal'),
    alertTitle: $('alertTitle'),
    alertText: $('alertText'),
    alertClose: $('alertClose'),
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // State
  // ─────────────────────────────────────────────────────────────────────────────
  const STORE_KEY = 'door-counter-state-v2';
  const HISTORY_KEY = 'door-counter-history-v2';

  const state = {
    model: null,
    stream: null,
    running: false,
    rafId: null,
    inferring: false,
    countIn: 0,
    countOut: 0,
    capacityAlerted: false,
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
      capacityMax: 0,
      hapticOn: true,
      soundOn: false,
      bufferZone: 15,        // % of frame on each side of line — hysteresis band
      minConfirmFrames: 2,   // frames track must hold a zone before it's "confirmed"
    },
    mode: 'host',
    audioCtx: null,
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // Storage
  // ─────────────────────────────────────────────────────────────────────────────
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

  // ─────────────────────────────────────────────────────────────────────────────
  // UI helpers
  // ─────────────────────────────────────────────────────────────────────────────
  function setStatus(text, kind = '') {
    els.status.textContent = text;
    els.status.className = 'status' + (kind ? ' ' + kind : '');
  }

  function syncUIFromSettings() {
    els.lineOrient.value = state.settings.lineOrient;
    els.linePos.value = String(state.settings.linePos);
    els.linePosVal.textContent = state.settings.linePos + '%';
    els.entryDir.value = state.settings.entryDir;
    els.confThreshold.value = String(Math.round(state.settings.confThreshold * 100));
    els.confVal.textContent = Math.round(state.settings.confThreshold * 100) + '%';
    els.bufferZone.value = String(state.settings.bufferZone);
    els.bufferVal.textContent = state.settings.bufferZone + '%';
    els.minConfirmFrames.value = String(state.settings.minConfirmFrames);
    els.minFramesVal.textContent = String(state.settings.minConfirmFrames);
    els.cameraFacing.value = state.settings.cameraFacing;
    els.capacityMax.value = String(state.settings.capacityMax || 0);
    els.hapticOn.checked = !!state.settings.hapticOn;
    els.soundOn.checked = !!state.settings.soundOn;
    updateCounters();
    updateCapacityUI();
    renderHistory();
    renderChart();
    positionLineHandle();
  }

  function updateCounters() {
    const net = Math.max(0, state.countIn - state.countOut);
    setNumberAnim(els.countIn, state.countIn);
    setNumberAnim(els.countOut, state.countOut);
    setNumberAnim(els.countNet, net);
  }

  function setNumberAnim(el, value) {
    const prev = +el.textContent;
    el.textContent = value;
    if (prev !== value) {
      el.classList.remove('bump');
      void el.offsetWidth;
      el.classList.add('bump');
    }
  }

  function updateCapacityUI() {
    const cap = state.settings.capacityMax || 0;
    const net = Math.max(0, state.countIn - state.countOut);

    if (cap <= 0) {
      els.capacityBar.hidden = true;
      els.capacityHint.textContent = '';
      els.netCard.classList.remove('warn', 'full');
      return;
    }

    els.capacityBar.hidden = false;
    const pct = Math.min(100, (net / cap) * 100);
    els.capacityFill.style.inset = `0 ${100 - pct}% 0 0`;
    els.capacityText.textContent = `${net} / ${cap}`;
    els.capacityHint.textContent = `${net} / ${cap}`;

    els.netCard.classList.remove('warn', 'full');
    els.capacityFill.classList.remove('warn', 'full');
    if (net >= cap) {
      els.netCard.classList.add('full');
      els.capacityFill.classList.add('full');
    } else if (net >= cap * 0.85) {
      els.netCard.classList.add('warn');
      els.capacityFill.classList.add('warn');
    }
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

  // ─────────────────────────────────────────────────────────────────────────────
  // Hourly chart (SVG bars)
  // ─────────────────────────────────────────────────────────────────────────────
  function renderChart() {
    const svg = els.chartSvg;
    const W = 480, H = 160, P = { top: 14, right: 8, bottom: 24, left: 8 };
    svg.innerHTML = '';

    const buckets = new Array(24).fill(0).map(() => ({ in: 0, out: 0 }));
    for (const e of state.history) {
      const h = new Date(e.t).getHours();
      buckets[h][e.type] = (buckets[h][e.type] || 0) + 1;
    }

    const maxVal = Math.max(1, ...buckets.map(b => Math.max(b.in, b.out)));
    const chartW = W - P.left - P.right;
    const chartH = H - P.top - P.bottom;
    const slot = chartW / 24;
    const barW = Math.max(2, slot * 0.35);
    const gap = (slot - barW * 2) / 3;

    const total = state.history.length;
    els.chartEmpty.classList.toggle('hidden', total > 0);
    els.chartSub.textContent = total > 0 ? `${total} حدث اليوم` : 'اليوم';

    if (total === 0) return;

    const ns = 'http://www.w3.org/2000/svg';
    for (let i = 0; i < 4; i++) {
      const y = P.top + (chartH * i / 4);
      const line = document.createElementNS(ns, 'line');
      line.setAttribute('x1', P.left);
      line.setAttribute('x2', W - P.right);
      line.setAttribute('y1', y);
      line.setAttribute('y2', y);
      line.setAttribute('stroke', '#334155');
      line.setAttribute('stroke-dasharray', '2 3');
      line.setAttribute('stroke-width', '1');
      svg.appendChild(line);
    }

    for (let h = 0; h < 24; h++) {
      const x = P.left + slot * h;
      const b = buckets[h];

      if (b.in > 0) {
        const barH = (b.in / maxVal) * chartH;
        const r = document.createElementNS(ns, 'rect');
        r.setAttribute('x', x + gap);
        r.setAttribute('y', P.top + chartH - barH);
        r.setAttribute('width', barW);
        r.setAttribute('height', barH);
        r.setAttribute('rx', 2);
        r.setAttribute('fill', '#10b981');
        svg.appendChild(r);
      }

      if (b.out > 0) {
        const barH = (b.out / maxVal) * chartH;
        const r = document.createElementNS(ns, 'rect');
        r.setAttribute('x', x + gap * 2 + barW);
        r.setAttribute('y', P.top + chartH - barH);
        r.setAttribute('width', barW);
        r.setAttribute('height', barH);
        r.setAttribute('rx', 2);
        r.setAttribute('fill', '#ef4444');
        svg.appendChild(r);
      }

      if (h % 3 === 0) {
        const t = document.createElementNS(ns, 'text');
        t.setAttribute('x', x + slot / 2);
        t.setAttribute('y', H - 8);
        t.setAttribute('fill', '#94a3b8');
        t.setAttribute('font-size', '10');
        t.setAttribute('text-anchor', 'middle');
        t.textContent = h.toString().padStart(2, '0');
        svg.appendChild(t);
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Events / counting / haptic / sound
  // ─────────────────────────────────────────────────────────────────────────────
  function logEvent(type) {
    state.history.push({ t: Date.now(), type });
    if (state.history.length > 1000) state.history.shift();
    renderHistory();
    renderChart();
    saveState();
  }

  function feedback(type) {
    if (state.settings.hapticOn && navigator.vibrate) {
      navigator.vibrate(type === 'in' ? 40 : [30, 40, 30]);
    }
    if (state.settings.soundOn) beep(type === 'in' ? 880 : 440, 80);
  }

  function beep(freq, dur) {
    try {
      if (!state.audioCtx) state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const ctx = state.audioCtx;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain).connect(ctx.destination);
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.12, ctx.currentTime + 0.01);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + dur / 1000);
      osc.start();
      osc.stop(ctx.currentTime + dur / 1000 + 0.02);
    } catch {}
  }

  function checkCapacity() {
    const cap = state.settings.capacityMax || 0;
    if (cap <= 0) { state.capacityAlerted = false; return; }
    const net = Math.max(0, state.countIn - state.countOut);
    if (net >= cap && !state.capacityAlerted) {
      state.capacityAlerted = true;
      triggerCapacityAlert(net, cap);
    }
    if (net < cap) state.capacityAlerted = false;
  }

  function triggerCapacityAlert(net, cap) {
    if (navigator.vibrate) navigator.vibrate([100, 60, 100, 60, 200]);
    if (state.settings.soundOn) {
      beep(880, 150);
      setTimeout(() => beep(660, 200), 180);
    }
    els.capacityFlash.classList.remove('flash');
    void els.capacityFlash.offsetWidth;
    els.capacityFlash.classList.add('flash');
    showAlert('السعة القصوى', `وصل العدد إلى ${net} من أصل ${cap}`);
  }

  function showAlert(title, text) {
    els.alertTitle.textContent = title;
    els.alertText.textContent = text;
    els.alertModal.hidden = false;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Camera
  // ─────────────────────────────────────────────────────────────────────────────
  async function loadModel() {
    setStatus('تحميل نموذج الكشف...');
    try {
      await tf.ready();
      state.model = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
      setStatus('النموذج جاهز', 'ok');
    } catch (err) {
      setStatus('فشل تحميل النموذج', 'error');
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
      els.lineHandle.hidden = false;
      positionLineHandle();
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
    positionLineHandle();
  }
  window.addEventListener('resize', resizeOverlay);

  // ─────────────────────────────────────────────────────────────────────────────
  // Line + drag
  // ─────────────────────────────────────────────────────────────────────────────
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

  function positionLineHandle() {
    if (!els.cameraWrap || els.lineHandle.hidden) return;
    const rect = els.cameraWrap.getBoundingClientRect();
    if (!rect.width) return;
    const orient = state.settings.lineOrient;
    const pct = state.settings.linePos;
    els.lineHandle.classList.toggle('horizontal', orient === 'horizontal');
    els.lineHandle.classList.toggle('vertical', orient === 'vertical');
    if (orient === 'horizontal') {
      els.lineHandle.style.top = pct + '%';
      els.lineHandle.style.left = '0';
      els.lineHandle.style.right = '0';
      els.lineHandle.style.bottom = '';
    } else {
      els.lineHandle.style.left = pct + '%';
      els.lineHandle.style.top = '0';
      els.lineHandle.style.bottom = '0';
      els.lineHandle.style.right = '';
    }
  }

  function bindLineDrag() {
    let dragging = false;
    const onDown = (e) => {
      dragging = true;
      els.lineHandle.classList.add('dragging');
      els.dragHint.classList.add('hidden');
      e.preventDefault();
    };
    const onMove = (e) => {
      if (!dragging) return;
      const rect = els.cameraWrap.getBoundingClientRect();
      const point = e.touches ? e.touches[0] : e;
      let pct;
      if (state.settings.lineOrient === 'horizontal') {
        pct = ((point.clientY - rect.top) / rect.height) * 100;
      } else {
        pct = ((point.clientX - rect.left) / rect.width) * 100;
      }
      pct = Math.max(5, Math.min(95, pct));
      state.settings.linePos = Math.round(pct);
      els.linePos.value = String(state.settings.linePos);
      els.linePosVal.textContent = state.settings.linePos + '%';
      positionLineHandle();
      e.preventDefault();
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      els.lineHandle.classList.remove('dragging');
      saveState();
      sharePush();
    };
    els.lineHandle.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Drawing
  // ─────────────────────────────────────────────────────────────────────────────
  function drawOverlay() {
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

    const zones = getZonesFor(vw, vh);
    const line = zones.line;

    // Draw buffer zones as faint translucent bands
    if (zones.axis === 'y') {
      const [zax1, zay1] = transform(0, zones.a);
      const [zax2, zay2] = transform(vw, zones.b);
      ctx.fillStyle = 'rgba(59,130,246,0.08)';
      ctx.fillRect(zax1, zay1, zax2 - zax1, zay2 - zay1);
      // Buffer boundaries
      ctx.strokeStyle = 'rgba(59,130,246,0.35)';
      ctx.lineWidth = 1.5 * dpr;
      ctx.setLineDash([4 * dpr, 6 * dpr]);
      const [ax1, ay1] = transform(0, zones.a);
      const [ax2, ay2] = transform(vw, zones.a);
      ctx.beginPath(); ctx.moveTo(ax1, ay1); ctx.lineTo(ax2, ay2); ctx.stroke();
      const [bx1, by1] = transform(0, zones.b);
      const [bx2, by2] = transform(vw, zones.b);
      ctx.beginPath(); ctx.moveTo(bx1, by1); ctx.lineTo(bx2, by2); ctx.stroke();
    } else {
      const [zax1, zay1] = transform(zones.a, 0);
      const [zax2, zay2] = transform(zones.b, vh);
      ctx.fillStyle = 'rgba(59,130,246,0.08)';
      ctx.fillRect(zax1, zay1, zax2 - zax1, zay2 - zay1);
      ctx.strokeStyle = 'rgba(59,130,246,0.35)';
      ctx.lineWidth = 1.5 * dpr;
      ctx.setLineDash([4 * dpr, 6 * dpr]);
      const [ax1, ay1] = transform(zones.a, 0);
      const [ax2, ay2] = transform(zones.a, vh);
      ctx.beginPath(); ctx.moveTo(ax1, ay1); ctx.lineTo(ax2, ay2); ctx.stroke();
      const [bx1, by1] = transform(zones.b, 0);
      const [bx2, by2] = transform(zones.b, vh);
      ctx.beginPath(); ctx.moveTo(bx1, by1); ctx.lineTo(bx2, by2); ctx.stroke();
    }
    ctx.setLineDash([]);

    // Main crossing line
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
      const inA = t.lastConfirmedZone === 'A';
      const inB = t.lastConfirmedZone === 'B';
      const color = t.counts > 0 ? 'rgba(16,185,129,0.95)'
                  : inA ? 'rgba(96,165,250,0.95)'
                  : inB ? 'rgba(251,191,36,0.95)'
                  : 'rgba(255,255,255,0.85)';
      ctx.strokeStyle = color;
      ctx.lineWidth = 2 * dpr;
      ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);

      ctx.fillStyle = color;
      ctx.font = `${12 * dpr}px system-ui`;
      const label = `#${t.id} ${(t.score * 100).toFixed(0)}% ${t.zone || '·'}`;
      const tw = ctx.measureText(label).width + 8 * dpr;
      ctx.fillRect(x1, y1 - 18 * dpr, tw, 18 * dpr);
      ctx.fillStyle = '#0f172a';
      ctx.fillText(label, x1 + 4 * dpr, y1 - 5 * dpr);

      const [cx, cy] = transform(t.smoothCx, t.smoothCy);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(cx, cy, 5 * dpr, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Tracking + counting
  // ─────────────────────────────────────────────────────────────────────────────
  function iou(a, b) {
    const [ax, ay, aw, ah] = a;
    const [bx, by, bw, bh] = b;
    const x1 = Math.max(ax, bx), y1 = Math.max(ay, by);
    const x2 = Math.min(ax + aw, bx + bw), y2 = Math.min(ay + ah, by + bh);
    const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    const union = aw * ah + bw * bh - inter;
    return union > 0 ? inter / union : 0;
  }
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

  function nms(dets, threshold = 0.5) {
    const sorted = [...dets].sort((a, b) => b.score - a.score);
    const kept = [];
    for (const d of sorted) {
      let suppress = false;
      for (const k of kept) {
        if (iou(d.bbox, k.bbox) > threshold) { suppress = true; break; }
      }
      if (!suppress) kept.push(d);
    }
    return kept;
  }

  function getZonesFor(vw, vh) {
    const line = getLineCoords(vw, vh);
    const dim = line.axis === 'y' ? vh : vw;
    const buf = (state.settings.bufferZone / 100) * dim;
    return {
      line,
      a: line.value - buf,
      b: line.value + buf,
      axis: line.axis,
    };
  }

  function classifyZone(t, zones) {
    const v = zones.axis === 'y' ? t.smoothCy : t.smoothCx;
    if (v < zones.a) return 'A';
    if (v > zones.b) return 'B';
    return 'mid';
  }

  function updateTracks(detections, vw, vh) {
    const TIMEOUT = 2500, MIN_IOU = 0.2;
    const MAX_DIST = Math.min(vw, vh) * 0.3;
    const ALPHA = 0.55; // EMA smoothing factor
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
        t.bbox = d.bbox;
        t.cx = d.cx; t.cy = d.cy;
        t.smoothCx = ALPHA * d.cx + (1 - ALPHA) * t.smoothCx;
        t.smoothCy = ALPHA * d.cy + (1 - ALPHA) * t.smoothCy;
        t.score = d.score;
        t.lastSeen = now;
        t.misses = 0;
      } else {
        t.misses = (t.misses || 0) + 1;
      }
    }

    for (let i = 0; i < detections.length; i++) {
      if (used.has(i)) continue;
      const d = detections[i];
      state.tracks.push({
        id: state.nextTrackId++,
        bbox: d.bbox,
        cx: d.cx, cy: d.cy,
        smoothCx: d.cx, smoothCy: d.cy,
        score: d.score,
        lastSeen: now,
        misses: 0,
        zone: null,
        zoneFrames: 0,
        lastConfirmedZone: null,
        counts: 0,
      });
    }
    state.tracks = state.tracks.filter(t => now - t.lastSeen < TIMEOUT);
  }

  function checkLineCrossings(vw, vh) {
    const zones = getZonesFor(vw, vh);
    const MIN = state.settings.minConfirmFrames || 2;

    for (const t of state.tracks) {
      const z = classifyZone(t, zones);

      if (z === t.zone) {
        t.zoneFrames++;
      } else {
        t.zone = z;
        t.zoneFrames = 1;
      }

      if ((z === 'A' || z === 'B') && t.zoneFrames >= MIN) {
        if (!t.lastConfirmedZone) {
          t.lastConfirmedZone = z;
          continue;
        }
        if (t.lastConfirmedZone !== z) {
          const aToB = (t.lastConfirmedZone === 'A' && z === 'B');
          const isEntry = (state.settings.entryDir === 'positive' && aToB)
                       || (state.settings.entryDir === 'negative' && !aToB);

          if (isEntry) state.countIn++; else state.countOut++;
          logEvent(isEntry ? 'in' : 'out');
          feedback(isEntry ? 'in' : 'out');
          t.counts++;
          t.lastConfirmedZone = z;

          updateCounters();
          updateCapacityUI();
          checkCapacity();
          sharePush();
        }
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Detection loop
  // ─────────────────────────────────────────────────────────────────────────────
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

        const personsRaw = preds
          .filter(p => p.class === 'person' && p.score >= state.settings.confThreshold)
          .map(p => ({
            bbox: p.bbox,
            cx: p.bbox[0] + p.bbox[2] / 2,
            cy: p.bbox[1] + p.bbox[3] / 2,
            score: p.score,
          }));
        const persons = nms(personsRaw, 0.5);

        els.people.textContent = `${persons.length} شخص`;
        updateTracks(persons, vw, vh);
        checkLineCrossings(vw, vh);
        drawOverlay();
      } catch {} finally { state.inferring = false; }
    } else if (vw && vh) {
      drawOverlay();
    }
    state.rafId = requestAnimationFrame(detectLoop);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────────────────────
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
    els.lineHandle.hidden = true;
    els.btnStart.disabled = false;
    els.btnStop.disabled = true;
    setStatus('متوقف');
    const ctx = els.overlay.getContext('2d');
    ctx.clearRect(0, 0, els.overlay.width, els.overlay.height);
  }

  function reset() {
    if (!confirm('تصفير العدّاد وسجل اليوم؟')) return;
    state.countIn = 0; state.countOut = 0;
    state.history = []; state.tracks = [];
    state.capacityAlerted = false;
    updateCounters();
    updateCapacityUI();
    renderHistory();
    renderChart();
    saveState();
    sharePush();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Export — CSV
  // ─────────────────────────────────────────────────────────────────────────────
  function exportCSV() {
    if (!state.history.length) { alert('لا توجد بيانات للتصدير'); return; }
    const rows = [['التاريخ', 'الوقت', 'الحدث']];
    for (const e of state.history) {
      const d = new Date(e.t);
      rows.push([d.toLocaleDateString('en-CA'), d.toLocaleTimeString('en-GB'), e.type === 'in' ? 'دخول' : 'خروج']);
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
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Export — PDF (via print dialog → save as PDF)
  // ─────────────────────────────────────────────────────────────────────────────
  function exportPDF() {
    const date = new Date().toLocaleDateString('ar-SA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const time = new Date().toLocaleTimeString('ar-SA');
    const net = Math.max(0, state.countIn - state.countOut);
    const cap = state.settings.capacityMax || 0;
    const chartSvg = els.chartSvg.outerHTML;
    const fmt = new Intl.DateTimeFormat('ar-SA', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const eventsHTML = state.history.length
      ? state.history.slice().reverse().map(e => `
        <tr>
          <td>${e.type === 'in' ? '↓ دخول' : '↑ خروج'}</td>
          <td>${fmt.format(new Date(e.t))}</td>
        </tr>`).join('')
      : '<tr><td colspan="2" style="text-align:center;color:#888">لا توجد أحداث</td></tr>';

    const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl"><head>
<meta charset="utf-8"><title>تقرير عدّاد الباب — ${date}</title>
<style>
  body { font-family: -apple-system, "Segoe UI", Tahoma, sans-serif; padding: 24px; color: #111; max-width: 800px; margin: 0 auto; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .sub { color: #666; font-size: 12px; margin-bottom: 24px; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 24px; }
  .card { border: 1px solid #ddd; border-radius: 12px; padding: 16px; text-align: center; }
  .card .lbl { font-size: 11px; color: #666; }
  .card .val { font-size: 28px; font-weight: bold; margin-top: 4px; }
  .card.in .val { color: #059669; }
  .card.out .val { color: #dc2626; }
  .card.net .val { color: #2563eb; }
  h2 { font-size: 15px; margin: 24px 0 8px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { padding: 6px 8px; text-align: right; border-bottom: 1px solid #eee; }
  th { background: #f7f7f8; font-weight: 600; }
  .chart-box svg { width: 100%; height: 180px; }
  .chart-box svg text { fill: #444 !important; }
  .chart-box svg line { stroke: #ddd !important; }
  .footer { margin-top: 32px; font-size: 11px; color: #888; text-align: center; }
  @media print { body { padding: 8px; } }
</style></head><body>
  <h1>تقرير عدّاد الداخلين</h1>
  <div class="sub">${date} — ${time}</div>

  <div class="grid">
    <div class="card in"><div class="lbl">إجمالي الدخول</div><div class="val">${state.countIn}</div></div>
    <div class="card out"><div class="lbl">إجمالي الخروج</div><div class="val">${state.countOut}</div></div>
    <div class="card net"><div class="lbl">داخل الآن${cap ? ` (السعة ${cap})` : ''}</div><div class="val">${net}</div></div>
  </div>

  <h2>الازدحام بالساعة</h2>
  <div class="chart-box">${chartSvg}</div>

  <h2>سجل الأحداث (${state.history.length})</h2>
  <table>
    <thead><tr><th>الحدث</th><th>الوقت</th></tr></thead>
    <tbody>${eventsHTML}</tbody>
  </table>

  <div class="footer">تم إنشاء التقرير بواسطة عدّاد الداخلين • door-counter</div>
  <script>window.addEventListener('load',()=>setTimeout(()=>window.print(),300));</script>
</body></html>`;

    const w = window.open('', '_blank');
    if (!w) { alert('السماح بالنوافذ المنبثقة لتصدير PDF'); return; }
    w.document.open(); w.document.write(html); w.document.close();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Sharing — Firebase Realtime DB
  // ─────────────────────────────────────────────────────────────────────────────
  const share = {
    enabled: false,
    db: null,
    role: null,        // 'host' | 'viewer'
    code: null,
    ref: null,
    unsubscribe: null,
  };

  function initFirebase() {
    if (typeof firebase === 'undefined') return false;
    if (typeof window.FIREBASE_CONFIG === 'undefined') return false;
    try {
      if (!firebase.apps.length) firebase.initializeApp(window.FIREBASE_CONFIG);
      share.db = firebase.database();
      share.enabled = true;
      return true;
    } catch (err) {
      console.warn('Firebase init failed', err);
      return false;
    }
  }

  function genCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  }

  function snapshot() {
    return {
      countIn: state.countIn,
      countOut: state.countOut,
      net: Math.max(0, state.countIn - state.countOut),
      capacityMax: state.settings.capacityMax || 0,
      history: state.history.slice(-100),
      updatedAt: Date.now(),
    };
  }

  async function sharePush() {
    if (!share.enabled || share.role !== 'host' || !share.ref) return;
    try { await share.ref.set(snapshot()); } catch {}
  }

  async function startHost() {
    if (!initFirebase()) {
      showShareStatus('Firebase غير مفعّل — راجع README لإعداد المشاركة', 'error');
      return;
    }
    try {
      const code = genCode();
      share.role = 'host';
      share.code = code;
      share.ref = share.db.ref('rooms/' + code);
      await share.ref.set(snapshot());
      share.ref.onDisconnect().remove();

      const url = `${location.origin}${location.pathname}?room=${code}`;
      els.shareCode.textContent = code;
      els.shareLink.value = url;
      els.shareResult.hidden = false;
      els.btnHostStart.disabled = true;
      showShareStatus('الجلسة مفعّلة — شارك الكود مع الجوال الآخر', '');

      els.shareQR.innerHTML = '';
      if (typeof QRCode !== 'undefined') {
        QRCode.toCanvas(url, { width: 200, margin: 1, color: { dark: '#0f172a', light: '#fff' } }, (err, canvas) => {
          if (!err && canvas) els.shareQR.appendChild(canvas);
        });
      }
    } catch (err) {
      showShareStatus('فشل إنشاء الجلسة: ' + (err.message || ''), 'error');
    }
  }

  async function stopHost() {
    if (share.ref) { try { await share.ref.remove(); } catch {} }
    share.role = null; share.code = null; share.ref = null;
    els.shareResult.hidden = true;
    els.btnHostStart.disabled = false;
    showShareStatus('تم إنهاء الجلسة', '');
  }

  function startViewer(code) {
    if (!initFirebase()) {
      showShareStatus('Firebase غير مفعّل', 'error');
      return;
    }
    code = (code || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code)) {
      showShareStatus('الكود يجب أن يكون 6 أحرف/أرقام', 'error');
      return;
    }
    share.role = 'viewer';
    share.code = code;
    share.ref = share.db.ref('rooms/' + code);
    state.mode = 'viewer';
    els.body.dataset.mode = 'viewer';
    els.modeBadge.textContent = 'مشاهد — ' + code;

    share.ref.on('value', (snap) => {
      const data = snap.val();
      if (!data) {
        showShareStatus('الجلسة غير موجودة أو انتهت', 'error');
        return;
      }
      state.countIn = data.countIn || 0;
      state.countOut = data.countOut || 0;
      state.history = data.history || [];
      state.settings.capacityMax = data.capacityMax || 0;
      updateCounters();
      updateCapacityUI();
      renderHistory();
      renderChart();
      showShareStatus(`متصل بالجلسة ${code} • آخر تحديث: ${new Date(data.updatedAt).toLocaleTimeString('ar-SA')}`, '');
    });

    closeShareModal();
  }

  function showShareStatus(text, kind) {
    els.shareStatus.textContent = text;
    els.shareStatus.className = 'share-status' + (kind ? ' ' + kind : '');
    els.shareStatus.hidden = !text;
  }

  function openShareModal() { els.shareModal.hidden = false; }
  function closeShareModal() { els.shareModal.hidden = true; }

  // ─────────────────────────────────────────────────────────────────────────────
  // Events binding
  // ─────────────────────────────────────────────────────────────────────────────
  function bindEvents() {
    els.btnStart.addEventListener('click', start);
    els.btnStop.addEventListener('click', stop);
    els.btnReset.addEventListener('click', reset);
    els.btnExport.addEventListener('click', exportCSV);
    els.btnPDF.addEventListener('click', exportPDF);
    els.btnShare.addEventListener('click', openShareModal);
    els.btnSettings.addEventListener('click', () => { els.settings.open = !els.settings.open; });

    els.lineOrient.addEventListener('change', e => {
      state.settings.lineOrient = e.target.value;
      positionLineHandle();
      saveState();
    });
    els.linePos.addEventListener('input', e => {
      state.settings.linePos = +e.target.value;
      els.linePosVal.textContent = state.settings.linePos + '%';
      positionLineHandle();
      saveState();
    });
    els.entryDir.addEventListener('change', e => { state.settings.entryDir = e.target.value; saveState(); });
    els.confThreshold.addEventListener('input', e => {
      state.settings.confThreshold = +e.target.value / 100;
      els.confVal.textContent = e.target.value + '%';
      saveState();
    });
    els.bufferZone.addEventListener('input', e => {
      state.settings.bufferZone = +e.target.value;
      els.bufferVal.textContent = state.settings.bufferZone + '%';
      saveState();
    });
    els.minConfirmFrames.addEventListener('input', e => {
      state.settings.minConfirmFrames = +e.target.value;
      els.minFramesVal.textContent = String(state.settings.minConfirmFrames);
      saveState();
    });
    els.cameraFacing.addEventListener('change', async e => {
      state.settings.cameraFacing = e.target.value;
      saveState();
      if (state.running) { stopCamera(); try { await startCamera(); } catch {} }
    });
    els.capacityMax.addEventListener('change', e => {
      state.settings.capacityMax = Math.max(0, +e.target.value || 0);
      updateCapacityUI();
      saveState();
      sharePush();
    });
    els.hapticOn.addEventListener('change', e => { state.settings.hapticOn = e.target.checked; saveState(); });
    els.soundOn.addEventListener('change', e => { state.settings.soundOn = e.target.checked; saveState(); });

    bindLineDrag();

    els.shareClose.addEventListener('click', closeShareModal);
    els.shareModal.addEventListener('click', (e) => {
      if (e.target === els.shareModal) closeShareModal();
    });
    els.tabHost.addEventListener('click', () => switchShareTab('host'));
    els.tabJoin.addEventListener('click', () => switchShareTab('join'));
    els.btnHostStart.addEventListener('click', startHost);
    els.btnHostStop.addEventListener('click', stopHost);
    els.btnJoin.addEventListener('click', () => startViewer(els.joinCode.value));
    els.joinCode.addEventListener('input', (e) => {
      e.target.value = e.target.value.toUpperCase();
    });
    els.btnCopyLink.addEventListener('click', () => {
      els.shareLink.select();
      navigator.clipboard?.writeText(els.shareLink.value).then(() => {
        els.btnCopyLink.textContent = 'تم!';
        setTimeout(() => { els.btnCopyLink.textContent = 'نسخ'; }, 1500);
      });
    });

    els.alertClose.addEventListener('click', () => { els.alertModal.hidden = true; });
  }

  function switchShareTab(tab) {
    els.tabHost.classList.toggle('active', tab === 'host');
    els.tabJoin.classList.toggle('active', tab === 'join');
    els.paneHost.hidden = tab !== 'host';
    els.paneJoin.hidden = tab !== 'join';
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

  function maybeJoinFromURL() {
    const params = new URLSearchParams(location.search);
    const room = params.get('room');
    if (room) startViewer(room);
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

    maybeJoinFromURL();
  }

  init();
})();
