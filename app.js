// MediaPipe is loaded dynamically so the camera and buttons still work even if the library fails to load.
let FilesetResolver, HandLandmarker, FaceLandmarker;
async function loadLib() {
  const urls = [
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs',
    'https://unpkg.com/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs'
  ];
  let last;
  for (const u of urls) {
    try { ({ FilesetResolver, HandLandmarker, FaceLandmarker } = await import(u)); return; }
    catch (e) { last = e; console.warn('Could not load', u, e); }
  }
  throw last;
}
window.addEventListener('error', e => { const el = document.querySelector('#status'); if (el) el.textContent = 'Error: ' + e.message; });

const video = document.querySelector('#video');
const canvas = document.querySelector('#canvas');
const ctx = canvas.getContext('2d');
const startBtn = document.querySelector('#startBtn');
const stopBtn = document.querySelector('#stopBtn');
const captureBtn = document.querySelector('#captureBtn');
const statusEl = document.querySelector('#status');
const placeholder = document.querySelector('#placeholder');
const gestureBadge = document.querySelector('#gestureBadge');
const filterButtons = [...document.querySelectorAll('.filter')];

let stream = null, handLandmarker = null, faceLandmarker = null, running = false;
let currentFilter = 'none', lastGesture = '', lastGestureAt = 0, lastVideoTime = -1, lastCaptureAt = 0;

const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const modelBase = 'https://storage.googleapis.com/mediapipe-models';

function setFilter(name) {
  currentFilter = name;
  filterButtons.forEach(b => b.classList.toggle('active', b.dataset.filter === name));
}
filterButtons.forEach(b => b.addEventListener('click', () => setFilter(b.dataset.filter)));

async function createWithFallback(Task, path, extra) {
  for (const delegate of ['GPU', 'CPU']) {
    try {
      return await Task.createFromOptions(await visionPromise, {
        baseOptions: { modelAssetPath: path, delegate }, runningMode: 'VIDEO', ...extra
      });
    } catch (e) { console.warn(`${delegate} delegate failed`, e); }
  }
  throw new Error('Could not load model');
}
let visionPromise;

async function loadModels() {
  statusEl.textContent = 'Loading AI models…';
  if (!FilesetResolver) await loadLib();
  visionPromise = FilesetResolver.forVisionTasks(WASM);
  handLandmarker = await createWithFallback(HandLandmarker,
    `${modelBase}/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
    { numHands: 2, minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5 });
  faceLandmarker = await createWithFallback(FaceLandmarker,
    `${modelBase}/face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
    { numFaces: 2, minFaceDetectionConfidence: 0.5, minFacePresenceConfidence: 0.5, minTrackingConfidence: 0.5 });
}

async function startCamera() {
  startBtn.disabled = true;
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access needs HTTPS or localhost and a supported browser.');
    statusEl.textContent = 'Starting camera…';
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false
    });
    video.srcObject = stream;
    await video.play();
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    placeholder.hidden = true;
    running = true; lastVideoTime = -1;
    stopBtn.disabled = false; captureBtn.disabled = false; startBtn.textContent = 'Camera running';
    statusEl.textContent = 'Camera active';
    requestAnimationFrame(renderLoop);   // preview starts immediately

    if (!handLandmarker || !faceLandmarker) {
      try { await loadModels(); statusEl.textContent = 'Camera active'; }
      catch (e) {
        console.error(e);
        handLandmarker = faceLandmarker = null;
        statusEl.textContent = 'Camera on (AI models failed to load)';
      }
    }
  } catch (error) {
    console.error(error);
    statusEl.textContent = 'Could not start';
    const hints = {
      NotAllowedError: 'Camera permission was blocked. Click the lock icon in the address bar, set Camera to Allow, then reload.',
      NotFoundError: 'No camera was found on this device.',
      NotReadableError: 'The camera is being used by another app or tab. Close it and try again.',
      OverconstrainedError: 'The camera does not support the requested size.'
    };
    alert(`Unable to start GestureAR.\n\n${error.name}: ${hints[error.name] || error.message}`);
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = null; running = false;
    startBtn.disabled = false; startBtn.textContent = 'Start camera';
  }
}

function stopCamera() {
  running = false;
  if (stream) stream.getTracks().forEach(t => t.stop());
  stream = null; video.srcObject = null;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  placeholder.hidden = false; stopBtn.disabled = true; captureBtn.disabled = true;
  startBtn.disabled = false; startBtn.textContent = 'Start camera';
  statusEl.textContent = 'Camera off'; gestureBadge.textContent = 'Gesture: —';
}

