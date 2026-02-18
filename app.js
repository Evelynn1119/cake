/* ========================================
   VIRTUAL BIRTHDAY CARD — App Logic
   ======================================== */

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

/* ── Happy Birthday Melody (Web Audio Synthesis) ── */

const MELODY = [
    [392.00, 0.75], [392.00, 0.25], [440.00, 1], [392.00, 1], [523.25, 1], [493.88, 2],
    [392.00, 0.75], [392.00, 0.25], [440.00, 1], [392.00, 1], [587.33, 1], [523.25, 2],
    [392.00, 0.75], [392.00, 0.25], [783.99, 1], [659.25, 1], [523.25, 1], [493.88, 1], [440.00, 2],
    [698.46, 0.75], [698.46, 0.25], [659.25, 1], [523.25, 1], [587.33, 1], [523.25, 2],
];

const BEAT_DURATION = 0.48;

class MusicBox {
    constructor() {
        this.ctx = null;
        this.playing = false;
        this.timeouts = [];
    }

    init() {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }

    playNote(freq, startTime, duration) {
        const ctx = this.ctx;
        const osc = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain = ctx.createGain();
        const gain2 = ctx.createGain();
        const master = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.value = freq;
        osc2.type = 'sine';
        osc2.frequency.value = freq * 2;

        gain.gain.value = 0;
        gain2.gain.value = 0;
        master.gain.value = 0.25;

        osc.connect(gain);
        osc2.connect(gain2);
        gain.connect(master);
        gain2.connect(master);
        master.connect(ctx.destination);

        const attack = 0.05;

        gain.gain.setValueAtTime(0, startTime);
        gain.gain.linearRampToValueAtTime(0.5, startTime + attack);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration - 0.01);

        gain2.gain.setValueAtTime(0, startTime);
        gain2.gain.linearRampToValueAtTime(0.12, startTime + attack);
        gain2.gain.exponentialRampToValueAtTime(0.001, startTime + duration - 0.01);

        osc.start(startTime);
        osc.stop(startTime + duration);
        osc2.start(startTime);
        osc2.stop(startTime + duration);
    }

    play() {
        if (!this.ctx) this.init();
        if (this.ctx.state === 'suspended') this.ctx.resume();
        this.playing = true;
        this.loop();
    }

    loop() {
        if (!this.playing) return;
        const startTime = this.ctx.currentTime + 0.1;
        let t = startTime;
        for (const [freq, beats] of MELODY) {
            const dur = beats * BEAT_DURATION;
            this.playNote(freq, t, dur * 0.9);
            t += dur;
        }
        const totalDuration = (t - startTime) + 1.5;
        const tid = setTimeout(() => this.loop(), totalDuration * 1000);
        this.timeouts.push(tid);
    }

    stop() {
        this.playing = false;
        this.timeouts.forEach(clearTimeout);
        this.timeouts = [];
    }
}

/* ── Face Blow Detector (Camera + MediaPipe Face Mesh) ── */

class FaceBlowDetector {
    constructor({ onBlow, onBlowing, onReady, onError }) {
        this.callbacks = { onBlow, onBlowing, onReady, onError };
        this.running = false;
        this.faceMesh = null;
        this.mpCamera = null;
        this.blowFrames = 0;
        this.blowThreshold = 15;
        this.ready = false;
    }

