# KWS na Android TV / Google TV — notatka z researchu (2026-11-11)

Cel: oglądać streamy na TV (box **Kinhank G1**), a na telefonie wybierać źródła i zmieniać ustawienia.
Status: **tylko research** — nic nie zbudowane. Start, gdy będzie odnowiony limit.

## Werdykt

**Szanse na działający soft: dobre.** Niepewna jest tylko liczba streamów naraz w dobrej jakości —
trzeba ją zmierzyć na G1, zanim zaczniemy właściwą aplikację.

- Realne na pewno: 1 duży stream (720p–1080p) + pilot na telefonie.
- Raczej realne: 1 duży + 2–3 małe w 480p (natywny odtwarzacz).
- Do sprawdzenia: 4 × 720p naraz.
- Prawie na pewno za ciężkie: 4 strony playerów naraz w WebView (tak jak robi wersja na PC).

## Sprzęt — Kinhank G1 (wg specyfikacji ze sklepów)

- SoC **Amlogic S905X4**, 4× Cortex-A55, GPU Mali-G31 MP2 (słabe CPU/GPU)
- **4 GB RAM**, 32 GB eMMC, Wi-Fi 6, Ethernet, BT 5.0
- Android TV z certyfikatem Google — zależnie od partii **Android 11 albo 14** (sprawdzić na sztuce)
- Sprzętowe dekodery H.264 / H.265 / VP9 / AV1 — dobrze, bo z tego korzystają Twitch, Kick, YouTube
- Ile strumieni naraz pociągnie dekoder (multi-instance) — zależy od sterowników Amlogica, **nieznane bez testu**

Źródła: minukaubad.ee (oferta G1, Android TV 14, 4 GB/32 GB), manuals.plus (B0CYZGWS8K),
parsers.vc („The KINHANK G1: A Hidden Gem”, Antutu ~130k), desertcart.sg (partia z Androidem 11).

## Architektura (propozycja)

Electron nie działa na Androidzie → osobna aplikacja na TV + pilot na telefonie, rozmowa w sieci domowej.

### Aplikacja na TV (APK)
- Kotlin + Jetpack Compose for TV (androidx.tv). Tylko oglądanie: pełny ekran, układ 1 / 4, czat opcjonalnie.
- Odtwarzanie hybrydowe:
  - **Kick, Twitch → Media3 / ExoPlayer** (natywny HLS): dużo lżejszy niż strona playera, można wybrać jakość
    (480p dla małych docków). ⚠️ Adresy HLS idą przez **nieoficjalne API** (Twitch GQL playback token, Kick API
    za Cloudflare) — mogą się zmienić, Twitch potrafi wstawiać reklamy w strumień.
  - **YouTube → oficjalny embed w WebView** (regulamin YT zabrania wyciągania strumienia). Raczej jako pojedynczy dock.
  - Zapas: oficjalne embedy Twitch/Kick w WebView (pewniejsze, ale cięższe).
- Dźwięk Solo/Multi = głośności poszczególnych odtwarzaczy (prościej niż na PC).
- Na TV mały serwer **HTTP + WebSocket** (np. Ktor / NanoHTTPD) — przez niego steruje telefon.

### Pilot na telefonie — strona WWW, nie osobna aplikacja (rekomendacja)
- TV pokazuje **kod QR** → telefon otwiera panel serwowany przez TV. Nic do instalowania, działa też na iPhonie.
- Panel = w dużej mierze kod z KWS na PC: `streamParser.js` (rozpoznawanie linków), wyszukiwarka Twitch/Kick,
  ulubione, Solo/Multi, układ, ustawienia czatu. Zmiany idą na TV na żywo przez WebSocket.

### Czego z wersji PC nie będzie / nie ma sensu
- Dock streamerski z kamerką (TV nie ma kamerki)
- strumyk.cv (Cloudflare blokuje także Electrona; na TV to samo)
- Przeciąganie siatki myszą → gotowe układy wybierane z telefonu / pilotem
- Chatango: możliwy w WebView na TV albo tylko na telefonie — do decyzji

## Plan

1. **Test wykonalności (najpierw):** minimalne APK w osobnym katalogu (nie rusza KWS), odtwarza 1/2/3/4 streamy
   Kick/Twitch przez ExoPlayer w różnych jakościach + wariant YouTube w WebView; na ekranie: zgubione klatki,
   CPU, RAM. Wynik → ile docków i jaka jakość.
2. **MVP:** aplikacja TV (siatka, dźwięk) + panel na telefonie przez QR (wybór streamów, ulubione, Solo/Multi, układ).
3. **Potem:** czat na TV lub telefonie, synchronizacja ulubionych z KWS na PC, obsługa pilota TV (D-pad),
   ewentualnie Google Play (dodatkowe wymagania dla TV — na start wystarczy instalacja ręczna APK).

Szybka alternatywa bez programowania: KWS na PC + obraz na TV (Chromecast / HDMI) — gorsza jakość i opóźnienie.

## Co jest gotowe / potrzebne

- Na PC jest **Android Studio + Android SDK** (`%LOCALAPPDATA%\Android\Sdk`: platform-tools z adb, build-tools,
  platforms, emulator). `java`/`adb` nie są w PATH — użyć JBR z Android Studio i `platform-tools\adb.exe`.
- Od usera do testu (żeby Claude sam instalował APK i czytał wyniki):
  1. G1: Ustawienia → System → Informacje → 7× „Kompilacja” (opcje programisty)
  2. Opcje programisty → „Debugowanie USB” (+ „ADB przez sieć”, jeśli jest)
  3. Adres IP boxa (Ustawienia → Sieć) → `adb connect <ip>:5555`, zatwierdzić „Zezwól na debugowanie” na TV
  - Alternatywa: gotowe APK do ręcznej instalacji (pendrive / aplikacja Downloader), wyniki odczytane z ekranu.

## Otwarte decyzje

- 4 streamy naraz czy 1 duży + 2–3 małe? (rozstrzygnie test)
- Pilot: strona przez QR (rekomendacja) czy natywna aplikacja na telefon?
- Czat: na TV, na telefonie, czy oba?