/* ---------- gestures ---------- */
function fingerUp(lm, tip, pip) { return lm[tip].y < lm[pip].y - 0.015; }
function recognizeGesture(lm) {
  const index = fingerUp(lm, 8, 6), middle = fingerUp(lm, 12, 10), ring = fingerUp(lm, 16, 14), pinky = fingerUp(lm, 20, 18);
  const thumb = Math.abs(lm[4].x - lm[2].x) > 0.07;
  if (index && middle && !ring && !pinky) return 'Peace';
  if (thumb && !index && !middle && !ring && !pinky && lm[4].y < lm[3].y) return 'Thumbs Up';
  if (!index && !middle && !ring && !pinky) return 'Fist';
  if (index && middle && ring && pinky) return 'Open Palm';
  if (index && !middle && !ring && !pinky) return 'Index Pointing';
  return '';
}
function applyGesture(name) {
  const now = performance.now();
  if (!name) return;
  gestureBadge.textContent = `Gesture: ${name}`;
  if (name === 'Index Pointing') {                       // screenshot, 3 s cooldown
    if (now - lastCaptureAt > 3000) { lastCaptureAt = now; captureScreenshot(); }
  } else if (name !== lastGesture || now - lastGestureAt > 1200) {
    const map = { 'Peace': 'goggles', 'Thumbs Up': 'dog', 'Fist': 'cat', 'Open Palm': 'bow' };
    if (map[name]) setFilter(map[name]);
  }
  lastGesture = name; lastGestureAt = now;
}

/* ---------- drawing ---------- */
function px(p) { return [p.x * canvas.width, p.y * canvas.height]; }
function drawLine(a, b, color = '#111827', width = 4) {
  const p = px(a), q = px(b);
  ctx.beginPath(); ctx.moveTo(...p); ctx.lineTo(...q); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
}
function drawCircle(point, r, fill, stroke = null, lw = 3) {
  const [x, y] = px(point);
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
}

/* ---------- extra filters (add your own here!) ---------- */
// Each filter receives the context and face measurements: eye points (lx,ly,rx,ry), nose (nx,ny),
// forehead (fx,fy), d = eye distance, angle = head tilt.
const emoji = (c, text, x, y, size) => { c.font = `${Math.round(size)}px sans-serif`; c.fillText(text, x, y); };
const EXTRA = {
  ghost(c, f) {
    for (const [x, y] of [[f.lx, f.ly], [f.rx, f.ry]]) {
      c.beginPath(); c.ellipse(x, y, f.d * .13, f.d * .18, 0, 0, Math.PI * 2); c.fillStyle = '#0b0b12'; c.fill();
    }
    c.beginPath(); c.ellipse(f.nx, f.ny + f.d * .45, f.d * .1, f.d * .16, 0, 0, Math.PI * 2); c.fill();
    emoji(c, '👻', f.fx, f.fy - f.d * .35, f.d * .6);
  },
  crown(c, f) { emoji(c, '👑', f.fx, f.fy - f.d * .12, f.d * .75); },
  clown(c, f) {
    c.beginPath(); c.arc(f.nx, f.ny, f.d * .13, 0, Math.PI * 2); c.fillStyle = '#ef233c'; c.fill();
    c.strokeStyle = '#fff'; c.lineWidth = Math.max(2, f.d * .015); c.stroke();
    emoji(c, '🌈', f.fx, f.fy - f.d * .3, f.d * .5);
  },
  devil(c, f) {
    c.fillStyle = '#e11d48';
    for (const s of [-1, 1]) {
      const bx = f.fx + s * f.d * .35, by = f.fy + f.d * .05;
      c.beginPath(); c.moveTo(bx - f.d * .1, by); c.lineTo(bx + s * f.d * .08, by - f.d * .42); c.lineTo(bx + f.d * .1, by); c.closePath(); c.fill();
    }
  },
  paris(c, f) {            // beret + moustache
    c.save(); c.translate(f.fx, f.fy - f.d * .05); c.rotate(f.angle);
    c.beginPath(); c.ellipse(0, -f.d * .12, f.d * .62, f.d * .2, -.08, 0, Math.PI * 2); c.fillStyle = '#b91c3c'; c.fill();
    c.fillRect(-f.d * .02, -f.d * .4, f.d * .04, f.d * .1);
    c.restore();
    c.strokeStyle = '#1f1308'; c.lineWidth = Math.max(4, f.d * .05); c.lineCap = 'round';
    const y = f.ny + f.d * .27;
    c.beginPath(); c.moveTo(f.nx, y); c.quadraticCurveTo(f.nx - f.d * .2, y - f.d * .1, f.nx - f.d * .35, y + f.d * .05);
    c.moveTo(f.nx, y); c.quadraticCurveTo(f.nx + f.d * .2, y - f.d * .1, f.nx + f.d * .35, y + f.d * .05); c.stroke();
  },
  oslo(c, f) {             // knit beanie + pom-pom
    c.save(); c.translate(f.fx, f.fy - f.d * .02); c.rotate(f.angle);
    c.beginPath(); c.ellipse(0, 0, f.d * .62, f.d * .45, 0, Math.PI, 0); c.fillStyle = '#2563eb'; c.fill();
    c.fillStyle = '#e5e7eb'; c.fillRect(-f.d * .62, -f.d * .06, f.d * 1.24, f.d * .12);
    c.beginPath(); c.arc(0, -f.d * .46, f.d * .1, 0, Math.PI * 2); c.fill();
    c.restore();
  },
  tokyo(c, f) {            // neon glow glasses + sakura
    c.lineWidth = Math.max(3, f.d * .03);
    [['#22d3ee', f.lx, f.ly], ['#f472b6', f.rx, f.ry]].forEach(([col, x, y]) => {
      c.strokeStyle = col; c.shadowColor = col; c.shadowBlur = f.d * .15;
      c.beginPath(); c.ellipse(x, y, f.d * .2, f.d * .13, f.angle, 0, Math.PI * 2); c.stroke();
    });
    c.shadowBlur = 0;
    emoji(c, '🌸', f.fx - f.d * .45, f.fy, f.d * .3); emoji(c, '🌸', f.fx + f.d * .45, f.fy + f.d * .05, f.d * .25);
  }
};
const TINTS = { ghost: 'rgba(210,225,255,.22)', paris: 'rgba(255,190,120,.16)', oslo: 'rgba(120,170,255,.16)', tokyo: 'rgba(255,0,200,.14)' };
const FLOATERS = { hearts: '💗', oslo: '❄️', tokyo: '🌸', ghost: '👻' };

