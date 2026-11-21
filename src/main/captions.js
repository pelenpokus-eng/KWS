// ── Live captions for a dock ────────────────────────────────────────────────
// Sound of ONE dock (its own <video>, not the whole system) → local Whisper
// (whisper.cpp server on the GPU) → Google Translate → Polish subtitle line in
// the dock. Works on a muted dock too: captureStream() copies the audio before
// the dock's volume / mute is applied.
//
// Whisper (CUDA build of whisper-server + model + VAD model, ~1.2 GB) is
// downloaded into userData/whisper on first use, then started on a local port
// and kept running while any dock has captions on (stopped after 3 min idle,
// so the model doesn't sit in VRAM).

import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, createWriteStream, renameSync, rmSync, appendFileSync } from 'fs'
import { spawn, execFile } from 'child_process'
import { createServer } from 'net'

const SR = 16000 // Whisper wants 16 kHz mono

// pinned downloads (release asset names change between whisper.cpp builds).
// CUDA 12.4 build: the 11.8 one ships without cuBLAS and falls back to CPU
// (~10× slower than real time — useless for live captions).
const FILES = {
  zip: { url: 'https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-win-cuda-12.4.0-x64.zip', name: 'whisper-bin.zip', size: 684913404 },
  model: { url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin', name: 'ggml-large-v3-turbo-q5_0.bin', size: 574041195 },
  vad: { url: 'https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v5.1.2.bin', name: 'ggml-silero-v5.1.2.bin', size: 0 },
}

// ── page side: tap the dock's <video> sound, resample to 16 kHz Int16 ──────
const CAP_START_JS = `(function(){
  var S = window.__kwsCap;
  if (S && S.alive()) return 'ok';
  if (S) S.stop();
  var vids = Array.prototype.slice.call(document.querySelectorAll('video')).filter(function(v){ return v.readyState >= 2; });
  vids.sort(function(a, b){ return b.videoWidth * b.videoHeight - a.videoWidth * a.videoHeight; });
  var v = vids[0];
  if (!v) return 'novideo';
  var stream;
  try { stream = v.captureStream(); } catch (e) { return 'err:' + e.message; }
  var tracks = stream.getAudioTracks();
  if (!tracks.length) return 'noaudio';
  var ctx = new AudioContext();
  var src = ctx.createMediaStreamSource(new MediaStream(tracks));
  var proc = ctx.createScriptProcessor(4096, 2, 1);
  var zero = ctx.createGain(); zero.gain.value = 0;
  src.connect(proc); proc.connect(zero); zero.connect(ctx.destination);
  var ratio = ctx.sampleRate / ${SR}, pos = 0, out = [], outLen = 0;
  proc.onaudioprocess = function(e){
    var ib = e.inputBuffer, n = ib.length;
    var a = ib.getChannelData(0), b = ib.numberOfChannels > 1 ? ib.getChannelData(1) : a;
    var res = new Int16Array(Math.ceil(n / ratio) + 2), k = 0;
    while (pos < n) {
      var i0 = Math.floor(pos), i1 = Math.min(n, Math.max(i0 + 1, Math.floor(pos + ratio))), s = 0;
      for (var i = i0; i < i1; i++) s += a[i] + b[i];
      var val = s / (2 * (i1 - i0));
      res[k++] = Math.max(-1, Math.min(1, val)) * 32767;
      pos += ratio;
    }
    pos -= n;
    out.push(res.subarray(0, k)); outLen += k;
    while (outLen > ${SR} * 20 && out.length > 1) outLen -= out.shift().length;
  };
  ctx.resume();
  window.__kwsCap = {
    alive: function(){ return ctx.state !== 'closed' && v.isConnected && tracks[0].readyState === 'live' && !v.ended; },
    take: function(){
      if (!this.alive()) return { dead: true, data: '' };
      var all = new Int16Array(outLen), o = 0;
      for (var i = 0; i < out.length; i++) { all.set(out[i], o); o += out[i].length; }
      out = []; outLen = 0;
      var b = new Uint8Array(all.buffer), str = '', CH = 0x8000;
      for (var j = 0; j < b.length; j += CH) str += String.fromCharCode.apply(null, b.subarray(j, j + CH));
      return { dead: false, data: btoa(str), paused: v.paused };
    },
    stop: function(){ try { proc.disconnect(); src.disconnect(); ctx.close(); } catch (e) {} }
  };
  return 'ok';
})()`

const CAP_TAKE_JS = 'window.__kwsCap ? window.__kwsCap.take() : { dead: true, data: "" }'
const CAP_STOP_JS = 'window.__kwsCap && (window.__kwsCap.stop(), window.__kwsCap = null)'

// Whisper "hears" these in silence / music (from its training data).
// Subtitle credits: nobody says them on a stream — always dropped.
const HALLUCINATIONS_HARD = [
  /субтитр/i, /DimaTorzok/i, /продолжение следует/i, /редактор субтитров/i, /корректор/i, /amara\.org/i,
]
// Phrases a streamer may really say — dropped only when the chunk had little
// actual sound in it (then it's almost surely invented).
const HALLUCINATIONS_SOFT = [
  /спасибо за (просмотр|внимание)/i, /дякую за перегляд/i, /подпис(ывайтесь|уйтесь|ывайся)/i,
  /підписуйтесь/i, /ставьте лайк/i, /thank(s| you) for watching/i,
  /^\s*(спасибо|дякую)[.!]*\s*$/i, /^\s*(пока|до свидания)[.!]*\s*$/i,
]
const isHallucination = (text, soundFrac) =>
  HALLUCINATIONS_HARD.some(re => re.test(text)) || (soundFrac < 0.5 && HALLUCINATIONS_SOFT.some(re => re.test(text)))

// In "Auto" only Russian or Ukrainian are allowed (surżyk): Whisper sometimes
// labels a short / mixed phrase as Belarusian, Bulgarian or even Polish.
// Letters tell the two apart: і ї є ґ only in Ukrainian, ы э ъ ё only in Russian.
function ruOrUk(text, fallback) {
  const uk = (text.match(/[іїєґ]/gi) || []).length
  const ru = (text.match(/[ыэъё]/gi) || []).length
  if (uk || ru) return uk >= ru ? 'uk' : 'ru'
  return fallback
}

// The same words on both sides of a cut — a hard cut keeps 0.5 s of overlap
// so no word gets chopped, and an energy cut can land in a quiet sound inside
// a word: drop up to 3 repeated words from the new line. After a cut at a real
// pause only a repeat of ≥4 letters counts ("да, да" can be really said).
const normWord = (w) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
function dedupeStart(prev, text, overlap) {
  const a = prev.split(/\s+/).filter(Boolean), b = text.split(/\s+/).filter(Boolean)
  for (let k = Math.min(3, a.length, b.length - 1); k >= 1; k--) {
    const tail = a.slice(-k).map(normWord).join(' ')
    if (tail !== b.slice(0, k).map(normWord).join(' ')) continue
    if (!overlap && tail.replace(/ /g, '').length < 4) continue
    return b.slice(k).join(' ')
  }
  return text
}
const cleanText = (t) => String(t || '')
  .replace(/\[[^\]]*\]|\([^)]*(музык|music|смех|аплодисмент)[^)]*\)|♪+/gi, ' ')
  .replace(/\s+/g, ' ').trim()

