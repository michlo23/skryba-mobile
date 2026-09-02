/* Skryba mobile — record, send to ElevenLabs Scribe, get text back.
 *
 * No backend: Scribe answers browser requests with `access-control-allow-origin: *`,
 * so the phone talks to it directly and the key lives in localStorage on the
 * device. That is the whole reason this can be a plain static page.
 */

const VERSION = '1.0.0';
const ENDPOINT = 'https://api.elevenlabs.io/v1/speech-to-text';
const MODEL = 'scribe_v2';
const MAX_SECONDS = 15 * 60; // same safety valve as the desktop app
const MAX_NOTES = 300;
const BARS = 15;

const LANGS = {
  pl: { label: 'Polski', badge: 'PL' },
  en: { label: 'English', badge: 'EN' },
};

/* ---------------------------------------------------------------- storage */

const store = {
  get key() { return localStorage.getItem('skryba.key') || ''; },
  set key(v) { localStorage.setItem('skryba.key', v); },

  get lang() { return LANGS[localStorage.getItem('skryba.lang')] ? localStorage.getItem('skryba.lang') : 'pl'; },
  set lang(v) { localStorage.setItem('skryba.lang', v); },

  flag(name, fallback) {
    const raw = localStorage.getItem('skryba.' + name);
    return raw === null ? fallback : raw === '1';
  },
  setFlag(name, on) { localStorage.setItem('skryba.' + name, on ? '1' : '0'); },

  notes() {
    try { return JSON.parse(localStorage.getItem('skryba.notes') || '[]'); }
    catch { return []; }
  },
  saveNotes(list) {
    localStorage.setItem('skryba.notes', JSON.stringify(list.slice(0, MAX_NOTES)));
  },
  addNote(note) {
    const list = store.notes();
    list.unshift(note);
    store.saveNotes(list);
    return list;
  },
  removeNote(id) {
    const list = store.notes().filter((n) => n.id !== id);
    store.saveNotes(list);
    return list;
  },
};

/* -------------------------------------------------------------- utilities */

const $ = (sel) => document.querySelector(sel);

function clock(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function when(iso) {
  const then = new Date(iso);
  const mins = Math.round((Date.now() - then.getTime()) / 60000);
  if (mins < 1) return 'przed chwilą';
  if (mins < 60) return `${mins} min temu`;
  const today = new Date().toDateString() === then.toDateString();
  const time = then.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
  if (today) return `dziś ${time}`;
  return `${then.toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' })} ${time}`;
}

let toastTimer;
function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
}

/** Clipboard writes are blocked outside a gesture on some browsers; the
 *  textarea fallback still works there, so try both before giving up. */
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch { /* fall through */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------ transcriber */

/** The audio container the browser will actually give us. Safari records
 *  mp4/AAC, Chrome and Firefox webm/Opus — Scribe accepts all of them, it
 *  just needs a matching filename and content type. */
function pickFormat() {
  const candidates = [
    ['audio/mp4', 'm4a'],
    ['audio/mp4;codecs=mp4a.40.2', 'm4a'],
    ['audio/webm;codecs=opus', 'webm'],
    ['audio/webm', 'webm'],
    ['audio/ogg;codecs=opus', 'ogg'],
  ];
  for (const [mime, ext] of candidates) {
    if (window.MediaRecorder?.isTypeSupported?.(mime)) return { mime, ext };
  }
  return { mime: '', ext: 'bin' }; // let the browser choose
}

/** HTTP header values must be printable ASCII. A key copied from a web page
 *  can carry a zero-width space or a BOM, which makes the request arrive with
 *  no `xi-api-key` at all — the server then complains about a missing header,
 *  which reads like a bad key but isn't. Same guard as the macOS app. */
function headerSafe(key) {
  return Array.from(key).filter((c) => {
    const code = c.codePointAt(0);
    return code > 0x20 && code < 0x7f;
  }).join('');
}

async function transcribe(blob, lang, ext) {
  const key = headerSafe(store.key);
  if (!key) throw new Error('Brak klucza ElevenLabs');

  const form = new FormData();
  form.append('model_id', MODEL);
  form.append('language_code', lang);
  form.append('tag_audio_events', 'false');
  form.append('timestamps_granularity', 'none');
  form.append('file', blob, `skryba.${ext}`);

  let response;
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'xi-api-key': key },
      body: form,
    });
  } catch {
    throw new Error('Brak połączenia z ElevenLabs');
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new Error('Klucz ElevenLabs odrzucony');
    if (response.status === 429) throw new Error('ElevenLabs: limit zapytań');
    if (response.status === 413) throw new Error('Nagranie za duże dla ElevenLabs');
    throw new Error(`ElevenLabs zwrócił błąd ${response.status}`);
  }

  const data = await response.json();
  const text = (data.text || '').trim();
  if (!text) throw new Error('Nic nie usłyszałem');
  return { text, detected: data.language_code || null };
}

