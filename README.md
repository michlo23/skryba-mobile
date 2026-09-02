# Skryba mobile

Skryba na telefon: otwierasz apkę, dotykasz wielkiego przycisku, mówisz,
dotykasz ponownie — tekst pojawia się na ekranie i ląduje w schowku. Ta sama
transkrypcja co w [Skrybie](../Skryba) na macOS: **ElevenLabs Scribe**
(`scribe_v2`), więc polski brzmi tak samo dobrze.

To PWA — zwykła statyczna strona, którą dodajesz do ekranu głównego. Działa
na iPhonie i na Androidzie, bez App Store, bez konta developerskiego i bez
terminu ważności.

## Dlaczego bez backendu

Scribe odpowiada przeglądarce nagłówkiem `access-control-allow-origin: *`, więc
telefon rozmawia z ElevenLabs bezpośrednio, a klucz siedzi w `localStorage` na
urządzeniu. Nagranie nie przechodzi przez żaden pośredni serwer — nie ma go,
kto by postawił.

Konsekwencja: klucz jest tylko tak bezpieczny, jak sam telefon, a każdy, kto
zna adres i doda tam swój klucz, płaci za własne transkrypcje. Do prywatnej
apki to dobry układ. Gdybyś kiedyś chciał ten adres komuś podać, właściwą
odpowiedzią jest mały proxy trzymający klucz po stronie serwera.

## Uruchomienie

Strona musi iść po **HTTPS** — bez tego przeglądarka nie da dostępu do
mikrofonu. `localhost` też się liczy jako bezpieczny, więc lokalnie wystarczy:

```bash
python3 -m http.server 8765     # potem http://127.0.0.1:8765 w przeglądarce
```

Na telefonie apka stoi na GitHub Pages:

**<https://michlo23.github.io/skryba-mobile/>**

Deploy to zwykły `git push` na `main` — Pages przebudowuje się samo w kilkadziesiąt
sekund. Katalog jest w pełni statyczny, więc równie dobrze pasuje gdzie indziej
(Netlify, Cloudflare Pages, własny VPS z nginxem); wszystkie ścieżki są względne,
więc podkatalog nie przeszkadza.

Repo jest publiczne, ale nie ma w nim żadnego sekretu — klucz ElevenLabs żyje
wyłącznie w `localStorage` na Twoim telefonie. Gdybyś kiedyś chciał ten adres komuś
podać, właściwą odpowiedzią jest mały proxy trzymający klucz po stronie serwera.

> Adres `http://192.168.x.x:8765` z telefonu **nie** zadziała: to nie jest
> bezpieczny kontekst i `getUserMedia` odmówi. Do szybkiego testu w sieci
> lokalnej użyj tunelu (`cloudflared tunnel --url http://localhost:8765`).

## Pierwsze uruchomienie

1. Wejdź na adres w telefonie, otwórz **Ustawienia** (koło zębate) i wklej
   klucz ElevenLabs (`sk_…`), a potem **Zapisz i sprawdź**.
   Klucz zapisuje się **przed** weryfikacją, więc nieudany test nigdy nie
   blokuje dyktowania. Klucze z ograniczonymi uprawnieniami dostają na
   `/v1/user` odpowiedź 401 `missing_permissions`, choć transkrybują normalnie
   — apka traktuje to jako sukces, dokładnie jak wersja na macOS.
2. Dodaj do ekranu głównego:
   - **iPhone**: Safari → Udostępnij → *Dodaj do ekranu początkowego*.
     Musi to być Safari; z Chrome na iOS nie da się zainstalować PWA.
   - **Android**: Chrome → menu → *Zainstaluj aplikację*.
3. Przy pierwszym nagraniu system zapyta o **mikrofon**.

Po instalacji apka odpala się na pełnym ekranie, bez paska przeglądarki, i
otwiera się offline (sama transkrypcja rzecz jasna potrzebuje sieci).

## Skrót „dyktuj od razu"

Adres `?rec=1` zaczyna nagrywanie natychmiast po otwarciu — to jest ten
odpowiednik `⌃⌥D` z maca. To samo robi przełącznik *Zacznij nagrywać zaraz po
otwarciu apki* w ustawieniach.

- **iPhone** — Skróty → nowy skrót → *Otwórz URL* z adresem `…/?rec=1`. Skrót
  podepniesz pod **przycisk Akcji**, **stuknięcie w tył obudowy**
  (Ustawienia → Dostępność → Dotyk → Stuknięcie w tył) albo kafelek w Centrum
  sterowania.
