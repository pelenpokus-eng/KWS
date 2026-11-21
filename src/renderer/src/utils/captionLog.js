import { useEffect, useState } from 'react'

// ── Live caption history (the "Tłumaczenie" panel) ─────────────────────────
// Listens to every dock's caption events for the whole app run, so closing
// and reopening the panel keeps the history. Finished sentences pile up in
// `entries`; the sentence being spoken right now (per dock) is in `partials`.

const MAX_ENTRIES = 500
const PARTIAL_STALE_MS = 6000

let entries = []            // [{ uid, key, id, label, orig, pl, draft, trFailed, t }]
const partials = new Map()  // dock key -> { gen, orig, pl, label, t }
let version = 0
let uid = 0
const subs = new Set()
let started = false

function notify() {
  version++
  subs.forEach(f => f(version))
}

function start() {
  if (started || !window.electronAPI?.onCapEvent) return
  started = true
  window.electronAPI.onCapEvent((ev) => {
    const p = partials.get(ev.key)
    if (ev.type === 'partial') {
      partials.set(ev.key, { gen: ev.gen, orig: ev.orig, pl: p?.gen === ev.gen ? p.pl : null, label: ev.label, t: Date.now() })
    } else if (ev.type === 'partialTr') {
      if (p?.gen !== ev.gen) return
      partials.set(ev.key, { ...p, pl: ev.text })
    } else if (ev.type === 'line') {
      entries = [...entries, {
        uid: ++uid, key: ev.key, id: ev.id, label: ev.label, orig: ev.orig,
        pl: null, draft: p?.gen === ev.gen ? p.pl : null, t: Date.now(),
      }].slice(-MAX_ENTRIES)
      if (p && p.gen <= ev.gen) partials.delete(ev.key)
    } else if (ev.type === 'tr') {
      entries = entries.map(e => e.key === ev.key && e.id === ev.id
        ? (ev.text ? { ...e, pl: ev.text } : { ...e, trFailed: true }) : e)
    } else if (ev.type === 'drop') {
      if (p && p.gen <= ev.gen) partials.delete(ev.key)
    } else return
    notify()
  })
}

export function clearCaptionLog() {
  entries = []
  partials.clear()
  notify()
}

export function useCaptionLog() {
  const [, setV] = useState(version)
  useEffect(() => {
    start()
    subs.add(setV)
    // drafts of a dock that went quiet / was switched off fade out
    const t = setInterval(() => {
      let changed = false
      for (const [k, p] of partials) if (Date.now() - p.t > PARTIAL_STALE_MS) { partials.delete(k); changed = true }
      if (changed) notify()
      else setV(v => v + 0.0001) // re-check "translation late" fallbacks
    }, 1000)
    return () => { subs.delete(setV); clearInterval(t) }
  }, [])
  return { entries, partials: [...partials.entries()].map(([key, p]) => ({ key, ...p })) }
}

// start listening as soon as the app loads (history from the first CC on)
if (typeof window !== 'undefined') setTimeout(start, 0)

// ── Caption preferences: speech language + "show original too" ────────────
// Shared by all docks and the panel, remembered (store key captionPrefs).
let capPrefs = { lang: 'auto', showOrig: false }
let capPrefsLoaded = false
const capPrefSubs = new Set()
export function useCapPrefs() {
  const [p, setP] = useState(capPrefs)
  useEffect(() => {
    capPrefSubs.add(setP)
    if (!capPrefsLoaded) {
      capPrefsLoaded = true
      window.electronAPI?.store.get('captionPrefs').then(v => {
        if (v && typeof v === 'object') { capPrefs = { ...capPrefs, ...v }; capPrefSubs.forEach(f => f(capPrefs)) }
      }).catch(() => {})
    }
    return () => { capPrefSubs.delete(setP) }
  }, [])
  const update = (patch) => {
    capPrefs = { ...capPrefs, ...patch }
    capPrefSubs.forEach(f => f(capPrefs))
    window.electronAPI?.store.set('captionPrefs', capPrefs)
  }
  return [p, update]
}
export const getCapPrefs = () => capPrefs
export const CAP_LANGS = [['auto', 'Auto'], ['ru', 'RU'], ['uk', 'UK']]
export const CAP_TR_WAIT_MS = 3000 // no translation by then: show the original instead
