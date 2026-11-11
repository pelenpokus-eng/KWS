# KWS MultiStream — notatki developerskie

## Stan projektu

Electron 45 + React 18 (electron-vite) — do 4 streamów naraz (Twitch, Kick, YouTube, ShowUp.tv, dowolny URL) + panel czatu (1 albo 2 czaty obok siebie).

- **Renderer w buildzie** ładuje się z lokalnego serwera `http://localhost:PORT` (`startRendererServer` w `src/main/index.js`), NIE z `file://` — YouTube bez Referera daje błąd 153, Twitch sprawdza `parent=localhost`. W dev to samo robi serwer Vite.
- **Czat Chatango** = strona pokoju `https://<pokój>.chatango.com/` w webview + wstrzykiwany ciemny motyw (`inject-chatango-dark`). Stary wariant z lokalnym serwerem + `emb.js` usunięty (nic nie rysował).
- **Czat Kick** = oficjalny popout `kick.com/popout/<kanał>/chat` w webview (własny klient Pusher przestał działać — Kick pobiera konfigurację realtime dynamicznie).
- **Czat Twitch** = iframe `twitch.tv/embed/<kanał>/chat?parent=localhost`.

---

## Postęp prac (ostatnia sesja: 2026-11-10)

Wszystko wypchnięte na `origin/main` (ostatni commit `2ffe37a`).

### Zrobione i przetestowane (na buildzie produkcyjnym)
- **Ikona aplikacji** — `build/icon.ico` (16–256 px, instalator/exe) i `resources/icon.png` (okno, import `?asset`). Źródło: tarcza `blacha.png`.
- **Instalator NSIS z kreatorem** — wybór folderu, skrót na pulpicie i w menu Start (`package.json` → `build.nsis`). Wcześniej był one-click do `%LOCALAPPDATA%\Programs\kws-multistream`.
- **YouTube w buildzie** — błąd 153 naprawiony (patrz serwer localhost wyżej).
- **Czat po powrocie z czatu streama** — był czarny ekran (ładował się niedziałający wariant z lokalnego serwera). Pokój i „Własny URL” z ⚙ Ustawień faktycznie działają.
- **Czat Kick** — popout (patrz wyżej).
- **Plansza 18+ Twitcha** („Zacznij oglądać”) — dock klika ją sam co 1 s (`TWITCH_GATE_JS` w `StreamDock.jsx`); docki mają `pointer-events: none`, więc user nie mógł.
- **Auto-reload czatu po crashu** — `ChatWebview` w `ChatPanel.jsx` (backoff jak w dockach).
- **Ulubione** (★ w docku i w oknie wyboru) + usuwanie pozycji z historii (✕).
- **Dźwięk YouTube** — kontroler w ramce embedu (`ytControllerScript` w main): przejmuje settery `volume`/`muted` elementu `<video>` i co 500 ms wymusza stan docka; stan ponownie wysyłany przy każdym przeładowaniu ramki (`did-frame-finish-load`). Naprawia: YT grał mimo ikonki mute (start, przeciąganie docka) i skok na 100% po kilku sekundach przy suwaku np. 20%.
  - ⚠️ Fix „skoku na 100%” sprawdzony tylko 15 s (okno testowe zamknięte w trakcie). Do potwierdzenia: YT solo 20% przez minutę, `setVolume(100)` z playera, oddanie i powrót dźwięku, ↺.
