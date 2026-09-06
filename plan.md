# Görev

Pi için **Grok Build tarzı tam `/goal` sistemi** implement et.

Bu bir araştırma veya mimari seçenek değerlendirme görevi değil. Temel tasarım kararları aşağıda verilmiştir ve bunları başlangıç noktası olarak kabul et.

Amaç:

> Pi içinde `/goal <objective>` dediğimde objective'in planner tarafından contract'a dönüştürüldüğü, persistent bir worker'ın işi yaptığı, worker'ın kendi işini başarılı ilan edemediği, fresh independent verifier agent'ların işi doğruladığı, failure durumunda aynı worker'ın resume edildiği ve gerektiğinde strategist'ın devreye girdiği güvenilir bir goal workflow oluşturmak.

Sistem production-quality olmalı. PoC yeterli değil.

---

# Sabit mimari kararlar

Ana orchestration runtime olarak:

**`nicobailon/pi-subagents`**

kullan.

Yeni bir workflow engine, subagent runtime veya mission persistence layer yazma.

Mümkün olduğunca şu hazır primitive'leri kullan:

* workflow execution
* Mission / Goal Mission
* retained child runs
* `resume`
* fresh child agents
* parallel child runs
* structured outputs
* mission state
* persistence
* cancellation
* budgets
* deterministic acceptance/evidence primitives
* extension API

Package'ın mevcut sürümündeki API isimleri farklıysa güncel API'nin temiz karşılığını kullan.

Ancak architecture'ı değiştirme.

---

# Ana execution modeli

İlk sürümde **main Pi session worker olmayacak**.

Ana Pi session:

```text
user / orchestration / status
```

rolünde.

Actual implementation yapan agent:

```text
retained child Worker
```

olacak.

Böylece bütün goal lifecycle tek workflow tarafından yönetilecek.

Temel akış:

```text
/goal OBJECTIVE
      │
      ▼
Create durable Goal Mission
      │
      ▼
Planner [fresh child]
      │
      ▼
Immutable Goal Contract
+ Mutable Work Plan
      │
      ▼
Worker W1 [retained child]
      │
      ▼
completion candidate
      │
      ▼
Verifier panel
 ├─ Skeptic 1 [fresh]
 ├─ Skeptic 2 [fresh]
 └─ Skeptic 3 [fresh]
      │
      ▼
aggregate verdict
   /        \
 PASS       FAIL
  │          │
  │       persist gaps
  │          │
  │    repeated failure?
  │      /        \
  │    no         yes
  │    │           │
  │    │      Strategist [fresh]
  │    │           │
  │    └───────────┘
  │          │
  │      resume W1
  │          │
  │      fix gaps
  │          │
  └──────── verify again

PASS
 ↓
COMPLETE
```

---

# En önemli invariant

**Worker kendi goal'unu tamamlanmış ilan edemez.**

Worker sadece:

> completion candidate

üretebilir.

Actual completion authority harness/verifier tarafında olmalı.

Şu hiçbir zaman olmamalı:

```text
worker: done
→ goal complete
```

Sadece:

```text
worker: done
→ independent verification
→ PASS
→ complete
```

olabilir.

Verifier sistemi çalışamazsa da success verme.

---

# Planner

Planner **fresh child Pi agent** olmalı.

Görevi implementation planı yazmak değil; başarı kontratını belirlemek.

Structured bir `GoalContract` üret.

Önerilen shape:

```ts
interface GoalContract {
  objective: string;

  acceptanceCriteria: {
    id: string;
    requirement: string;
    verification?: string;
  }[];

  constraints: string[];
  nonGoals: string[];
  verificationPlan: string[];
}
```

Ayrıca ayrı mutable:

```text
work plan
```

üretilebilir.

Temel invariant:

> WHAT immutable, HOW mutable.

Planner tamamlandıktan sonra `GoalContract` worker veya strategist tarafından değiştirilememeli.

