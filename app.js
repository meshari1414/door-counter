(() => {
  'use strict';

  // ─────────────────────────────────────────────────────────────────────────────
  // Element refs
  // ─────────────────────────────────────────────────────────────────────────────
  const $ = id => document.getElementById(id);
  const els = {
    body: document.body,
    video: $('video'), overlay: $('overlay'),
    cameraWrap: $('cameraWrap'), lineHandle: $('lineHandle'),
    liveDot: $('liveDot'),
    status: $('status'), modeBadge: $('modeBadge'),
    countIn: $('countIn'), countOut: $('countOut'), countNet: $('countNet'),
    netCard: $('netCard'), capacityHint: $('capacityHint'),
    capacityBar: $('capacityBar'), capacityFill: $('capacityFill'), capacityText: $('capacityText'),
    capacityFlash: $('capacityFlash'),
    fps: $('fps'), people: $('people'), dragHint: $('dragHint'),
    empty: $('emptyState'),
    btnStart: $('btnStart'), btnStop: $('btnStop'),
    btnReset: $('btnReset'), btnDashboard: $('btnDashboard'),
    btnExport: $('btnExport'), btnPDF: $('btnPDF'),
    btnShare: $('btnShare'), btnSettings: $('btnSettings'),
    settings: $('settingsPanel'),
    // Settings inputs
    countingMode: $('countingMode'), doubleLineGap: $('doubleLineGap'), doubleGapVal: $('doubleGapVal'),
    rowDoubleGap: $('rowDoubleGap'), rowBuffer: $('rowBuffer'), rowFrames: $('rowFrames'),
    lineOrient: $('lineOrient'), linePos: $('linePos'), linePosVal: $('linePosVal'),
    entryDir: $('entryDir'),
    confThreshold: $('confThreshold'), confVal: $('confVal'),
    bufferZone: $('bufferZone'), bufferVal: $('bufferVal'),
    minConfirmFrames: $('minConfirmFrames'), minFramesVal: $('minFramesVal'),
    modelBase: $('modelBase'), showWeak: $('showWeak'),
    cameraFacing: $('cameraFacing'),
    capacityMax: $('capacityMax'), hapticOn: $('hapticOn'), soundOn: $('soundOn'), voiceOn: $('voiceOn'),
    // Charts & history
    chartSvg: $('hourlyChart'), chartEmpty: $('chartEmpty'), chartSub: $('chartSub'),
    historyList: $('historyList'),
    // Summary
    summaryCard: $('summaryCard'), summaryDate: $('summaryDate'),
    summaryList: $('summaryList'), summaryCompare: $('summaryCompare'),
    // Dashboard
    dashboard: $('dashboard'),
    dashTime: $('dashTime'), dashDate: $('dashDate'), dashTitle: $('dashTitle'),
    dashIn: $('dashIn'), dashOut: $('dashOut'), dashNet: $('dashNet'),
    dashCap: $('dashCap'), dashSummary: $('dashSummary'),
    dashCapBar: $('dashCapBar'), dashCapFill: $('dashCapFill'),
    btnExitDash: $('btnExitDash'),
    // Modals
    shareModal: $('shareModal'), shareClose: $('shareClose'),
    shareStatus: $('shareStatus'),
    tabHost: $('tabHost'), tabJoin: $('tabJoin'),
    paneHost: $('paneHost'), paneJoin: $('paneJoin'),
    btnHostStart: $('btnHostStart'), btnHostStop: $('btnHostStop'),
    shareResult: $('shareResult'), shareCode: $('shareCode'),
    shareQR: $('shareQR'), shareLink: $('shareLink'), btnCopyLink: $('btnCopyLink'),
    joinCode: $('joinCode'), btnJoin: $('btnJoin'),
    alertModal: $('alertModal'), alertTitle: $('alertTitle'),
    alertText: $('alertText'), alertClose: $('alertClose'),
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // State
  // ─────────────────────────────────────────────────────────────────────────────
  const STORE_KEY   = 'door-counter-state-v3';
  const HISTORY_KEY = 'door-counter-history-v2';
  const DAILY_KEY   = 'door-counter-daily-v1';

  const state = {
    model: null, stream: null,
    running: false, rafId: null, inferring: false,
    countIn: 0, countOut: 0,
    capacityAlerted: false,
    tracks: [], nextTrackId: 1,
    lastDetectionAt: 0, detectionIntervalMs: 60,
    fpsSamples: [], weakDetections: [],
    history: [],
    dashInterval: null,
    wakeLock: null,
    mode: 'host',
    audioCtx: null,
    settings: {
      countingMode: 'double',
      doubleLineGap: 18,
      lineOrient: 'horizontal',
      linePos: 50,
      entryDir: 'positive',
      confThreshold: 0.40,
      bufferZone: 10,
      minConfirmFrames: 1,
      modelBase: 'mobilenet_v2',
      showWeak: true,
      cameraFacing: 'environment',
      capacityMax: 0,
      hapticOn: true,
      soundOn: false,
      voiceOn: false,
    },
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // Storage
  // ─────────────────────────────────────────────────────────────────────────────
  function loadState() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
      if (s.settings) Object.assign(state.settings, s.settings);
      const today = new Date().toDateString();
      if (s.date === today) { state.countIn = s.countIn || 0; state.countOut = s.countOut || 0; }
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
      countIn: state.countIn, countOut: state.countOut,
      settings: state.settings,
    }));
    localStorage.setItem(HISTORY_KEY, JSON.stringify(state.history));
    saveDailyStats();
  }

  function loadDailyStats() {
    try { return JSON.parse(localStorage.getItem(DAILY_KEY) || '{}'); } catch { return {}; }
  }
  function saveDailyStats() {
    const daily = loadDailyStats();
    const today = new Date().toISOString().slice(0, 10);
    daily[today] = { in: state.countIn, out: state.countOut };
    const keys = Object.keys(daily).sort().slice(-30);
    const trimmed = {};
    keys.forEach(k => { trimmed[k] = daily[k]; });
    try { localStorage.setItem(DAILY_KEY, JSON.stringify(trimmed)); } catch {}
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Status & UI sync
  // ─────────────────────────────────────────────────────────────────────────────
  function setStatus(text, kind = '') {
    els.status.textContent = text;
    els.status.className = 'status' + (kind ? ' ' + kind : '');
  }

  function syncUIFromSettings() {
    const s = state.settings;
    els.countingMode.value      = s.countingMode;
    els.doubleLineGap.value     = String(s.doubleLineGap);
    els.doubleGapVal.textContent = s.doubleLineGap + '%';
    els.lineOrient.value        = s.lineOrient;
    els.linePos.value           = String(s.linePos);
    els.linePosVal.textContent  = s.linePos + '%';
    els.entryDir.value          = s.entryDir;
    els.confThreshold.value     = String(Math.round(s.confThreshold * 100));
    els.confVal.textContent     = Math.round(s.confThreshold * 100) + '%';
    els.bufferZone.value        = String(s.bufferZone);
    els.bufferVal.textContent   = s.bufferZone + '%';
    els.minConfirmFrames.value  = String(s.minConfirmFrames);
    els.minFramesVal.textContent = String(s.minConfirmFrames);
    els.modelBase.value         = s.modelBase || 'mobilenet_v2';
    els.showWeak.checked        = !!s.showWeak;
    els.cameraFacing.value      = s.cameraFacing;
    els.capacityMax.value       = String(s.capacityMax || 0);
    els.hapticOn.checked        = !!s.hapticOn;
    els.soundOn.checked         = !!s.soundOn;
    els.voiceOn.checked         = !!s.voiceOn;
    syncModeUI();
    updateCounters();
    updateCapacityUI();
    renderHistory();
    renderChart();
    renderSummary();
    positionLineHandle();
  }

  function syncModeUI() {
    const isDouble = state.settings.countingMode === 'double';
    els.rowDoubleGap.style.display = isDouble ? '' : 'none';
    els.rowBuffer.style.display    = isDouble ? 'none' : '';
    els.rowFrames.style.display    = isDouble ? 'none' : '';
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Counters
  // ─────────────────────────────────────────────────────────────────────────────
  function bump(el) {
    el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
  }

  function updateCounters() {
    const net = Math.max(0, state.countIn - state.countOut);
    [els.countIn, els.dashIn].forEach(e => { if (+e.textContent !== state.countIn) { e.textContent = state.countIn; bump(e); } });
    [els.countOut, els.dashOut].forEach(e => { if (+e.textContent !== state.countOut) { e.textContent = state.countOut; bump(e); } });
    [els.countNet, els.dashNet].forEach(e => { if (+e.textContent !== net) { e.textContent = net; bump(e); } });
    const cap = state.settings.capacityMax || 0;
    els.dashCap.textContent = cap ? `${net} / ${cap}` : '';
  }

  function updateCapacityUI() {
    const cap = state.settings.capacityMax || 0;
    const net = Math.max(0, state.countIn - state.countOut);
    if (cap <= 0) {
      els.capacityBar.hidden = true; els.capacityHint.textContent = '';
      els.netCard.classList.remove('warn', 'full');
      els.dashCapBar.hidden = true;
      return;
    }
    els.capacityBar.hidden = false;
    const pct = Math.min(100, (net / cap) * 100);
    els.capacityFill.style.inset = `0 ${100 - pct}% 0 0`;
    els.capacityText.textContent = els.capacityHint.textContent = `${net} / ${cap}`;
    els.netCard.classList.remove('warn', 'full');
    els.capacityFill.classList.remove('warn', 'full');
    if (net >= cap) { els.netCard.classList.add('full'); els.capacityFill.classList.add('full'); }
    else if (net >= cap * 0.85) { els.netCard.classList.add('warn'); els.capacityFill.classList.add('warn'); }
    // Dashboard bar
    els.dashCapBar.hidden = false;
    els.dashCapFill.style.width = pct + '%';
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // History
  // ─────────────────────────────────────────────────────────────────────────────
  function renderHistory() {
    if (!state.history.length) {
      els.historyList.innerHTML = '<li class="empty">لا توجد أحداث بعد</li>'; return;
    }
    const fmt = new Intl.DateTimeFormat('ar-SA', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    els.historyList.innerHTML = state.history.slice(-50).reverse()
      .map(e => `<li>
        <span class="${e.type === 'in' ? 'ev-in' : 'ev-out'}">${e.type === 'in' ? 'دخول' : 'خروج'}</span>
        <span class="ev-time">${fmt.format(new Date(e.t))}</span>
      </li>`).join('');
  }

  function logEvent(type) {
    state.history.push({ t: Date.now(), type });
    if (state.history.length > 1000) state.history.shift();
    renderHistory();
    renderChart();
    renderSummary();
    saveState();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Hourly chart (SVG)
  // ─────────────────────────────────────────────────────────────────────────────
  function renderChart() {
    const svg = els.chartSvg;
    const W = 480, H = 160, P = { top: 14, right: 8, bottom: 24, left: 8 };
    svg.innerHTML = '';
    const buckets = Array.from({ length: 24 }, () => ({ in: 0, out: 0 }));
    for (const e of state.history) buckets[new Date(e.t).getHours()][e.type]++;
    const maxVal = Math.max(1, ...buckets.map(b => Math.max(b.in, b.out)));
    const chartW = W - P.left - P.right, chartH = H - P.top - P.bottom;
    const slot = chartW / 24, barW = Math.max(2, slot * 0.35), gap = (slot - barW * 2) / 3;
    const total = state.history.length;
    els.chartEmpty.classList.toggle('hidden', total > 0);
    els.chartSub.textContent = total > 0 ? `${total} حدث` : 'اليوم';
    if (!total) return;
    const ns = 'http://www.w3.org/2000/svg';
    const mkRect = (x, y, w, h, fill) => {
      const r = document.createElementNS(ns, 'rect');
      r.setAttribute('x', x); r.setAttribute('y', y);
      r.setAttribute('width', w); r.setAttribute('height', h);
      r.setAttribute('rx', 2); r.setAttribute('fill', fill);
      return r;
    };
    for (let i = 1; i <= 3; i++) {
      const ln = document.createElementNS(ns, 'line');
      const y = P.top + chartH * i / 4;
      Object.entries({ x1: P.left, x2: W - P.right, y1: y, y2: y,
        stroke: '#334155', 'stroke-dasharray': '2 3', 'stroke-width': 1 })
        .forEach(([k, v]) => ln.setAttribute(k, v));
      svg.appendChild(ln);
    }
    for (let h = 0; h < 24; h++) {
      const x = P.left + slot * h, b = buckets[h];
      if (b.in > 0) svg.appendChild(mkRect(x + gap, P.top + chartH - (b.in / maxVal) * chartH, barW, (b.in / maxVal) * chartH, '#10b981'));
      if (b.out > 0) svg.appendChild(mkRect(x + gap * 2 + barW, P.top + chartH - (b.out / maxVal) * chartH, barW, (b.out / maxVal) * chartH, '#ef4444'));
      if (h % 3 === 0) {
        const t = document.createElementNS(ns, 'text');
        Object.entries({ x: x + slot / 2, y: H - 8, fill: '#94a3b8', 'font-size': 10, 'text-anchor': 'middle' })
          .forEach(([k, v]) => t.setAttribute(k, v));
        t.textContent = String(h).padStart(2, '0');
        svg.appendChild(t);
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Smart Summary
  // ─────────────────────────────────────────────────────────────────────────────
  function renderSummary() {
    if (!state.history.length) { els.summaryCard.hidden = true; return; }
    els.summaryCard.hidden = false;
    const today = new Date();
    els.summaryDate.textContent = today.toLocaleDateString('ar-SA', { weekday: 'long', day: 'numeric', month: 'long' });
    const inEvents = state.history.filter(e => e.type === 'in');
    const hourly = new Array(24).fill(0);
    for (const e of inEvents) hourly[new Date(e.t).getHours()]++;
    const peakH = hourly.indexOf(Math.max(...hourly));
    const peakN = hourly[peakH];
    const net = Math.max(0, state.countIn - state.countOut);
    const items = [];
    if (state.countIn > 0) items.push({ icon: '👥', text: `دخل اليوم ${state.countIn} شخص` });
    if (net > 0)           items.push({ icon: '🏠', text: `${net} شخص داخل الآن` });
    if (peakN > 0)         items.push({ icon: '⏰', text: `الذروة في الساعة ${peakH}:00 — ${peakN} أشخاص` });
    const cap = state.settings.capacityMax;
    if (cap > 0) {
      const pct = Math.round((net / cap) * 100);
      items.push({ icon: pct >= 100 ? '🚨' : pct >= 85 ? '⚠️' : '✅', text: `السعة ${pct}% (${net}/${cap})` });
    }
    els.summaryList.innerHTML = items.map(i =>
      `<li><span class="s-icon">${i.icon}</span><span>${i.text}</span></li>`).join('');
    // Compare with yesterday
    const daily = loadDailyStats();
    const yKey = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const yData = daily[yKey];
    if (yData && yData.in > 0 && state.countIn > 0) {
      const diff = state.countIn - yData.in;
      const pct  = Math.round(Math.abs(diff) / yData.in * 100);
      if (diff > 0)      els.summaryCompare.innerHTML = `مقارنة بالأمس (${yData.in}) <span class="compare-up">↑ أكثر بـ ${diff} (${pct}%)</span>`;
      else if (diff < 0) els.summaryCompare.innerHTML = `مقارنة بالأمس (${yData.in}) <span class="compare-down">↓ أقل بـ ${Math.abs(diff)} (${pct}%)</span>`;
      else               els.summaryCompare.innerHTML = `نفس عدد الأمس تماماً (${yData.in})`;
    } else {
      els.summaryCompare.textContent = 'لا توجد بيانات للمقارنة بعد';
    }
    // Sync to dashboard
    els.dashSummary.textContent = items.length ? items.map(i => i.text).join(' • ') : '';
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Feedback (haptic / sound / voice)
  // ─────────────────────────────────────────────────────────────────────────────
  function feedback(type) {
    if (state.settings.hapticOn && navigator.vibrate)
      navigator.vibrate(type === 'in' ? 40 : [30, 40, 30]);
    if (state.settings.soundOn) beep(type === 'in' ? 880 : 440, 80);
    if (state.settings.voiceOn) voice(type);
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
      osc.start(); osc.stop(ctx.currentTime + dur / 1000 + 0.02);
    } catch {}
  }

  function voice(type) {
    if (!window.speechSynthesis) return;
    const net = Math.max(0, state.countIn - state.countOut);
    const text = type === 'in' ? `دخول، العدد ${net}` : `خروج، داخل ${net}`;
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = 'ar-SA'; utt.rate = 1.1; utt.volume = 0.9;
    speechSynthesis.cancel();
    speechSynthesis.speak(utt);
  }

  function checkCapacity() {
    const cap = state.settings.capacityMax || 0;
    if (!cap) { state.capacityAlerted = false; return; }
    const net = Math.max(0, state.countIn - state.countOut);
    if (net >= cap && !state.capacityAlerted) {
      state.capacityAlerted = true;
      if (navigator.vibrate) navigator.vibrate([100, 60, 100, 60, 200]);
      if (state.settings.soundOn) { beep(880, 150); setTimeout(() => beep(660, 200), 180); }
      els.capacityFlash.classList.remove('flash');
      void els.capacityFlash.offsetWidth;
      els.capacityFlash.classList.add('flash');
      showAlert('السعة القصوى', `وصل العدد إلى ${net} من أصل ${cap}`);
    }
    if (net < cap) state.capacityAlerted = false;
  }

  function showAlert(title, text) {
    els.alertTitle.textContent = title;
    els.alertText.textContent = text;
    els.alertModal.hidden = false;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Dashboard Mode
  // ─────────────────────────────────────────────────────────────────────────────
  function openDashboard() {
    els.dashboard.hidden = false;
    updateCounters(); updateCapacityUI(); renderSummary();
    state.dashInterval = setInterval(dashTick, 1000);
    dashTick();
    // Keep screen awake
    if ('wakeLock' in navigator) {
      navigator.wakeLock.request('screen').then(wl => { state.wakeLock = wl; }).catch(() => {});
    }
    // Try fullscreen (desktop / Android)
    try { document.documentElement.requestFullscreen?.(); } catch {}
  }

  function closeDashboard() {
    els.dashboard.hidden = true;
    clearInterval(state.dashInterval);
    if (state.wakeLock) { state.wakeLock.release().catch(() => {}); state.wakeLock = null; }
    try { document.exitFullscreen?.(); } catch {}
  }

  function dashTick() {
    const now = new Date();
    els.dashTime.textContent = now.toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    els.dashDate.textContent = now.toLocaleDateString('ar-SA', { weekday: 'long', day: 'numeric', month: 'long' });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Camera
  // ─────────────────────────────────────────────────────────────────────────────
  async function loadModel() {
    setStatus('تحميل نموذج الكشف...');
    try {
      await tf.ready();
      const base = state.settings.modelBase || 'mobilenet_v2';
      state.model = await cocoSsd.load({ base });
      setStatus(`جاهز (${base === 'mobilenet_v2' ? 'دقيق' : 'سريع'})`, 'ok');
    } catch {
      try { state.model = await cocoSsd.load({ base: 'lite_mobilenet_v2' }); setStatus('جاهز (احتياطي)', 'ok'); }
      catch (e2) { setStatus('فشل تحميل النموذج', 'error'); throw e2; }
    }
  }

  async function startCamera() {
    if (state.stream) stopCamera();
    setStatus('طلب الكاميرا...');
    try {
      state.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: state.settings.cameraFacing }, width: { ideal: 640 }, height: { ideal: 480 } },
      });
      els.video.srcObject = state.stream;
      await new Promise(res => els.video.readyState >= 2 ? res() : (els.video.onloadedmetadata = res));
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
    state.stream?.getTracks().forEach(t => t.stop());
    state.stream = null;
    els.video.srcObject = null;
  }

  function resizeOverlay() {
    const rect = els.video.getBoundingClientRect();
    const dpr  = Math.min(window.devicePixelRatio || 1, 2);
    els.overlay.width  = Math.round(rect.width  * dpr);
    els.overlay.height = Math.round(rect.height * dpr);
    els.overlay.style.width  = rect.width  + 'px';
    els.overlay.style.height = rect.height + 'px';
    positionLineHandle();
  }
  window.addEventListener('resize', resizeOverlay);

  // ─────────────────────────────────────────────────────────────────────────────
  // Line coordinates (shared by draw + counting)
  // ─────────────────────────────────────────────────────────────────────────────
  function getLineCoords(vw, vh) {
    const pos = state.settings.linePos / 100;
    if (state.settings.lineOrient === 'horizontal') {
      const y = vh * pos;
      return { x1: 0, y1: y, x2: vw, y2: y, axis: 'y', value: y };
    }
    const x = vw * pos;
    return { x1: x, y1: 0, x2: x, y2: vh, axis: 'x', value: x };
  }

  function getDoubleLinesFor(vw, vh) {
    const line = getLineCoords(vw, vh);
    const dim  = line.axis === 'y' ? vh : vw;
    const gap  = (state.settings.doubleLineGap / 100) * dim / 2;
    return { line, l1: line.value - gap, l2: line.value + gap, axis: line.axis };
  }

  function getZonesFor(vw, vh) {
    const line = getLineCoords(vw, vh);
    const dim  = line.axis === 'y' ? vh : vw;
    const buf  = (state.settings.bufferZone / 100) * dim;
    return { line, a: line.value - buf, b: line.value + buf, axis: line.axis };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Line handle drag
  // ─────────────────────────────────────────────────────────────────────────────
  function positionLineHandle() {
    if (els.lineHandle.hidden) return;
    const orient = state.settings.lineOrient;
    const pct    = state.settings.linePos;
    els.lineHandle.classList.toggle('horizontal', orient === 'horizontal');
    els.lineHandle.classList.toggle('vertical',   orient === 'vertical');
    if (orient === 'horizontal') {
      els.lineHandle.style.cssText = `top:${pct}%;left:0;right:0;bottom:auto;`;
    } else {
      els.lineHandle.style.cssText = `left:${pct}%;top:0;bottom:0;right:auto;`;
    }
  }

  function bindLineDrag() {
    let dragging = false;
    const onDown = e => { dragging = true; els.lineHandle.classList.add('dragging'); els.dragHint.classList.add('hidden'); e.preventDefault(); };
    const onMove = e => {
      if (!dragging) return;
      const rect  = els.cameraWrap.getBoundingClientRect();
      const point = e.touches ? e.touches[0] : e;
      let pct = state.settings.lineOrient === 'horizontal'
        ? ((point.clientY - rect.top) / rect.height) * 100
        : ((point.clientX - rect.left) / rect.width) * 100;
      pct = Math.max(5, Math.min(95, pct));
      state.settings.linePos = Math.round(pct);
      els.linePos.value = String(state.settings.linePos);
      els.linePosVal.textContent = state.settings.linePos + '%';
      positionLineHandle();
      e.preventDefault();
    };
    const onUp = () => { if (!dragging) return; dragging = false; els.lineHandle.classList.remove('dragging'); saveState(); sharePush(); };
    els.lineHandle.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup',   onUp);
    window.addEventListener('pointercancel', onUp);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Overlay drawing
  // ─────────────────────────────────────────────────────────────────────────────
  function drawOverlay() {
    const ctx = els.overlay.getContext('2d');
    const W = els.overlay.width, H = els.overlay.height;
    ctx.clearRect(0, 0, W, H);
    const v = els.video, vw = v.videoWidth, vh = v.videoHeight;
    if (!vw || !vh) return;

    const cw = els.overlay.clientWidth, ch = els.overlay.clientHeight;
    const scale = Math.max(cw / vw, ch / vh);
    const ox = (cw - vw * scale) / 2, oy = (ch - vh * scale) / 2;
    const dpr = W / cw;
    const T = (x, y) => [(ox + x * scale) * dpr, (oy + y * scale) * dpr];

    const isDouble = state.settings.countingMode === 'double';

    if (isDouble) {
      // Draw two-line tripwire
      const dl = getDoubleLinesFor(vw, vh);
      // Band between lines
      if (dl.axis === 'y') {
        const [, y1] = T(0, dl.l1), [, y2] = T(0, dl.l2);
        ctx.fillStyle = 'rgba(59,130,246,0.07)';
        ctx.fillRect(0, y1, W, y2 - y1);
      } else {
        const [x1] = T(dl.l1, 0), [x2] = T(dl.l2, 0);
        ctx.fillStyle = 'rgba(59,130,246,0.07)';
        ctx.fillRect(x1, 0, x2 - x1, H);
      }
      // Line 1 (entry trigger)
      const [lx1a, ly1a] = T(dl.axis === 'y' ? 0 : dl.l1, dl.axis === 'y' ? dl.l1 : 0);
      const [lx1b, ly1b] = T(dl.axis === 'y' ? vw : dl.l1, dl.axis === 'y' ? dl.l1 : vh);
      ctx.strokeStyle = 'rgba(96,165,250,0.8)'; ctx.lineWidth = 2 * dpr;
      ctx.setLineDash([8 * dpr, 6 * dpr]);
      ctx.beginPath(); ctx.moveTo(lx1a, ly1a); ctx.lineTo(lx1b, ly1b); ctx.stroke();
      // Line 2 (confirm trigger)
      const [lx2a, ly2a] = T(dl.axis === 'y' ? 0 : dl.l2, dl.axis === 'y' ? dl.l2 : 0);
      const [lx2b, ly2b] = T(dl.axis === 'y' ? vw : dl.l2, dl.axis === 'y' ? dl.l2 : vh);
      ctx.strokeStyle = 'rgba(59,130,246,0.95)'; ctx.lineWidth = 3 * dpr;
      ctx.setLineDash([12 * dpr, 8 * dpr]);
      ctx.beginPath(); ctx.moveTo(lx2a, ly2a); ctx.lineTo(lx2b, ly2b); ctx.stroke();
      ctx.setLineDash([]);
      // Labels
      ctx.font = `${11 * dpr}px system-ui`; ctx.fillStyle = 'rgba(96,165,250,.9)';
      ctx.fillText('① تفعيل', lx1a + 4 * dpr, ly1a - 5 * dpr);
      ctx.fillStyle = 'rgba(59,130,246,.9)';
      ctx.fillText('② تأكيد', lx2a + 4 * dpr, ly2a - 5 * dpr);
    } else {
      // Single-line + buffer zones
      const zones = getZonesFor(vw, vh);
      const ax = zones.axis;
      // Faint band
      if (ax === 'y') {
        const [, ya] = T(0, zones.a), [, yb] = T(0, zones.b);
        ctx.fillStyle = 'rgba(59,130,246,0.07)';
        ctx.fillRect(0, ya, W, yb - ya);
        // Zone boundary lines
        ctx.strokeStyle = 'rgba(59,130,246,0.35)'; ctx.lineWidth = 1.5 * dpr; ctx.setLineDash([4 * dpr, 6 * dpr]);
        [[0, zones.a, vw, zones.a], [0, zones.b, vw, zones.b]].forEach(([x1, y1, x2, y2]) => {
          const [px1, py1] = T(x1, y1), [px2, py2] = T(x2, y2);
          ctx.beginPath(); ctx.moveTo(px1, py1); ctx.lineTo(px2, py2); ctx.stroke();
        });
      } else {
        const [xa] = T(zones.a, 0), [xb] = T(zones.b, 0);
        ctx.fillStyle = 'rgba(59,130,246,0.07)';
        ctx.fillRect(xa, 0, xb - xa, H);
        ctx.strokeStyle = 'rgba(59,130,246,0.35)'; ctx.lineWidth = 1.5 * dpr; ctx.setLineDash([4 * dpr, 6 * dpr]);
        [[zones.a, 0, zones.a, vh], [zones.b, 0, zones.b, vh]].forEach(([x1, y1, x2, y2]) => {
          const [px1, py1] = T(x1, y1), [px2, py2] = T(x2, y2);
          ctx.beginPath(); ctx.moveTo(px1, py1); ctx.lineTo(px2, py2); ctx.stroke();
        });
      }
      ctx.setLineDash([]);
      // Main line
      const ln = zones.line;
      const [lx1, ly1] = T(ln.x1, ln.y1), [lx2, ly2] = T(ln.x2, ln.y2);
      ctx.strokeStyle = 'rgba(59,130,246,0.95)'; ctx.lineWidth = 3 * dpr;
      ctx.setLineDash([12 * dpr, 8 * dpr]);
      ctx.beginPath(); ctx.moveTo(lx1, ly1); ctx.lineTo(lx2, ly2); ctx.stroke();
      ctx.setLineDash([]);
    }

    // Weak detections (diagnostic — gray dashed)
    if (state.weakDetections?.length) {
      ctx.strokeStyle = 'rgba(148,163,184,0.5)'; ctx.lineWidth = 1 * dpr;
      ctx.setLineDash([3 * dpr, 3 * dpr]);
      ctx.font = `${10 * dpr}px system-ui`;
      for (const w of state.weakDetections) {
        const [bx, by, bw, bh] = w.bbox;
        const [x1, y1] = T(bx, by), [x2, y2] = T(bx + bw, by + bh);
        ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
        ctx.fillStyle = 'rgba(148,163,184,0.85)';
        ctx.fillText(`${(w.score * 100).toFixed(0)}%`, x1 + 2 * dpr, y1 + 12 * dpr);
      }
      ctx.setLineDash([]);
    }

    // Tracks
    for (const t of state.tracks) {
      const [bx, by, bw, bh] = t.bbox;
      const [x1, y1] = T(bx, by), [x2, y2] = T(bx + bw, by + bh);
      const color = t.counts > 0     ? 'rgba(16,185,129,0.95)'
                  : t.tripState != null ? 'rgba(251,191,36,0.95)'
                  : t.lastConfirmedZone === 'A' ? 'rgba(96,165,250,0.95)'
                  : t.lastConfirmedZone === 'B' ? 'rgba(251,191,36,0.95)'
                  : 'rgba(255,255,255,0.75)';
      ctx.strokeStyle = color; ctx.lineWidth = 2 * dpr;
      ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
      ctx.fillStyle = color;
      ctx.font = `${11 * dpr}px system-ui`;
      const lbl = isDouble
        ? `#${t.id} ${(t.score * 100).toFixed(0)}% ${t.tripState != null ? '→ ✓' : ''}`
        : `#${t.id} ${(t.score * 100).toFixed(0)}% ${t.zone || '·'}`;
      const tw = ctx.measureText(lbl).width + 6 * dpr;
      ctx.fillRect(x1, y1 - 16 * dpr, tw, 16 * dpr);
      ctx.fillStyle = '#0f172a';
      ctx.fillText(lbl, x1 + 3 * dpr, y1 - 4 * dpr);
      const [cx, cy] = T(t.smoothCx, t.smoothCy);
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(cx, cy, 5 * dpr, 0, Math.PI * 2); ctx.fill();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Detection helpers
  // ─────────────────────────────────────────────────────────────────────────────
  function iou(a, b) {
    const [ax, ay, aw, ah] = a, [bx, by, bw, bh] = b;
    const inter = Math.max(0, Math.min(ax + aw, bx + bw) - Math.max(ax, bx))
                * Math.max(0, Math.min(ay + ah, by + bh) - Math.max(ay, by));
    return inter / (aw * ah + bw * bh - inter || 1);
  }
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  function nms(dets, thr = 0.5) {
    const sorted = [...dets].sort((a, b) => b.score - a.score);
    const kept = [];
    for (const d of sorted) {
      if (!kept.some(k => iou(d.bbox, k.bbox) > thr)) kept.push(d);
    }
    return kept;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Track management
  // ─────────────────────────────────────────────────────────────────────────────
  function updateTracks(detections, vw, vh) {
    const TIMEOUT = 3000, MIN_IOU = 0.15, ALPHA = 0.55;
    const MAX_DIST = Math.min(vw, vh) * 0.4;
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
          const sc = o + (1 - cd / MAX_DIST) * 0.5;
          if (sc > bestScore) { bestScore = sc; bestIdx = i; }
        }
      }
      if (bestIdx >= 0) {
        const d = detections[bestIdx];
        used.add(bestIdx);
        t.prevSmoothCx = t.smoothCx; t.prevSmoothCy = t.smoothCy;
        t.bbox = d.bbox; t.cx = d.cx; t.cy = d.cy;
        t.smoothCx = ALPHA * d.cx + (1 - ALPHA) * t.smoothCx;
        t.smoothCy = ALPHA * d.cy + (1 - ALPHA) * t.smoothCy;
        t.score = d.score; t.lastSeen = now;
      }
    }
    for (let i = 0; i < detections.length; i++) {
      if (used.has(i)) continue;
      const d = detections[i];
      state.tracks.push({
        id: state.nextTrackId++,
        bbox: d.bbox, cx: d.cx, cy: d.cy,
        smoothCx: d.cx, smoothCy: d.cy,
        prevSmoothCx: d.cx, prevSmoothCy: d.cy,
        score: d.score, lastSeen: now,
        // Single-line mode state
        zone: null, zoneFrames: 0, lastConfirmedZone: null,
        // Double-line mode state
        tripState: null,
        counts: 0,
      });
    }
    state.tracks = state.tracks.filter(t => now - t.lastSeen < TIMEOUT);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Crossing: Single-line (buffer zones / hysteresis)
  // ─────────────────────────────────────────────────────────────────────────────
  function checkSingleLineCrossings(vw, vh) {
    const zones = getZonesFor(vw, vh);
    const MIN = state.settings.minConfirmFrames || 1;
    for (const t of state.tracks) {
      const z = (() => {
        const v = zones.axis === 'y' ? t.smoothCy : t.smoothCx;
        return v < zones.a ? 'A' : v > zones.b ? 'B' : 'mid';
      })();
      if (z === t.zone) t.zoneFrames++; else { t.zone = z; t.zoneFrames = 1; }
      if ((z === 'A' || z === 'B') && t.zoneFrames >= MIN) {
        if (!t.lastConfirmedZone) { t.lastConfirmedZone = z; continue; }
        if (t.lastConfirmedZone !== z) {
          const aToB   = (t.lastConfirmedZone === 'A' && z === 'B');
          const isEntry = (state.settings.entryDir === 'positive' && aToB)
                       || (state.settings.entryDir === 'negative' && !aToB);
          emitCount(isEntry);
          t.counts++; t.lastConfirmedZone = z;
        }
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Crossing: Two-line tripwire
  // ─────────────────────────────────────────────────────────────────────────────
  function checkDoubleLineCrossings(vw, vh) {
    const dl = getDoubleLinesFor(vw, vh);
    for (const t of state.tracks) {
      const pv = dl.axis === 'y' ? t.prevSmoothCy : t.prevSmoothCx;
      const cv = dl.axis === 'y' ? t.smoothCy     : t.smoothCx;
      if (pv === cv) continue;
      const cross1pos = pv <= dl.l1 && cv > dl.l1;
      const cross1neg = pv >= dl.l1 && cv < dl.l1;
      const cross2pos = pv <= dl.l2 && cv > dl.l2;
      const cross2neg = pv >= dl.l2 && cv < dl.l2;
      if (t.tripState === null) {
        if (cross1pos) t.tripState = 'pos';
        else if (cross2neg) t.tripState = 'neg';
      } else if (t.tripState === 'pos') {
        if (cross2pos) {
          const isEntry = state.settings.entryDir === 'positive';
          emitCount(isEntry);
          t.counts++; t.tripState = null;
        } else if (cross1neg) {
          t.tripState = null; // turned back
        }
      } else if (t.tripState === 'neg') {
        if (cross1neg) {
          const isEntry = state.settings.entryDir === 'negative';
          emitCount(isEntry);
          t.counts++; t.tripState = null;
        } else if (cross2pos) {
          t.tripState = null;
        }
      }
    }
  }

  function emitCount(isEntry) {
    if (isEntry) state.countIn++; else state.countOut++;
    logEvent(isEntry ? 'in' : 'out');
    feedback(isEntry ? 'in' : 'out');
    updateCounters();
    updateCapacityUI();
    checkCapacity();
    sharePush();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Detection loop
  // ─────────────────────────────────────────────────────────────────────────────
  async function detectLoop() {
    if (!state.running) return;
    const now = performance.now();
    const v = els.video, vw = v.videoWidth, vh = v.videoHeight;
    if (vw && vh && !state.inferring && (now - state.lastDetectionAt) >= state.detectionIntervalMs) {
      state.inferring = true; state.lastDetectionAt = now;
      try {
        const t0 = performance.now();
        const preds = await state.model.detect(v, 10);
        const elapsed = performance.now() - t0;
        state.fpsSamples.push(elapsed);
        if (state.fpsSamples.length > 10) state.fpsSamples.shift();
        const avg = state.fpsSamples.reduce((a, b) => a + b, 0) / state.fpsSamples.length;
        els.fps.textContent = `${(1000 / Math.max(avg, 1)).toFixed(1)} FPS`;
        const allP = preds.filter(p => p.class === 'person').map(p => ({
          bbox: p.bbox, cx: p.bbox[0] + p.bbox[2] / 2, cy: p.bbox[1] + p.bbox[3] / 2, score: p.score,
        }));
        const persons = nms(allP.filter(p => p.score >= state.settings.confThreshold));
        state.weakDetections = state.settings.showWeak
          ? nms(allP.filter(p => p.score < state.settings.confThreshold && p.score >= 0.15))
          : [];
        const weakLbl = state.weakDetections.length ? ` (+${state.weakDetections.length} ضعيف)` : '';
        els.people.textContent = `${persons.length} شخص${weakLbl}`;
        updateTracks(persons, vw, vh);
        if (state.settings.countingMode === 'double') checkDoubleLineCrossings(vw, vh);
        else checkSingleLineCrossings(vw, vh);
        drawOverlay();
      } catch (e) { console.warn(e); } finally { state.inferring = false; }
    } else if (els.video.videoWidth) { drawOverlay(); }
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
      els.liveDot.style.background = '#10b981';
      detectLoop();
    } catch { els.btnStart.disabled = false; }
  }

  function stop() {
    state.running = false;
    if (state.rafId) cancelAnimationFrame(state.rafId);
    stopCamera(); state.tracks = [];
    els.empty.classList.remove('hidden'); els.lineHandle.hidden = true;
    els.btnStart.disabled = false; els.btnStop.disabled = true;
    els.liveDot.style.background = '';
    setStatus('متوقف');
    els.overlay.getContext('2d').clearRect(0, 0, els.overlay.width, els.overlay.height);
  }

  function reset() {
    if (!confirm('تصفير العدّاد وسجل اليوم؟')) return;
    state.countIn = 0; state.countOut = 0; state.history = [];
    state.tracks = []; state.capacityAlerted = false;
    updateCounters(); updateCapacityUI();
    renderHistory(); renderChart(); renderSummary();
    saveState(); sharePush();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Exports
  // ─────────────────────────────────────────────────────────────────────────────
  function exportCSV() {
    if (!state.history.length) { alert('لا توجد بيانات للتصدير'); return; }
    const rows = [['التاريخ', 'الوقت', 'الحدث']];
    for (const e of state.history) {
      const d = new Date(e.t);
      rows.push([d.toLocaleDateString('en-CA'), d.toLocaleTimeString('en-GB'), e.type === 'in' ? 'دخول' : 'خروج']);
    }
    rows.push([], ['إجمالي الدخول', state.countIn], ['إجمالي الخروج', state.countOut],
      ['داخل الآن', Math.max(0, state.countIn - state.countOut)]);
    const csv = '﻿' + rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `door-counter-${new Date().toISOString().slice(0, 10)}.csv` });
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function exportPDF() {
    const date = new Date().toLocaleDateString('ar-SA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const net  = Math.max(0, state.countIn - state.countOut);
    const cap  = state.settings.capacityMax || 0;
    const fmt  = new Intl.DateTimeFormat('ar-SA', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const evRows = state.history.length
      ? state.history.slice().reverse().map(e =>
          `<tr><td>${e.type === 'in' ? '↓ دخول' : '↑ خروج'}</td><td>${fmt.format(new Date(e.t))}</td></tr>`).join('')
      : '<tr><td colspan="2" style="text-align:center;color:#888">لا توجد أحداث</td></tr>';
    // Build insights
    const hourly = new Array(24).fill(0);
    state.history.filter(e => e.type === 'in').forEach(e => hourly[new Date(e.t).getHours()]++);
    const peakH = hourly.indexOf(Math.max(...hourly));
    const daily = loadDailyStats();
    const yData = daily[new Date(Date.now() - 86400000).toISOString().slice(0, 10)];
    const cmpLine = yData ? `<p>مقارنة بالأمس (${yData.in}): ${state.countIn > yData.in ? '+' : ''}${state.countIn - yData.in}</p>` : '';
    const w = window.open('', '_blank');
    if (!w) { alert('السماح بالنوافذ المنبثقة لتصدير PDF'); return; }
    w.document.open();
    w.document.write(`<!DOCTYPE html><html lang="ar" dir="rtl"><head>
<meta charset="utf-8"><title>تقرير — ${date}</title>
<style>body{font-family:-apple-system,"Segoe UI",Tahoma,sans-serif;padding:24px;color:#111;max-width:800px;margin:0 auto}
h1{font-size:22px;margin:0 0 4px}.sub{color:#666;font-size:12px;margin-bottom:20px}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px}
.card{border:1px solid #ddd;border-radius:12px;padding:16px;text-align:center}
.card .v{font-size:32px;font-weight:900;margin-top:4px}.in .v{color:#059669}.out .v{color:#dc2626}.net .v{color:#2563eb}
h2{font-size:15px;margin:20px 0 8px;border-bottom:1px solid #ddd;padding-bottom:4px}
table{width:100%;border-collapse:collapse;font-size:12px}th,td{padding:6px 8px;text-align:right;border-bottom:1px solid #eee}
th{background:#f7f7f8;font-weight:600}.insight{background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:12px;font-size:13px}
.chart-box svg{width:100%;height:160px}.footer{margin-top:32px;font-size:11px;color:#888;text-align:center}
@media print{body{padding:8px}}</style></head><body>
<h1>تقرير عدّاد الداخلين</h1><div class="sub">${date} — ${new Date().toLocaleTimeString('ar-SA')}</div>
<div class="grid">
<div class="card in"><div>دخول</div><div class="v">${state.countIn}</div></div>
<div class="card out"><div>خروج</div><div class="v">${state.countOut}</div></div>
<div class="card net"><div>داخل الآن${cap ? ` / ${cap}` : ''}</div><div class="v">${net}</div></div>
</div>
<div class="insight"><strong>ملخص ذكي:</strong>
${state.countIn > 0 ? `دخل اليوم ${state.countIn} شخص.` : 'لا بيانات.'}
${hourly[peakH] > 0 ? ` الذروة في الساعة ${peakH}:00 بـ ${hourly[peakH]} أشخاص.` : ''}
${cmpLine}</div>
<h2>الازدحام بالساعة</h2>
<div class="chart-box">${els.chartSvg.outerHTML}</div>
<h2>سجل الأحداث (${state.history.length})</h2>
<table><thead><tr><th>الحدث</th><th>الوقت</th></tr></thead><tbody>${evRows}</tbody></table>
<div class="footer">تم إنشاء التقرير بواسطة عدّاد الداخلين</div>
<script>window.addEventListener('load',()=>setTimeout(()=>window.print(),350));<\/script>
</body></html>`);
    w.document.close();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Firebase sharing
  // ─────────────────────────────────────────────────────────────────────────────
  const share = { enabled: false, db: null, role: null, code: null, ref: null };
  function initFirebase() {
    if (typeof firebase === 'undefined' || typeof window.FIREBASE_CONFIG === 'undefined') return false;
    try {
      if (!firebase.apps.length) firebase.initializeApp(window.FIREBASE_CONFIG);
      share.db = firebase.database(); share.enabled = true; return true;
    } catch { return false; }
  }
  const genCode = () => Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
  const snapshot = () => ({ countIn: state.countIn, countOut: state.countOut, net: Math.max(0, state.countIn - state.countOut), capacityMax: state.settings.capacityMax || 0, history: state.history.slice(-100), updatedAt: Date.now() });
  async function sharePush() {
    if (!share.enabled || share.role !== 'host' || !share.ref) return;
    try { await share.ref.set(snapshot()); } catch {}
  }
  async function startHost() {
    // ① توليد الكود وعرض الرابط فوراً بدون انتظار Firebase
    const code = genCode();
    share.role = 'host'; share.code = code;
    const url = `${location.origin}${location.pathname}?room=${code}`;
    els.shareCode.textContent = code;
    els.shareLink.value = url;
    els.shareResult.hidden = false;
    els.btnHostStart.disabled = true;
    showShareStatus('جارٍ تفعيل الجلسة...', '');

    // ② رسم QR
    els.shareQR.innerHTML = '';
    if (typeof QRCode !== 'undefined') {
      QRCode.toCanvas(url, { width: 180, margin: 1, color: { dark: '#0f172a', light: '#f8fafc' } },
        (err, canvas) => { if (!err) els.shareQR.appendChild(canvas); });
    }

    // ③ ربط Firebase في الخلفية
    if (!initFirebase()) {
      showShareStatus('الكود جاهز (بدون مزامنة لايف)', '');
      return;
    }
    try {
      share.ref = share.db.ref('rooms/' + code);
      await share.ref.set(snapshot());
      share.ref.onDisconnect().remove();
      showShareStatus('الجلسة مفعّلة — شارك الكود أو QR', '');
    } catch (e) {
      showShareStatus('الكود جاهز — تعذّر الاتصال بالسيرفر', 'error');
    }
  }
  async function stopHost() {
    try { await share.ref?.remove(); } catch {}
    share.role = null; share.code = null; share.ref = null;
    els.shareResult.hidden = true; els.btnHostStart.disabled = false;
    showShareStatus('تم إنهاء الجلسة', '');
  }
  function startViewer(code) {
    if (!initFirebase()) { showShareStatus('Firebase غير مفعّل', 'error'); return; }
    code = (code || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code)) { showShareStatus('الكود يجب 6 أحرف/أرقام', 'error'); return; }
    share.role = 'viewer'; share.code = code;
    share.ref = share.db.ref('rooms/' + code);
    state.mode = 'viewer'; els.body.dataset.mode = 'viewer';
    els.modeBadge.textContent = 'مشاهد — ' + code;
    share.ref.on('value', snap => {
      const d = snap.val();
      if (!d) { showShareStatus('الجلسة غير موجودة', 'error'); return; }
      state.countIn = d.countIn || 0; state.countOut = d.countOut || 0;
      state.history = d.history || []; state.settings.capacityMax = d.capacityMax || 0;
      updateCounters(); updateCapacityUI(); renderHistory(); renderChart(); renderSummary();
      showShareStatus(`متصل — آخر تحديث: ${new Date(d.updatedAt).toLocaleTimeString('ar-SA')}`, '');
    });
    closeShareModal();
  }
  const showShareStatus = (text, kind) => { els.shareStatus.textContent = text; els.shareStatus.className = 'share-status' + (kind ? ' ' + kind : ''); els.shareStatus.hidden = !text; };
  const openShareModal  = () => { els.shareModal.hidden = false; };
  const closeShareModal = () => { els.shareModal.hidden = true; };

  // ─────────────────────────────────────────────────────────────────────────────
  // Event binding
  // ─────────────────────────────────────────────────────────────────────────────
  function bindEvents() {
    els.btnStart.addEventListener('click', start);
    els.btnStop.addEventListener('click', stop);
    els.btnReset.addEventListener('click', reset);
    els.btnExport.addEventListener('click', exportCSV);
    els.btnPDF.addEventListener('click', exportPDF);
    els.btnShare.addEventListener('click', openShareModal);
    els.btnSettings.addEventListener('click', () => { els.settings.open = !els.settings.open; });
    els.btnDashboard.addEventListener('click', openDashboard);
    els.btnExitDash.addEventListener('click', closeDashboard);

    // Settings
    const sv = (key, val) => { state.settings[key] = val; saveState(); };
    els.countingMode.addEventListener('change', e => { sv('countingMode', e.target.value); syncModeUI(); });
    els.doubleLineGap.addEventListener('input', e => { sv('doubleLineGap', +e.target.value); els.doubleGapVal.textContent = e.target.value + '%'; });
    els.lineOrient.addEventListener('change', e => { sv('lineOrient', e.target.value); positionLineHandle(); });
    els.linePos.addEventListener('input', e => { sv('linePos', +e.target.value); els.linePosVal.textContent = e.target.value + '%'; positionLineHandle(); });
    els.entryDir.addEventListener('change', e => sv('entryDir', e.target.value));
    els.confThreshold.addEventListener('input', e => { sv('confThreshold', +e.target.value / 100); els.confVal.textContent = e.target.value + '%'; });
    els.bufferZone.addEventListener('input', e => { sv('bufferZone', +e.target.value); els.bufferVal.textContent = e.target.value + '%'; });
    els.minConfirmFrames.addEventListener('input', e => { sv('minConfirmFrames', +e.target.value); els.minFramesVal.textContent = e.target.value; });
    els.modelBase.addEventListener('change', e => { sv('modelBase', e.target.value); state.model = null; setStatus('أعد التشغيل لتحميل النموذج الجديد'); });
    els.showWeak.addEventListener('change', e => sv('showWeak', e.target.checked));
    els.cameraFacing.addEventListener('change', async e => { sv('cameraFacing', e.target.value); if (state.running) { stopCamera(); try { await startCamera(); } catch {} } });
    els.capacityMax.addEventListener('change', e => { sv('capacityMax', Math.max(0, +e.target.value || 0)); updateCapacityUI(); sharePush(); });
    els.hapticOn.addEventListener('change', e => sv('hapticOn', e.target.checked));
    els.soundOn.addEventListener('change', e => sv('soundOn', e.target.checked));
    els.voiceOn.addEventListener('change', e => sv('voiceOn', e.target.checked));

    // Share modal
    els.shareClose.addEventListener('click', closeShareModal);
    els.shareModal.addEventListener('click', e => { if (e.target === els.shareModal) closeShareModal(); });
    els.tabHost.addEventListener('click', () => { els.tabHost.classList.add('active'); els.tabJoin.classList.remove('active'); els.paneHost.hidden = false; els.paneJoin.hidden = true; });
    els.tabJoin.addEventListener('click', () => { els.tabJoin.classList.add('active'); els.tabHost.classList.remove('active'); els.paneJoin.hidden = false; els.paneHost.hidden = true; });
    els.btnHostStart.addEventListener('click', startHost);
    els.btnHostStop.addEventListener('click', stopHost);
    els.btnJoin.addEventListener('click', () => startViewer(els.joinCode.value));
    els.joinCode.addEventListener('input', e => { e.target.value = e.target.value.toUpperCase(); });
    els.btnCopyLink.addEventListener('click', () => {
      const url = els.shareLink.value;
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(url).then(() => { els.btnCopyLink.textContent = 'تم!'; setTimeout(() => { els.btnCopyLink.textContent = 'نسخ'; }, 1500); });
      } else {
        els.shareLink.select(); document.execCommand('copy');
        els.btnCopyLink.textContent = 'تم!'; setTimeout(() => { els.btnCopyLink.textContent = 'نسخ'; }, 1500);
      }
    });

    const btnNativeShare = $('btnNativeShare');
    if (navigator.share) {
      btnNativeShare.style.display = '';
      btnNativeShare.addEventListener('click', () => {
        navigator.share({ title: 'عدّاد الداخلين', text: `الكود: ${share.code}`, url: els.shareLink.value }).catch(() => {});
      });
    }
    els.alertClose.addEventListener('click', () => { els.alertModal.hidden = true; });
    bindLineDrag();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Init
  // ─────────────────────────────────────────────────────────────────────────────
  function checkSupport() {
    if (!navigator.mediaDevices?.getUserMedia) { setStatus('المتصفح لا يدعم الكاميرا', 'error'); els.btnStart.disabled = true; return false; }
    if (!window.isSecureContext) { setStatus('يجب فتح الموقع عبر HTTPS', 'error'); els.btnStart.disabled = true; return false; }
    return true;
  }

  function maybeJoinFromURL() {
    const room = new URLSearchParams(location.search).get('room');
    if (room) startViewer(room);
  }

  function init() {
    loadState();
    syncUIFromSettings();
    bindEvents();
    if (!checkSupport()) return;
    setStatus('جاهز — اضغط تشغيل');
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
    maybeJoinFromURL();
  }

  init();
})();
