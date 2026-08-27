# PROJECT MANAGEMENT PLAN

## AI Software Engineering Team (AISET)

| Campo | Valore |
| :---- | :---- |
| **Versione** | 1.0 (bozza — 4 punti TBD in sez. 12\) |
| **Data** | 25 agosto 2026 |
| **Riferimento** | PROJECT\_CHARTER v1.0 |
| **Project Manager** | Massimiliano Corvino |
| **Approvazione richiesta** | Sponsor \+ Gaurav, Hemant |

---

## 1\. Introduzione

Questo piano definisce come il progetto AISET sarà eseguito, monitorato, controllato e chiuso, in attuazione del Project Charter v1.0. In caso di conflitto tra questo piano e il charter, prevale il charter; le modifiche al charter seguono la sua sez. 11\.

**Decisione fondante del piano (registrata):** lo sponsor ha scelto di mantenere l'orizzonte di 6 mesi con disponibilità \< 5 h/settimana (\~104 ore totali stimate), **accettando formalmente il rischio di schedule** a fronte di una stima di effort del piano completo di 250-400 ore. Il piano gestisce questa scelta con tre strumenti: timeboxing rigido, scala di riduzione dello scope predefinita (sez. 3.3), e uso degli agenti AI per costruire il sistema stesso (sez. 7.2).

**Principio operativo:** le date non si spostano; lo scope flette. Ogni milestone è un timebox con exit criteria distinti in **minimi** (obbligatori) e **target** (desiderabili).

## 2\. Baseline di progetto

- **Scope baseline:** deliverable D1-D7 del charter, con priorità e riducibilità definite in sez. 3\.  
- **Schedule baseline:** 26 settimane, milestone come da sez. 4\.  
- **Cost baseline:** budget ore 104 h (\~4 h/sett. × 26); budget economico AI: TBD (sez. 12).  
- Le baseline sono modificabili solo tramite change control (sez. 11).

## 3\. Gestione dell'ambito

### 3.1 WBS di primo livello

| WP | Contenuto | Deliverable | Ore stimate |
| :---- | :---- | :---- | :---- |
| WP1 — Kernel documentale | Metrics, Agent Contract, Artifacts, Workflow; stub degli altri documenti | D1 (parziale), D2 (parziale) | 24 |
| WP2 — Schemi e template | run.schema.json \+ specification.schema.json completi; altri in versione minima; template PR evidence-driven e failure issue | D2 | 10 |
| WP3 — Baseline umana | Selezione task campione, misurazione, report | D6 | 8 |
| WP4 — Agenti V0.1 | Specifiche platform-agnostic \+ implementazione OpenCode | D3, D4 | 26 |
| WP5 — Infrastruttura di misura | Logging run, replay corpus, eval suite minima, baseline eval | D5 | 22 |
| WP6 — Esercizio e milestone | Uso su task reali, report M2 e M3, decisioni organizzative | D7 | 14 |
| **Totale** |  |  | **104** |

Il vincolo di charter (30-40% su misura) è rispettato: WP5 \+ quota misurazione di WP3/WP6 ≈ 34 ore.

### 3.2 Definition of Done dei work package

Un WP è chiuso quando i suoi deliverable superano i criteri definiti in DoR/DoD (documento del kernel) e sono versionati nel repository. Nessun WP si chiude "a voce".

### 3.3 Scala di riduzione dello scope (scope-shedding ladder)

Se a fine timebox gli exit criteria minimi non sono raggiungibili, lo scope si riduce in quest'ordine predefinito — deciso ora, a mente fredda, non durante la crisi:

1. **Gradino 1:** eval suite ridotta a 5 scenari; documenti non-kernel restano stub (ARCHITECTURE, TEAM esteso, SECURITY esteso)  
2. **Gradino 2:** agenti V0.1 da 5 a 3 (Orchestrator+Spec fusi, Developer, Reviewer+QA fusi) — la fusione è essa stessa un esperimento organizzativo registrato  
3. **Gradino 3:** M3 ridotta a dimostrazione di 2 workflow concorrenti su task semplici, decisioni organizzative rinviate  
4. **Gradino 4 (ultimo):** M3 esce dall'orizzonte; il progetto chiude a M2 con report finale e proposta di estensione

**Non riducibili in nessun caso:** logging obbligatorio dei run (run.schema.json), replay corpus, guardrail operativi, baseline M1. Sono il nucleo che rende il progetto diverso da una collezione di prompt.