/** Cheapest way to tell a working key from a typo, without spending a
 *  transcription. Scoped `sk_…` keys get 401 `missing_permissions` on
 *  /v1/user while transcribing perfectly well — that counts as a pass. */
async function validateKey(raw) {
  const key = headerSafe(raw);
  if (!key) return { ok: false, message: 'Klucz nie zawiera żadnego dopuszczalnego znaku' };

  let response;
  try {
    response = await fetch('https://api.elevenlabs.io/v1/user', { headers: { 'xi-api-key': key } });
  } catch {
    return { ok: false, message: 'Brak połączenia z ElevenLabs' };
  }
  if (response.ok) return { ok: true, message: 'Klucz działa ✓' };

  const body = await response.text();
  if ((response.status === 401 || response.status === 403) && /permission/i.test(body)) {
    return { ok: true, message: 'Klucz przyjęty ✓ (bez uprawnienia user_read — do transkrypcji wystarczy)' };
  }
  if (response.status === 401 || response.status === 403) {
    return { ok: false, message: 'Odrzucony przez ElevenLabs' };
  }
  return { ok: false, message: `ElevenLabs ${response.status}` };
}

/* --------------------------------------------------------------- recorder */

const rec = {
  recorder: null,
  stream: null,
  audio: null,
  chunks: [],
  format: pickFormat(),
  startedAt: 0,
  timer: null,
  frame: null,
  history: new Array(BARS).fill(0),
  wakeLock: null,
  stopping: false,

  get active() { return this.recorder?.state === 'recording'; },

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    this.chunks = [];
    this.stopping = false;
    this.recorder = new MediaRecorder(
      this.stream,
      this.format.mime ? { mimeType: this.format.mime, audioBitsPerSecond: 48000 } : {}
    );
    this.recorder.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); };
    this.recorder.start();
    this.startedAt = Date.now();

    this.meter();
    this.timer = setInterval(() => {
      const elapsed = (Date.now() - this.startedAt) / 1000;
      ui.status(`${clock(elapsed)} — dotknij, żeby skończyć`, 'live');
      if (elapsed >= MAX_SECONDS) ui.stop(); // safety valve
    }, 250);

    // Keep the screen awake: a locked screen suspends the page and kills the
    // recording mid-sentence.
    try { this.wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* optional */ }
  },

  /** Resolves with the finished clip, or null if nothing usable was captured. */
  stop() {
    return new Promise((resolve) => {
      if (!this.recorder || this.stopping) return resolve(null);
      this.stopping = true;

      clearInterval(this.timer);
      cancelAnimationFrame(this.frame);
      this.audio?.close().catch(() => {});
      this.audio = null;
      document.body.style.removeProperty('--level-scale');

      const seconds = (Date.now() - this.startedAt) / 1000;
      this.recorder.onstop = () => {
        const type = this.recorder.mimeType || this.format.mime || 'audio/webm';
        const blob = new Blob(this.chunks, { type });
        this.stream.getTracks().forEach((t) => t.stop());
        this.stream = null;
        this.recorder = null;
        this.wakeLock?.release().catch(() => {});
        this.wakeLock = null;
        resolve(blob.size > 1000 ? { blob, seconds } : null);
      };
      this.recorder.stop();
    });
  },

  /** Rolling waveform: one new sample per frame, pushed through a short
   *  history so the bars read as a scrolling trace rather than a VU meter. */
  meter() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.audio = new Ctx();
    const analyser = this.audio.createAnalyser();
    analyser.fftSize = 256;
    this.audio.createMediaStreamSource(this.stream).connect(analyser);

    const buffer = new Uint8Array(analyser.fftSize);
    const bars = [...document.querySelectorAll('#meter i')];
    let last = 0;

    const tick = (now) => {
      this.frame = requestAnimationFrame(tick);
      if (now - last < 55) return; // ~18 fps is plenty and saves battery
      last = now;

      analyser.getByteTimeDomainData(buffer);
      let sum = 0;
      for (const sample of buffer) {
        const centred = (sample - 128) / 128;
        sum += centred * centred;
      }
      const rms = Math.sqrt(sum / buffer.length);
      // dBFS → 0…1 on the same curve the macOS app uses, so speech is visible.
      const db = Math.max(20 * Math.log10(rms || 1e-5), -60);
      const level = Math.min(Math.max(Math.pow((db + 60) / 60, 1.6), 0), 1);

      this.history.push(level);
      this.history.shift();
      bars.forEach((bar, i) => {
        bar.style.height = `${3 + this.history[i] * 23}px`;
      });
      document.body.style.setProperty('--level-scale', String(1 + level * 0.1));
    };
    this.frame = requestAnimationFrame(tick);
  },
};

