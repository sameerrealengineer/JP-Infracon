# Scope: JP Infracon

A construction management app for JP Infracon field teams. Site supervisors record daily progress, attendance, materials, and petty cash on Android phones; directors, accounts, and admins review, approve, and track money and stock across sites. Requirements come from `docs/JP_Infracon_Production_Ready_PRD.md`; evidence of what is delivered lives in `TODO.md`.

**Build approach:** Tracer Bullet (each feature is built end to end, through schema, server rules, screen, and tests, and works before the next one starts).
**Workflow:** Beta (after `/develop`, run `/check verify`, then `/test`). Features that hold money, access, or the shared data carry a `· GA` tag, which adds a fresh model `/check review`, `/check ready`, and `/document`. `/architect` is the recommended first stop for a feature with a real decision, but skippable when you already know the build.

_These are recommendations to keep your build orderly, not requirements. Skip anything that does not fit: if you already know how to build a feature, use `/develop` and skip `/architect`. You decide when a feature is `done`._

**First release** (the end of Slice 1): the field loop plus money basics, so real supervisors can use the app on a live site. One developer, no hard deadline.

## At a glance

| # | Feature | Phase | Status |
|---|---------|-------|--------|
| 1 | [Stack & architecture](platform.md) | Existing | existing |
| 2 | [Design system](platform.md) | Existing | existing |
| 3 | [Organisation, sites, permissions & audit](platform.md) | Existing | existing |
| 4 | [Tasks & schedule revisions](field.md) | Existing | existing |
| 5 | [Workforce register, KYC status & rates](field.md) | Existing | existing |
| 6 | [Inventory ledger](field.md) | Existing | existing |
| 7 | [Supplier payment ledger](finance.md) | Existing | existing |
| 8 | [Coding standards & tooling](platform.md) | Foundation | done |
| 9 | [Environment separation & backups](platform.md) | Foundation | planned |
| 10 | [Error reporting](platform.md) | Foundation | planned |
| 11 | [Text resources for translation](platform.md) | Foundation | planned |
| 12 | [Private file evidence](platform.md) | Foundation | planned |
| 13 | [Identity & accounts](platform.md) | Slice 1 | in-progress |
| 14 | [Daily reports (DPR/DLR)](field.md) | Slice 1 | in-progress |
| 15 | [Report photo evidence](field.md) | Slice 1 | planned |
| 16 | [Attendance & overtime](field.md) | Slice 1 | planned |
| 17 | [Material requests](field.md) | Slice 1 | in-progress |
| 18 | [Approval limits & maker checker policy](finance.md) | Slice 1 | planned |
| 19 | [Petty cash ledger](finance.md) | Slice 1 | in-progress |
| 20 | [Supervisor reimbursements](finance.md) | Slice 1 | planned |
| 21 | [Notification inbox](platform.md) | Slice 1 | planned |
| 22 | [Offline drafts & sync](platform.md) | Slice 1 | in-progress |
| 23 | [Android release & device QA](platform.md) | Slice 1 | planned |
| 24 | [Vendors & subcontractors](field.md) | Slice 2 | planned |
| 25 | [Subcontract work measurements](field.md) | Slice 2 | planned |
| 26 | [Worker payables & advances](finance.md) | Slice 2 | planned |
| 27 | [Supervisor compensation records](finance.md) | Slice 2 | planned |
| 28 | [Supplier invoices](finance.md) | Slice 3 | in-progress |
| 29 | [Procurement & delivery receipts](finance.md) | Slice 3 | planned |
| 30 | [Supplier advances, notes, retention & reversals](finance.md) | Slice 3 | planned |
| 31 | [Transporter freight expenses](finance.md) | Slice 3 | planned |
| 32 | [Stock transfers, counts & adjustments](field.md) | Slice 3 | planned |
| 33 | [Safety, quality & constraint issues](field.md) | Slice 4 | planned |
| 34 | [Escalations & push alerts](platform.md) | Slice 4 | planned |
| 35 | [Work calendars & resource conflicts](field.md) | Slice 4 | planned |
| 36 | [Home & director dashboards](field.md) | Slice 5 | in-progress |
| 37 | [Exports (CSV and PDF)](field.md) | Slice 5 | planned |
| 38 | [Hindi & Odia translations](platform.md) | Slice 6 | planned |

## Epics

