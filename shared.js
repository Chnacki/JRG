/* ===================== PSP JRG 4 — stan, dźwięk, synchronizacja lokalna ===================== */
/* Synchronizacja działa między kartami/oknami TEJ SAMEJ przeglądarki (BroadcastChannel + localStorage),
   bez żadnego zewnętrznego serwera ani konta. */

const CH_NAME = 'psp_jrg4_channel_v2';
const LS_KEY  = 'psp_jrg4_state_v2';

const defaultState = () => ({
  nawiew: false,
  oswietlenie: [false, false, false],
  spalin: [false, false, false, false, false],
  wyswietlacze: [false, false, false, false, false, false, false, false, false, false],
  alarm: { pending: [], active: [] }
});

function sanitizeState(s) {
  const d = defaultState();
  const out = { ...d, ...s };
  out.oswietlenie = Array.isArray(s && s.oswietlenie) ? s.oswietlenie : d.oswietlenie;
  out.spalin = Array.isArray(s && s.spalin) ? s.spalin : d.spalin;
  out.wyswietlacze = Array.isArray(s && s.wyswietlacze) ? s.wyswietlacze : d.wyswietlacze;
  const a = (s && s.alarm) ? s.alarm : {};
  out.alarm = {
    pending: Array.isArray(a.pending) ? a.pending : [],
    active: Array.isArray(a.active) ? a.active : []
  };
  return out;
}

function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return sanitizeState(JSON.parse(raw));
  } catch (e) {}
  return defaultState();
}

function saveState(state) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) {}
}

let channel = null;
try {
  if ('BroadcastChannel' in window) channel = new BroadcastChannel(CH_NAME);
} catch (e) {
  console.warn('BroadcastChannel niedostępny w tej przeglądarce/kontekście.', e);
  channel = null;
}

function broadcastState(state) {
  saveState(state);
  if (channel) { try { channel.postMessage({ type: 'state', state }); } catch (e) {} }
}

function broadcastSound(name) {
  if (channel) { try { channel.postMessage({ type: 'sound', name }); } catch (e) {} }
}

function onRemoteMessage(handlers) {
  if (channel) {
    channel.onmessage = (ev) => {
      const msg = ev.data;
      if (!msg) return;
      if (msg.type === 'state' && handlers.onState) handlers.onState(msg.state);
      if (msg.type === 'sound' && handlers.onSound) handlers.onSound(msg.name);
      if (msg.type === 'mic' && handlers.onMic) handlers.onMic(msg);
    };
  }
  window.addEventListener('storage', (e) => {
    if (e.key === LS_KEY && e.newValue && handlers.onState) {
      try { handlers.onState(JSON.parse(e.newValue)); } catch (err) {}
    }
  });
}

function playLocalSound(name, audioEls) {
  const el = audioEls[name];
  if (!el) return;
  try { el.currentTime = 0; el.play().catch((e) => console.warn('Nie udało się odtworzyć dźwięku', name, e)); } catch (e) {}
}

/* ---------- Mikrofon: strumieniowanie surowego audio między kartami tej samej przeglądarki ---------- */
const MicBroadcaster = {
  ctx: null, stream: null, source: null, processor: null, gain: null, active: false,
  async start() {
    if (this.active) return;
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.processor = this.ctx.createScriptProcessor(4096, 1, 1);
    this.gain = this.ctx.createGain();
    this.gain.gain.value = 0;
    this.source.connect(this.processor);
    this.processor.connect(this.gain);
    this.gain.connect(this.ctx.destination);
    this.processor.onaudioprocess = (e) => {
      const data = new Float32Array(e.inputBuffer.getChannelData(0));
      if (channel) { try { channel.postMessage({ type: 'mic', samples: data, sampleRate: this.ctx.sampleRate }); } catch (er) {} }
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
