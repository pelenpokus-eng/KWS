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

### Sesja 2026-11-11 (commit 56a4d47)
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
- **Redesign paska (wg promptu z Gemini, po commicie 56a4d47)** — tło #0e0e11, kapsuły `tb-pill` (#18181b, ramka rgba(255,255,255,.06), radius 10px) z segmentami `tb-seg`, akcent #7c3aed z poświatą, ikony SVG zamiast emoji. Grupy: logo „KWS Multistream” · [1|4] · [Solo|Multi | Wycisz wszystko] · [1 czat|2 czaty] · Ulubione (badge z liczbą) · … · [przypnij|pełny ekran|ustawienia] (same ikony, opisy w tooltipach). Aktywne „Wycisz wszystko” = stonowana czerwień, napis stały (bez przesuwania paska). Klasy tylko dla paska — `.btn` w oknach bez zmian. Działanie bez zmian (ulubione dalej z przyciskami 1–4).
- **Filmy YouTube z Chatango w popupie aplikacji** — Chatango pokazuje link YT jako `.video-thumb` (img `img.youtube.com/vi/<id>/`) i odtwarzał go w małym okienku w czacie. W ramce czatu (`CHATANGO_FRAME_JS`) przechwytywanie mousedown/mouseup/click w fazie capture → `window.open(youtube.com/watch?v=id)` → `MediaViewer` (Do docka 1–4 / Przeglądarka). Sprawdzone prawdziwym kliknięciem: brak okienka w czacie, brak nowych okien Electrona.
- **Auto-wyciszenie docków przy filmie z czatu** — `App.jsx`: popup z filmem (YouTube/Streamable/plik wideo, nie obrazek) włącza „Wycisz wszystko”, zamknięcie (też „Do docka N”) przywraca stan sprzed kliknięcia. Jeśli docki były już wyciszone albo user sam włączy dźwięk w trakcie — zamknięcie nic nie zmienia (`viewerMutedRef`). Przetestowane scenariusze A–E.
- **Ustawienia jako osobny okrągły przycisk** przed grupą Okno (`.tb-round`).
- **Pasek — ikony i X** — ikony w stylu Lucide (24px viewBox, stroke 2): koło zębate, pinezka, ramki pełnego ekranu, głośniki (Solo 1 fala / Multi 2 fale / wycisz z X), dymki czatu, siatka, gwiazdka, strzałka. Grupa Okno: przypnij · ustawienia · pełny ekran · **X** (IPC `quit-app` → `app.quit()`, czerwony na hover). Auto-wyciszenie od filmu z czatu nie jest zapisywane (`muteAll: viewerMutedRef ? false : muteAll`).
- **Okno bez systemowej ramki** — `frame: false`; pasek aplikacji = pasek tytułu (`-webkit-app-region: drag` na `.toolbar`, przyciski no-drag). W grupie Okno doszły – (minimalizuj) i ▢/przywróć (IPC `window-minimize`, `window-toggle-maximize`, zdarzenie `maximized-changed`). Sprawdzone: okno = treść (brak ramki), min/max/przywróć. NIEsprawdzone automatycznie (CDP omija hit-test Windows): przeciąganie okna za pasek, dwuklik w pasek, zmiana rozmiaru krawędziami.
- **Źródło strumyk.cv** — `streamParser`: `strumyk.cv/#<id>` → platforma `strumyk` (id z fragmentu URL), dock ładuje stronę + `focus-video-player` jak ShowUp. Strona jest za Cloudflare Turnstile: dock wykrywa stronę weryfikacji po tytule (`CHECK_TITLE`) i pokazuje „Strona wymaga weryfikacji” + przycisk → okno `open-site-check` (domyślna sesja, tylko https://strumyk.cv) — user sam klika pole, zamknięcie okna przeładowuje docki strumyk (`site-session-changed`). Weryfikacja NIE przechodzi w Electronie także w normalnej wersji (user: pętla „Potwierdź, że jesteś człowiekiem”) — Cloudflare odrzuca Electrona; świadomie NIE podszywamy się pod Chrome (obchodzenie zabezpieczeń). Komunikat w docku ma „↗ Otwórz w przeglądarce” (openExternal) + „Spróbuj weryfikacji tutaj”. Do zrobienia: jeśli user poda adres samego playera (iframe/video z innej domeny bez Cloudflare) — osadzać go bezpośrednio. Nieznane: czy wideo jest w <video> na stronie (może być w iframe innej domeny — wtedy focus-video go nie znajdzie).
- **Menu pod prawym przyciskiem** — main `showContextMenu` (okno główne + każdy webview przez `did-attach-webview`): pola tekstowe Wytnij/Kopiuj/Wklej/Zaznacz wszystko (wg editFlags), zaznaczony tekst Kopiuj, link Kopiuj adres / Otwórz w przeglądarce. Dock (`.stream-dock`), ulubione (`.fav-row`), historia (`.history-row`) mają `data-copy-link/name` → renderer wysyła `context-extra` → „Kopiuj link streamu / Kopiuj nazwę”. Przetestowane z podmienionym `Menu.buildFromTemplate`; menu w czacie (webview) niesprawdzone.
- **Tuba — 5. stream (co-watch)** — `Tube.jsx` + `TubeSettings.jsx`, stan `tube` w app-state (`enabled, mode link|camera, stream, cameraId, audio, volume, size`). Świecąca szklana kapsuła na przecięciu linii siatki; jest uchwytem siatki (przeciąganie z zachowaniem punktu chwytu, prawy przycisk = 50/50), zwykły uchwyt wtedy schowany; tylko widok 4 docków. Link: webview/iframe YT renderowany 16:9 w wysokości tuby i wyśrodkowany (efekt „cover”); kamerka: getUserMedia (lustrzane odbicie). Dźwięk tuby: osobny przełącznik (🔊 na tubie + suwak w ustawieniach), niezależny od Solo/Multi i „Wycisz wszystko”; przy kamerce = mikrofon (ostrzeżenie o echu). Przycisk „Tuba” w kapsule Docki. Na tym PC brak kamerki → tryb kamerki sprawdzony tylko pod kątem komunikatu błędu.
- **Ustawienia streamerskie** — przycisk „Streamer” na pasku (i ⚙ na tubie) → `StreamerPanel.jsx`: panel w prawym górnym rogu, nie zasłania tuby, zmiany na żywo (bez Zapisz). Sekcje: Tuba (wł./wył., źródło link/kamerka, rozmiar), Kadrowanie (suwaki Przybliżenie 50–400%, Poziomo/Pionowo ±100% szerokości/wysokości ekranu tuby, Reset kadru, „Kadruj myszą na tubie” → tryb na tubie: przeciąganie = przesunięcie, kółko = zoom, owalna ramka na głowę, Gotowe/Reset), Dźwięk tuby. `tube.frame {zoom,x,y}` zapisywane. `TubeSettings.jsx` usunięty.
- **Tuba z grafiki usera** — `tuba.png` (725×1877, od usera) → `assets/tube-skin.png`: szkło przerobione na półprzezroczyste (alfa 0.20–0.62 wg jasności; bitmapy nativeImage są premultiplied!). Okno szkła w grafice: x 100–630, y 178–1250 px (`SKIN_GLASS`). Pod szkłem ciemnoniebieskie tło (`.tube-backdrop`), na nim obraz z maską, na wierzchu grafika. Wygląd do wyboru: „Grafika tuby” (domyślnie) / „Ramka 4:3” — prostokąt 4:3 (200/260/340 px szer.) z obramowaniem z conic-gradient, którego kąt `--tube-angle` (@property) jest animowany (4 s/obrót, 1,2 s przy przeciąganiu) + rozmyta poświata `.tube-frame-glow`. Stara „Neonowa” kapsuła usunięta (zapisane `skin: neon` → grafika). W ramce 4:3 zawsze czysty obraz — maska działa tylko przy grafice tuby (sekcja maski w panelu ukryta przy ramce). Przycisk na pasku nazywa się „Dock streamerski”. Rozmiary dla grafiki: wysokość 260/340/450 px.
- **Maska głowy** — `tube.mask {on,w,h,y,soft}`: CSS `mask-image: radial-gradient(ellipse …)` na obrazie tuby; suwaki w Ustawieniach streamerskich; podczas kadrowania maska wyłączona, a jej elipsa rysowana jako ramka pomocnicza.
- **Fade tuby** — przycisk „Tuba”: opacity + scale 0.4 s; tuba zostaje zamontowana na czas wygaszania. Timer zamiast requestAnimationFrame (rAF staje, gdy okno jest zasłonięte, np. przez OBS).
- **Dock streamerski na pasku** — jedna kapsuła [Dock streamerski ┆ Ustawienia] zaraz za Docki (przełącznik + panel Ustawień streamerskich); stary przycisk „Streamer” po prawej usunięty. Domyślny wygląd docka: Ramka 4:3 (`DEFAULT_TUBE.skin = frame`).
- **Pasek przy wąskim oknie** — media queries chowają tekst stopniowo: ≤1700 „Multistream”, ≤1560 etykiety grup, ≤1380 napisy Wycisz/Ustawienia/Ulubione, ≤1180 wszystkie napisy (same ikony + tooltipy). Sprawdzone 1600/1400/1200/950 px — nic nie wychodzi poza okno.
- **Ukrywanie górnego paska** — ⚙ Ustawienia → „Górny pasek: Zawsze widoczny / Ukrywaj automatycznie” (`autoHideToolbar`). Pasek nie nachodzi na streamy: wiersz paska ma wysokość `--tb-h` (zarejestrowane @property, animacja 0.25 s 46px↔0), więc docki i czat zmniejszają się w pionie; pasek wysuwa się marginesem (nie transform — psuł position:fixed osłon w dropdownach). Wysuwa się po najechaniu na 6-px strefę u góry, chowa 0,7 s po zjechaniu (+ zapas przez mousemove, gdy przeglądarka nie zgłosi opuszczenia). Zostaje przy otwartych: Ustawienia, Ustawienia streamerskie, podgląd filmu, lista ulubionych. Testy: okno testowe przesuwać poza ekran (setPosition) — inaczej prawdziwa mysz usera zakłóca hover.
- **Nagrywanie docka** — przycisk ⏺ w pasku docka; main wstrzykuje do strony playera `captureStream()` największego <video> + `MediaRecorder` (WebM VP9/Opus, 6 Mb/s), strona kolejkuje 1-s kawałki (base64), main co 1 s ściąga je `executeJavaScript` i dopisuje do pliku `WideoKWS MultiStream<nazwa> <data>.webm`. Działa przy wyciszonym docku (captureStream ignoruje muted). Koniec: przycisk / znaczek REC, zmiana streamu, przeładowanie, zniknięcie wideo. Jakość = jakość odtwarzana w docku (mały dock YouTube → 480p). WebM z MediaRecorder nie ma zapisanej długości (część odtwarzaczy nie pokaże czasu trwania). Sprawdzone: YouTube 854×480 i Kick 1280×720, obraz + dźwięk.
- **Nagrane (pasek)** — `RecordingsMenu.jsx`: lista plików z folderu nagrań (data, rozmiar), ▶ otwórz w systemowym odtwarzaczu, 📁 pokaż, ✕ do Kosza (shell.trashItem, tylko pliki z folderu nagrań), „Otwórz folder nagrań”; pulsująca czerwona kropka, gdy coś się nagrywa (`rec-active`). Progi chowania napisów na pasku przesunięte (1840/1720/1500/1260).
- **Jakość w docku** — przycisk w pasku docka (Auto/Max/1080p/720p/480p/360p), `dock.quality` zapisywane jak głośność. YouTube: `movie_player.setPlaybackQualityRange` w ramce embedu, wymuszane co 3 s + ponownie przy przeładowaniu ramki (IPC `set-youtube-quality`). Twitch: automatyczny wybór w menu playera Settings → Quality (`player-settings-button` → `player-settings-menu-item-quality` → `player-settings-submenu-quality-option`) po każdym załadowaniu (IPC `set-twitch-quality`). Kick: embed nie ma menu jakości ani API (player IVS sam dobiera) → przycisk wyszarzony; pozostałe źródła też. Sprawdzone: YT 480p→1080p→2160p, Twitch 720p→480p→1080p, zachowane po restarcie.
- **Czytelne przyciski** w listach Nagrane i Ulubione (jasne ▶/📁/✎, czerwony ✕, wyraźne 1–4); listy z paska rozwijają się w lewo od prawej krawędzi przycisku i nie wychodzą poza okno.
- **YouTube: film nie do odtworzenia w docku** — YouTube blokuje filmy 18+ (i usunięte/prywatne/z wyłączonym osadzaniem) w każdym osadzonym playerze; logowania Google w Electronie nie robimy (Google blokuje „niezabezpieczone przeglądarki”). Main `yt-status`: `playabilityStatus` z `movie_player.getPlayerResponse()` / `ytcfg PLAYER_VARS.embedded_player_response`, a gdy player nie wstał — tekst komunikatu ze strony. Dock odpytuje co 3 s (15 s gdy OK) i pokazuje planszę: „Film z ograniczeniem wiekowym” (wykrywane po treści/statusie) albo „YouTube nie odtworzy tego filmu tutaj” + powód, przyciski ↗ Otwórz w przeglądarce / ↻ Spróbuj ponownie. Sprawdzone na usuniętym filmie; wariant 18+ niesprawdzony (brak znanego ID).
- **Chrome przyklejony do docka (eksperyment)** — dla YouTube 18+ i strumyk.cv: przycisk „⧉ Otwórz w Chrome w docku” na planszy. Main uruchamia Chrome (zapas: Edge) `--app=URL` na profilu usera (zalogowany → weryfikacja wieku działa), znajduje nowe okno `Chrome_WidgetWin_1` (różnica listy przed/po), ustawia właściciela = okno KWS (zostaje nad KWS, chowa się z nim), usuwa styl ramki, a przy każdej zmianie pozycji/rozmiaru docka (ResizeObserver + odpytywanie 400 ms + move/resize okna KWS) ustawia okno nad dockiem; własny pasek tytułu Chrome (31 px) i ramki są obcinane regionem okna (SetWindowRgn). Win32 przez pomocnika PowerShell `src/main/winhelper.ps1` (import `?raw`, zapis do temp). YouTube: zwykła strona `watch?v=` (watch_popup okazał się przekierowaniem na /embed/ — embed nigdy nie gra 18+, a bez Referera daje błąd 153), przycięta regionem do samego playera: do ~1000 px szerokości YouTube ma jedną kolumnę, player od lewej krawędzi pod 56-px paskiem, szer. = okno − 15 px scrollbara, wys. = szer.·9/16 + 8 (zmierzone w ukrytym oknie dla 500–1300 px); okno ≤ 990 px, player wyśrodkowany w docku (komenda helpera PLACE); widoczny obszar przycięty 6 px od prawej i 12 px od dołu (u usera prześwitywało białe tło strony — inny scrollbar/wysokość playera w Chrome niż w pomiarze). Górne 30 px docka zostaje dla KWS: pasek „⧉ Stream w oknie Chrome” z ↻ i ✕ (bo zakryta plansza z przyciskiem zamykania była niewidoczna). Dźwięk/jakość tylko w samym playerze; nie nagrywa się ⏺. Sprawdzone: pozycja = dock, podąża za oknem KWS, właściciel, zamykanie.
- **Chrome w docku v3 — osobny profil + sterowanie** — Chrome uruchamiany z `--user-data-dir=<userData>/chrome-profile --remote-debugging-port=0` (Chrome od 136 nie pozwala sterować domyślnym profilem; osobny tak). Port czytany z `DevToolsActivePort` w profilu (działa też, gdy profil już chodzi). Przez CDP (`Runtime.evaluate`, WebSocket z main): YouTube — CSS chowa stronę i rozciąga `#movie_player` na całe okno (koniec z przycinaniem/białymi pasami; okno = dock minus pasek KWS, przycinany tylko pasek tytułu Chrome); dźwięk — `__kwsExtA` co 700 ms ustawia volume/muted na <video> + `movie_player.setVolume/mute`. Dock wysyła stan jak dla własnego playera (muteAll / Solo-Multi / suwak) przez `ext-audio`. Pasek KWS nad oknem: mute, suwak, ↻, ✕ (hover-kontrolki docka schowane). Logowanie: ⚙ Ustawienia → „Zaloguj do YouTube w Chrome dla KWS” (okno profilu bez sterowania). Sieroty po awarii KWS (strony youtube/strumyk w profilu) zamykane przy pierwszym otwarciu sesji, z czekaniem aż stary Chrome się wyłączy; nowa strona wybierana spoza listy „przed”; zapytania z limitem 2 s. Fallback bez sterowania: stare przycinanie strony watch. Sprawdzone przez wywołania IPC: sterowanie, dźwięk (0,25/0,40/0,55/0,65, mute), wypełnienie, sprzątanie sierot, zamykanie przy wyjściu.
- **Tytuł jako proponowana nazwa** — w oknie dodawania streamu po wklejeniu linku pole „Etykieta” dostaje od razu etykietę z parsera, a po chwili prawdziwy tytuł (main `stream-title`): YouTube oEmbed (zapas: og:title strony z anonimowej sesji — oEmbed potrafi odmówić dla 18+), Streamable oEmbed, Twitch GQL (displayName; klip: „kanał: tytuł”), Kick API v2 (username), inne linki og:title/<title>. Nadpisuje tylko nazwę zaproponowaną przez KWS (`autoLabel`), nigdy wpisaną przez usera; wyczyszczenie pola przywraca podpowiedzi. Sprawdzone: YT (też 18+), Twitch, Kick, Wikipedia; własna nazwa zostaje.
- **Ulubione — eksport/import do pliku** — dół listy Ulubione na pasku + ⚙ Ustawienia → „Ulubione — plik” (`FavoritesFile` w `FavoritesMenu.jsx`). Plik JSON `{ app, kind: 'favorites', version: 1, exportedAt, favorites[] }` (domyślnie Dokumenty\KWS ulubione RRRR-MM-DD.json). Import dopisuje do obecnych, pomija już istniejące (streamKey), linki parsuje na nowo (format embedów tej wersji). Sprawdzone (dialogi podmienione w teście): eksport 3, usunięcie 2, import → dodano 2, ponowny import → bez duplikatów.
- **Czyszczenie danych aplikacji** — ⚙ Ustawienia → „Dane aplikacji” (dwuklik: pierwszy uzbraja przycisk). „Wyczyść dane przeglądania”: `clearStorageData` + cache + auth cache sesji domyślnej (logowania YouTube/ShowUp/Chatango, ciasteczka), usuwa profil Chrome KWS; docki/ulubione/ustawienia zostają. „Reset całej aplikacji”: to samo + `store.clear()` (zapis stanu z renderera zablokowany `storeLocked`). Potem `app.relaunch()`. Nagrania nietknięte. Uwaga: odinstalowanie NIE usuwa `%APPDATA%\kws-multistream` — stąd po reinstalacji film 18+ grał bez logowania (stare ciasteczka; zwykłe „Wyloguj” najwyraźniej nie widzi wszystkich — `cookies.get` może pomijać ciasteczka partycjonowane — do sprawdzenia). Sprawdzone na kopii danych: ciasteczko testowe i profil Chrome znikają, ulubione zostają; reset → 0 ulubionych, puste docki.
- **Testy na osobnych danych** — zmienna `KWS_USER_DATA=<folder>` przestawia `userData` (config, ciasteczka, profil Chrome) — test nie rusza danych usera, można testować przy działającym zainstalowanym KWS.
- **YouTube 18+ w docku — konto YouTube w KWS (zastępuje Chrome w docku dla YouTube)** — Google nie pozwala logować się w Electronie, a embed nie gra 18+. Rozwiązanie: user loguje się raz w profilu Chrome KWS (`<userData>/chrome-profile`, zwykły Chrome bez sterowania); main kopiuje ciasteczka youtube.com/google.com z profilu do `session.defaultSession` (headless Chrome na profilu → CDP `Storage.getCookies`; albo przez działającą instancję z portem). ⚙ Ustawienia → „Konto YouTube”: status, Zaloguj (okno Chrome; po jego zamknięciu — `exit` procesu + czekanie na `lockfile` — automatyczny import), Wyloguj (usuwa te ciasteczka). Dock: embed zgłasza ograniczenie wiekowe + KWS zalogowany → dock przełącza się sam na `<webview>` ze zwykłą stroną `youtube.com/watch?v=` (`ytWatch`, pamiętane na sesję w `ytWatchIds`); main `yt-watch-prep` wstrzykuje CSS (tylko `#movie_player` na cały dock, bez ambient `#cinematics`), wyłącza autoodtwarzanie następnego i sam klika „Rozumiem i chcę kontynuować” na planszy „potencjalnie kontrowersyjne treści” (`CONTENT_CHECK_REQUIRED`, `.interstitialViewModelButtonContainer`). Wtedy dock działa jak zwykły webview: mute/głośność (webContents), jakość (`ytQualityScript` w stronie), nagrywanie ⏺ (wcId). Niezalogowany → popup „Film z ograniczeniem wiekowym — zalogować się?” (Tak → okno logowania, po zamknięciu film rusza sam; Nie → plansza z „Zaloguj do YouTube”; raz na film na sesję, `YtLoginPrompt.jsx`, zdarzenie `kws-yt-ask-login`). Rozpoznawanie: komunikat embeda bywa różny, więc przy błędzie embeda main (`yt-check-watch`) pobiera anonimowo stronę watch (osobna sesja `kws-yt-anon`, `hl=en`, SOCS) i czyta `playabilityStatus`: OK → sam embed zablokowany, dock od razu przechodzi na stronę watch (bez logowania); „Sign in to confirm your age” → 18+; strona watch też odmawia (sesja wygasła) → „Zaloguj ponownie”. Uwaga: część filmów 18+ gra w embedzie nawet bez logowania (np. `HtVdAasjOgU`) — do testów używać `SZJvDhaSDnc` / `Tq92D6wQ1mg` (embed blokuje). Sprawdzone: import 47 ciasteczek, automatyczne przełączenie po starcie aplikacji, odtwarzanie (OK, 640×360 Auto → 1280×720 Max), mute, głośność 35%, nagranie 6 s = 4,3 MB, przycisk logowania (okno → zamknięcie → import 50 ciasteczek). Ryzyko: Google może kiedyś unieważnić skopiowaną sesję (powiązanie sesji z urządzeniem) — wtedy plansza „Zaloguj ponownie”. Stary „Chrome w docku” zostaje dla strumyk.cv.
- **goodzone.live — własny player HLS** — link `goodzone.live/live/<kanał>` (też `goodzone.live/<kanał>`) → platforma `goodzone`, `embedUrl = kwsplayer://goodzone/live/<kanał>`. Strona nie ma embeda, ale w danych strony (`live.playbackUrl`) jest zwykły HLS `hls1.goodzone.live/ch/<hash>.hls/master.m3u8` (CORS `*`, bez tokenu, 1080/720/360/144p). Main (`src/main/hlsPlayer.js`, protokół `kwsplayer://`) przy każdym załadowaniu docka pobiera stronę kanału, wyciąga `playbackUrl` i zwraca stronę z gołym `<video>` + hls.js (`node_modules/hls.js` jako `?raw`, serwowany pod `kwsplayer://goodzone/hls.js`) — więc adres streamu nigdy nie jest nieaktualny, a wyciszanie/głośność (webContents) i nagrywanie ⏺ działają bez zmian. Offline → plansza i ponowna próba co 30 s; brak kanału / błąd sieci → komunikat, próba co 20 s; zerwany fragment → `hls.startLoad()` (do 4×), potem przeładowanie. Jakość w docku działa (IPC `set-hls-quality` → `window.__kwsQuality`). Sprawdzone na Karabasandboss2: dodanie przez okno dodawania, gra 720p (Auto), Max→1080p, 360p, 720p, Auto bez przeładowań przez ~3 min, nagranie 7 s = 3 MB WebM, nieistniejący kanał → komunikat.
- **Logo w belce** — ⚡ zamienione na ikonę programu (`src/renderer/src/assets/logo.png` = kopia `resources/icon.png`).

### Sesja 2026-11-21 — napisy PL na żywo (niezacommitowane)
- **Przycisk CC w docku** — `src/main/captions.js` + `StreamDock.jsx`. Dźwięk TYLKO z danego docka (`captureStream()` na `<video>` → AudioContext/ScriptProcessor → 16 kHz Int16, main pobiera co 0,5 s jak przy nagrywaniu; działa też na wyciszonym docku) → lokalny **whisper.cpp server na CUDA** (`large-v3-turbo-q5_0` + VAD silero) → **Google Translate** (nieoficjalny endpoint `translate.googleapis.com/translate_a/single?client=gtx`, bez klucza) → nakładka w docku.
- Whisper pobierany przy pierwszym CC do `<userData>/whisper` (~1,2 GB: paczka `b5454` **CUDA 12.4** — paczka CUDA 11.8 nie ma cuBLAS i chodzi na CPU, 44 s na 5 s mowy; na 3060 Ti GPU: ~0,4 s na 5 s, ~900 MB VRAM). Serwer na wolnym porcie 127.0.0.1, gaszony 3 min po wyłączeniu ostatniego CC i przy wyjściu.
- Cięcie na frazy po pauzie ≥300 ms (min 2,5 s, max 8 s). Gotowe frazy mają pierwszeństwo w kolejce; gdy GPU wolne — **robocza linia** (całe dotychczasowe zdanie) co ~1 s na dock, tłumaczona max co 1,2 s; żółty pasek z lewej. Filtr halucynacji Whispera (napisy-kredyty RU/UK).
- **Jedna płynąca linia + cięcie po zdaniach**: robocze zapytania idą z timestampami i bez VAD; gdy robocza linia ma skończone zdanie (`.!?…`) a mowa trwa dalej, dźwięk jest cięty w `segments[k].end` i zdanie od razu staje się gotową linią (bez ponownego Whispera). W docku widać bieżące zdanie; poprzednie gotowe zostaje nad nim najwyżej 2,5 s (`CAP_KEEP_MS`), bez nowej mowy znika po 9 s. Serwer z `-nlp` (bez liczenia prawdopodobieństw języków przy każdym zapytaniu).
- **W głównej linii tylko polski**: robocza linia bez tłumaczenia nie jest pokazywana (pierwsza wersja każdego zdania tłumaczona od razu, kolejne co 1,2 s); gotowe zdanie czeka na tłumaczenie, oryginał zamiast niego tylko gdy Google zawiedzie lub >3 s (`CAP_TR_WAIT_MS`). Oryginał = mała szara linia przy „Oryginał”. Test: 273 próbki, 0 z cyrylicą.
- **Panel „Tłumaczenie”** (pasek → grupa Czat → „Tłumaczenie”; `TranslationPanel.jsx`, magazyn `utils/captionLog.js`): po lewej od czatów, stos czytany od dołu — na dole „teraz” (robocza linia, żółta), wyżej ostatnie gotowe zdanie (wyróżnione), wyżej archiwum (500 zdań, na czas działania aplikacji). Godzina + nazwa docka (gdy CC w kilku dockach). Jedna czcionka dla wszystkich wierszy (15 px/500, bez kursywy) — stan tylko kolorem/tłem/paskiem z lewej (zawsze 3 px), żeby zdanie nie przeskakiwało przy czytaniu; tekst jaskrawozielony `#4ade80`. W nakładce w docku też bez kursywy. W panelu tylko polski (bez oryginału — zawyżał wysokość stosu; zdanie bez tłumaczenia się nie pokazuje). Przewinięcie w górę zatrzymuje auto-przewijanie („↓ Najnowsze”). Gdy panel otwarty — nakładki z napisami w dockach schowane (zostaje tylko status: pobieranie itp.). Zapisywane: `transPanel`, `transWidth`. Etykieta docka idzie w zdarzeniach `cap-event` (`label`). Sprawdzone: 2 docki, 22 wiersze/40 s, zamknięcie panelu → napisy wracają na obraz, ponowne otwarcie → historia zachowana.
- **Poprawki po konsultacji z Gemini/Perplexity (2026-11-21)**:
  - Języki: w trybie Auto tylko RU/UK. Gdy Whisper wykryje coś innego (BE/BG/PL…), gotowe zdanie jest rozpoznawane jeszcze raz z wymuszonym językiem (`ruOrUk`: і ї є ґ → uk, ы э ъ ё → ru, inaczej ostatni wykryty / uk); robocze zapytania po pierwszym wykryciu idą z `lastLang`. Do Google zawsze RU/UK, tłumaczenie zawsze (wcześniej „polski” = brak tłumaczenia).
  - Halucynacje: kredyty napisów zawsze wyrzucane; „спасибо за просмотр”, „подписывайтесь” itp. tylko gdy <50% fragmentu miało dźwięk.
  - Cięcie po 8 s z zakładką 0,5 s; powtórzone słowa na styku kolejnych linii usuwane (`dedupeStart`, do 3 słów; po zwykłej pauzie tylko ≥4 litery). Test: 41 styków, 0 powtórzeń.
  - Pobieranie dźwięku co 150 ms (było 500).
  - Robocze linie: słuchany dock co ~0,9 s, wyciszone co ~1,9 s (gdy CC w kilku dockach; `audible` z docka).
  - Na później: LocalAgreement-2, prompt z poprzednim zdaniem, Silero VAD w main, lokalny tłumacz 4B (TranslateGemma / Gemma 3 4B) albo DeepL Free z `context`.
- Opcje nad napisami (hover): Auto/RU/UK + Oryginał, pamiętane w store `captionPrefs`.
- Sprawdzone (KWS_USER_DATA, 2 docki YouTube: RU FREEДOM + UK Telemaraton, jeden wyciszony): oba docki naraz, robocze linie co ~1,03 s na dock, 0 zgubionych fraz w 42 s.
- Pierwsza instalacja sprawdzona na buildzie (pobranie 653 MB paczki → rozpakowanie → start → napisy). Naprawiony wyścig: CC + pierwsza fraza w kolejce startowały DWA serwery Whisper po pobraniu (`ensureServer` trzyma teraz jedną obietnicę startu).
- Debug: `KWS_CAP_DEBUG=1` → `<userData>/cap-debug.log` (hook ramki, statusy, zdarzenia).
- Pomysł na później: synchronizacja przez opóźnienie obrazu (drugi, ukryty player na żywo do dźwięku; widoczny cofnięty ~8 s) — tylko YouTube/HLS, Twitch/Kick embed się nie cofa.

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