- **Android** — przytrzymaj ikonę apki: skrót *Dyktuj* jest w menu
  kontekstowym (jest w manifeście).

Uwaga: część przeglądarek oddaje mikrofon dopiero po dotknięciu ekranu. Jeśli
automatyczny start się nie uda, apka po prostu czeka na dotknięcie przycisku —
nie pokazuje błędu.

## Sprzątanie notatek

Dyktowana notatka nosi na sobie ślady mówienia: „yyy”, „eee”, zacięcia, dwa razy
to samo słowo. Skryba potrafi ją oddać modelowi, który to wycina — i nic poza
tym nie rusza.

W **Ustawieniach → Sprzątanie notatek** wybierasz dostawcę (**DeepSeek** albo
**OpenAI**), wklejasz jego klucz i ewentualnie wpisujesz model; puste pole
oznacza domyślny (`deepseek-chat`, `gpt-4o-mini`). Klucz i model trzymane są
osobno dla każdego dostawcy, więc sprawdzenie drugiego nie kasuje pierwszego.

Jest tu ten sam układ co ze Scribe: oba API odpowiadają przeglądarce nagłówkiem
CORS, więc telefon rozmawia z nimi bezpośrednio, bez pośrednika, a klucz zostaje
w `localStorage`.

Sprzątanie odpalasz na dwa sposoby:

- **przycisk „Wyczyść”** przy wyniku i przy każdej notatce na liście,
- **przełącznik „Sprzątaj każdą notatkę zaraz po transkrypcji”** — wtedy dzieje
  się to samo z siebie, kosztem sekundy-dwóch po ostatnim słowie.

Oryginał zostaje zapisany zawsze, więc „Przywróć oryginał” cofa wszystko jednym
dotknięciem. Sprzątnięta notatka nosi znaczek `czysta`, a w eksporcie `.md`
dochodzi linia `cleanup: deepseek/deepseek-chat`.

Model dostaje instrukcję po angielsku, ale z listą wypełniaczy dobraną do języka
notatki — polska notatka jest czyszczona po polsku, angielska po angielsku, i
nigdy nie zostaje przetłumaczona. Ten sam prompt, co do znaku, siedzi w wersji
na macOS.

> Gdy sprzątanie się nie uda — zły klucz, brak środków, padnięte API — notatka
> zostaje w wersji surowej, a apka mówi dlaczego. Transkrypcja nigdy nie ginie
> przez to, że drugi serwis miał zły dzień.

## Co apka robi z notatkami

Każda transkrypcja trafia na listę w telefonie (`localStorage`, ostatnie 300).
Dotknięcie notatki ją rozwija; masz przy niej **Kopiuj**, **Wyczyść** i **Usuń**.
**Eksportuj .md** zrzuca całą listę do jednego pliku markdown z takim samym
frontmatterem, jaki zapisuje wersja na macOS — czyli plik można wrzucić prosto
do tego samego vaulta w Obsidianie.

Nagrania audio nie są nigdzie przechowywane: klip żyje w pamięci do momentu
odpowiedzi ze Scribe.

## Ograniczenia, o których warto wiedzieć

- **Zgaszony ekran przerywa nagrywanie.** Przeglądarka w tle zostaje uśpiona i
  strumień z mikrofonu się kończy — na to nie ma obejścia w webowej apce. Apka
  trzyma `wakeLock`, więc ekran sam nie gaśnie w trakcie nagrywania, a gdy
  mimo wszystko przełączysz się gdzie indziej, klip zostaje zapamiętany i
  przepisuje się po powrocie.
- **Limit 15 minut** na nagranie, tak samo jak na macOS.
- Kopiowanie do schowka po transkrypcji potrafi zostać zablokowane, jeśli
  przeglądarka wymaga świeżego dotknięcia — dlatego przycisk **Kopiuj** jest
  zawsze pod ręką.

## Pliki

```
index.html            szkielet UI
app.js                nagrywanie, Scribe, sprzątanie notatek, ustawienia
styles.css            paleta i layout (atrament + terakota, jak na macOS)
manifest.webmanifest  instalacja jako PWA + skrót „Dyktuj"
sw.js                 cache powłoki, żeby apka otwierała się offline
tools/make-icons.swift generator ikon (ta sama fala co w Skrybie)
```

Po zmianie w plikach powłoki podbij `CACHE` w `sw.js`, inaczej telefon zostanie
przy starej wersji.

Ikony przerysujesz przez:

```bash
swift tools/make-icons.swift
```
