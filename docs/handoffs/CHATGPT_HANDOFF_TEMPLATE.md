
ChatGPT Handoff

Jeho účelem je předat ChatGPT dostatečně přesný technický kontext bez nutnosti kopírovat celý repozitář. Soubor po každé významné implementační session aktualizuj tak, aby popisoval aktuální stav po dokončení práce.



Povinná struktura

1. Session metadata

* datum
* aktuální branch
* výchozí commit
* výsledný commit
* cíl session
* stav pracovního stromu

2. Executive summary

Stručně popiš:

* co bylo cílem,
* co bylo skutečně implementováno,
* co nebylo dokončeno,
* zda je výsledek ověřený, nebo pouze předpokládaný.

Důsledně rozlišuj:

* implementováno,
* spuštěno,
* otestováno,
* pouze očekáváno.

3. Aktuální architektura dotčené části

Popiš skutečný tok programu po změně.

Použij stručné schéma, například:

CLI
→ načtení Configu
→ Zod validace
→ kontrola repoPath
→ vytvoření runId
→ zápis input.json

Uveď hlavní moduly, jejich odpovědnosti a vazby.

4. Veřejná rozhraní a datové kontrakty

U každého nového nebo změněného významného rozhraní uveď:

* název,
* soubor,
* signaturu nebo schéma,
* účel,
* významné validační podmínky.

Vlož krátké relevantní výřezy skutečného kódu. Nevkládej celé dlouhé soubory.

Příklad:

export type TaskInput = {
  schemaVersion: 1;
  runId: string;
  projectId: string;
  goal: string;
  createdAt: string;
  configPath: string;
};

5. Změny podle souborů

Pro každý změněný soubor uveď:

cesta/k/souboru

* proč byl změněn,
* co nyní obsahuje nebo dělá,
* důležité implementační rozhodnutí,
* vazby na ostatní soubory,
* známé riziko nebo omezení.

Nestačí pouze seznam názvů souborů.

6. Důležitá implementační rozhodnutí

Uveď rozhodnutí, která nejsou zřejmá ze zadání:

* zvolená varianta,
* proč byla zvolena,
* jaké alternativy byly odmítnuty,
* jaký technický dluh případně vznikl.

Nevydávej domněnky za schválená architektonická rozhodnutí.

7. Validace a důkazy

U každého příkazu uveď:

* přesný příkaz,
* zda se skutečně spustil,
* exit code,
* stručný výsledek,
* případnou překážku.

Použij tabulku:

Kontrola	Stav	Důkaz / překážka

Stavy:

* PASS
* FAIL
* BLOCKED
* NOT RUN

Pokud validace neproběhla, nesmí být výsledek označen za funkční nebo dokončený.

8. Git diff summary

Uveď:

* počet změněných souborů,
* hlavní změny v diffu,
* případné neočekávané změny,
* zda byly přidány generované nebo lock soubory,
* zda commit obsahuje pouze zamýšlený rozsah.

9. Rizika a podezřelá místa

Kriticky vyhodnoť:

* co nebylo možné ověřit,
* kde může být chyba,
* co může selhat v jiném prostředí,
* zda byly přidány předčasné abstrakce,
* zda implementace neodporuje ROADMAP_MVP.md.

10. Otevřené úkoly

Rozděl na:

Blokující před pokračováním

Úkoly, bez kterých není bezpečné navázat další fází.

Následující doporučený krok

Jeden konkrétní malý krok.

Pozdější práce

Věci, které nyní není vhodné implementovat.

11. Otázky pro ChatGPT review

Uveď 3–7 konkrétních otázek, například:

* Je aktuální rozdělení modulů přiměřené velikosti MVP?
* Je schéma Configu příliš široké?
* Je generování runId bezpečné a testovatelné?
* Nechybí důležitá validace před připojením Agents SDK?
* Má se další session věnovat opravě prostředí, nebo již Task Analystovi?

12. Doporučené soubory k přímému review

Uveď maximálně 8 nejdůležitějších souborů, které by měl ChatGPT vidět, pokud bude potřeba detailní kontrola.

Pro každý uveď důvod.

Pravidla kvality

* Neopisuj pouze původní zadání.
* Nevydávej očekávaný výsledek za skutečně ověřený.
* Neuváděj „testy prošly“, pokud nebyly spuštěny.
* Uváděj skutečné názvy funkcí, typů a souborů.
* Krátké klíčové výřezy kódu jsou žádoucí.
* Celý dokument drž přibližně mezi 1 000 a 2 500 slovy.
* Pokud se session týkala jen malé změny, dokument může být kratší.
* Soubor musí odpovídat výslednému commitu, nikoli průběžnému stavu.