    async start(videoElement) {
        if (typeof FaceMesh === 'undefined' || typeof Camera === 'undefined') {
            this.callbacks.onError(new Error('MediaPipe not loaded'));
            return false;
        }

        try {
            this.faceMesh = new FaceMesh({
                locateFile: (file) =>
                    `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
            });

            this.faceMesh.setOptions({
                maxNumFaces: 1,
                refineLandmarks: true,
                minDetectionConfidence: 0.5,
                minTrackingConfidence: 0.5,
            });

            this.faceMesh.onResults((r) => this.processResults(r));

            this.mpCamera = new Camera(videoElement, {
                onFrame: async () => {
                    if (this.running && this.faceMesh) {
                        await this.faceMesh.send({ image: videoElement });
                    }
                },
                width: 320,
                height: 240,
                facingMode: 'user',
            });

            this.running = true;
            await this.mpCamera.start();
            return true;
        } catch (e) {
            this.callbacks.onError(e);
            return false;
        }
    }

    processResults(results) {
        if (!this.running) return;

        const faces = results.multiFaceLandmarks;
        if (!faces || faces.length === 0) {
            this.callbacks.onBlowing(false);
            return;
        }

        if (!this.ready) {
            this.ready = true;
            if (this.callbacks.onReady) this.callbacks.onReady();
        }

        const blowing = this.isBlowingPose(faces[0]);
        this.callbacks.onBlowing(blowing);

        if (blowing) {
            this.blowFrames++;
            if (this.blowFrames >= this.blowThreshold) {
                this.running = false;
                this.callbacks.onBlow();
            }
        } else {
            this.blowFrames = Math.max(0, this.blowFrames - 2);
        }
    }

    isBlowingPose(landmarks) {
        // Key mouth landmarks from MediaPipe Face Mesh (468 points)
        const upperInner = landmarks[13];   // inner upper lip center
        const lowerInner = landmarks[14];   // inner lower lip center
        const leftCorner = landmarks[78];   // left inner mouth corner
        const rightCorner = landmarks[308]; // right inner mouth corner

        const openY = Math.abs(lowerInner.y - upperInner.y);
        const width = Math.abs(rightCorner.x - leftCorner.x);

        if (width < 0.001) return false;

        const ratio = openY / width;

        // Blowing = mouth slightly open + puckered narrow lips
        // ratio > 0.25 means more circular than wide
        return openY > 0.01 && width < 0.15 && ratio > 0.25;
    }

    stop() {
        this.running = false;
        if (this.mpCamera) {
            this.mpCamera.stop();
        }
    }
}

/* ── Background Bokeh Particles ── */

class BokehBackground {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.particles = [];
        this.resize();
        window.addEventListener('resize', () => this.resize());
    }

    resize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    }

    init(count = 35) {
        const colors = [
            'rgba(255, 182, 193, 0.2)',
            'rgba(255, 105, 180, 0.15)',
            'rgba(233, 30, 140, 0.12)',
            'rgba(255, 192, 203, 0.18)',
            'rgba(219, 112, 147, 0.14)',
        ];
        for (let i = 0; i < count; i++) {
            this.particles.push({
                x: Math.random() * this.canvas.width,
                y: Math.random() * this.canvas.height,
                r: Math.random() * 40 + 10,
                color: colors[Math.floor(Math.random() * colors.length)],
                vx: (Math.random() - 0.5) * 0.3,
                vy: (Math.random() - 0.5) * 0.2,
                phase: Math.random() * Math.PI * 2,
            });
        }
    }

    draw(time) {
        const { ctx, canvas, particles } = this;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        for (const p of particles) {
            p.x += p.vx;
            p.y += p.vy + Math.sin(time * 0.001 + p.phase) * 0.15;
            if (p.x < -p.r) p.x = canvas.width + p.r;
            if (p.x > canvas.width + p.r) p.x = -p.r;
            if (p.y < -p.r) p.y = canvas.height + p.r;
            if (p.y > canvas.height + p.r) p.y = -p.r;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.fillStyle = p.color;
            ctx.fill();
        }
    }
}

/* ── Confetti ── */

class Confetti {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.particles = [];
        this.running = false;
        this.resize();
        window.addEventListener('resize', () => this.resize());
    }

    resize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    }

    launch(count = 150) {
        const colors = ['#ff69b4', '#ff1493', '#db7093', '#ff85a2', '#e91e8c', '#ffb6c1', '#c2185b', '#f8bbd9'];
        const cx = this.canvas.width / 2;
        const cy = this.canvas.height * 0.4;
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = Math.random() * 8 + 4;
            this.particles.push({
                x: cx, y: cy,
                vx: Math.cos(angle) * speed * (0.5 + Math.random()),
                vy: Math.sin(angle) * speed * (0.5 + Math.random()) - 4,
                w: Math.random() * 8 + 4,
                h: Math.random() * 6 + 3,
                color: colors[Math.floor(Math.random() * colors.length)],
                rotation: Math.random() * 360,
                rotSpeed: (Math.random() - 0.5) * 12,
                gravity: 0.12 + Math.random() * 0.08,
                opacity: 1,
                decay: 0.003 + Math.random() * 0.004,
            });
        }
        if (!this.running) {
            this.running = true;
            this.draw();
        }
    }

    draw() {
        if (!this.running) return;
        const { ctx, canvas, particles } = this;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            p.x += p.vx;
            p.vy += p.gravity;
            p.y += p.vy;
            p.vx *= 0.99;
            p.rotation += p.rotSpeed;
            p.opacity -= p.decay;
            if (p.opacity <= 0 || p.y > canvas.height + 20) {
                particles.splice(i, 1);
                continue;
            }
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate((p.rotation * Math.PI) / 180);
            ctx.globalAlpha = p.opacity;
            ctx.fillStyle = p.color;
            ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
            ctx.restore();
        }
        if (particles.length > 0) {
            requestAnimationFrame(() => this.draw());
        } else {
            this.running = false;
        }
    }
}

/* ── Main App ── */

class App {
    constructor() {
        this.music = new MusicBox();
        this.bokeh = new BokehBackground($('#bg-canvas'));
        this.confetti = new Confetti($('#confetti-canvas'));
        this.blowDetector = null;
        this.candlesLit = 3;
        this.cameraAvailable = false;

        this.bokeh.init();
        this.startRenderLoop();
        this.bindEvents();
    }

    startRenderLoop() {
        const loop = (time) => {
            this.bokeh.draw(time);
            requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
    }

    bindEvents() {
        $('#start-btn').addEventListener('click', () => this.startCelebration());
        $('#tap-blow-btn').addEventListener('click', () => this.onBlowDetected());
        $('#save-photo-btn').addEventListener('click', () => this.savePhoto());
        $('#skip-photo-btn').addEventListener('click', () => this.closePolaroidAndShowNote());
    }

    async startCelebration() {
        $('#landing').classList.remove('active');
        await this.sleep(600);
        $('#cake-screen').classList.add('active');

        this.music.play();

        await this.sleep(800);
        await this.startFaceDetection();
    }

    async startFaceDetection() {
        const video = $('#camera-feed');
        const statusEl = $('#camera-status');
        const cameraArea = $('#camera-area');

        this.blowDetector = new FaceBlowDetector({
            onBlow: () => this.onBlowDetected(),
            onBlowing: (active) => {
                $('#camera-bubble').classList.toggle('blowing', active);
            },
            onReady: () => {
                statusEl.textContent = 'Blow out the candles!';
            },
            onError: () => {
                cameraArea.classList.add('hidden');
                $('#tap-blow-btn').classList.remove('hidden');
            },
        });

        statusEl.textContent = 'Loading face detection…';
        const ok = await this.blowDetector.start(video);

        if (ok) {
            this.cameraAvailable = true;
        } else {
            cameraArea.classList.add('hidden');
            $('#tap-blow-btn').classList.remove('hidden');
        }
    }

    async onBlowDetected() {
        if (this.candlesLit <= 0) return;

        if (this.blowDetector) this.blowDetector.running = false;
        $('#camera-area').classList.add('hidden');
        $('#tap-blow-btn').classList.add('hidden');

        const indices = [0, 1, 2].sort(() => Math.random() - 0.5);

        for (const i of indices) {
            $(`#candle-${i}`).classList.add('blown');
            this.candlesLit--;
            await this.sleep(250 + Math.random() * 200);
        }

        $('.candle-glow').classList.add('off');
        this.music.stop();

        await this.sleep(800);

        if (this.cameraAvailable) {
            await this.doPolaroidSequence();
        } else {
            await this.sleep(600);
            this.showNote();
        }
    }

    /* ── Polaroid Capture Sequence ── */

    async doPolaroidSequence() {
        const overlay = $('#polaroid-overlay');
        const cam = $('#pol-cam');
        const flash = $('#polaroid-flash');
        const scene = $('#polaroid-scene');
        const viewfinder = $('#cam-viewfinder');
        const countdownEl = $('#countdown');

        const video = $('#camera-feed');
        viewfinder.appendChild(video);

        overlay.classList.remove('hidden');
        await this.sleep(100);
        overlay.classList.add('visible');

        await this.sleep(300);
        cam.classList.add('fly-in');

        await this.sleep(2000);

        for (const n of [3, 2, 1]) {
            countdownEl.textContent = n;
            countdownEl.classList.remove('show');
            void countdownEl.offsetWidth;
            countdownEl.classList.add('show');
            await this.sleep(900);
        }

        countdownEl.classList.remove('show');
        countdownEl.textContent = '';

        this.capturePhoto();

        flash.classList.add('active');
        this.playShutterSound();

        await this.sleep(400);
        cam.classList.add('fly-out');

        await this.sleep(800);

        if (this.blowDetector) this.blowDetector.stop();

        this.addCCDTimestamp();
        scene.classList.add('active');
    }

    capturePhoto() {
        const video = $('#camera-feed');
        const canvas = $('#polaroid-canvas');

        const vw = video.videoWidth || 320;
        const vh = video.videoHeight || 240;
        const size = Math.min(vw, vh);

        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');

        const sx = (vw - size) / 2;
        const sy = (vh - size) / 2;

        ctx.save();
        ctx.translate(size, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(video, sx, sy, size, size, 0, 0, size, size);
        ctx.restore();

        this.applyCCDFilter(ctx, size, size);
    }

    applyCCDFilter(ctx, w, h) {
        const imageData = ctx.getImageData(0, 0, w, h);
        const d = imageData.data;

        for (let i = 0; i < d.length; i += 4) {
            let r = d[i], g = d[i + 1], b = d[i + 2];

            r = r * 1.05 + 5;
            g = g * 1.08 + 8;
            b = b * 1.15 + 15;

            const lum = r * 0.299 + g * 0.587 + b * 0.114;
            const contrast = 1.3;
            r = ((r - 128) * contrast + 128);
            g = ((g - 128) * contrast + 128);
            b = ((b - 128) * contrast + 128);

            r = Math.min(245, r);
            b = Math.min(255, b + 10);

            const noise = (Math.random() - 0.5) * 18;
            d[i]     = Math.min(255, Math.max(0, r + noise));
            d[i + 1] = Math.min(255, Math.max(0, g + noise));
            d[i + 2] = Math.min(255, Math.max(0, b + noise));
        }

        ctx.putImageData(imageData, 0, 0);

        const cx = w / 2, cy = h / 2;
        const grad = ctx.createRadialGradient(cx, cy, w * 0.35, cx, cy, w * 0.72);
        grad.addColorStop(0, 'rgba(0,0,0,0)');
        grad.addColorStop(1, 'rgba(0,0,20,0.25)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);

        ctx.fillStyle = 'rgba(0, 180, 255, 0.04)';
        ctx.fillRect(0, 0, w, h);
    }

    addCCDTimestamp() {
        const photo = document.querySelector('.polaroid-photo');
        const existing = photo.querySelector('.ccd-timestamp');
        if (existing) existing.remove();

        const stamp = document.createElement('span');
        stamp.className = 'ccd-timestamp';
        const now = new Date();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const y = now.getFullYear();
        const h = String(now.getHours()).padStart(2, '0');
        const min = String(now.getMinutes()).padStart(2, '0');
        stamp.textContent = `${m}.${day}.${y}  ${h}:${min}`;
        photo.appendChild(stamp);
    }

    async savePhoto() {
        const photoCanvas = $('#polaroid-canvas');
        const pad = 24;
        const bottomPad = 70;
        const cw = photoCanvas.width + pad * 2;
        const ch = photoCanvas.height + pad + bottomPad;

        const out = document.createElement('canvas');
        out.width = cw;
        out.height = ch;
        const ctx = out.getContext('2d');

        ctx.fillStyle = '#faf5e4';
        ctx.fillRect(0, 0, cw, ch);

        ctx.drawImage(photoCanvas, pad, pad);

        const now = new Date();
        const ts = `${String(now.getMonth()+1).padStart(2,'0')}.${String(now.getDate()).padStart(2,'0')}.${now.getFullYear()}  ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
        ctx.fillStyle = '#ff6a00';
        ctx.font = 'bold 14px Courier New, monospace';
        ctx.textAlign = 'right';
        ctx.shadowColor = 'rgba(255, 106, 0, 0.5)';
        ctx.shadowBlur = 4;
        ctx.fillText(ts, pad + photoCanvas.width - 10, pad + photoCanvas.height - 12);
        ctx.shadowBlur = 0;

        ctx.fillStyle = '#5c3d4a';
        ctx.font = 'italic 28px Georgia, serif';
        ctx.textAlign = 'center';
        ctx.fillText('Happy Birthday!', cw / 2, ch - 20);

        const blob = await new Promise(r => out.toBlob(r, 'image/png'));

        if (navigator.share && navigator.canShare) {
            const file = new File([blob], 'birthday-polaroid.png', { type: 'image/png' });
            if (navigator.canShare({ files: [file] })) {
                try { await navigator.share({ files: [file] }); return; } catch (_) {}
            }
        }

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'birthday-polaroid.png';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    closePolaroidAndShowNote() {
        if (this.blowDetector) this.blowDetector.stop();
        const overlay = $('#polaroid-overlay');
        overlay.classList.remove('visible');
        setTimeout(() => overlay.classList.add('hidden'), 800);
        this.showNote();
    }

    playShutterSound() {
        try {
            const ctx = this.music.ctx || new (window.AudioContext || window.webkitAudioContext)();
            if (ctx.state === 'suspended') ctx.resume();

            const dur = 0.12;
            const bufSize = ctx.sampleRate * dur;
            const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
            const data = buf.getChannelData(0);

            for (let i = 0; i < bufSize; i++) {
                data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufSize * 0.08));
            }

            const src = ctx.createBufferSource();
            src.buffer = buf;
            const gain = ctx.createGain();
            gain.gain.value = 0.25;
            const hp = ctx.createBiquadFilter();
            hp.type = 'highpass';
            hp.frequency.value = 2500;
            src.connect(hp);
            hp.connect(gain);
            gain.connect(ctx.destination);
            src.start();
        } catch (_) {}
    }

    async showNote() {
        const overlay = $('#note-overlay');
        const card = $('#note-card');

        overlay.classList.remove('hidden');
        await this.sleep(50);
        overlay.classList.add('visible');
        await this.sleep(300);
        card.classList.add('open');

        await this.sleep(800);
        this.confetti.launch(200);
        await this.sleep(1500);
        this.confetti.launch(80);
    }

    sleep(ms) {
        return new Promise((r) => setTimeout(r, ms));
    }
}

/* ── Boot ── */
document.addEventListener('DOMContentLoaded', () => new App());
