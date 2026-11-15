# 0001 · Product-grade roles, scope and approval authority

Status: approved by the owner on 15 Nov 2026 ("research well and implement"). Builds on the
account hierarchy of 13 Nov 2026 (`lib/jp/account-role-policy.ts`).

## 1. What exists (checked in code, 15 Nov 2026)

| Area | Today | Where |
|---|---|---|
| Roles | owner, director, admin (company-wide); project_manager, site_engineer, supervisor, accounts, storekeeper, auditor (site-scoped); super_admin (platform); worker PIN login (no membership) | `server/jp/policy.ts`, `access.ts` |
| Permissions | ~80 keys, role defaults per module; `.view` keys read-only and allowed on closed sites | `capabilities.ts`, `policy.ts` |
| Scope | Company-wide roles see every site; others only sites they are assigned to; the role can differ per site (`site_assignments.assignmentRole`) | `getAccessibleSites`, `getSiteScope` |
| Per-user exceptions | On/Off per permission for the company, a project or a site (`permission_grants`), only by someone above, never self or an owner | `user-access.ts` |
| Separation of duties | Maker-checker on reports, bills, payments, cash, payroll, PO, WO, returns, leave; self-approval only under a delegation with `approval.self` | `selfApprovalAllowed` |
| Temporary authority | Delegation bundles for 1 h – 1 month, revocable | `delegation.ts` |
| Accounts | Create, edit, reset, suspend, remove, restore by hierarchy; invites | `accounts.ts` |
| Audit | Every business change and access change | `audit_events` |
| Modules | Company switches modules off for everyone | `module-settings.ts` |

## 2. Benchmark: what enterprise construction ERPs (Procore, Oracle Aconex/Primavera Unifier, SAP S/4 construction, Indian ERPs like Highrise/StrategicERP) do

1. **Project as the main scope.** People join a *project* with a role and see all its sites,
   including sites added later; site-only membership is the exception.
2. **Delegation of Authority (DoA) matrix.** Every money approval has a ceiling per role:
   e.g. Project Manager approves POs up to ₹1 lakh, Director above. Above the ceiling the
   approval is refused and goes to the next level.
3. **Visible permission matrix.** Admins can see, per role and module, what is allowed, and
   change company policy without code.
4. **Least privilege + explainability.** Each user can see "what can I do here and why"
   (role, site, exceptions, delegation).
5. **Access review.** A periodic export of who has which access, for audits (ISO 27001 A.5.18,
   SOC 2 CC6.2-6.3).
6. **Session control.** Admins see active sign-ins and can end them; users can sign out other
   devices.
7. **Custom role templates.** Companies define roles like "Electrical Supervisor" as a base
   role plus switched exceptions.

## 3. Gaps and decisions

| # | Gap | Decision |
|---|---|---|
| G1 | No project-level membership; a PM must be added site by site | Add `project_assignments` (user, project, role, dates). Accessible sites = site assignments ∪ every site of assigned projects. A site assignment on the same site wins (more specific). |
| G2 | No money ceilings on approvals | Add `approval_limits` (company, role, area, ceiling in paise; no row = no ceiling, so nothing changes until a leader sets limits). Enforced on PO approval, subcontract bill approval, supplier payment approval, petty cash approval, client RA bill approval and budget approval. Owner and Super Admin have no ceiling. |
| G3 | Role matrix is invisible | Read-only "Roles and permissions" screen built from the same role defaults the server uses (no second copy). |
| G4 | No "my access" | "My access" screen: my roles per company/project/site, exceptions, delegations, approval ceilings. |
| G5 | No access review | Leaders export a CSV: person, role, scope (company/project/site), exceptions, last sign-in, status. Audited. |
| G6 | No session control | Leaders see a person's active sign-ins and end them; anyone can end their own other sign-ins. |
| G7 | No custom roles | Deferred: per-user exceptions already cover it for 5–50 users; revisit when a client asks for named templates. |

## 4. Rules (server-enforced)

- Project role ranks follow the account hierarchy; only roles below the manager may be given;
  project managers can add people only to their own projects.
- A project assignment never gives company-wide roles (owner/director/admin stay company roles).
- Approval ceiling check happens inside the same transaction as the approval, on the amount the
  server computed (never a client total). Refusal message names the ceiling and the next level.
- Every change to project assignments, limits and sessions writes an audit event.

## 5. Acceptance

- A PM assigned to a project sees and works on all its sites, including one created afterwards;
  removing the project assignment removes that access at once.
- With a PO ceiling of ₹1,00,000 for project managers, a PM cannot approve a ₹1,50,000 PO;
  a Director can; with no ceiling set, behaviour is unchanged.
- Roles screen shows, per role, the same permissions the server applies (one source).
- My access lists roles, scopes, exceptions, delegations and ceilings for the signed-in person.
- Access review CSV lists every member with role, scope and status; the export is audited.
- A leader ends a person's sessions and their next request is refused.