- **Mute po odświeżeniu docka** — po ↺ / crash-reload dock wraca wyciszony (globalny Mute, nieaktywny dock, głośność 0). Głośność 0 = `setAudioMuted` całego webview.
- **Głośność docka** — wymuszana w playerze (Kick/Twitch przywracały własne 60%/50%), zapisywana per dock w `docks[i].volume`, idzie za streamem przy przeciąganiu, przeżywa Jeden/Cztery i restart. Stan „Wycisz wszystko” zapisywany. Zapis stanu debounce 300 ms.
- **Pasek narzędzi w grupach** — DOCKI [Jeden | Cztery], DŹWIĘK [Solo | Multi] [Wycisz wszystko], CZAT [1 czat | 2 czaty].
- **Podwójny czat** — 2 czaty obok siebie z przesuwanym separatorem; panel 620 px w trybie podwójnym (400–1100), 310 px w pojedynczym. Każde okno ma własny pasek źródeł + „＋ Inny” (dowolny kanał Twitch/Kick po nicku lub linku). Okno 2 startuje z ekranem „Wybierz czat” — **dodanie streama do docka nigdy samo nie otwiera czatu** (wymaganie użytkownika). Okno 1 domyślnie Chatango raszei. Zapisywane: `dualChat`, `chatConfig2`, `chatSplit`.
- Aktywny przycisk czatu Twitcha czytelny (fiolet na fiolecie).

### Sesja 2026-11-11 (niezacommitowane)
- **Bug z raportu: „w Multi YouTube sam włącza dźwięk”** — nie dał się odtworzyć na buildzie z 2026-11-10 (Multi, Solo↔Multi, Wycisz wszystko, Jeden↔Cztery, ↺, przeciąganie — próbnik co 50 ms w ramce YT: 0 naruszeń). Utwardzono jedyną lukę: iframe YT dostaje `mute=1` (`ytMutedSrc` w `StreamDock.jsx`), bo kontroler wchodzi dopiero po `did-frame-finish-load`, a wcześniej player grał z własną głośnością. Sprawdzone: nieaktywny YT cichy od startu, aktywowany w Multi gra (muted=false, vol=1).
  - Testy automatyczne na buildzie (4 źródła: 2× Kick, 2× YouTube; próbkowanie co 100 ms z procesu głównego): 45 losowych akcji (Jeden/Cztery, Solo/Multi, Wycisz wszystko, klik dźwięku, suwak, ↺, przeciąganie) — 0 błędów; 12 zamian par docków przeciągnięciem w Multi z 2 grającymi (YT 30% + Kick) — dźwięk i głośność idą za streamem, 0 chwilowych dźwięków. Skrypty: CDP 9333 (renderer) + inspektor 9339 (main).
  - Zgłoszenie usera „dock 4 gra po Jeden→Cztery” okazało się dźwiękiem z przeglądarki.
  - Znane ograniczenie: stan audio YT trzymany per **videoId** — ten sam film w dwóch dockach dzieli wyciszenie.