Contract mutation prompt-level convention değil, mümkün olduğunca code/state-level invariant olsun.

Planner malformed output verirse veya çalışamazsa worker'ı başlatma.

Fail closed.

---

# Worker

Worker gerçek implementation'ı yapan **retained child Pi session**.

İlk run'dan sonra worker'ın run/session id'sini mission state'te sakla.

Örneğin:

```text
workerRunId = ...
```

Verifier failure sonrası yeni worker açma.

Mutlaka:

```text
resume(workerRunId)
```

veya package'ın equivalent primitive'i ile **aynı worker session'ını** devam ettir.

Worker:

* workspace'i değiştirebilir,
* bash/test çalıştırabilir,
* implementation yapabilir,
* work plan'ı güncelleyebilir,
* evidence üretebilir.

Worker GoalContract'ı değiştiremez.

Worker'ın completion claim'i structured olsun.

Örneğin:

```ts
{
  completed: true,
  summary: "...",
  claimedCriteria: ["AC1", "AC2", "AC3"],
  evidence: [...]
}
```

Ama bu bir verdict değildir.

---

# Verifier / Skeptic panel

Kod değişikliklerinde default:

```text
3 independent skeptics
```

kullan.

Her skeptic:

* fresh child session,
* worker conversation history'sinden bağımsız,
* birbirinden bağımsız,
* read-only workspace access,
* test/bash execution access

ile çalışmalı.

Verifier'ın input'u:

* immutable GoalContract,
* current work plan,
* worker completion claim,
* available evidence,
* prior verifier gaps,
* workspace current state.

Worker'ın full conversation transcript'ini verme.

Verifier worker'ın prose iddialarına güvenmemeli.

Örneğin:

> “Tests pass.”

evidence değildir.

Verifier mümkün olduğunca:

* ilgili dosyayı okusun,
* testleri kendisi çalıştırsın,
* behavior'ı reproduce etsin,
* acceptance criterion'ı doğrudan doğrulasın.

---

# Verifier tool policy

Verifier implementation yapmamalı.

Mümkünse tools:

```text
read
grep
find
ls
bash
```

ve equivalent read/test tools.

File edit/write tools verme.

Verifier'ın workspace mutation yapamadığını gerçek test ile doğrula.

---

# Structured verifier output

Text parsing'e güvenme.

Her skeptic structured verdict üretmeli.

Örneğin:

```ts
interface VerificationVerdict {
  achieved: boolean;

  gaps: {
    criterionId?: string;
    problem: string;
    evidence?: string;
  }[];

  notes?: string[];
}
```

Structured output alınamazsa:

```text
verification failure
```

olarak değerlendir.

Success'e fallback etme.

---

# Panel aggregation

Reliability-first davran.

Default policy:

> **Herhangi bir skeptic substantive bir acceptance failure buluyorsa verification FAIL.**

Yani:

```text
PASS + PASS + FAIL
```

normalde FAIL.

Ancak malformed/infrastructure failure ile substantive refutation'ı state açısından ayır.

Örneğin:

* skeptic says goal unmet → verification fail
* skeptic crashed → infra/retry
* all skeptic pass → pass

Aggregation deterministic code ile yapılsın.

LLM'e:

> “Bu üç review'u özetle, sence geçti mi?”

diye final authority verme.

---

# Anti-ratchet

Verifier her round'da yeni arbitrary standartlar icat edemez.

Mission state'te:

```text
priorVerificationGaps
```

sakla.

Subsequent verification prompt'unda:

1. Önce previous gap'lerin kapanıp kapanmadığını kontrol et.
2. Original GoalContract hâlâ authority.
3. Yeni gap ancak:

   * original acceptance criterion ihlali,
   * original objective'i doğrudan bozan gerçek defect
     ise eklenebilir.
4. Style preference, “şunu da yapsaydın güzel olurdu”, scope expansion vb. yeni blocker olamaz.

Bu davranışı verifier prompt'unda açıkça enforce et.

