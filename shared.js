const LS_KEY = 'psp_jrg4_state_v3';

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

function saveStateLocal(state) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) {}
}

function playLocalSound(name, audioEls) {
  const el = audioEls[name];
  if (!el) return;
  try { el.currentTime = 0; el.play().catch((e) => console.warn('Nie udało się odtworzyć dźwięku', name, e)); } catch (e) {}
}
