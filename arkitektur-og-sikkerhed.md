# Teknisk Gennemgang: Seniorklubber i København

*Til ikke-teknisk læser — april 2026*

---

## Hvad er systemet?

En hjemmeside med to dele: et **offentligt kort** der viser tilskud til seniorklubber i København, og et **adminpanel** hvor man kan redigere data og eksportere til Excel. Data gemmes i en database hos udbyderen Supabase.

---

## Arkitektur — hvordan er det bygget?

**Tre sider, én database.**

| Side | Formål |
|---|---|
| `login.html` | Man logger ind |
| `index.html` | Man ser kortet |
| `admin.html` | Man redigerer data |

Alle tre sider henter og gemmer data direkte fra en database hos Supabase (en ekstern cloud-udbyder i EU). Der er ingen "mellemstation" — browseren taler direkte med databasen.

**Ingen installation eller server.**
Selve hjemmesiden er bare filer (HTML, CSS, JavaScript) der hostes gratis på GitHub Pages. Det er lidt som at lægge filer på Dropbox og dele linket. Der er ingen applikationsserver at vedligeholde eller opdatere.

**Alle eksterne komponenter hentes fra internettet.**
Kortet (Leaflet), databasebiblioteket (Supabase) og Excel-eksporten (ExcelJS) er ikke en del af projektet selv — de hentes automatisk fra tredjeparts-servere hver gang siden åbnes. Det er billigt og nemt, men betyder at siden holder op med at virke korrekt, hvis en af disse udbydere ændrer eller fjerner biblioteket.

**Databasen har to tabeller.**

- `clubs` — klubbens navn og placering på kortet (koordinater)
- `funding` — tilskudsbeløb knyttet til en klub, et program og et år

Når siden indlæses, hentes begge tabeller og "sættes sammen" i browseren — ikke i databasen. Det er simpelt og fungerer fint i den nuværende skala.

---

## Sikkerhed — det gode

**Professionel login-løsning.**
Login håndteres af Supabase — en anerkendt platform. Adgangskoder gemmes aldrig i klartekst, og sessioner udløber automatisk.

**Databasen er beskyttet bag adgangskontrol.**
Supabase har "Row Level Security" aktiveret, hvilket som udgangspunkt afviser uautoriserede forespørgsler direkte mod databasen.

**Indholdet kan ikke ses uden login.**
Siden er skjult indtil login er bekræftet — der er ingen måde at "snige sig forbi" loginskærmen i browseren.

---

## Sikkerhed — det der bør forbedres

**Ingen beskyttelse mod for mange loginforsøg.**
Hvis nogen prøver at gætte adgangskoden, kan de i teorien forsøge tusinder af gange uden at blive blokeret. Dette kan afhjælpes med en simpel indstilling i Supabase.

**Ingen logning af handlinger.**
Hvis data slettes eller ændres forkert, er der ingen spor af hvem der gjorde det eller hvornår.

**Alle med login har fuld adgang.**
Der er kun én brugerrolle — alle kan slette, redigere og eksportere alt. Der er ingen mulighed for at give én bruger begrænset adgang.

**Ingen verificeret backup.**
Supabase laver automatiske sikkerhedskopier på betalingsplaner, men det er ikke bekræftet at dette er aktivt og testet.

---

## Samlet vurdering

Systemet er **velegnet til sit formål** — en intern løsning for et lille antal brugere med ikke-følsomme data. Arkitekturen er bevidst enkel: ingen server at vedligeholde, lave driftsomkostninger, og nem at overtage for en anden udvikler. De nævnte svagheder er reelle men ingen af dem er kritiske for dette use case. Prioritet #1 ville være at verificere at backup er aktivt, og dernæst aktivere beskyttelse mod gentagne loginforsøg.
