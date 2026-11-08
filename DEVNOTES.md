# KWS MultiStream — notatki developerskie

## Stan projektu

Electron + React (electron-vite) multistream viewer. Chat Chatango osadzony przez lokalny serwer HTTP (`127.0.0.1:PORT`) serwujący HTML z `emb.js`.

---

## Postęp prac (ostatnia sesja: 2026-11-08)

### Zrobione i przetestowane
- **Wyszukiwarka kanałów po nicku (Twitch + Kick)** w oknie „Wybierz stream” — commit `e18fa9e`, wypchnięte na `main`.
  - Main: IPC `search-channels` (`src/main/index.js`) — Twitch przez nieoficjalne GQL (`gql.twitch.tv`, publiczny Client-ID twitch.tv — decyzja użytkownika), Kick przez `kick.com/api/search` + dokładny lookup `api/v2/channels/{slug}`. Zapytania przez `net.fetch` (stos Chromium, lepiej z Cloudflare na Kicku).
  - Renderer: `AddStreamModal.jsx` — tekst bez `.`/`/`/`:` = wyszukiwanie (debounce 300 ms, ↑/↓ + Enter), z kropką = URL jak dawniej. Fallback: bezpośrednie pozycje `twitch.tv/nick`, `kick.com/nick`.
  - ⚠️ Odpowiedzi API nie były weryfikowane z poziomu Claude (blokada uprawnień) — sprawdzić, czy wyniki faktycznie przychodzą z obu platform.

### Zrobione, NIEPRZETESTOWANE (commit lokalny, bez push)
1. **ShowUp.tv jako źródło** — platforma `showup` w `streamParser.js` (`showup.tv/{nick}`), różowy kolor. Brak embed playera, więc dock ładuje całą stronę pokoju, a main wstrzykuje `FOCUS_VIDEO_JS` (IPC `focus-video-player`): auto-klik 18+/cookies (regex po tekście przycisku), ukrycie reszty strony, największy `<video>` na cały dock. Bez selektorów specyficznych dla ShowUp (nie mogłem pobrać strony do analizy). W wyszukiwarce zawsze jest pozycja „ShowUp” z dokładnym nickiem (ShowUp nie ma API wyszukiwania).
   - Ryzyka: wideo w cross-origin iframe → skrypt go nie znajdzie; inny tekst przycisku 18+ → nie kliknie.
2. **Logowanie do ShowUp** — ⚙ Ustawienia → „Zaloguj do ShowUp” (osobne okno, ta sama domyślna sesja co docki → ciasteczka współdzielone) / „Wyloguj” (czyści cookies + storage showup.tv). Po zamknięciu okna docki ShowUp się przeładowują (`showup-session-changed`). Przycisk w toolbarze zmieniony z „⚙ Chat” na „⚙ Ustawienia”.
3. **Szary ekran (crash docka)** — log pokazał `reason=crashed exitCode=-1073741819` (0xC0000005, access violation w rendererze Chromium) na stronie ShowUp. Dodano:
   - logowanie `render-process-gone` / `child-process-gone` w main (linie `[render-process-gone] reason=...` w konsoli dev),
   - auto-reload webview po crashu w `StreamDock.jsx` (backoff 1 s, 2 s…; max 5 crashy/min).
4. **Aktualizacja Electron 28.3.3 → 45.0.0** (Chromium 120 → nowy) — główna próba naprawy crashy. `frame.routingId` zamienione na `webFrameMain.fromId` w injectorze Chatango. Aplikacja startuje bez błędów, reszta niezweryfikowana.

### Do przetestowania na start następnej sesji
- [ ] Twitch / Kick / YouTube / ShowUp grają na Electron 45
- [ ] Wyciszanie i głośność w dockach (szczególnie YouTube — frame injection)
- [ ] Ciemny motyw Chatango nadal się nakłada
- [ ] Czy ShowUp nadal crashuje (szary ekran) — jeśli tak: sprawdzić log, rozważyć `disable-accelerated-video-decode`
- [ ] Czy auto-reload po crashu działa
- [ ] ShowUp: czy 18+ klika się samo, czy wideo wypełnia dock, czy logowanie działa
- [ ] Wyszukiwarka: wyniki z Twitcha i Kicka
- [ ] Po testach: `git push`

### Instalacja Electrona — znany problem
`npm install` nie rozpakowuje binarki Electrona (instalator kończy się cicho, w `node_modules/electron/dist` tylko `locales`; błąd `Error: Electron uninstall` przy `npm run dev`). Prawdopodobnie `extract-zip` vs Node 26. Obejście (PowerShell):
```
Remove-Item -Recurse -Force node_modules\electron\dist
$zip = Get-ChildItem -Recurse "$env:LOCALAPPDATA\electron\Cache" -Filter electron-v45.0.0-win32-x64.zip | Select -First 1
Expand-Archive $zip.FullName node_modules\electron\dist -Force
Move-Item -Force node_modules\electron\dist\electron.d.ts node_modules\electron\electron.d.ts
Set-Content node_modules\electron\path.txt 'electron.exe' -NoNewline -Encoding ascii
```

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