---

# Gap normalization / fingerprint

Verification failure sonrası gap'leri normalize et.

Amaç:

```text
aynı semantic problem tekrar mı geliyor?
```

anlamak.

Mission state'te yaklaşık:

```ts
verificationAttempts
consecutiveFailures
lastGapFingerprint
sameGapCount
```

tut.

Fingerprint deterministic olmalı.

Exact wording değişse bile mümkün olduğunca aynı criterion/problem ailesini aynı gap olarak değerlendirebilirsin.

Burada LLM tabanlı karmaşık clustering yazma. Acceptance criterion id + normalized problem identity yeterliyse onu tercih et.

---

# Strategist

Repeated same-gap failure durumunda fresh Strategist agent çalıştır.

Trigger configurable olsun.

Sane default örneğin:

```text
2 consecutive materially identical failed verification rounds
```

olabilir.

Strategist:

* fresh child,
* read-only,
* GoalContract'ı değiştiremez,
* implementation yapamaz.

Şunları görür:

* immutable GoalContract,
* current work plan,
* verification history,
* recurring gaps,
* worker'ın mevcut approach summary'si.

Görevi:

> WHAT'i değiştirmeden HOW'u yeniden düşünmek.

Structured veya persisted strategy üret.

Örneğin:

```ts
{
  diagnosis: "...",
  recommendedStrategy: "...",
  avoidRepeating: [...]
}
```

Sonra aynı Worker W1 resume edilir ve strategy + gaps ona verilir.

Strategist'ın gerçekten runtime'da invoke edildiğini test et.

Sadece scaffolding bırakma.

---

# No-progress

Sonsuz retry istemiyorum.

Strategist çalıştıktan sonra da aynı semantic gaps devam ediyorsa mission:

```text
no-progress / paused
```

state'ine geçsin.

Success verme.

User daha sonra resume edebilsin.

State'te neden durduğu açık olsun.

---

# Evidence

Mümkün olduğunca `pi-subagents`in mevcut evidence / acceptance / host verification primitive'lerini kullan.

Örneğin deterministic commands:

```text
npm test
npm run typecheck
pytest
cargo test
...
```

varsa worker'ın iddiasına güvenmek yerine harness tarafından çalıştırılabilsin.

Evidence için gereksiz büyük özel framework yazma.

Ama minimum olarak şunlar persisted/auditable olsun:

* worker claim,
* verifier verdicts,
* deterministic command results,
* verification attempts,
* gaps.

---

# Mission states

En az şu logical states olsun:

```text
planning
working
verifying
strategizing
paused
no-progress
blocked
budget-limited
infra-paused
complete
cancelled
```

Package'ın Mission state modeline uyacak şekilde map et.

Ayrı custom state machine yazmak zorunda değilsen yazma.

Ama user-facing status bu farkları gösterebilsin.

---

# Budget

Bounded autonomy şart.

`pi-subagents`in existing budget primitive'lerini kullan.

Configurable:

* max worker iterations,
* max verification rounds,
* max strategist invocations,
* token budget,
* gerekiyorsa wall-clock limit.

Budget biterse:

```text
budget-limited
```

olmalı.

Partial success hiçbir zaman complete sayılmamalı.

---

# `/goal` kullanıcı arayüzü

Basit tut.

Minimum:

```text
/goal <objective>
/goal status
/goal pause
/goal resume
/goal clear
```

Bare:

```text
/goal
```

aktif goal varsa status gösterebilir.

10 farklı command yaratma.

---

# TUI / progress

Kullanıcı orchestration noise görmek zorunda değil.

Anlamlı high-level status göster:

```text
Goal · planning
```

```text
Goal · working
  iteration 1
```

```text
Goal · verifying
  skeptic 1 ✓
  skeptic 2 …
  skeptic 3 …
```

```text
Goal · working
  verification found 2 gaps
```

```text
Goal · strategizing
```

```text
Goal ✓ complete
  independently verified
```

