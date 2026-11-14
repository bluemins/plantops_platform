# Marketing Insights: Phase Plan

**Status:** The owner approved a manual, owner-only pilot at ₹0/month on 2026-11-11. No service, API, subscription,
PlantOps code, database or credentials have been changed. The first report is prepared only when the owner asks for it;
this chat does not run a background weekly monitor.

## Purpose

Use the existing Marketing Contacts module slot for a future **Marketing Insights** module. The first step is a
zero-cost manual pilot that helps the owner understand public customer feedback and activity, relevant local
competitors, and practical ways to improve customer perception by addressing real needs and communicating honestly.

Marketing Insights is owner-only by default. The existing **Marketing staff** role belongs to Sales
(`order_capture`) and is not access to Marketing Insights. Do not grant other users access unless the owner later
asks for it.

## Agreed pilot scope

| Item | Agreed scope |
|---|---|
| Budget | ₹0/month. No paid listening service, paid API, or subscription. |
| Owner's public pages | Instagram `@bluemins_life`; Facebook `https://www.facebook.com/bluemins.life/`. |
| Areas | Bargarh, Sambalpur, Bolangir and Dunguripali. |
| Businesses to discover | Packaged drinking-water brands/plants; 20 L jar and home/office delivery businesses; distributors and retailers selling competing water brands. |
| Names to check | Crystal, Anmol, Sujal and Amrit. These are search leads, not confirmed competitor identities. |
| Sources | Public pages, public posts/listings and reviews only, where accessible without payment or bypassing platform restrictions. |
| Cadence | Two-week pilot; the owner requests each report in chat. No scheduled collection or automatic delivery. |
| Audience | Plant owner only. |

The pilot should include relevant businesses found in the area, not only the four named leads, but must not claim
complete market coverage. Mark uncertain business matches as unverified and ask the owner before treating them as
competitors. Do not profile individual customers or collect private messages.

## Weekly report format

1. **Coverage:** dates reviewed, areas and sources checked, and known gaps.
2. **Customer activity and demand signals:** public, aggregate questions, needs, product preferences or service
   concerns, with links to representative evidence.
3. **Bluemins:** public mentions, questions, praise and complaints; identify urgent items for owner follow-up.
4. **Local market:** verified relevant competitor activity, public promotions or notable changes, with links.
5. **Perception opportunities:** recurring issues to fix and truthful messages that could clarify or demonstrate
   Bluemins' service, products or quality practices.
6. **Suggested actions:** prioritized, practical next steps. Any reply or post is a draft for the owner to review;
   never publish automatically.

Sentiment or demand interpretations are directional, not facts. Link to evidence and distinguish observed content
from inference. Do not fabricate reviews, impersonate customers, conceal criticism or make unsupported claims.

## Phases

### Phase 0 — Scope and guardrails (approved)

- Use the pilot scope above.
- Keep spending at zero and the workflow manual.
- Restrict the report to the owner.
- Use only public information; verify ambiguous businesses; cite source links.
- No automated posting, private-message collection, account connection or PlantOps changes.

### Phase 1 — Manual pilot (next)

- Prepare two reports, one per week, when requested by the owner.
- Review accessible public material for the agreed areas, categories and search leads.
- Use free access only. If a platform blocks access, requires payment/approval, or does not expose a source,
  record the gap instead of scraping, bypassing controls, or substituting an unverified result.
- Include the coverage statement and links in each report; separate confirmed facts from interpretation.
- Owner checks whether the reports are accurate and useful.

### Phase 2 — Pilot review and decision

After two reports, review coverage, false matches, usefulness, time required and whether the findings led to a useful
action. The owner decides whether to stop, continue manually, or ask for a new plan. Any proposed cost or source
requiring paid access must be presented for explicit approval; the current budget remains ₹0.

### Phase 3 — Detailed PlantOps module design (not approved for build)

Only if the owner asks to proceed after the pilot:

- Design the user-facing name **Marketing Insights**, retaining internal module ID `marketing_contacts` unless a
  separately approved migration is justified.
- Specify owner-only server-enforced access, settings, report history and deletion/retention expectations.
- Determine which sources support permitted integration, what credentials are required, and their actual costs and
  terms. Do not store credentials or connect accounts before approval.
- Decide whether reports are generated on demand or scheduled; scheduling would be a separate capability from this
  manual pilot.
- Write detailed requirements, tests and a build plan, then wait for owner approval before any code, schema,
  permission or credential changes.

### Phase 4 — Optional module foundation and source integrations (future; separate approval)

If approved after Phase 3, build the standalone module on `packages/module-kit`, with tenant isolation and owner-only
authorization enforced on the server. Add only sources whose access is explicitly approved and compliant with their
terms. A source outage or unavailable competitor data must be reported clearly, not presented as a complete result.

### Phase 5 — Insights, improvement workflow and release (future; separate approval)

If approved, add evidence-linked themes, trend comparisons, actions to address recurring issues, and owner-reviewed
reply/content drafts. Keep public actions human-approved. Test tenant isolation, owner-only access, source failures,
report accuracy indicators, and notification behavior before release. Adding staff access, paid sources, or automated
publishing requires a new explicit owner decision.

## Existing PlantOps relationship

The platform already registers `marketing_contacts`, but there is no Marketing Contacts app today. The launcher
currently describes the slot as “Contacts & follow-ups”; Marketing Contacts is also listed as a future module in
`docs/TODO.md`. The user-facing rename to Marketing Insights is a planned change, not yet live.

The Sales `marketing_staff` role remains a separate role for Sales customer-management functions. It must not be
reused as a Marketing Insights role. A new Insights-specific operating role is not needed for the owner-only pilot.
