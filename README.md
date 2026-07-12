# CatOS

CatOS je připravovaná CLI aplikace pro řízení bezpečné a auditovatelné automatizace práce nad lokálními repozitáři. Dlouhodobý směr projektu popisuje [`ROADMAP_MVP.md`](./ROADMAP_MVP.md).

## Aktuální stav MVP

Tato první verze implementuje pouze infrastrukturní kostru z první fáze MVP:

- CLI příkaz `run`,
- načtení projektové konfigurace z YAML souboru,
- validaci povinných polí konfigurace,
- kontrolu existence cílového repozitáře,
- vytvoření unikátního `runId`,
- založení adresáře `runs/<runId>/`,
- uložení vstupu běhu do `input.json`.

## Požadavky

- Node.js 22 nebo novější
- npm

## Instalace

```bash
npm install
```

## Ukázka CLI

Součástí repozitáře je demonstrační konfigurace `projects/demo.yaml`, která míří na lokální adresář `demo-project/`.

```bash
npm run catos -- run --project demo --task "Testovací úkol"
```

Při úspěchu příkaz vypíše ID běhu, načtený projekt, ověřenou cestu k cílovému repozitáři a cestu k vytvořenému `input.json`.

## Co tato verze ještě neumí

Tato verze záměrně neobsahuje žádné LLM volání ani integraci s OpenAI Agents SDK, Codex SDK nebo jinými agentními nástroji. Také zatím neumí:

- upravovat cílový repozitář,
- spouštět validační příkazy cílového projektu,
- vytvářet Git commity v cílovém projektu,
- pushovat nebo mergovat změny,
- ukládat stav do databáze,
- poskytovat webové UI,
- vytvářet finální run report.

Další kroky a hranice MVP jsou popsány v [`ROADMAP_MVP.md`](./ROADMAP_MVP.md).
