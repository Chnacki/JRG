/* ===================== PSP JRG 4 — wspólna logika ===================== */
const CH_NAME = 'psp_jrg4_channel';
const LS_KEY  = 'psp_jrg4_state_v1';

const defaultState = () => ({
  nawiew: false,
  oswietlenie: [false, false, false],
  spalin: [false, false, false, false, false],
  wyswietlacze: [false, false, false, false, false, false, false, false, false, false],
  alarm: { pending: null, active: null } // pending = miga (wybrane, nie zatwierdzone), active = zatwierdzone (WYKONAJ)
});

function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return { ...defaultState(), ...JSON.parse(raw) };
  } catch (e) {}
  return defaultState();
}

function saveState(state) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) {}
}

const channel = ('BroadcastChannel' in window) ? new BroadcastChannel(CH_NAME) : null;

function broadcastState(state) {
  saveState(state);
  if (channel) channel.postMessage({ type: 'state', state });
}

function broadcastSound(name) {
  if (channel) channel.postMessage({ type: 'sound', name });
}

function onRemoteMessage(handlers) {
  if (!channel) return;
  channel.onmessage = (ev) => {
    const msg = ev.data;
    if (!msg) return;
    if (msg.type === 'state' && handlers.onState) handlers.onState(msg.state);
    if (msg.type === 'sound' && handlers.onSound) handlers.onSound(msg.name);
    if (msg.type === 'mic' && handlers.onMic) handlers.onMic(msg);
    if (msg.type === 'mic-stop' && handlers.onMicStop) handlers.onMicStop();
  };
  // reakcja na zmiany w localStorage z innej karty (fallback / redundancja)
  window.addEventListener('storage', (e) => {
    if (e.key === LS_KEY && e.newValue && handlers.onState) {
      try { handlers.onState(JSON.parse(e.newValue)); } catch (err) {}
    }
  });
}

/* ---------- Dźwięki lokalne (odtwarzane też po odebraniu broadcastu) ---------- */
function playLocalSound(name, audioEls) {
  const el = audioEls[name];
  if (!el) return;
  try { el.currentTime = 0; el.play().catch(() => {}); } catch (e) {}
}

/* ---------- Mikrofon — strumieniowanie PCM między kartami tej samej przeglądarki ---------- */
const MicBroadcaster = {
  ctx: null, stream: null, source: null, processor: null, gain: null, active: false,
  async start() {
    if (this.active) return;
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.processor = this.ctx.createScriptProcessor(4096, 1, 1);
    this.gain = this.ctx.createGain();
    this.gain.gain.value = 0; // nie odtwarzamy lokalnie na głośniku (unikamy sprzężenia)
    this.source.connect(this.processor);
    this.processor.connect(this.gain);
    this.gain.connect(this.ctx.destination);
    this.processor.onaudioprocess = (e) => {
      const data = new Float32Array(e.inputBuffer.getChannelData(0));
      if (channel) channel.postMessage({ type: 'mic', samples: data, sampleRate: this.ctx.sampleRate });
    };
    this.active = true;
  },
  stop() {
    if (!this.active) return;
    try {
      this.processor && this.processor.disconnect();
      this.source && this.source.disconnect();
      this.gain && this.gain.disconnect();
      this.stream && this.stream.getTracks().forEach(t => t.stop());
      this.ctx && this.ctx.close();
    } catch (e) {}
    this.active = false;
    if (channel) channel.postMessage({ type: 'mic-stop' });
  }
};

const MicReceiver = {
  ctx: null, nextTime: 0,
  play(msg) {
    if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    const buf = this.ctx.createBuffer(1, msg.samples.length, msg.sampleRate);
    buf.copyToChannel(msg.samples, 0);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.ctx.destination);
    const now = this.ctx.currentTime;
    if (this.nextTime < now) this.nextTime = now + 0.05;
    src.start(this.nextTime);
    this.nextTime += buf.duration;
  }
};
