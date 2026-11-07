# JP shared domain logic

## Overview

Pure TypeScript rules shared by the mobile client and the API: money and quantity math, workflow policies, schedule impact, and local offline drafts. No database access and no privileged decisions on the client side; the server reuses these and stays the authority.

## Key files

| File | Owns |
|---|---|
| `finance-domain.ts` | Rupee to paise parsing, invoice totals, payment allocation checks |
| `workforce-domain.ts` | Exact paise rates and inclusive effective date ranges |
| `inventory-domain.ts` | Thousandth unit quantities, movement signs, balance rules |
| `petty-cash-policy.ts` | Petty cash rules (fund source attestation, custodian checks, transitions) returning typed errors |
| `account-role-policy.ts` | Which roles an account admin may assign |
| `scheduling.ts` | Date math and dependency impact for rescheduling |
| `domain.ts` | Shared presentation and domain types |
| `local-repository.ts` | AsyncStorage drafts and sync queue, `createClientMutationId` |
| `site-admin-policy.ts` | Site/project status transitions, site-role assignment rules, `prettyRole`, inbox item type and ordering |
| `issue-policy.ts` | Issue categories, severities, transitions, who may close High/Critical, issue codes |
| `issue-drafts.ts` | Offline issue drafts in AsyncStorage and which sync errors are retryable |
| `attachment-policy.ts` | Allowed evidence types, file-signature sniffing, safe names, size formatting |
| `csv.ts` | CSV cells safe from formula injection, UTF-8 BOM, exact paise to rupees |
| `attendance-domain.ts` | Attendance hours (hundredths), estimated earnings in paise, entry validation |
| `delegation-policy.ts` | Delegation bundles, durations, state and time-left text |
| `invite-code.ts` | Invite code alphabet, normalising and unbiased generation from random bytes |
| `notify-policy.ts` | Indian mobile normalising and request builders for WAHA, Evolution API, WhatsApp Cloud, SMS gateways and Expo push |
| `ai-extraction.ts` | JSON schemas and prompts for bills/issues, re-validation of AI output into safe drafts |
| `geo.ts` | Distances, coordinate checks, geofence plausibility, map links |
| `pdf-report.ts` | Escaped printable HTML for PDF exports |
| `effective-time.ts` | `effectiveNow()`: whole-second start time so MySQL rounding never makes an immediate grant/assignment start in the future |
| `dpr-domain.ts` | DPR work lines: exact quantities, cumulative vs planned, estimated percent, suggested cumulative |
| `dlr-domain.ts` | Labour summary by trade from attendance rows (exact hours) |
| `ai-report-extraction.ts` | Prompt, schema and re-validation of AI-filled daily reports |
| `document-policy.ts` | Document categories, file type sniffing (incl. DOCX/XLSX/CSV), chunking, cosine and keyword scores, hybrid ranking |
| `document-text.ts` | Text from Word, Excel and CSV files with `fflate` (no AI) |
| `budget-domain.ts` | Budget cost heads, supplier type to head, line validation, budget vs approved spend per head (ok / near / over), margins |
| `progress-domain.ts` | Task and site progress (tenths of a percent), expected-by-today, health (ahead / on track / behind) |
| `profile-policy.ts` | Profile field cleaning (mobile, PIN code), address text, completeness |
| `modules.ts` | Company modules that can be turned off, permission → module, audit action → module |
| `assistant-catalog.ts` | Screens the assistant may open and `resolveAssistantAction` (only allowed screens, own sites, drafts where the person may create) |
| `selection.ts` | Keeping a chosen site, section, role, or page valid as server data changes (`resolveSelectedId`, `resolveChoice`, `clampPageIndex`) |
| `home-layout.ts` | Home screen module groups, quick actions and badge counts from capabilities and inbox kinds |
| `assistant-files.ts` | Assistant attachments: limits, type from bytes, Office to text, CAD refusal message |
| `person-history.ts` | Feedback kinds and validation, attendance and estimated earnings per site (exact paise), rating summary |
| `alert-rules.ts` | Alert categories, per-role channel rules, `decideChannels` (rules, mutes, opt-ins, module off, SMS urgent only) |
| `whatsapp-bot.ts` | Parsing OpenWA `message.received` (private chats only, phone from `@c.us` or `senderPhone`), fixed bot replies, one stranger note a day |
| `voice-turn.ts` | Live talk: speech start/end from microphone level (dBFS), idle and max turn, reply language from the detected one |
| `billing-domain.ts` | Lead stages, quantity/percent parsing, quotation and RA bill totals (GST on work value; retention and TDS on work value), contract balance check, payment state from receipts, ageing, numbering |
| `purchase-domain.ts` | PO totals with GST per line, transitions, receipt state, delivery checks (not over what is due; reason to reject), lowest quote, three-way bill match, ledger quantity text |
| `subcontract-domain.ts` | Work order and RA bill transitions, measured quantity from nos × L × B × D (exact thousandths), measurement limit vs WO quantity, RA bill totals (GST, retention, TDS on work value; advance recovery; other deduction), advance recovery cap, bill lines from measurements, WO position (value, measured, billed, retention held) |
| `payroll-domain.ts` | Dated statutory rates (`DEFAULT_RATES`: EPF ceiling ₹25,000 from 17 Sep 2026, ESI to ₹21,000, no Odisha PT from Apr 2026, overtime 2×, 50% wages rule), wages from attendance, proration, PF (rupee rounding, EPS split), ESI (next rupee), PT slabs, pay line and run totals, run transitions |
| `accounts-domain.ts` | Due dates (PF/ESI 15th, TDS 7th, March TDS 30 April), dues against deposits (Paid/Due/Overdue/Excess), deposit checks, GST by month, project P&L, vendor type → cost head |
| `payslip.ts` | Escaped printable payslips (A5, one page per person) |
| `advance-domain.ts` | Advance position (given, repaid, recovered by approved runs, pending in open runs, outstanding), recoverable now, suggested installment, entry checks, worker money position |
| `statutory-files.ts` | EPFO ECR 2.0 monthly text (11 fields, `#~#`, whole rupees, NCP days) and ESIC contribution CSV (template columns); people without UAN / IP number listed as left out |
| `access-catalog.ts` | Per-user access groups by module, plain labels, company-level keys, who may switch what on |
| `presence-rules.ts` | IST clock, working hours/days, which arrival/departure alerts, settings checks |
| `app-reports.ts` | Report sources, worker problem tiles, staff categories, text cleaning, stack trimming, error fingerprints, and `transportError` (plain messages for no internet, 502/503/504, a web page instead of data) used by `friendlyErrorLink` in `lib/trpc.ts` |
| `worker-speech.ts` | What the worker screen says aloud in English, Hindi and Odia (whole rupees, attendance counts, drawings) and the speech language codes |
| `worker-app.ts` | Worker PIN rules (6 digits, no repeats/runs), lock after wrong PINs, switched-on features, attendance signs |
| `crew-domain.ts` | Crew trades, who was in which crew on a day, deployment checks, crew labour cost from approved attendance; one open crew per person per site |
| `tracking-domain.ts` | Team tracking: month ranges in IST, attendance (hours in hundredths, days in halves), presence and report sums per person |
| `project-hub.ts` | Project page billing summary: only Approved bills count as billed; drafts and waiting bills counted apart |
| `site-route.ts` | `siteScopedRoute`: the link that opens a module for one site |
| `help-content.ts` | In-app guide topics, first steps per role (`startPathFor`), troubleshooting |
| `ai-expense-extraction.ts` | Prompt, schema and re-checking of AI petty cash expense drafts (amount, date, payment mode); saves nothing |
| `ai-request-extraction.ts` | Prompt, schema and re-checking of AI material request drafts (names, quantities, units); saves nothing |

## Conventions

- Every module here has a colocated `*.test.ts`. Add or update tests with any rule change; they run in `pnpm test`.
- Money is a string of integer paise (minor units) handled with `BigInt`. Never use `Number` or floats for money.
- Policy functions return a `{ code, message }` error or `null` instead of throwing, so the server can map the code to a `TRPCError`.
- Keep these files free of server imports (`drizzle`, `express`) so they bundle into the app.

## Gotchas

- `local-repository.ts` stores drafts only. A draft is never an approval or an official total; its state is Local Draft, Pending Sync, Synced, Conflict, or Sync Failed.

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
