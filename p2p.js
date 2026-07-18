/* ===================== PSP JRG 4 — warstwa P2P (WebRTC, PeerJS) ===================== */
/* Wymaga wczytanego wcześniej: <script src="https://unpkg.com/peerjs@1.5.2/dist/peerjs.min.js"></script> */

const ICE_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' }
  ]
};

const ROOM = 'jrg4-fordon'; // stały, wspólny dla panelu i wyświetlacza - nie trzeba nic wpisywać
function hostIdFor(room) {
  return 'pspjrg4-' + room + '-panel';
}

const P2P = {
  peer: null,
  conns: [],      // (host) połączenia danych z podłączonymi wyświetlaczami
  calls: [],      // (host) aktywne połączenia audio (mikrofon) do wyświetlaczy
  room: null,
  role: null,     // 'host' | 'client'

  /* === PANEL (host) === */
  initHost(room, handlers) {
    this.room = room; this.role = 'host';
    this.peer = new Peer(hostIdFor(room), { config: ICE_CONFIG });
    this.peer.on('open', () => { handlers.onStatus && handlers.onStatus('online'); });
    this.peer.on('connection', (conn) => {
      this.conns.push(conn);
      handlers.onStatus && handlers.onStatus('connected');
      conn.on('open', () => {
        if (handlers.getState) conn.send({ type: 'state', state: handlers.getState() });
      });
      conn.on('close', () => {
        this.conns = this.conns.filter(c => c !== conn);
        if (this.conns.length === 0) handlers.onStatus && handlers.onStatus('online');
      });
    });
    this.peer.on('error', (e) => { console.warn('PeerJS error:', e); handlers.onStatus && handlers.onStatus('error'); });
    this.peer.on('disconnected', () => { handlers.onStatus && handlers.onStatus('offline'); });
  },
  broadcastState(state) {
    this.conns.forEach(c => { try { c.send({ type: 'state', state }); } catch (e) {} });
  },
  broadcastSound(name) {
    this.conns.forEach(c => { try { c.send({ type: 'sound', name }); } catch (e) {} });
  },
  async startMic() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this._micStream = stream;
    this.conns.forEach(c => {
      try {
        const call = this.peer.call(c.peer, stream);
        if (call) this.calls.push(call);
      } catch (e) {}
    });
    return stream;
  },
  stopMic() {
    this.calls.forEach(c => { try { c.close(); } catch (e) {} });
    this.calls = [];
    if (this._micStream) { this._micStream.getTracks().forEach(t => t.stop()); this._micStream = null; }
  },

  /* === WYŚWIETLACZ (client) === */
  initClient(room, handlers) {
    this.room = room; this.role = 'client';
    this.peer = new Peer({ config: ICE_CONFIG });
    this.peer.on('open', () => {
      const conn = this.peer.connect(hostIdFor(room));
      this.conns = [conn];
      handlers.onStatus && handlers.onStatus('connecting');
      conn.on('open', () => { handlers.onStatus && handlers.onStatus('connected'); });
      conn.on('data', (data) => {
        if (!data) return;
        if (data.type === 'state' && handlers.onState) handlers.onState(data.state);
        if (data.type === 'sound' && handlers.onSound) handlers.onSound(data.name);
      });
      conn.on('close', () => { handlers.onStatus && handlers.onStatus('disconnected'); });
    });
    this.peer.on('call', (call) => {
      call.answer(); // odbieramy strumień mikrofonu z panelu
      call.on('stream', (remoteStream) => { handlers.onMicStream && handlers.onMicStream(remoteStream); });
    });
    this.peer.on('error', (e) => { console.warn('PeerJS error:', e); handlers.onStatus && handlers.onStatus('error'); });
    this.peer.on('disconnected', () => { handlers.onStatus && handlers.onStatus('offline'); });
  }
};
