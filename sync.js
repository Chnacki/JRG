/* ===================== PSP JRG 4 — synchronizacja przez Supabase Realtime ===================== */
/* Wymaga wcześniej wczytanych: supabase-js (CDN) oraz config.js z SUPABASE_URL / SUPABASE_ANON_KEY */

const ROOM_NAME = 'psp-jrg4-fordon'; // stały, wspólny kanał dla panelu i wyświetlacza

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const roomChannel = supabaseClient.channel(ROOM_NAME, { config: { broadcast: { self: false, ack: false } } });

let _subscribed = false;
let _pendingState = null;
let _pendingSoundQueue = [];

let syncStatusCallback = null;
function setSyncStatusCallback(fn) { syncStatusCallback = fn; }

function _ensureSubscribed() {
  if (_subscribed) return;
  _subscribed = true;
  roomChannel.subscribe((status) => {
    console.log('Supabase Realtime status:', status);
    if (syncStatusCallback) syncStatusCallback(status);
  });
}

function broadcastState(state) {
  _ensureSubscribed();
  if (typeof saveStateLocal === 'function') saveStateLocal(state);
  try { roomChannel.send({ type: 'broadcast', event: 'state', payload: { state } }); } catch (e) { console.warn(e); }
}

function broadcastSound(name) {
  _ensureSubscribed();
  try { roomChannel.send({ type: 'broadcast', event: 'sound', payload: { name } }); } catch (e) { console.warn(e); }
}

function onRemoteMessage(handlers) {
  roomChannel.on('broadcast', { event: 'state' }, ({ payload }) => {
    if (handlers.onState && payload && payload.state) handlers.onState(payload.state);
  });
  roomChannel.on('broadcast', { event: 'sound' }, ({ payload }) => {
    if (handlers.onSound && payload && payload.name) handlers.onSound(payload.name);
  });
  roomChannel.on('broadcast', { event: 'mic-chunk' }, ({ payload }) => {
    if (payload && payload.data) MicReceiver.push(payload.data, payload.mime);
  });
  _ensureSubscribed();
}

/* ---------- Konwersja ArrayBuffer <-> base64 ---------- */
function _abToBase64(buf) {
  let binary = '';
  const bytes = new Uint8Array(buf);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
function _base64ToAb(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/* ---------- Mikrofon (nadawanie): nagrywanie i wysyłanie małych fragmentów audio ---------- */
const MicBroadcaster = {
  stream: null, recorder: null, active: false, mime: 'audio/webm;codecs=opus',
  async start() {
    if (this.active) return;
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (!MediaRecorder.isTypeSupported(this.mime)) this.mime = 'audio/webm';
    this.recorder = new MediaRecorder(this.stream, { mimeType: this.mime });
    this.recorder.ondataavailable = async (e) => {
      if (e.data && e.data.size > 0) {
        const buf = await e.data.arrayBuffer();
        const b64 = _abToBase64(buf);
        _ensureSubscribed();
        try { roomChannel.send({ type: 'broadcast', event: 'mic-chunk', payload: { data: b64, mime: this.mime } }); } catch (er) {}
      }
    };
    this.recorder.start(250); // fragment co 250ms
    this.active = true;
  },
  stop() {
    if (!this.active) return;
    try { this.recorder && this.recorder.stop(); } catch (e) {}
    try { this.stream && this.stream.getTracks().forEach(t => t.stop()); } catch (e) {}
    this.active = false;
  }
};

/* ---------- Mikrofon (odbiór): odtwarzanie fragmentów przez MediaSource ---------- */
const MicReceiver = {
  mediaSource: null, sourceBuffer: null, audioEl: null, queue: [], ready: false, mime: 'audio/webm;codecs=opus',

  _ensureInit(mime) {
    if (this.mediaSource) return;
    this.mime = mime || this.mime;
    this.audioEl = document.createElement('audio');
    this.audioEl.autoplay = true;
    document.body.appendChild(this.audioEl);
    this.mediaSource = new MediaSource();
    this.audioEl.src = URL.createObjectURL(this.mediaSource);
    this.mediaSource.addEventListener('sourceopen', () => {
      try {
        this.sourceBuffer = this.mediaSource.addSourceBuffer(this.mime);
        this.sourceBuffer.mode = 'sequence';
        this.sourceBuffer.addEventListener('updateend', () => this._pump());
        this.ready = true;
        this._pump();
      } catch (e) { console.warn('MediaSource init error', e); }
    });
  },
  push(base64, mime) {
    this._ensureInit(mime);
    this.queue.push(_base64ToAb(base64));
    this._pump();
  },
  _pump() {
    if (!this.ready || !this.sourceBuffer || this.sourceBuffer.updating) return;
    if (this.queue.length === 0) return;
    const chunk = this.queue.shift();
    try { this.sourceBuffer.appendBuffer(chunk); } catch (e) { console.warn('appendBuffer error', e); }
  }
};