const LANG_CODE = { russian: 'ru', ukrainian: 'uk', belarusian: 'be', polish: 'pl', english: 'en', bulgarian: 'bg' }

export function setupCaptions({ ipcMain, getMainWindow, findFrame }) {
  const dir = join(app.getPath('userData'), 'whisper')
  const binDir = join(dir, 'bin')
  const serverExe = () => {
    for (const p of [join(binDir, 'Release', 'whisper-server.exe'), join(binDir, 'whisper-server.exe')]) if (existsSync(p)) return p
    return null
  }
  const filePath = (f) => join(dir, f.name)
  const ready = () => !!serverExe() && existsSync(filePath(FILES.model)) && existsSync(filePath(FILES.vad))

  const sessions = new Map() // key -> session
  const dbg = process.env.KWS_CAP_DEBUG ? (...a) => { try { appendFileSync(join(app.getPath('userData'), 'cap-debug.log'), new Date().toISOString().slice(11, 23) + ' ' + a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ') + '\n') } catch {} } : () => {}
  const send = (key, msg) => {
    const w = getMainWindow()
    dbg('send', key, msg.type, msg.status || msg.gen || '')
    if (w && !w.isDestroyed()) w.webContents.send('cap-event', { key, label: sessions.get(key)?.label || '', ...msg })
  }
  const broadcast = (msg) => { for (const k of sessions.keys()) send(k, msg) }

  // ── first-use download ──────────────────────────────────────────────────
  let installing = null
  async function download(f, onBytes) {
    const dest = filePath(f)
    if (existsSync(dest)) return
    const part = dest + '.part'
    const res = await fetch(f.url, { redirect: 'follow' })
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} (${f.name})`)
    const out = createWriteStream(part)
    let got = 0
    const reader = res.body.getReader()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        got += value.length
        onBytes(value.length)
        if (!out.write(value)) await new Promise(r => out.once('drain', r))
      }
    } finally {
      await new Promise(r => out.end(r))
    }
    const want = Number(res.headers.get('content-length')) || f.size
    if (want && got !== want) { rmSync(part, { force: true }); throw new Error(`niepełne pobieranie (${f.name})`) }
    renameSync(part, dest)
  }
  function install() {
    if (ready()) return Promise.resolve()
    if (installing) return installing
    installing = (async () => {
      mkdirSync(dir, { recursive: true })
      const need = []
      if (!serverExe()) need.push(FILES.zip)
      if (!existsSync(filePath(FILES.model))) need.push(FILES.model)
      if (!existsSync(filePath(FILES.vad))) need.push(FILES.vad)
      const total = need.reduce((s, f) => s + (f.size || 1000000), 0)
      let done = 0, lastPct = -1
      const tick = (n) => {
        done += n
        const pct = Math.min(99, Math.floor(done / total * 100))
        if (pct !== lastPct) { lastPct = pct; broadcast({ type: 'status', status: 'download', pct, mb: Math.round(total / 1048576) }) }
      }
      broadcast({ type: 'status', status: 'download', pct: 0, mb: Math.round(total / 1048576) })
      for (const f of need) await download(f, tick)
      if (!serverExe()) {
        broadcast({ type: 'status', status: 'unpack' })
        mkdirSync(binDir, { recursive: true })
        const tar = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
        await new Promise((resolve, reject) => execFile(tar, ['-xf', filePath(FILES.zip), '-C', binDir], { windowsHide: true }, (err) => err ? reject(new Error('rozpakowanie nie powiodło się')) : resolve()))
        rmSync(filePath(FILES.zip), { force: true })
        if (!serverExe()) throw new Error('w paczce nie ma whisper-server.exe')
      }
    })().finally(() => { installing = null })
    return installing
  }

  // ── whisper-server process ─────────────────────────────────────────────
  let server = null // { proc, port, ready: Promise }
  let idleTimer = null
  const freePort = () => new Promise((resolve, reject) => {
    const s = createServer()
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)) })
  })
  function stopServer() {
    if (!server) return
    try { server.proc.kill() } catch {}
    server = null
  }
  // one start at a time: the dock's CC and its first phrase both ask for the
  // server while the download is still running
  let serverStarting = null
  function ensureServer() {
    clearTimeout(idleTimer)
    if (server) return server.ready
    if (!serverStarting) serverStarting = startServer().finally(() => { serverStarting = null })
    return serverStarting
  }
  async function startServer() {
    await install()
    const port = await freePort()
    const exe = serverExe()
    const proc = spawn(exe, [
      '-m', filePath(FILES.model), '--host', '127.0.0.1', '--port', String(port),
      '-t', '4', '--vad', '-vm', filePath(FILES.vad), '-nth', '0.6', '-nlp',
    ], { cwd: join(exe, '..'), windowsHide: true })
    let log = ''
    proc.stderr.on('data', d => { log = (log + d.toString()).slice(-4000) })
    proc.stdout.on('data', d => { log = (log + d.toString()).slice(-4000) })
    const me = { proc, port }
    me.ready = new Promise((resolve, reject) => {
      let exited = false
      proc.on('exit', (code) => {
        exited = true
        if (server === me) server = null
        const tail = log.split(/\r?\n/).filter(Boolean).slice(-3).join(' | ')
        reject(new Error(`Whisper zakończył się (kod ${code})${tail ? ': ' + tail : ''}`))
        if (sessions.size) broadcast({ type: 'status', status: 'error', error: 'Whisper przestał działać — wyłącz i włącz napisy ponownie' })
      })
      const t0 = Date.now()
      const poll = async () => {
        if (exited) return
        try { const r = await fetch(`http://127.0.0.1:${port}/`); if (r.ok) { resolve(); return } } catch {}
        if (Date.now() - t0 > 90000) { reject(new Error('Whisper nie wystartował w 90 s')); try { proc.kill() } catch {} ; return }
        setTimeout(poll, 400)
      }
      poll()
    })
    server = me
    broadcast({ type: 'status', status: 'starting' })
    return me.ready
  }
  const scheduleIdleStop = () => {
    clearTimeout(idleTimer)
    if (!sessions.size) idleTimer = setTimeout(stopServer, 3 * 60 * 1000)
  }
  app.on('will-quit', stopServer)

  // ── transcription queue (one request at a time, stays live) ──────────────
  const queue = []
  let busy = false
  function wav(pcm) {
    const h = Buffer.alloc(44), len = pcm.length * 2
    h.write('RIFF', 0); h.writeUInt32LE(36 + len, 4); h.write('WAVE', 8); h.write('fmt ', 12)
    h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(SR, 24)
    h.writeUInt32LE(SR * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(len, 40)
    return Buffer.concat([h, Buffer.from(pcm.buffer, pcm.byteOffset, len)])
  }
  function enqueue(key, pcm, gen) {
    // more than ~3 chunks waiting for one dock = we're behind; drop the oldest
    const mine = queue.filter(q => q.key === key)
    if (mine.length >= 3) queue.splice(queue.indexOf(mine[0]), 1)
    queue.push({ key, pcm, gen })
    pump()
  }
  // draft = with sentence timestamps and without VAD (VAD would shift them)
  async function whisper(s, pcm, draft = false, forceLang = null) {
    await ensureServer()
    const fd = new FormData()
    fd.append('file', new Blob([wav(pcm)], { type: 'audio/wav' }), 'a.wav')
    fd.append('language', forceLang || (s.lang === 'ru' || s.lang === 'uk' ? s.lang : 'auto'))
    fd.append('response_format', 'verbose_json')
    fd.append('temperature', '0')
    fd.append('suppress_non_speech', 'true')
    fd.append('no_timestamps', draft ? 'false' : 'true')
    if (draft) fd.append('vad', 'false')
    const r = await fetch(`http://127.0.0.1:${server.port}/inference`, { method: 'POST', body: fd })
    const j = await r.json()
    const text = cleanText(j.text)
    if (!text || text.length < 2) return null
    const detected = LANG_CODE[String(j.language || '').toLowerCase()] || String(j.language || '')
    const segs = (j.segments || []).map(x => ({ text: cleanText(x.text), end: Number(x.end) || 0 })).filter(x => x.text)
    return { text, detected, segs }
  }
  // which language to hand to the translator
  function sourceLang(s, res) {
    if (s.lang === 'ru' || s.lang === 'uk') return s.lang
    if (res.detected === 'ru' || res.detected === 'uk') return res.detected
    return ruOrUk(res.text, s.lastLang || 'auto')
  }
  // Auto mode, final line: Whisper chose something other than RU/UK →
  // transcribe once more as RU/UK (what it wrote is usually nonsense then)
  async function whisperFinal(s, pcm) {
    let res = await whisper(s, pcm)
    if (res && s.lang !== 'ru' && s.lang !== 'uk' && res.detected !== 'ru' && res.detected !== 'uk') {
      const again = await whisper(s, pcm, false, ruOrUk(res.text, s.lastLang || 'uk'))
      dbg('relang', res.detected, res.text.slice(0, 40), '->', again?.text?.slice(0, 40))
      if (again) res = again
    }
    return res
  }
  function emitFinal(s, gen, text, lang, soundFrac) {
    const key = s.key
    if (s.lastFinal && gen === s.lastFinalGen + 1) text = dedupeStart(s.lastFinal, text, s.dedupeGen === gen)
    if (!text || isHallucination(text, soundFrac) || s.recent.includes(text)) { send(key, { type: 'drop', gen }); return }
    s.recent = [...s.recent.slice(-3), text]
    s.lastFinal = text
    s.lastFinalGen = gen
    if (lang === 'ru' || lang === 'uk') s.lastLang = lang
    const id = ++s.seq
    send(key, { type: 'line', id, gen, orig: text, lang })
    translate(text, lang).then(pl => { if (sessions.has(key)) send(key, { type: 'tr', id, text: pl || null }) })
  }
  const SENTENCE_END = /[.!?…]["»”)]?$/
  // Finished phrases go first. When the GPU is free, a dock that is in the
  // middle of a phrase gets a draft of what was said so far (the newest sound
  // at the time it runs) — docks take turns.
  let partialTurn = 0
  function nextPartial() {
    const list = [...sessions.values()].filter(x => x.partialWanted)
    if (!list.length) return null
    const s = list[partialTurn++ % list.length]
    s.partialWanted = false
    return s
  }
  async function pump() {
    if (busy) return
    let job = queue.shift()
    let partial = null
    if (!job) { partial = nextPartial(); if (!partial) return }
    busy = true
    const key = job ? job.key : partial.key
    try {
      const s = sessions.get(key)
      if (!s) return
      if (job) {
        const res = await whisperFinal(s, job.pcm)
        if (!sessions.has(key)) return
        if (s.status !== 'live') { s.status = 'live'; send(key, { type: 'status', status: 'live' }) }
        if (!res) { send(key, { type: 'drop', gen: job.gen }); return }
        emitFinal(s, job.gen, res.text, sourceLang(s, res), soundFrac(job.pcm))
      } else {
        const gen = s.gen, pcm = s.buf
        if (pcm.length < SR) return
        s.partialLen = pcm.length
        // Auto: once RU/UK is known, drafts stick to it (no BE/BG/PL guesses)
        const res = await whisper(s, pcm, true, s.lang !== 'ru' && s.lang !== 'uk' ? s.lastLang : null)
        if (!sessions.has(key) || s.gen !== gen || !res) return // phrase already finished
        const lang = sourceLang(s, res)
        if (isHallucination(res.text, soundFrac(pcm))) return
        if (s.status !== 'live') { s.status = 'live'; send(key, { type: 'status', status: 'live' }) }
        // A finished sentence with speech after it: hand it over as a final
        // line right away (cut the sound where Whisper says it ended) instead
        // of waiting for a pause or the 8 s limit.
        let k = -1
        for (let i = 0; i < res.segs.length - 1; i++) if (SENTENCE_END.test(res.segs[i].text)) k = i
        const cutAt = k >= 0 ? Math.round(res.segs[k].end * SR) : 0
        if (k >= 0 && cutAt >= SR * 0.8 && cutAt <= pcm.length - SR * 0.3) {
          s.buf = s.buf.slice(cutAt)
          s.gen++
          s.partialText = ''
          s.partialLen = 0
          s.partialTrAt = 0
          emitFinal(s, gen, res.segs.slice(0, k + 1).map(x => x.text).join(' '), lang, soundFrac(pcm.subarray(0, cutAt)))
          return
        }
        if (res.text === s.partialText) return
        s.partialText = res.text
        send(key, { type: 'partial', gen, orig: res.text })
        // translate the draft at most every ~1.2 s (free endpoint — be gentle)
        const now = Date.now()
        if (now - (s.partialTrAt || 0) >= 1200) {
          s.partialTrAt = now
          translate(res.text, lang).then(pl => { if (pl && sessions.has(key) && s.gen === gen) send(key, { type: 'partialTr', gen, text: pl }) })
        }
      }
    } catch (e) {
      const s = sessions.get(key)
      if (s) { s.status = 'error'; send(key, { type: 'status', status: 'error', error: e.message || String(e) }) }
    } finally {
      busy = false
      if (queue.length || [...sessions.values()].some(x => x.partialWanted)) setImmediate(pump)
    }
  }

  // Google Translate, the endpoint translate.google.com's widget uses (no key)
  async function translate(text, lang) {
    try {
      const u = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(lang || 'auto')}&tl=pl&dt=t&q=${encodeURIComponent(text)}`
      const r = await fetch(u)
      if (!r.ok) return null
      const j = await r.json()
      return (j?.[0] || []).map(x => x?.[0] || '').join('').trim() || null
    } catch { return null }
  }

  // ── cutting the sound into phrases ───────────────────────────────────────
  // Cut at a pause: after ≥2.5 s look for ≥300 ms of quiet; at 8 s cut at the
  // quietest spot anyway. Near-silent chunks never reach Whisper.
  const FR = 320 // 20 ms frames
  function frameRms(pcm, from, to) {
    const out = []
    for (let i = from; i + FR <= to; i += FR) {
      let s = 0
      for (let k = i; k < i + FR; k++) s += pcm[k] * pcm[k]
      out.push(Math.sqrt(s / FR))
    }
    return out
  }
  // share of 20 ms frames with real sound in them
  const soundFrac = (pcm) => {
    const r = frameRms(pcm, 0, pcm.length)
    return r.length ? r.filter(v => v > 400).length / r.length : 0
  }
  const OVERLAP = Math.round(SR * 0.5)
  function segment(s) {
    const pcm = s.buf
    if (pcm.length < SR * 2.5) return
    const rms = frameRms(pcm, 0, pcm.length)
    const sorted = [...rms].sort((a, b) => a - b)
    const quiet = Math.max(150, sorted[Math.floor(sorted.length * 0.5)] * 0.35)
    let cut = -1
    const minF = Math.floor(SR * 2.5 / FR), needF = 15
    for (let f = minF, run = 0; f < rms.length; f++) {
      run = rms[f] < quiet ? run + 1 : 0
      if (run >= needF) { cut = (f - Math.floor(run / 2)) * FR; break }
    }
    let hard = false
    if (cut < 0 && pcm.length >= SR * 8) {
      let best = Math.floor(SR * 4 / FR)
      for (let f = best; f < rms.length; f++) if (rms[f] < rms[best]) best = f
      cut = best * FR
      hard = true
    }
    if (cut < 0) return
    const chunk = pcm.slice(0, cut)
    // cut in the middle of speech: the next phrase starts 0.5 s earlier, so a
    // word cut in half is heard whole there (the repeat is removed from text)
    s.buf = pcm.slice(hard ? Math.max(0, cut - OVERLAP) : cut)
    const gen = s.gen++
    if (hard) s.dedupeGen = s.gen
    s.partialText = ''
    s.partialLen = 0
    s.partialTrAt = 0
    s.partialWanted = false
    const loud = frameRms(chunk, 0, chunk.length).filter(v => v > 400).length
    if (loud * FR < SR * 0.4) { send(s.key, { type: 'drop', gen }); return } // under 0.4 s of anything audible
    enqueue(s.key, chunk, gen)
  }
  // a draft is due: ≥1 s of phrase with sound in it, ≥0.8 s more than last time
  function wantPartial(s) {
    const pcm = s.buf
    const step = !s.audible && sessions.size > 1 ? SR * 1.8 : SR * 0.8
    if (pcm.length < SR || pcm.length - s.partialLen < step) return
    const loud = frameRms(pcm, Math.max(0, pcm.length - SR), pcm.length).filter(v => v > 400).length
    if (loud * FR < SR * 0.2 && !s.partialText) return
    s.partialWanted = true
    pump()
  }

  // ── pulling sound from the dock's page ───────────────────────────────────
  function frames(target) {
    const f = findFrame(target)
    if (!f) return []
    if (target.ytId) return [f]
    return [f, ...f.framesInSubtree.filter(x => x !== f)]
  }
  async function hook(s) {
    let last = 'noframe'
    dbg('frames', frames(s.target).length, s.target)
    for (const f of frames(s.target)) {
      try {
        last = await f.executeJavaScript(CAP_START_JS, true)
        dbg('hook', f.url.slice(0, 60), last)
        if (last === 'ok') { s.frame = f; return 'ok' }
      } catch (e) { last = 'err:' + e.message }
    }
    s.frame = null
    return last
  }
  async function pull(s) {
    if (s.pulling) return
    s.pulling = true
    try {
      if (!s.frame || s.frame.isDestroyed?.() || s.frame.detached) {
        const r = await hook(s)
        if (r !== 'ok') {
          const status = r === 'novideo' || r === 'noframe' ? 'novideo' : r === 'noaudio' ? 'noaudio' : 'novideo'
          if (s.status !== status) { s.status = status; send(s.key, { type: 'status', status }) }
          return
        }
        if (s.status !== 'live') {
          s.status = server ? 'listening' : s.status
          if (s.status === 'listening') send(s.key, { type: 'status', status: 'listening' })
        }
      }
      let res
      try { res = await s.frame.executeJavaScript(CAP_TAKE_JS) } catch (e) { dbg('take-err', e.message); s.frame = null; return }
      if (!res?.data || res.dead) dbg('take', res)
      if (res?.dead) { s.frame = null; return }
      if (res?.data) {
        const b = Buffer.from(res.data, 'base64')
        const add = new Int16Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length - (b.length % 2)))
        const merged = new Int16Array(s.buf.length + add.length)
        merged.set(s.buf); merged.set(add, s.buf.length)
        s.buf = merged
        segment(s)
        wantPartial(s)
      }
    } finally { s.pulling = false }
  }

  function stopSession(key) {
    const s = sessions.get(key)
    if (!s) return
    clearInterval(s.timer)
    s.partialWanted = false
    sessions.delete(key)
    for (let i = queue.length - 1; i >= 0; i--) if (queue[i].key === key) queue.splice(i, 1)
    try { s.frame?.executeJavaScript(CAP_STOP_JS) } catch {}
    scheduleIdleStop()
  }

  ipcMain.handle('cap-start', async (_, key, target, opts = {}) => {
    if (!key || !target) return { ok: false }
    let s = sessions.get(key)
    if (s) {
      // dock reloaded (new webview) or language changed
      const moved = JSON.stringify(s.target) !== JSON.stringify(target)
      s.target = target
      s.lang = opts.lang || s.lang
      s.label = opts.label || s.label
      if (typeof opts.audible === 'boolean') s.audible = opts.audible
      if (moved) { try { s.frame?.executeJavaScript(CAP_STOP_JS) } catch {}; s.frame = null; s.buf = new Int16Array(0); s.gen++; s.partialText = ''; s.partialLen = 0 }
      return { ok: true }
    }
    s = { key, target, label: opts.label || '', audible: opts.audible !== false, lastLang: null, lastFinal: '', lastFinalGen: -9, dedupeGen: -1, lang: opts.lang || 'auto', buf: new Int16Array(0), frame: null, seq: 0, recent: [], status: 'init', pulling: false, gen: 1, partialText: '', partialLen: 0, partialWanted: false }
    sessions.set(key, s)
    clearTimeout(idleTimer)
    s.timer = setInterval(() => pull(s).catch(() => {}), 150)
    // get Whisper going right away (download / start), not on the first phrase
    ensureServer().then(() => {
      if (sessions.get(key) === s && s.status !== 'live') { s.status = 'listening'; send(key, { type: 'status', status: 'listening' }) }
    }).catch((e) => {
      if (sessions.get(key) === s) { s.status = 'error'; send(key, { type: 'status', status: 'error', error: e.message || String(e) }) }
    })
    return { ok: true, installed: ready() }
  })
  ipcMain.handle('cap-stop', (_, key) => stopSession(key))
}