- [platform.md](platform.md): stack, standards, environments, errors, files, identity, notifications, offline, release, languages. 3 existing, 3 in progress, 8 planned.
- [field.md](field.md): daily reports, attendance, materials, schedule, workforce, inventory, issues, dashboards, exports. 3 existing, 3 in progress, 8 planned.
- [finance.md](finance.md): limits, petty cash, reimbursements, supplier invoices and payments, worker pay, procurement. 1 existing, 2 in progress, 7 planned.

## Phases

- **Existing**: delivered before this workflow, recorded for context. Each has follow up work enrolled as its own feature.
- **Foundation**: make the shared database safe, add error reporting, a text seam for languages, and private file storage. Everything after leans on these.
- **Slice 1, first field release**: thicken the working field loop (reports, photos, attendance, materials) and money basics (limits, petty cash close out, reimbursements), add the inbox, and ship an APK to real supervisors.
- **Slice 2, worker pay**: vendors, subcontract measurements, and derived worker payables.
- **Slice 3, supplier and stock depth**: procurement links, supplier exceptions, freight, stock transfers and counts.
- **Slice 4, site issues and schedule depth**: safety and quality issues, escalations, work calendars.
- **Slice 5, reports**: complete dashboards and exports.
- **Slice 6, languages**: Hindi and Odia.

## Deferred

Out of scope for the current build pass, kept so the plan stays honest.
- **KYC document uploads**: private ID document storage with consent, encryption, and retention · needs a decision · GA. Needs a legal review first; today KYC is status only.
- **Usage analytics**: track which screens supervisors use · needs a decision
- **Bank or UPI payment execution**: not authorised; payments stay internal ledger records.
- **Google Play publishing**: not authorised; personal use APK only.
- **Legal, accounting, and compliance review**: privacy, labour, tax, and retention review before real production use. Not a build feature, but owed before launch.

## Legend

**The decision box.** Every feature carries exactly one, the sub task whose label ends with `(spec)`. Its wording varies (`Design it (spec)` normally), so skills locate it by that `(spec)` suffix, never by an exact label. Every other box is an execution box and `/architect` never ticks one.

**Feature lifecycle**: the scope updates as a feature moves; each row is what it shows and who sets it:

| State | Set by | The feature shows |
|---|---|---|
| `planned` · needs a decision | `/scope` | one box: `Design it (spec): /architect <feature>` |
| `in-progress` (designed) | **`/architect` at spec capture** | `Design it` ticked; spec linked; `Build it: /develop <feature>` + **2 to 5 milestones**; the tier's closing boxes (`Verify it` Alpha+, `Test it` Beta+, `Review it` + `Document it` GA, `Launch check` GA with `Rollout & operations`); any surfaced follow up enrolled |
| `in-progress` (building) | `/develop` | milestone sub boxes tick one by one; code pointer filled |
| `in-progress` (verified) | `/check verify` | `Build it` + milestones ticked; `Verify it` ticked |
| `done` | **you, when you decide it is** (any skill sets it when you say so); `/sync` reconciles | boxes you ran ticked, skipped ones marked skipped; the tier's last stage (`Prototype` → after `/develop`; `Alpha` → after `/check verify`; `Beta`/`GA` → after `/test`) is the suggested point to call it done; `/sync` captures conventions |

- **Next step** = the first unticked box (always a command or a tracked milestone).
- **needs a decision** = run `/architect` first; otherwise straight to `/develop` (or `/audit` for standards & tooling). The tag drops once the spec is captured.
- **Atomic build tasks live in the spec's `## Build plan`, not here**: the scope carries only the milestone rollup.
- **Status** `planned` → `in-progress` → `done`, plus `existing` (pre workflow) and `dropped` (de scoped, kept for history).
- **In progress enrolled features** were partly built before this workflow. Their intent names what is still open; finish them through their first unticked box.
- **Approach tag** beside a heading (e.g. `· Facade`) overrides the project default for that feature; no tag = inherits it.
- **Workflow tier tag** beside a heading (e.g. `· GA`, `· Prototype`) sets that one feature's rigor above or below the project default; no tag inherits the default. It decides the feature's check boxes and each skill's next suggestion.
- **Workflow** (header line) is the project default, what runs after `/develop`: **Prototype** = nothing (trust develop's own build time self check); **Alpha** = `/check verify`; **Beta** = `/check verify` then `/test`; **GA** = adds a fresh model `/check review`, `/check ready` (spec has `Rollout & operations`), then `/document`. A feature built on an unratified decision (an `Assumed` spec) stays flagged, but that never blocks `done`.
- **Pointer line** (`spec <n> · code in <path>`): the spec link added by `/architect`, the code path by `/develop`.