/* --------------------------------------------------------------------- UI */

const ui = {
  lang: store.lang,
  pending: null, // a clip captured but not yet transcribed (app went to background)

  init() {
    const meter = $('#meter');
    for (let i = 0; i < BARS; i++) meter.appendChild(document.createElement('i'));

    this.setLang(store.lang);
    document.querySelectorAll('.lang').forEach((btn) => {
      btn.addEventListener('click', () => this.setLang(btn.dataset.lang));
    });

    $('#rec').addEventListener('click', () => this.toggle());
    $('#copy').addEventListener('click', () => this.copyResult());
    $('#dismiss').addEventListener('click', () => { $('#result').hidden = true; });
    $('#share').addEventListener('click', () => this.shareResult());
    if (!navigator.share) $('#share').hidden = true;

    $('#export').addEventListener('click', () => this.exportNotes());
    $('#open-settings').addEventListener('click', () => this.settings(true));
    $('#close-settings').addEventListener('click', () => this.settings(false));
    $('#scrim').addEventListener('click', () => this.settings(false));
    this.wireSettings();

    this.renderNotes();
    $('#version').textContent = `Skryba ${VERSION}`;
    $('#autostart-url').textContent =
      `${location.origin}${location.pathname.replace(/index\.html$/, '')}?rec=1`;

    // A clip recorded before the app was backgrounded still deserves its text.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && rec.active) {
        this.stop({ deferred: true });
      } else if (!document.hidden && this.pending) {
        const clip = this.pending;
        this.pending = null;
        this.send(clip);
      }
    });

    if (!store.key) {
      this.settings(true);
      this.status('Najpierw wklej klucz ElevenLabs');
      return;
    }

    const wanted = new URLSearchParams(location.search).has('rec') || store.flag('autostart', false);
    if (wanted) this.toggle({ auto: true });
  },

  setLang(lang) {
    this.lang = LANGS[lang] ? lang : 'pl';
    store.lang = this.lang;
    document.querySelectorAll('.lang').forEach((btn) => {
      btn.setAttribute('aria-pressed', String(btn.dataset.lang === this.lang));
    });
    $('#default-lang').value = this.lang;
  },

  status(text, kind = '') {
    const el = $('#status');
    el.textContent = text;
    el.className = `status ${kind}`;
  },

  async toggle({ auto = false } = {}) {
    if (rec.active) return this.stop();

    if (!store.key) {
      this.settings(true);
      return this.status('Najpierw wklej klucz ElevenLabs', 'error');
    }

    try {
      await rec.start();
      document.body.classList.add('recording');
      $('#rec').setAttribute('aria-label', 'Skończ nagrywać');
      $('#result').hidden = true;
      navigator.vibrate?.(12);
    } catch (error) {
      const denied = error?.name === 'NotAllowedError' || error?.name === 'SecurityError';
      // Starting without a tap is a best-effort convenience: some browsers only
      // hand over the mic inside a gesture, and there the button still works.
      if (auto && denied) return this.status('Dotknij, żeby dyktować');
      this.status(denied ? 'Brak dostępu do mikrofonu' : 'Nie udało się uruchomić nagrywania', 'error');
    }
  },

  async stop({ deferred = false } = {}) {
    const clip = await rec.stop();
    document.body.classList.remove('recording');
    $('#rec').setAttribute('aria-label', 'Zacznij nagrywać');
    navigator.vibrate?.(12);

    if (!clip) return this.status('Za krótkie nagranie');
    if (deferred) {
      this.pending = clip;
      return this.status('Nagranie zapisane — wróć do apki, żeby je przepisać');
    }
    return this.send(clip);
  },

  async send(clip) {
    document.body.classList.add('busy');
    this.status('Przepisuję…');
    try {
      const { text, detected } = await transcribe(clip.blob, this.lang, rec.format.ext);
      const note = {
        id: crypto.randomUUID(),
        text,
        lang: detected || this.lang,
        seconds: Math.round(clip.seconds),
        created: new Date().toISOString(),
      };
      store.addNote(note);
      this.renderNotes();
      this.showResult(note);
      this.status('Dotknij, żeby dyktować');
      navigator.vibrate?.([12, 60, 12]);
    } catch (error) {
      this.status(error.message, 'error');
    } finally {
      document.body.classList.remove('busy');
    }
  },

  async showResult(note) {
    this.result = note;
    $('#result-lang').textContent = (LANGS[note.lang]?.badge) || note.lang.toUpperCase();
    $('#result-meta').textContent = `${clock(note.seconds)} · ${note.text.split(/\s+/).length} słów`;
    $('#result-text').textContent = note.text;
    $('#result').hidden = false;

    if (store.flag('autocopy', true) && await copyText(note.text)) {
      toast('Skopiowane');
    }
  },

  async copyResult() {
    const ok = await copyText(this.result?.text || '');
    toast(ok ? 'Skopiowane' : 'Nie udało się skopiować');
  },

  shareResult() {
    navigator.share?.({ text: this.result?.text || '' }).catch(() => {});
  },

  renderNotes() {
    const notes = store.notes();
    const list = $('#note-list');
    list.textContent = '';
    $('#notes-empty').hidden = notes.length > 0;
    $('#export').hidden = notes.length === 0;

    for (const note of notes) {
      const item = document.createElement('li');
      item.className = 'note';

      const top = document.createElement('div');
      top.className = 'note-top';
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = (LANGS[note.lang]?.badge) || note.lang.toUpperCase();
      const stamp = document.createElement('span');
      stamp.textContent = when(note.created);
      top.append(badge, stamp);

      const body = document.createElement('p');
      body.className = 'note-body';
      body.textContent = note.text;

      const actions = document.createElement('div');
      actions.className = 'note-actions';
      const copy = document.createElement('button');
      copy.className = 'btn primary';
      copy.textContent = 'Kopiuj';
      copy.addEventListener('click', async (e) => {
        e.stopPropagation();
        toast(await copyText(note.text) ? 'Skopiowane' : 'Nie udało się skopiować');
      });
      const remove = document.createElement('button');
      remove.className = 'btn ghost danger';
      remove.textContent = 'Usuń';
      remove.addEventListener('click', (e) => {
        e.stopPropagation();
        store.removeNote(note.id);
        this.renderNotes();
      });
      actions.append(copy, remove);

      item.append(top, body, actions);
      item.addEventListener('click', () => item.classList.toggle('open'));
      list.appendChild(item);
    }
  },

  /** One markdown file, same frontmatter the macOS app writes — so the export
   *  can be dropped straight into the Obsidian vault it already fills. */
  exportNotes() {
    const body = store.notes().map((note) => [
      '---',
      `created: ${note.created}`,
      `language: ${note.lang}`,
      `duration: ${note.seconds}s`,
      `words: ${note.text.split(/\s+/).filter(Boolean).length}`,
      'source: skryba-mobile',
      '---',
      '',
      note.text,
      '',
    ].join('\n')).join('\n');

    const stamp = new Date().toISOString().slice(0, 10);
    const blob = new Blob([body], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `skryba-${stamp}.md`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  },

  settings(open) {
    $('#settings').hidden = !open;
    $('#scrim').hidden = !open;
    if (!open) return;
    $('#key').value = store.key;
    $('#default-lang').value = store.lang;
    $('#autocopy').checked = store.flag('autocopy', true);
    $('#autostart').checked = store.flag('autostart', false);
  },

  wireSettings() {
    $('#show-key').addEventListener('click', () => {
      const input = $('#key');
      const hidden = input.type === 'password';
      input.type = hidden ? 'text' : 'password';
      $('#show-key').textContent = hidden ? 'Ukryj' : 'Pokaż';
    });

    $('#paste-key').addEventListener('click', async () => {
      try { $('#key').value = (await navigator.clipboard.readText()).trim(); }
      catch { toast('Brak dostępu do schowka — wklej ręcznie'); }
    });

    $('#save-key').addEventListener('click', async () => {
      const raw = $('#key').value.trim();
      const hint = $('#key-status');
      // Save before verifying: a failed check must never block dictation.
      store.key = raw;
      hint.textContent = 'Sprawdzam…';
      hint.className = 'hint';
      const result = await validateKey(raw);
      hint.textContent = result.message;
      hint.className = `hint ${result.ok ? 'ok' : 'bad'}`;
      if (result.ok) this.status('Dotknij, żeby dyktować');
    });

    $('#default-lang').addEventListener('change', (e) => this.setLang(e.target.value));
    $('#autocopy').addEventListener('change', (e) => store.setFlag('autocopy', e.target.checked));
    $('#autostart').addEventListener('change', (e) => store.setFlag('autostart', e.target.checked));

    $('#wipe').addEventListener('click', () => {
      if (!confirm('Usunąć wszystkie notatki i klucz z tego telefonu?')) return;
      localStorage.clear();
      location.reload();
    });
  },
};

document.addEventListener('DOMContentLoaded', () => ui.init());

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