## 4\. Gestione dei tempi

### 4.1 Schedule (26 settimane)

| Settimane | Fase | Contenuto | Exit criteria minimi |
| :---- | :---- | :---- | :---- |
| 1-6 | **M0 \+ M1** | WP1, WP2, WP3 in parallelo | Kernel minimo approvato (Metrics, Agent Contract, Artifacts, Workflow); run.schema.json attivo; baseline documentata |
| 7-10 | **M2a — Costruzione** | WP4: specifiche \+ implementazione agenti | 3-5 agenti operativi su task di prova; logging attivo dal primo run |
| 11-17 | **M2b — Esercizio** | WP5 \+ WP6: task reali, eval suite, replay corpus | ≥2× su almeno una categoria di task vs baseline; corpus ≥90% dei task; passaggio a evidence mode |
| 18-24 | **M3 — Parallelismo** | WP6: workflow concorrenti | 2-3 workflow paralleli entro budget attenzione su task semplici |
| 25-26 | **Chiusura** | Report M3, lessons learned, proposta M4 | Report finale con confronto metriche e decisione su revisione charter per M4 |

### 4.2 Controllo dello schedule

- Verifica di avanzamento settimanale (integrata nel report, sez. 8\) su GitHub Projects: ore spese, WP in corso, scostamento.  
- **Trigger di de-scoping:** se a metà timebox il completamento stimato del WP critico è \< 50%, si applica il gradino successivo della scala 3.3. Il trigger è automatico, non negoziabile seduta stante — evita l'ottimismo del "recupero la prossima settimana".  
- Buffer: nessun buffer esplicito (incompatibile con 104 h); la scala di riduzione È il buffer.

## 5\. Gestione dei costi

- **Budget ore:** 104 h, tracciate per WP su GitHub Projects (campo custom "ore").  
- **Budget AI:** tetto mensile e soglia per task **TBD** (sez. 12). Fino alla definizione: tracking di tutti i costi API per run nel replay corpus (campo previsto da run.schema.json), nessuna soglia enforcement.  
- **Controllo:** scostamento ore \> 20% su un WP → segnalato nel report settimanale con proposta di de-scoping o riallocazione.  
- Il costo AI di costruzione del sistema (dogfooding, sez. 7.2) è contabilizzato separatamente dal costo AI di esercizio, per non inquinare la metrica costo-per-task.

## 6\. Gestione della qualità

La qualità del *software prodotto* è governata dai documenti del kernel (Metrics, DoR/DoD, Evaluation) — questo piano non la duplica. La qualità dei *deliverable di progetto* segue queste regole:

- Ogni documento del kernel ha un revisore: gli agenti AI eseguono review strutturata (coerenza interna, riferimenti incrociati, completezza rispetto al template), lo sponsor approva.  
- Gli schemi JSON sono validati con esempi positivi e negativi committati accanto allo schema.  
- Le PR al repository AISET seguono il template evidence-driven dal passaggio a evidence mode; prima, richiedono solo descrizione e collegamento a Issue.

## 7\. Gestione delle risorse

### 7.1 Risorse umane

Una persona (sponsor/PM/ingegnere), \< 5 h/settimana. Conseguenze operative: nessuna attività richiede sincronizzazione con terzi nel percorso critico; le sessioni di lavoro sono blocchi da 1-2 h con obiettivo singolo definito in anticipo su GitHub Projects.

### 7.2 Dogfooding come moltiplicatore

Gli agenti di coding (Claude Code, OpenCode) sono la risorsa che rende il piano tentabile: la scrittura di schemi, tooling di logging, eval runner e documentazione è delegata agli agenti con supervisione umana. **Ogni sessione di costruzione di AISET è essa stessa loggata secondo run.schema.json dal momento in cui esiste** — il progetto diventa il proprio primo caso di studio, e le 104 ore umane comprano molte più ore-agente.

### 7.3 Strumenti

GitHub (repo, Issues, Projects, PR), OpenCode, tooling SAST/static analysis open source, storage replay corpus.

## 8\. Gestione delle comunicazioni

| Comunicazione | Frequenza | Formato | Effort |
| :---- | :---- | :---- | :---- |
| Report ad approvatori (Gaurav, Hemant) | Settimanale | **Generato automaticamente** da GitHub Projects (avanzamento WP, ore, metriche disponibili, rischi attivi) \+ 3-5 righe di commento del PM | ≤ 15 min/sett. |
| Report di milestone | A M0/M1, M2, M3 | Documento strutturato con confronto vs baseline e decisioni richieste | Incluso in WP6 |
| Registro decisioni | Continuo | ADR nel repository | — |

