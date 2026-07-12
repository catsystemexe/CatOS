Pravidla vytváření ChatGPT handoffů

Soubor docs/handoffs/CHATGPT_HANDOFF_TEMPLATE.md obsahuje závaznou strukturu a pravidla handoffu.

ChatGPT handoff nevytvářej pouze při ukončení celé Codex session. Vytvoř nový samostatný handoff po každém významném implementačním nebo opravném kroku, který má být předán ChatGPT k review.

Každý krok musí vytvořit nový soubor

Nový handoff ukládej do:

docs/handoffs/sessions/

Použij název:

YYYY-MM-DD_NN_short-description.md

Příklad:

docs/handoffs/sessions/2026-07-12_05_untracked-diff-fix.md

Kde:

* YYYY-MM-DD je datum,
* NN je pořadové číslo handoffu v daném dni,
* short-description stručně popisuje konkrétní krok.

Nikdy nepřepisuj starší archivní handoff.

CURRENT_CHATGPT_HANDOFF.md

Po vytvoření nového archivního handoffu aktualizuj také:

docs/handoffs/CURRENT_CHATGPT_HANDOFF.md

Tento soubor musí obsahovat přesnou kopii nejnovějšího archivního handoffu.

CURRENT_CHATGPT_HANDOFF.md je pouze pohodlný ukazatel na poslední stav. Není náhradou historického handoffu.

Kdy vytvořit nový handoff

Nový samostatný handoff vytvoř zejména po:

* dokončení implementačního kroku,
* opravě chyby nalezené při review,
* změně architektonického rozhodnutí,
* změně datového kontraktu,
* doplnění významných testů,
* změně validačního výsledku,
* odblokování dříve blokované dependency nebo runtime validace.

Nevytvářej nový handoff po každé triviální textové úpravě uvnitř stejného kroku.

Obsah handoffu

Každý nový handoff musí popisovat pouze aktuální konkrétní krok a výsledný stav po něm.

Nesmí mechanicky kombinovat text předchozího handoffu s novým textem.

Předchozí kontext shrň pouze stručně v sekci „Výchozí stav“.

Handoff musí jasně rozlišovat:

* výchozí stav,
* změny provedené v tomto kroku,
* skutečně provedenou validaci,
* známá rizika,
* doporučený další krok.

Při pokračování ve stejné Codex session

Pokud už v této Codex session existuje CURRENT_CHATGPT_HANDOFF.md, neupravuj pouze tento soubor.

Vždy:

1. zjisti nejvyšší existující pořadové číslo pro aktuální datum,
2. vytvoř nový archivní handoff s následujícím číslem,
3. zkopíruj jeho výsledný obsah do CURRENT_CHATGPT_HANDOFF.md,
4. ponech všechny starší archivní handoffy beze změny.

Výstup Codexu

Na konci kroku vždy uveď:

* cestu k novému archivnímu handoffu,
* cestu k aktualizovanému CURRENT_CHATGPT_HANDOFF.md,
* číslo checkpointu,
* zda byla předchozí archivní dokumentace ponechána beze změny.