- **Pełny ekran** — przycisk „⛶ Pełny ekran” w belce + F11 (działa też z fokusem w docku/czacie: `before-input-event` na oknie i każdym webview, `did-attach-webview`). Sprawdzone na buildzie.
- **Nowy czat Chatango** (najpierw jako „Chatango 2”, potem decyzja usera: zostaje tylko ten). Stary wariant usunięty: `CHATANGO_DARK_CSS/JS` + IPC `inject-chatango-dark` (to one dawały czarne kwadraty — bug #1 niżej nieaktualny) i nieużywany wrapper `appstream://chat` z `emb.js`. Zapisany `type: 'chatango2'` migrowany na `chatango` (`migrateChatConfig`, też dla `chatConfig2`).
  - Main `chatango-compact`: ramka czatu `st.chatango.com/h5/...` przypięta `position:fixed` na całą stronę pokoju (nagłówek, reklama, dolny pasek przykryte) i przesunięta w górę o wysokość własnego paska z adresem (`#HEAD`, mierzone → `--kws-shift`). Ukrywanie `#HEAD` psuło układ Chatango (przerwa nad polem wpisywania).
  - Wygląd: tylko punktowe nadpisania reguł Chatango (`#OWBG` tło #101010, `.msg-fg` jasny tekst, ramki, pole wpisywania) — kolory użytkowników (inline), miniatury i podglądy przy hoverze bez zmian. Bez starego `CHATANGO_DARK_JS` (to on dawał czarne kwadraty).
  - Pasek przewijania Chatango (div obok `#OM` w `#OMW`): przeciąganie zaznaczało tekst wiadomości, a przeciąganie zaznaczenia połykało `mouseup` → pasek „przyklejał się” do kursora. Fix w ramce: klasa `kws-nosel` (bez zaznaczania i natywnego drag) na czas trzymania paska + syntetyczny `mouseup`, gdy mysz rusza się bez wciśniętego przycisku.
  - Zasłona „Ładowanie czatu…” do czasu: ramka przypięta + ostylowana + wiadomości narysowane (max 10 s).
  - Linki: `setWindowOpenHandler` na webview czatu → IPC `chat-open-url` → `MediaViewer` (obrazek / plik wideo / YouTube / Streamable z przyciskami „Do docka 1–4” i „Przeglądarka”), reszta → `shell.openExternal`.
  - Parser: Streamable (`streamable.com/<id>` → `/e/<id>`), YouTube `/shorts/`, `m.youtube.com`.
  - Testy (build): klik miniatury → podgląd pełnego obrazka; youtube.com/watch, youtu.be, shorts, streamable, .mp4 → podgląd; „Do docka 4” → Streamable w docku; brak nowych okien Electrona; układ OK po Kick→Chatango 2 i zmianie rozmiaru okna.
- **Ulubione na pasku** — grupa ULUBIONE → „★ Ulubione (N)” (`FavoritesMenu.jsx`): przyciski 1–4 wysyłają stream do docka (akcja `openFavorite`, link parsowany od nowa, nazwa zostaje; podświetlony dock, w którym już gra), ✎ edycja nazwy i linku/nicku (`updateFavorite`; sam nick = ta sama platforma; zmiana samej nazwy aktualizuje nazwę w docku), ✕ usuwa.
- **Wielkość czcionki Chatango** — ⚙ Ustawienia → sekcja Chatango: 100/125/150/175/200% (`chatConfig.fontPct`). Main: `#OM{font-size:N%}` (tylko wiadomości), po zmianie przewinięcie na dół syntetycznym `mousewheel` na `.msg` (na `wheel` Chatango nie reaguje). Zmiana stosowana na żywo, bez przeładowania. Zapis Ustawień nie przełącza już czatu z Kick/Twitch na Chatango, jeśli pokój/typ się nie zmienił.
- **Wielkość czcionki Kick i Twitch** — ⚙ Ustawienia → sekcje „Czat Kick” / „Czat Twitch” (`chatConfig.kickFontPct`, `twitchFontPct`). Oba czaty mają rozmiary w rem → main skaluje `font-size` elementu html (bazowy rozmiar strony zapamiętany przy pierwszym razie). Kick: IPC `set-chat-font` na webview + ponownie przy `dom-ready`; Twitch (iframe w oknie głównym): `set-twitch-chat-font` + `did-frame-finish-load`. Twitch skaluje też swoje przyciski/nagłówek.
- **Elastyczna siatka 2×2** — `DockGrid.jsx`: `grid-template-columns/rows` z `gridSplit {x,y}` (zapisywane, 0.15–0.85). Uchwyt w punkcie przecięcia linii (przeciąganie w dowolnym kierunku), same linie (tylko kolumny / tylko wiersze), uchwyt widoczny dopiero po najechaniu (strefa 28 px), prawy przycisk na uchwycie lub linii (albo dwuklik) = 50/50. Podczas przeciągania osłona nad playerami (webview połyka mousemove), aktualizacja raz na klatkę (rAF).
- **Logo w belce** — ⚡ zamienione na ikonę programu (`src/renderer/src/assets/logo.png` = kopia `resources/icon.png`).

### Do zrobienia (z raportu testów 2026-11-10)
- [ ] **Nieaktualny czat** — po podmianie streama w docku czat dalej pokazuje stary kanał (teraz przynajmniej ma przycisk na pasku).
- [ ] **Nagłówek Chatango widoczny** (logo, Help, Android app, reklama, link) — ukrywanie `.topbar` działało tylko w starym wariancie `emb.js`; trzeba ukryć elementy strony pokoju.
- [ ] **Baner cookies Twitcha** zasłania pół czatu Twitcha.
- [ ] Wyszukiwarka: dokładne trafienie nicku powinno być nad przypadkowymi kanałami LIVE; wyniki Kick bez awatarów/statusu LIVE (poza exact match).
- [ ] Skróty 2–4 nie działają w trybie „Jeden” (`App.jsx`, `handleKey`).
- [ ] Powrót Jeden → Cztery przeładowuje wszystkie streamy.
- [ ] Historia deduplikuje po `embedUrl`, ulubione po `streamKey` — możliwe duplikaty przy innej wielkości liter.
- [ ] Szerokość panelu czatu nie jest zapamiętywana.
- [ ] Nieprzetestowane: logowanie ShowUp, przypinanie okna, czarne kwadraty na miniaturkach Chatango, faktyczne odsłuchanie dźwięku.

### Jak testować (sposób z sesji 2026-11-10)
- Build: `npm run dist` → `dist\KWS MultiStream Setup 1.0.0.exe` + `dist\win-unpacked\`. **Przed buildem zamknąć `dist\win-unpacked\KWS MultiStream.exe`** — inaczej `ERR_ELECTRON_BUILDER_CANNOT_EXECUTE` (pliki zablokowane).
- Sterowanie zbudowaną aplikacją: uruchomić `win-unpacked\KWS MultiStream.exe --remote-debugging-port=9333 --inspect=9339` i przez CDP wykonywać JS w oknie / webview / ramkach (`http://127.0.0.1:9333/json`), a przez inspektor Node — w procesie głównym (`webContents.isAudioMuted()`, `app.getAppMetrics()` itp.). Zrzuty: `Page.captureScreenshot`; crash: `Page.crash`.
- **Przed testami skopiować `%APPDATA%\kws-multistream\config.json`, po testach przywrócić** — testy zmieniają docki/historię użytkownika.

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

### 1. Czarne kwadraty na miniaturkach zdjęć, gifów i filmów w chacie — NIEAKTUALNE (stary motyw usunięty 2026-11-11)

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

**Objaw:** Pasek z logo Chatango, linkami i reklamą widoczny nad czatem.

**Status (2026-11-10): NIE działa.** CSS `.topbar { display: none }` pasował do starego wariantu z `emb.js`. Teraz czat to pełna strona pokoju (`<pokój>.chatango.com`) — trzeba znaleźć i ukryć jej elementy nagłówka.

---

### 3. Ciemny motyw — ogólna architektura

**Jak działa:**
- Webview ładuje stronę pokoju `https://<pokój>.chatango.com/` (komponent `ChatWebview` w `ChatPanel.jsx`)
- `ipcMain.handle('inject-chatango-dark')` wstrzykuje CSS i JS do wszystkich frame'ów przez `wc.mainFrame.framesInSubtree`
- `did-frame-finish-load` dorzuca injection gdy nowy frame się ładuje
- `ChatWebview` wywołuje `injectChatangoDark` po `dom-ready` oraz z retry: 1.2s, 3s, 6s, 10s

**Pliki kluczowe:**
- `src/main/index.js` — `CHATANGO_DARK_CSS`, `CHATANGO_DARK_JS`, handler `inject-chatango-dark`
- `src/renderer/src/components/ChatPanel.jsx` — `ChatWebview`, `ChatPane`, `ChatPicker`
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

---

## Środowisko

```
Node.js 26 + npm
electron-vite 2, Electron 45
React 18
electron-store
```

Uruchomienie dev:
```
npm run dev
```

Build + instalator:
```
npm run dist
```