Il report settimanale automatizzato è un deliverable di WP5 (prime 3 settimane in forma manuale ridotta). Vincolo: la comunicazione non deve superare il 10% del budget ore.

**TBD:** contenuto atteso dai destinatari — dipende dal ruolo reale di Gaurav e Hemant (sez. 12).

## 9\. Gestione dei rischi

### 9.1 Registro (eredita dal charter, aggiornato con le decisioni di pianificazione)

| ID | Rischio | P | I | Risposta | Owner |
| :---- | :---- | :---- | :---- | :---- | :---- |
| R1 | **Effort disponibile (104 h) insufficiente per lo scope chartered (stima 250-400 h)** | **Certa** | Alto | **ACCETTATO dallo sponsor** (decisione registrata, sez. 1). Gestione: timeboxing, scala 3.3, dogfooding 7.2 | Sponsor |
| R2 | Carico di revisione umana annulla i guadagni | Alta | Alto | Review package, escalation selettiva, budget attenzione | PM |
| R3 | Infrastruttura di misura sacrificata sotto pressione | Media | Alto | Elementi non riducibili in 3.3; 30-40% ore protette | PM |
| R4 | Review AI correlata a generazione AI | Alta | Alto | Layer deterministico, diversità modello, sentinel defects (post-M2) | PM |
| R5 | Volume dati insufficiente a M3 per decisioni organizzative | Alta | Medio | Decisioni dichiarate provvisorie sotto soglia; replay corpus | PM |
| R6 | Interruzioni prolungate della disponibilità (impegni CloudSalus/altri progetti) | Media | Alto | Timebox flessibili in avvio ±1 sett.; oltre 2 settimane di stop → change request su schedule baseline | Sponsor |
| R7 | Drift modelli provider | Media | Medio | Pinning, flakiness budget | PM |

### 9.2 Processo

Revisione del registro a ogni report settimanale (campo "rischi attivi" generato da label GitHub); nuova valutazione completa a ogni milestone. Un rischio che si concretizza genera una Issue con etichetta `risk-materialized` e, se tocca le baseline, una change request.

## 10\. Gestione degli stakeholder

| Stakeholder | Strategia |
| :---- | :---- |
| Gaurav, Hemant | Report settimanale automatizzato; coinvolgimento decisionale solo su change alle baseline e revisioni charter. **Strategia da raffinare quando il loro ruolo è definito (TBD)** |
| Progetti ospiti | Selezione task compatibili con vincoli di riservatezza; nessun dato cliente nel corpus condivisibile |
| Community | Nessuna comunicazione pubblica prima del report M2 (evita promesse premature) |

## 11\. Change control e configuration management

- **Change request:** modifica a scope/schedule/cost baseline → Issue con etichetta `change-request`, analisi di impatto (3 righe minime: effetto su ore, milestone, rischi), decisione dello sponsor registrata. Modifiche che toccano il charter → sez. 11 del charter (ri-approvazione Gaurav/Hemant).  
- **Configuration management:** tutto è nel repository Git; documenti versionati via PR; schemi con `schema_version`; release del "team AI" taggate con changelog e confronto metriche. Nessun documento vive fuori dal repo.  
- I gradini della scala 3.3 **non richiedono change request** (sono pre-approvati con questo piano); la loro applicazione è solo registrata nel report settimanale.

## 12\. Punti aperti (bloccanti per la v1.0 finale)

| \# | Punto | Impatta |
| :---- | :---- | :---- |
| 1 | Ruolo reale di Gaurav e Hemant e loro aspettative | Sez. 8, 10; possibile revisione autorità in charter |
| 2 | Tetto mensile budget AI (€) e soglia costo/task | Sez. 5; METRICS.md |
| 3 | Progetti ospiti dei task reali | Sez. 7, 10; vincoli riservatezza; selezione task M1 |
| 4 | Task set campione per baseline M1 (esiste o va costruito) | WP3; attendibilità di tutti i confronti successivi |

Il piano è approvabile in bozza con questi TBD; la v1.0 finale li richiede risolti **entro la settimana 2** (il punto 4 blocca WP3, che è nel percorso critico).

---

*Approvazione: Sponsor \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ · Gaurav \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ · Hemant \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ · Data **/**/\_\_\_\_\_\_*  