Worker'ın anlamlı progress/update'lerinin kullanıcı tarafından görülebilir olmasını sağla.

Ama raw subagent protocol/tool spam'i TUI'a dökme.

---

# Persistence

Goal Mission durable olmalı.

Persist edilmesi gereken minimum state:

```text
goal id
GoalContract
work plan
worker retained run id
current status
verification attempt
prior gaps
gap fingerprint
strategist count
budgets
completion result
```

`pi-subagents` Mission persistence bunu destekliyorsa onun üstünden yap.

Ayrı DB/filesystem state layer yazma.

---

# Concurrency / stale result safety

Her async planner/verifier/strategist result'ı ilgili:

```text
goalId
generation
verificationAttempt
```

ile ilişkilendir.

Örneğin:

```text
Verifier attempt 1
```

çok geç dönüp attempt 3 state'ini overwrite edememeli.

Aynı şekilde:

```text
/goal clear
```

sonrası eski skeptic result'ı goal'u complete edememeli.

Stale result guard şart.

---

# Cancellation

`/goal clear` veya cancel durumunda:

* active worker,
* verifier children,
* strategist,
* pending workflow execution

mümkün olduğunca düzgün cancel edilsin.

Orphan child process bırakma.

Late result'ları ignore et.

---

# Infra failure semantics

Şunların hiçbiri success'e dönüşmemeli:

* verifier timeout,
* provider error,
* child crash,
* malformed structured output,
* workflow runtime failure.

Retry mantıklıysa bounded retry yap.

Düzelmiyorsa:

```text
infra-paused
```

veya equivalent safe state.

Fail closed.

---

# Implementation yaklaşımı

Mümkünse yapı kabaca:

```text
extension/
  index.ts
  goal-command.ts

  goal-workflow.ts

  roles/
    planner.ts
    worker.ts
    skeptic.ts
    strategist.ts

  goal-contract.ts
  verification.ts
  aggregation.ts
  gap-fingerprint.ts
  state.ts
  ui.ts

  prompts/
    planner.md
    worker.md
    skeptic.md
    strategist.md

  tests/
```

Ama mevcut codebase/package conventions daha iyi bir yapı gerektiriyorsa onları takip et.

Overarchitecture yapma.

---

# Yapmaman gerekenler

Şunlardan kaçın:

### 1. Yeni orchestration runtime yazma

`pi-subagents` varken:

```text
custom child process manager
custom workflow scheduler
custom persistence engine
```

yazma.

### 2. Worker self-verification

```text
worker says complete
→ complete
```

yasak.

### 3. Verifier fallback success

Verifier yoksa:

```text
best effort → success
```

yasak.

### 4. Text marker parsing

Mümkünse:

```text
[GOAL COMPLETE]
```

gibi textual protocol kullanma.

Structured output/state kullan.

### 5. Recursive extension hacks

Child agent içinde extension'ın tekrar yüklenmesini:

```text
globalThis magic
environment depth hack
```

gibi yöntemlerle çözmek zorunda kalmamaya çalış.

`pi-subagents` child extension/tool configuration'ını kullan.

### 6. Multiple workflow runtimes

Zorunlu olmadıkça:

```text
pi-subagents
+
pi-workflows
+
başka subagent framework
```

yapma.

Tek ana runtime.

---

# Test stratejisi

Bu görevin önemli kısmı implementasyon kadar **gerçek execution testing**.

Sadece mock/unit testlerle bitirme.

Pi'yi gerçek şekilde çalıştır.

Extension'ı yükle.

Gerçek `/goal` çalıştır.

Gerçek child agents spawn et.

Gerçek worker/verifier/strategist loop'unu gözlemle.

---

# Unit testler

En az:

### Goal contract immutability

Worker/strategist contract'ı mutate edemiyor.

### Aggregation

```text
PASS PASS PASS → PASS
PASS PASS FAIL → FAIL
```

### Gap fingerprint