/* tongue: appears when the mouth opens and gets longer the wider you open */
function drawTongue(face, d, angle) {
  const top = face[13], bottom = face[14];
  const gap = Math.hypot((top.x - bottom.x) * canvas.width, (top.y - bottom.y) * canvas.height);
  const t = Math.min(1, Math.max(0, (gap / d - 0.06) / 0.4));
  if (t <= 0) return;
  const [bx, by] = px(bottom);
  const w = d * .24, len = d * (.2 + 1.0 * t);
  ctx.save();
  ctx.translate(bx, by - d * .02); ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(-w / 2, 0); ctx.lineTo(-w / 2, len - w / 2);
  ctx.arc(0, len - w / 2, w / 2, Math.PI, 0, true);
  ctx.lineTo(w / 2, 0); ctx.closePath();
  ctx.fillStyle = '#ff6b8b'; ctx.fill();
  ctx.strokeStyle = '#d6335a'; ctx.lineWidth = Math.max(2, d * .02); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, d * .04); ctx.lineTo(0, len * .7);
  ctx.strokeStyle = 'rgba(190,40,80,.6)'; ctx.stroke();
  ctx.restore();
}

function drawFaceFilter(face, filter) {
  if (!face || filter === 'none' || filter === 'hearts') return;
  // after mirroring, make sure "left" is really the eye with smaller x
  let eyeL = face[33], eyeR = face[263];
  if (eyeL.x > eyeR.x) [eyeL, eyeR] = [eyeR, eyeL];
  const nose = face[1], forehead = face[10], cheekL = face[234], cheekR = face[454];
  const [lx, ly] = px(eyeL), [rx, ry] = px(eyeR), [nx, ny] = px(nose), [fx, fy] = px(forehead);
  const d = Math.hypot(rx - lx, ry - ly), angle = Math.atan2(ry - ly, rx - lx);
  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (filter === 'goggles') {
    for (const eye of [eyeL, eyeR]) {
      const [x, y] = px(eye);
      ctx.beginPath(); ctx.ellipse(x, y, d * .19, d * .12, angle, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(28,35,53,.7)'; ctx.fill();
      ctx.strokeStyle = '#e7edff'; ctx.lineWidth = Math.max(3, d * .025); ctx.stroke();
    }
    const lerp = t => ({ x: eyeL.x + (eyeR.x - eyeL.x) * t, y: eyeL.y + (eyeR.y - eyeL.y) * t });
    drawLine(lerp(.3), lerp(.7), '#e7edff', Math.max(3, d * .025));
  } else if (filter === 'dog') {
    ctx.font = `${Math.round(d * .4)}px sans-serif`; ctx.fillText('🐶', nx, ny + d * .1);
    ctx.font = `${Math.round(d * .42)}px sans-serif`;
    ctx.fillText('🐾', lx - d * .15, ly - d * .35); ctx.fillText('🐾', rx + d * .15, ry - d * .35);
    drawTongue(face, d, angle);
  } else if (filter === 'cat') {
    ctx.font = `${Math.round(d * .52)}px sans-serif`; ctx.fillText('🐱', nx, ny + d * .1);
    ctx.strokeStyle = '#ffb3d1'; ctx.lineWidth = Math.max(3, d * .035);
    ctx.beginPath();
    ctx.moveTo(lx - d * .28, ly - d * .05); ctx.lineTo(lx - d * .15, ly - d * .45); ctx.lineTo(lx, ly - d * .08);
    ctx.moveTo(rx, ry - d * .08); ctx.lineTo(rx + d * .15, ry - d * .45); ctx.lineTo(rx + d * .28, ry - d * .05);
    ctx.stroke();
    drawTongue(face, d, angle);
  } else if (filter === 'bow') {
    // bow on the left side of the head (left as seen on screen)
    ctx.save(); ctx.translate(fx - d * .5, fy + d * .12); ctx.rotate(angle - .25);
    ctx.font = `${Math.round(d * .5)}px sans-serif`; ctx.fillText('🎀', 0, 0);
    ctx.restore();
  } else if (EXTRA[filter]) {
    EXTRA[filter](ctx, { lx, ly, rx, ry, nx, ny, fx, fy, d, angle });
  } else if (filter === 'makeup') {
    drawCircle(cheekL, d * .075, 'rgba(255,95,145,.42)'); drawCircle(cheekR, d * .075, 'rgba(255,95,145,.42)');
    ctx.beginPath(); ctx.moveTo(lx, ly + d * .17);
    ctx.quadraticCurveTo((lx + rx) / 2, ny + d * .55, rx, ry + d * .17);
    ctx.strokeStyle = '#ff477e'; ctx.lineWidth = Math.max(3, d * .035); ctx.stroke();
  }
  ctx.restore();
}
function drawFloating(char) {
  const t = performance.now() / 1000;
  ctx.save(); ctx.font = `${Math.max(24, canvas.width * .045)}px sans-serif`; ctx.textAlign = 'center';
  for (let i = 0; i < 7; i++) {
    const x = canvas.width * (.12 + ((i * .137 + t * .025) % .76));
    const y = canvas.height * (.18 + ((i * .19 + t * .08) % .62));
    ctx.globalAlpha = .65 + Math.sin(t + i) * .25; ctx.fillText(char, x, y);
  }
  ctx.restore();
}
function captureScreenshot() {
  if (!canvas.width || !canvas.height) return;
  const link = document.createElement('a');
  link.download = `GestureAR-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
  link.href = canvas.toDataURL('image/png'); link.click();
  statusEl.textContent = 'Screenshot saved';
  setTimeout(() => { if (running) statusEl.textContent = 'Camera active'; }, 1600);
}

/* ---------- main loop ---------- */
function renderLoop() {
  if (!running) return;
  if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {   // never stop the loop on a slow frame
    lastVideoTime = video.currentTime;
    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    }
    ctx.save(); ctx.translate(canvas.width, 0); ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height); ctx.restore();
    if (TINTS[currentFilter]) { ctx.fillStyle = TINTS[currentFilter]; ctx.fillRect(0, 0, canvas.width, canvas.height); }

    if (faceLandmarker && handLandmarker) {
      const now = performance.now();
      try {
        const faces = faceLandmarker.detectForVideo(video, now).faceLandmarks || [];
        const hands = handLandmarker.detectForVideo(video, now).landmarks || [];
        const mir = list => list.map(pts => pts.map(p => ({ ...p, x: 1 - p.x })));
        mir(faces).forEach(f => drawFaceFilter(f, currentFilter));
        if (FLOATERS[currentFilter]) drawFloating(FLOATERS[currentFilter]);
        const mh = mir(hands);
        if (mh.length) {
          const names = mh.map(recognizeGesture).filter(Boolean);
          if (names.length) applyGesture(names[0]);
          else if (performance.now() - lastGestureAt > 1300) gestureBadge.textContent = 'Gesture: detecting…';
          mh.forEach(h => [0, 4, 8, 12, 16, 20].forEach(i => drawCircle(h[i], Math.max(3, canvas.width * .004), '#76f7c4')));
        } else if (performance.now() - lastGestureAt > 1300) gestureBadge.textContent = 'Gesture: —';
      } catch (e) { console.warn('Frame processing issue:', e); }
    }
  }
  requestAnimationFrame(renderLoop);
}

startBtn.addEventListener('click', startCamera);
stopBtn.addEventListener('click', stopCamera);
captureBtn.addEventListener('click', captureScreenshot);
window.addEventListener('beforeunload', () => { if (stream) stream.getTracks().forEach(t => t.stop()); });
