# KWS MultiStream — notatki developerskie

## Stan projektu

Electron + React (electron-vite) multistream viewer. Chat Chatango osadzony przez lokalny serwer HTTP (`127.0.0.1:PORT`) serwujący HTML z `emb.js`.

---

## Aktywne bugi / problemy

### 1. Czarne kwadraty na miniaturkach zdjęć, gifów i filmów w chacie

**Objaw:** Zamiast podglądu obrazka/wideo pojawia się czarny kwadrat. Po kliknięciu kwadrat otwiera pełny podgląd poprawnie.

**Przyczyna:** Nasz injector CSS/JS (`CHATANGO_DARK_JS` w `src/main/index.js`) ustawia `background-color: #1a1a20 !important` na elementach `contenteditable`. Chatango używa absolutnie pozycjonowanego `contenteditable` jako overlay nad miniaturkami — przez to overlay zakrywa obrazek czarnym tłem.

**Ostatnia próba naprawy:**
- Dodano sprawdzenie `position` dla `contenteditable`: jeśli `absolute` lub `fixed` → `background-color: transparent`, jeśli statyczny → `#1a1a20` (jak pole input).
- Dodano `WeakSet busy` zapobiegający pętlom MutationObserver.
- Dodano `el.querySelector('img,video')` — element z dziećmi img/video dostaje `transparent`.
- Ponownie dodano `'class'` do `attributeFilter` w MO (wykrywa klasy z `background-image`).
- Gdy MO widzi dodanie `<img>` do DOM — re-przetwarza rodzica.

**Status:** Do weryfikacji po uruchomieniu.

---

### 2. Header Chatango (pasek z logo "Chatango", "Help", "Android app")

**Objaw:** Biały pasek z logo Chatango widoczny nad czatem.

**Rozwiązanie (zaimplementowane):** CSS `.topbar { display: none !important }` + JS `apply()` szuka elementów z klasą `topbar` i ukrywa.

**Status:** Powinno działać. Klasa `.topbar` pochodzi z oficjalnego `emb.js` Chatango.

---

### 3. Ciemny motyw — ogólna architektura

**Jak działa:**
- Lokalny serwer HTTP (`createServer`) serwuje stronę z `emb.js` na `127.0.0.1:PORT`
- `ipcMain.handle('inject-chatango-dark')` wstrzykuje CSS i JS do wszystkich frame'ów przez `wc.mainFrame.framesInSubtree`
- `did-frame-finish-load` dorzuca injection gdy nowy frame się ładuje
- `ChatPanel.jsx` wywołuje `injectChatangoDark` po `dom-ready` oraz z retry: 1.2s, 3s, 6s, 10s

**Pliki kluczowe:**
- `src/main/index.js` — `CHATANGO_DARK_CSS`, `CHATANGO_DARK_JS`, handler `inject-chatango-dark`
- `src/renderer/src/components/ChatPanel.jsx` — webview, wywołanie injectora
- `src/preload/index.js` — bridge IPC

---

### 4. Kursor I-beam nad przyciskami toolbaru chatu

**Objaw:** Nad ikonami (kamerka, #) pojawia się kursor tekstowy zamiast wskaźnika.

**Rozwiązanie (zaimplementowane):** CSS `button, [role="button"], a, label { cursor: pointer !important }` w `CHATANGO_DARK_CSS`.

---

## Rzeczy do dalszego testowania

- [ ] Czarne kwadraty na miniaturkach — czy fix z `position: absolute` działa?
- [ ] Czy kolorowe nicki użytkowników są zachowane (funkcja `isDarkColor` pomija kolory jasne)
- [ ] Podwójny scrollbar — czy `overflow: hidden` na `html, body` działa poprawnie
- [ ] Czy `.topbar` jest konsekwentnie ukryty po załadowaniu chatu

---

## Środowisko

```
Node.js + npm
electron-vite
React
electron-store
```

Uruchomienie dev:
```
npm run dev
```

Build:
```
npm run build
```