Aynı gap tekrarlandığında detected.

### Strategist trigger

Configured threshold sonrası invoke.

### No-progress

Bounded pause.

### Budget exhaustion

Complete değil.

### Stale result

Eski verification result ignored.

### State transitions

Illegal transition engelleniyor.

---

# Integration testler

Gerçek `pi-subagents` runtime primitive'lerini mümkün olduğunca kullan.

Test et:

* fresh child spawn,
* retained worker run,
* worker resume,
* parallel skeptics,
* structured output,
* cancellation,
* persistence.

---

# Zorunlu E2E test 1 — normal başarı

Basit gerçek goal ver.

Örneğin küçük test repo:

```text
Implement a function, add tests, make all tests pass.
```

Beklenti:

```text
planner
→ worker
→ skeptic panel
→ all pass
→ complete
```

Evidence sakla.

---

# Zorunlu E2E test 2 — false completion

Bu sistemin en önemli testi.

Worker'ın acceptance kriterlerinden birini kaçırdığı scenario oluştur.

Beklenen gerçek akış:

```text
worker says done
→ verification starts
→ skeptic rejects
→ goal remains active
→ concrete gaps persisted
→ SAME worker session resumes
→ worker fixes
→ NEW fresh skeptics run
→ verification passes
→ goal completes
```

Final raporda bunun gerçek evidence'ını göster.

---

# Zorunlu E2E test 3 — same worker resume

Verifier failure öncesi ve sonrası worker identity/run id kontrol et.

Beklenti:

```text
worker run id before = W1
worker run id after  = W1
```

Yeni worker olmamalı.

---

# Zorunlu E2E test 4 — verifier isolation

Verifier run'larının:

* fresh session olduğunu,
* worker transcript'i taşımadığını,
* distinct run ids kullandığını

kanıtla.

---

# Zorunlu E2E test 5 — skeptic panel

Gerçek 3 skeptic çalıştır.

Mümkünse parallel çalıştığını doğrula.

Distinct child runs olmalı.

Bir skeptic substantive failure verdiğinde aggregate FAIL test et.

---

# Zorunlu E2E test 6 — strategist

Kontrollü bir goal/test scenario ile aynı gap'i tekrar ürettir.

Beklenti:

```text
verify FAIL
→ worker fix attempt
→ verify same FAIL
→ strategist actually runs
→ strategy produced
→ same worker resumes with strategy
```

Bu gerçek invocation olmalı.

---

# Zorunlu E2E test 7 — no-progress

Strategist sonrasında da aynı gap devam etsin.

Beklenti:

```text
no-progress
```

state.

Infinite loop yok.

Success yok.

---

# Zorunlu E2E test 8 — verifier failure

Bir verifier run'ını kontrollü şekilde:

* crash ettir,
* invalid output üret,
* veya timeout/failure simulate et.

Beklenti:

```text
NOT complete
```

ve bounded retry / infra-paused.

---

# Zorunlu E2E test 9 — pause/resume

Goal aktifken:

```text
/goal pause
```

ardından:

```text
/goal resume
```

State ve worker identity korunmalı.

---

# Zorunlu E2E test 10 — cancel/clear race

Active verifier varken goal clear/cancel et.

Verifier daha sonra sonuç döndürse bile:

```text
old goal → complete
```

olamamalı.

Child cleanup kontrol et.

---

# Zorunlu E2E test 11 — restart persistence

Mümkünse gerçek Pi process restart yap.

1. goal başlat,
2. worker/session state oluşsun,
3. Pi'yi kapat,
4. tekrar aç,
5. mission restore et,
6. resume et.

Retained worker conversation/session'ın package tarafından desteklenen ölçüde geri geldiğini test et.

Package burada limit koyuyorsa gizleme; exact limitation'ı raporla.

---

# Zorunlu E2E test 12 — gerçek coding task

Toy testten farklı küçük bir gerçek repo task'ı yap.

Örneğin:

* mevcut bug,
* birkaç file edit,
* tests,
* integration behavior.

Goal system gerçek coding workflow içinde baştan sona çalışsın.

Bu final smoke test.

---

# Test sırasında sistemi kırmaya çalış

Happy path yeterli değil.

Özellikle ara:

* stale results,
* double completion,
* duplicate verifier launch,
* worker resume race,
* mission cancelled while child running,
* structured output malformed,
* child model error,
* budget exhaustion during verification,
* restart sırasında verifying state,
* verifier mutation attempt.

Bulduğun bug'ları düzeltip testleri tekrar çalıştır.

---

# Progress updates

Çalışırken beni yüksek seviyede haberdar et.

Özellikle:

* ilk çalışan skeleton,
* first full planner→worker→verifier run,
* first verifier rejection + same-worker resume,
* strategist'ın ilk gerçek invocation'ı,
* önemli race/lifecycle bug'ları,
* final full test pass.

Low-level shell command spam'i verme.

Update sonrası approval bekleme; çalışmaya devam et.

---

# Definition of Done

Görevi yalnızca aşağıdakilerin hepsi sağlandıysa complete kabul et:

* `/goal` gerçek Pi içinde çalışıyor.
* Goal Mission durable.
* Planner fresh agent.
* GoalContract immutable.
* Worker retained child.
* Worker kendi kendini başarılı ilan edemiyor.
* Completion independent verification gerektiriyor.
* Verifier'lar fresh isolated child agents.
* Default multi-skeptic panel çalışıyor.
* Verification failure concrete gaps üretiyor.
* Same worker resume çalışıyor ve test edildi.
* Anti-ratchet semantics mevcut.
* Repeated gaps detected.
* Strategist gerçek runtime'da çalışıyor.
* Strategist WHAT'i değiştiremiyor.
* No-progress bounded.
* Budget bounded.
* Infra failure fail-closed.
* Pause/resume çalışıyor.
* Cancel/clear safe.
* Stale results guarded.
* Persistence/restart test edildi.
* Gerçek coding E2E testi çalıştı.
* README/install/usage hazır.
* Bütün önemli test sonuçları bana verildi.

Bunlardan biri yoksa “done” deme.

---

# Final rapor formatı

İş bitince bana kısa ama teknik olarak yeterli rapor ver.

## Architecture

Gerçek final akış ve kullanılan `pi-subagents` primitive'leri.

## Files

Eklenen/değişen ana dosyalar.

## Usage

Tam install + `/goal` kullanım şekli.

## Grok-style capability matrix

Örneğin:

```text
Planner                    PASS
Immutable goal contract    PASS
Retained worker            PASS
Independent verifier       PASS
3-skeptic panel            PASS
Corrective resume loop     PASS
Anti-ratchet               PASS
Strategist                 PASS
No-progress                PASS
Fail-closed infra          PASS
Pause/resume               PASS
Persistence                PASS
...
```

## Tests

Her zorunlu test:

```text
PASS / FAIL
```

ve kısa evidence.

## Critical E2E evidence

Özellikle bunu göster:

```text
worker completion candidate
→ verifier rejects
→ same worker resumed
→ fix
→ fresh verifier panel
→ independently verified completion
```

## Remaining limitations

Gerçekten kalan package/runtime limitation varsa açıkça yaz.

---

# Öncelikler

Karar verirken sıra:

1. correctness
2. independent verification integrity
3. lifecycle/race safety
4. clean use of existing `pi-subagents` infrastructure
5. Grok-style behavior
6. simplicity
7. UX polish

Ama basitlik uğruna reliability invariant'larından taviz verme.

Şimdi plan yazıp bana dönme.

**Doğrudan implementasyona başla, sistemi çalıştır, kır, düzelt ve bütün E2E testlerini tamamla.**



not: belki https://github.com/xai-org/grok-build buradaki goal implemnetasyonu kodunu okumak işine yarar.
