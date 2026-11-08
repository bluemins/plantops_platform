# Customer app ("Drop") — discussion and plan

App name **"Drop"** (decided by the owner 2026-11-07; working name "Book it" until then). Discussed with the owner on 2026-11-06. This file records
everything agreed, recommended and still open. It is **not yet an approved phase plan**: no PlantOps code, schema or
permission change has been made for it. The only thing built is a **demo app with made-up data** (section 14) so the
owner can feel a Capacitor app on their phone.

## 0. Status (2026-11-06)

- **Discussion:** done (this file).
- **Demo app:** built outside the monorepo, made-up data only, never talks to PlantOps (section 14).
- **Waiting for the owner:**
  1. screenshots of **PurePani's customer app** (list in section 12)
  2. the **open questions** in section 12
  3. ~~a clear OK on a native (Capacitor) app~~ **given 2026-11-07** (customer app only; CLAUDE.md updated)
- **Demo tried by the owner (2026-11-06):** "App screens and feel are fine." Capacitor look and feel accepted.
- **Next discussion (new session):** the **content and screens per customer type** (B2C 20L vs B2B Bluemins vs B2B
  Mr.Charge vs both). Proposal and the six points to decide: **section 15**. Start there.
- **Decided 2026-11-06 (later):** orders, ledgers and bills in PlantOps; a PlantOps bill is a **bill / statement of
  account**, Zoho only for GST invoices via a send queue (decision 4.9, section 16). Capacity for 1,000–2,000
  customers checked on paper (section 16.1). Waiting for the CA's answers (question 12.11).
- **Re-ordered 2026-11-06 (owner): Bluemins + Mr.Charge (B2B) first, 20L later** (decision 4.2, section 8). Next
  discussion: what the first B2B version shows (section 15.3 B, 15.4).
- **2026-11-07:** the owner's retailer feature list (directory, marketing kit, product / quality info, support,
  announcements, loyalty, rewards) mapped to PlantOps with a proposed first version: **section 18.2** (4 points to
  decide). **Decided the same day: shops see only the current order (no history, no amounts) + total due**
  (section 18.3). **Bluemins only at first; Mr.Charge switched on per customer** (section 18.4). App name **Drop**;
  mock-up: https://claude.ai/artifact/AFWktvyoB2XEyXgihJXouQ
- **2026-11-08 (owner):** Bluemins water-bottle customers also see their **box totals** (this month, last month, this
  year vs last), never money or an order list (section 18.5, replaces part of 18.3).
- **2026-11-08 (owner): Google Play account.** Business per GST certificate: proprietorship, legal name **Sujata Sahu**,
  trade name **PureVibe Enterprises** (Bluemins and Mr.Charge are its brands). Recommended and being set up: **one
  organisation account** named exactly as the D&B record (PureVibe Enterprises, proprietor Sujata Sahu) with a D-U-N-S
  number; Sujata Sahu answers D&B / Google identity checks, Rocky can be an admin user.
  **D-U-N-S requested 2026-11-08** (D&B India, free route, reason "Google Developer", contact Manas Ranjan Sahu,
  `contact@bluemins.life`), reference **DR110820263662512338**; up to 30 business days. Next: Play Console sign-up
  (Organisation, name exactly as D&B lists it) once the number arrives (no 12-tester / 14-day closed test needed; account type can't be changed later). One account publishes Drop
  for both brands.
- **2026-11-08: login-code template created** by the owner (section 19): `drop_login_code_v1` =
  `HX701c5de329b39705cfa1c152c931c4b7`, WhatsApp Authentication, security note + 10-minute expiry + Copy code;
  submitted to Meta 23:45 IST, **approved by Meta the same night** (business- and user-initiated).
- **2026-11-08: Firebase project created** by the owner (push, Phase 6): project "Drop", id `drop-purevibe`, under the
  `bluemins.life` Google organisation, free Spark plan, Analytics and Gemini off, Android app `life.bluemins.drop`
  (permanent once on Play), FCM API (V1) enabled (legacy API disabled), sender id 823242107636;
  `google-services.json` kept by the owner for Phase 3. The organisation may block service-account keys by default:
  allow it for this project only in Phase 6. The **service-account key** (secret) is made only in Phase 6, straight into a Railway variable, never in
  chat or git.
- **2026-11-08: Phase 0 decisions 1–4 made** (section 20).
- **2026-11-08: phase plan approved: `docs/CUSTOMER_APP_PHASE_PLAN.md`** (Phases 1–7, database, decisions D1–D6
  approved incl. due per brand and free boxes not counted, build prompts). Next: Phase 1.
- **2026-11-09: Phase 1 live (v0.49.0):** Drop switch, extra phones, WhatsApp-code login (server side) and the staff
  screens; Rates brands set by the owner (Bluemins / Mr.Charge / Hemex / Bluemins 20L). **Next: Phase 2** (Home data)
  in a new session, using the Phase 2 prompt in the phase plan; then design Phase 4 content (brand-wise push, see the
  phase plan's Phase 4 note). Waiting on: the D-U-N-S number (ref DR110820263662512338) for the Play Console.
- **Then (done above):** turn this into a phase plan with mock-ups (`docs/CUSTOMER_APP_PHASE_PLAN.md`), with every schema change
  listed for approval, like the earlier modules.

## 1. The idea (owner's words, 2026-11-06)

- "We are having the packaged drinking water business, Distilled water business and 20L delivery business. I want to
  have a single customer facing application, but the backend is same which is already running on Railway."
- "For 20L jar entry I use a subscription based app (PurePani). But for Bluemins and Mr.Charge I do not use any. So
  instead of creating for 20L only, I am thinking to create one for all the products in one Android app."
- "With app things to push sales + ads + many things can be done."
- "Backend: I am good to have single backend."
- "We can cross sell among our customers."
- "From the customer side it's just the read-only data from the app side. So not necessarily they need to choose any
  brand. We can just have a section where they see the orders that they have made."
- "Existing customer would see the read-only order, invoice for each order and our interactions. Any business."
- Future: "if at all we want to integrate the order, it will be possible"; "the app can be an e-commerce app for
  future"; "businesses (Bluemins and Mr.Charge) can upload their products and others can see also: very far-fetched".

### 1.1 Why a B2B FMCG customer app can be valuable

A B2B app is worthwhile when it makes routine buying and account checks easier for shops and distributors—not simply
because the business has an app. For Bluemins and Mr.Charge customers, it can provide:

- **A dependable order record:** customers can check what they ordered, quantities, delivery status and their own
  prices without searching through WhatsApp messages or calling the office.
- **Clearer accounts:** bills, payments and balances in one place can reduce avoidable questions and make it easier
  for customers to reconcile purchases with their own records.
- **Faster repeat business:** a customer-specific product and price list makes it easier to decide what to reorder;
  app ordering can follow later if the read-only version proves useful.
- **More informed growth:** seeing their own order history and quantities can help a shop spot what it regularly
  buys, plan stock and consider increasing volumes or adding suitable products. Bluemins can support that with
  relevant recommendations; order history shows purchases from Bluemins, not the shop's sales to its own customers.
- **A direct service channel:** customers can find help, see the status of an issue and receive relevant updates.
- **Relevant cross-selling:** the business can introduce another suitable product or brand to existing customers,
  with customer consent for promotional messages.

For the company, a useful app can reduce repetitive order-status and account enquiries, strengthen customer
relationships, and create an owned channel for future ordering and offers. These are benefits to test, not guaranteed
savings or sales. WhatsApp and personal sales relationships should remain available; the app should make service
easier, not force every customer to change how they buy.

**The customer-value gap:** order history, delivery status and a price list mainly put existing information in a new
place. They may save time, but by themselves they do not give the shop a compelling new reason to install and keep
using an app. Before building, identify at least one benefit customers cannot get as easily today and validate that
they want it. Possibilities to discuss—not decisions—include simple repeat ordering, reliable stock / delivery
availability, useful reorder prompts based on the shop's own buying pattern, easy-to-download account documents, or
clear volume schemes and product guidance. Do not promise stock availability, discounts, or sales growth unless
Bluemins can operationally provide them. If none of these solves a real customer problem, a read-only app may not be
worth the effort yet.

The proposed B2B-first, read-only pilot is a low-risk way to test whether customers actually use order history,
account information and their own price lists before investing in order entry or e-commerce. Measure activation,
repeat use, customer enquiries and order/account corrections during the pilot; add ordering only when the evidence
and customer feedback support it.

## 2. The three businesses

| Business | Brand | Type | Customers | Today |
|---|---|---|---|---|
| Packaged drinking water | **Bluemins** | B2B (shops, distributors) | ~200+ | Order Capture + WhatsApp bot; billing in Zoho |
| Distilled water | **Mr.Charge** | B2B (battery / auto / inverter shops) | ~100+ | Order Capture (brand tag since v0.32.0); billing in Zoho |
| 20L jar delivery | **Bluemins** | B2C (households, offices, event venues) | ~270 (~80 active, ~30 jars a day) | **PurePani** app |

Owner's answer on which comes first: **"the stronger case is 20L"**. Bluemins / Mr.Charge B2B customers are fine on
WhatsApp for now.

## 3. PurePani today

- **Cost:** ₹4,600 a year for up to 300 customers (about ₹380 a month).
- **Two apps on one backend:** an **owner / staff app** and a **customer app**. The same shape as this plan (PlantOps
  staff side + "Drop" customer side, one backend).
- **Owner app** (screenshots seen 2026-11-06). At its core it is a **credit ledger for 20L jars**:

| PurePani (owner app) | What it does | PlantOps today |
|---|---|---|
| Single / Bulk Delivery, QR scan of the customer's card | Per customer, date and shift (Morning / Afternoon / Evening): **delivered** and **empties received** per product (Bluemins 20 L, Capsule Jar ₹40, Dispenser), "Delivery by" an employee, "Share on submit", a "collect payment" warning when dues are open | ❌ Order Capture has orders, not doorstep entries with empties |
| Balance Jar | Jars still with the customer ("Unbalance Jar") | ❌ (Floor Stock counts jars inside the plant only) |
| Past / Current / Total Due | Money owed per customer | ❌ Order Capture has no payments (billing is in Zoho) |
| Payments | Cash / Cheque / Online / Wallet, "Received by Bindu / Anmol / Rocky", Customer + Employee payments, print | ❌ |
| Invoices | Daily / Weekly / Monthly invoice with past dues ("Invoice amount" vs "Payable amount"), share / print | ❌ |
| Monthly Card / Monthly Details | Calendar per customer: delivered, received, balance and time each day, totals, PDF | ❌ |
| Customers | Name, mobile, billing mobile, customer group, address with map pin, email, GST number, shift, Daily / Weekly / Monthly, Marketing contacts tab, Invite All | 🟡 Order Capture customers (no group, shift, GST, map pin, frequency) |
| Groups | e.g. "Event" | ❌ |
| Leaves (customer) | Pause deliveries | ❌ |
| Past Deliveries, Delivered / Not delivered filter | | ❌ |
| Load / Unload | Jars put on the vehicle and brought back | ❌ |
| Offline mode | Works without network | ❌ (PlantOps is online-only by design) |
| Expenses, Employees, Leaves (staff) | | ✅ Attendance & Salary already does these |
| Message, Membership, Reports, Support, My Shop, Website | Messages to customers, PurePani subscription, extras | ❌ / not needed |

- **Customer app:** not seen yet. The owner will send screenshots (section 12).

## 4. Decisions by the owner (2026-11-06)

1. **One customer app for all three businesses**, on the **existing PlantOps backend** (no second backend).
2. ~~20L first (replacing PurePani), B2B later.~~ **Changed by the owner (2026-11-06, later): Bluemins and Mr.Charge
   (B2B) first, 20L later.** PurePani keeps running for 20L until then.
3. **A native Play Store app**, not a PWA: "customers would not like PWA apps". (Capacitor recommended and accepted
   for a trial: section 5.1.)
4. **One app name for all brands** ("Drop", decided 2026-11-07). **No brand choice:** the customer sees everything they
   buy, any brand, in one place.
5. **Read-only first:** the customer sees their own orders, an invoice per order and "our interactions", for any of
   the businesses.
6. **App price "always the same for all"** (one app price per product). See open question 6 for B2B.
7. **Cross-selling** between the three customer bases is a goal.
8. Ordering, e-commerce and a marketplace are **later possibilities**, not now (section 10).
9. **Orders, ledgers and bills live in PlantOps; Zoho only for GST invoices** (owner, 2026-11-06: "maintain the order
   through Railway and my infra and only push the important / GST compliant bills to Zoho if at all required").
   - **A PlantOps bill is a bill / statement of account, never a tax invoice** (agreed 2026-11-06). PlantOps therefore
     follows no GST invoice rules (FY numbering, GSTIN, HSN, tax breakup, e-invoicing); **Zoho stays the only place tax
     invoices are issued.**
   - Bills that need a GST invoice go to Zoho through a **send queue** in the background (section 16.2); the app never
     waits for Zoho.
   - Which sales need a Zoho invoice is for the owner's CA (section 12, question 11).

## 5. Recommendations (mine), with reasons

### 5.1 App type: Capacitor

**Capacitor** (free, open source, by the Ionic team) wraps a React + Tailwind web app into a **real Android app**: built
as an `.aab` for the Play Store, its own icon, full screen with no browser bar, and phone features through plugins
(push notifications, camera, location, share). Customers can't tell it from any other app.

| | **Capacitor** ✅ | Fully native (Kotlin) | React Native / Flutter | PWA only |
|---|---|---|---|---|
| On the Play Store, real icon | ✅ | ✅ | ✅ | ❌ (owner: customers dislike it) |
| Push notifications | ✅ | ✅ | ✅ | 🟡 |
| Same code and skills as PlantOps | ✅ | ❌ new language | ❌ new framework | ✅ |
| iPhone later from the same code | ✅ | ❌ rewrite | ✅ | 🟡 |
| Fits a read-only orders / invoices / interactions app | ✅ well within | overkill | overkill | ✅ |
| Upkeep for a part-time developer | **lowest** | highest | medium | low |

- Weaker only for very heavy apps (games, complex animation), which this is not.
- Every screen change needs a new Play Store release (usually reviewed within hours to a day), because the screens
  ship inside the app; a paid live-update service could skip that, not needed at the start.
- **Decided (owner, 2026-11-07):** Capacitor, for the customer app only; recorded in CLAUDE.md's Stack section. The
  staff side stays web / PWA.
- Examples reported by developers (from unpacking the apps, not official statements): **JustWatch**, **Sworkit**;
  H&R Block's MyBlock on community lists.
- **CLAUDE.md conflict:** "Next.js + Tailwind, mobile-first PWA. No native app … in v1." Needs the owner's clear OK,
  then CLAUDE.md is updated.
- A **Trusted Web Activity** (Play Store shell around the PWA) was also mentioned: cheapest, but no native features
  beyond the browser's. Capacitor gives more for little extra.

### 5.2 The 20L ledger lives inside Order Capture (staff side)

A 20L delivery is an order, and **one customer list** is what makes cross-selling and one login possible.

- **No new Railway service** for the staff side (keeps cost flat, `docs/STABILITY_PLAN.md` section 9).
- **Delivery staff** role already exists (Calls only today); it would gain "Today's deliveries".

New in Order Capture (**each a schema change: ask first**):
1. **Doorstep delivery entry:** customer, shift, delivered + empties received per product, saved as a delivered order
   in one step; "Share on WhatsApp".
2. **Jar ledger:** each customer's jars out (delivered − received), per returnable product.
3. **Money ledger:** payments received (who received, how: cash / cheque / online), dues = delivered value − payments.
   **Append-only**: a mistake is corrected by a new entry, never deleted (stricter than PurePani's Delete button).
4. **Monthly bill / card** per customer, printable as PDF and shareable.
5. **Customer extras:** schedule (daily / alternate / weekly), shift, pause dates, group, GST number, customer type.
6. **App price** per product (one price for all; today each customer's rate comes from their last order).

Left out at first: **offline mode** (big; only if routes really lack signal: open question 2), **load / unload**,
**expenses** (Attendance & Salary covers them).

### 5.3 Customer API inside Order Capture at first

Like the WhatsApp bot API (`src/server/bot.ts`, outside the staff login): **no new Railway service**. A separate
service only if it grows. Customers log in with **phone number + a code sent on WhatsApp** (Twilio already set up),
never the plant login, never the SSO token.

### 5.4 Two rules that keep the future open

1. **The app gets data only through the API**, never the database. Adding "send an order" later is one more API call.
2. **Products, brands and businesses are data, not code** (the "no customer-specific code" rule). A third brand or
   another plant is an addition, not a rewrite.

## 6. What the customer sees (read-only version)

| Section | What | Where the data is |
|---|---|---|
| **Orders** | Every order, any brand: date, products, quantity, amount, status, brand tag | ✅ Order Capture (brand tags since v0.32.0) |
| **Bill per order / month** | The PlantOps bill (statement of account, decision 4.9); "GST invoice" link when one was sent to Zoho | PlantOps (new ledger, 5.2); the Zoho invoice number + link saved on the bill (section 16.2) |
| **Interactions** | Calls ("You called 5 Nov, 10:42 · attended"), WhatsApp thank-you / reminders sent, complaints and their status | ✅ Calls + messages in Order Capture; complaints in Complaint Box (matched by phone, through its API) |
| **20L** | Jars with you, empties returned, dues, payments, this month's card | The new 20L ledger (5.2) |
| **Notifications** | "Order O-0123 delivered", "Your October bill is ready" | Push via Firebase (free) |
| **Our products** (later) | All three brands, read-only, "Call / WhatsApp to order" | Products + brands as data |

**Never shown to the customer** (enforced on the server, like amounts are hidden from plant staff today): staff notes
on orders and complaints, order History ("changed by Bindu"), which staff member did what, anything of another
customer, the WhatsApp bot chat (it lives in the bot's system; customers already have it in WhatsApp).

## 7. How it fits together

```
"Drop" (Capacitor, Play Store)
        │  phone + WhatsApp code login
        ▼
Customer API (read-only) ──► Order Capture (orders, 20L ledger, calls, messages)
                         ──► Complaint Box (complaints, via its API)
                         ──► Zoho (invoice PDF / share link)
        ▲
PlantOps on Railway: same backend, nothing replaced
Staff side: Order Capture screens + Delivery staff on their phones (replaces PurePani's owner app)
```

## 8. Order of work (proposed)

Re-ordered 2026-11-06 (owner: B2B first, decision 4.2).

1. **"Drop" for Bluemins shops** (Mr.Charge per customer when switched on: decision 18.4; screens 15.3 B as changed
   by 18.2 / 18.3): orders with brand tags and status,
   interactions, their own price list; GST invoice link once the Zoho queue exists (16.2). Pilot with 10–20 shops, then
   all ~300.
2. **B2B bills and payments in PlantOps** (decision 4.9) for the Account tab (outstanding, statement), + the Zoho send
   queue.
3. **Write down what PurePani does for you**, export its data (customers, jar balances, dues) for opening balances.
4. **20L ledger in Order Capture** (staff side, 5.2).
5. **20L customers in "Drop"** (screens 15.3 A); run alongside PurePani with a few customers, then all ~80 active
   ones, then let PurePani lapse at its renewal date.
6. **Cross-selling:** "Our products" page, offers by push (section 9).
7. **Buttons:** Order again, extra jars, pause delivery.
8. **Payments:** UPI.
9. **Shop:** catalogue with photos, cart, offers, delivery slots.
10. **Marketplace** (very far off).

Each step is useful on its own; the owner can stop at any step.

## 9. Cross-selling

| Customer today | What else they could buy |
|---|---|
| 20L customers (offices, Police Party, Electric Office) | Bluemins bottles for meetings / visitors; a dispenser |
| Event customers (Kalyan Mandup, wedding halls) | Bluemins 200 ml / 500 ml / 1 L cases for every event, 20L for the kitchen |
| Bluemins shops (200+) | 20L jars for the shop and staff, or for resale |
| Mr.Charge shops (100+) | 20L for the shop; Bluemins cases to sell at the counter |
| Households on 20L | Bluemins cases for functions and festivals |

Needs:
1. **One customer per phone number** across all three businesses (Order Capture already works this way).
2. **Customer type** (household / shop / office / event venue / institution): already on the Insights list "after
   approval" (`docs/WHATSAPP_BUILD_PLAN.md` section 11); **schema change, ask**.
3. "Drop" shows all brands, opening on what the customer already buys ("Also from us").
4. **Offers by app push** (free) to a chosen group, e.g. "all event venues before wedding season". WhatsApp offers cost
   money per message, so push is the main channel.
5. A separate **"OK to send offers" consent**, apart from the reorder-reminder consent (`customer_consents`): a
   customer can refuse offers and still get reminders.
6. Owner view in Order Capture: customers who buy only one brand, by type. Group level only (the Insights rule: no
   individual scores).

## 10. Later: ordering, e-commerce, marketplace

**Ordering** can be added without rebuilding: the WhatsApp bot already orders through Order Capture's own save
(`saveOrder` in `src/server/orders.ts`: server-side prices, idempotency key, reference only after commit). "Drop"
would call the same path; the customer is already identified by the phone login; app orders show in the list, alerts,
CSV, tile and delivery list like any other. Needs then: the order screen, the app-price decision, maybe UPI.

**E-commerce** ladder: read-only → ordering → payments → shop → marketplace (table in section 8). It adds: online
payment and refunds / failed payments, a GST invoice per online sale, delivery areas and time slots, a stock check
(Floor Stock "Can make"), Play Store and payment-gateway policies (returns, terms, privacy page).

**Marketplace** (other businesses list products; "very far-fetched", owner): possible because PlantOps already holds
many plants, but plants are walled off by RLS by design, so it needs an **opt-in public catalogue**, never shared
tenant data. It also means taking payments for others, GST, their delivery, complaints and refunds: running a
marketplace, not just an app. Customers need a reason to open the app first (your own three brands). Kept possible by
rule 5.4.2. Also in `docs/TODO.md` "New ideas".

## 11. Costs

| Item | Cost |
|---|---|
| PurePani today | ₹4,600 a year (300 customers) |
| Google Play developer account | $25 once |
| WhatsApp login codes | a small charge per login (authentication template) |
| Push notifications (Firebase) | free |
| Railway | about nothing extra while the customer API lives in Order Capture; a separate service ≈ ₹1,000–2,000 a year |
| Zoho API | within the existing Zoho plan (to check) |

**The case is not saving money** (PurePani is cheap). It is: **owning the customer list, one ledger for all three
businesses, and a channel to push sales and offers.**

## 12. Open questions (with my recommendation)

1. **Which PurePani features are used every day?** Guess from the screens: Delivery, Payments, Invoices, Monthly
   Card, Customers. Are Load / Unload, Offline mode, Groups, Expenses, Message in use?
2. **Do delivery boys lose signal on routes?** *Recommend: online-only first, a "save and send later" for weak signal if
   needed.*
3. ~~20L billing stays out of Zoho?~~ **Decided (4.9):** bills and dues in PlantOps for every business; Zoho only for
   GST invoices.
4. **Do 20L customers use PurePani's customer app today** ("Invite All")? Tells how much they'll use "Drop".
5. **Can PurePani export customers, jar balances and dues** (Excel / CSV)? Needed for opening balances. And its
   **renewal date** (sets the deadline).
6. **B2B prices:** one app price for shops too, or their own rates? *Recommend: shops keep their own negotiated rates;
   "one price for all" for 20L / households.*
7. **Invoices for Bluemins / Mr.Charge:** now shaped by decision 4.9: the PlantOps bill (statement of account) plus the
   Zoho GST invoice link when one exists. Still open: does every B2B order keep its own Zoho invoice as today, or does
   PlantOps make the bill and push it to Zoho? *Recommend: PlantOps bill + push to Zoho for every customer with a
   GSTIN (one place to enter orders).*
8. **Which interactions to show?** *Recommend: calls, messages sent to the customer, complaints with status; not the
   bot chat.*
9. **Payment method today for 20L** (cash on delivery / monthly bill / prepaid)? *Recommend: keep what customers are
   used to; UPI in the app later.*
10. ~~OK to build native (Capacitor) against the CLAUDE.md PWA rule?~~ **Decided (owner, 2026-11-07): yes, customer
    app only**; CLAUDE.md Stack section updated.
11. **For the owner's CA** (decides the Zoho send queue's rule):
    - Which sales need a Zoho tax invoice? B2B customers with a GSTIN for certain.
    - Small 20L household sales: may one combined B2C invoice per day (or month) in Zoho cover them (GST allows a
      consolidated daily invoice for low-value sales to unregistered buyers who don't ask for one)?
    - Is a PlantOps "bill / statement of account" (clearly not a tax invoice) fine to give customers alongside?

**PurePani customer-app screenshots wanted:** home after login; login screen (OTP?); jar balance / dues; monthly card
or bill; payment screen (UPI?); order extra jars / pause (leave); notifications or messages received; the ☰ menu.

## 13. Rules that apply (from CLAUDE.md)

- Generic, never Bluemins-only; brands / businesses / plants are data.
- **Ask before** any schema, grant, credential, Twilio or SSO change.
- Customers are not plant users: no plant login, no SSO token; their own narrow, rate-limited, audited API.
- The customer API would be the second PlantOps surface strangers reach (after Job applications): rate limits, minimal
  fields, one plant from server-side config, tenant isolation tests.
- Every new table: `tenant_id` + FORCE RLS; money ledger append-only.
- Railway cost: no new service without a reason.
- New notification events listed per phase (N5+ rule) — here also the customer push events.

## 14. Demo app (built 2026-11-06)

Built on the owner's request ("I want to try a Capacitor app, build it for me") so the owner can feel a Capacitor app
on an Android phone before deciding. **Made-up data only; it never talks to PlantOps.** No PlantOps code changed.

- **Where:** `~/projects/book-it-demo` (outside the monorepo on purpose, its own `README.md`). Build tools (Java 21,
  Android SDK 36) in `~/projects/android-tools`.
- **Stack:** Capacitor 8 + React 19 + Tailwind 4 + Vite; plugins `@capacitor/app` (Android back button) and
  `@capacitor/local-notifications` (the notification demo). App id `life.bluemins.bookit.demo`, name "Book it (demo)" (built before the name "Drop").
- **APK:** `~/projects/book-it-demo/android/app/build/outputs/apk/debug/app-debug.apk` (about 4 MB, debug-signed:
  Android warns "unknown app", fine for a trial, never for the Play Store).
- **Screens:** login (phone + "code on WhatsApp", any 6 digits), Home (jars with you, 20L due, on the way, recent
  orders, "Also from us" offer, Call / WhatsApp, "Try a notification", log out), Orders (all brands, brand chips),
  order page (lines, total, "View invoice", "Ask about this order"), sample tax invoice ("the real one comes from
  Zoho"), 20L (with you / delivered / empties back, due + "Pay (later)", month card, payments), Activity (calls,
  WhatsApp messages, complaint, bill), Products (three brands, "Ask" on WhatsApp).
- **Checked:** type check and web build pass; every screen screenshotted at 390 px in headless Chromium; APK built.
  Not yet installed on a real phone.
- **What the demo does not show:** real login codes, real data, Firebase push (it uses a local notification instead),
  UPI, ordering.
- **Owner's verdict (2026-11-06):** "App screens and feel are fine. However we still need to discuss the content of the
  app": the demo shows one mixed customer; the real screens must be planned per customer type (section 15).
- **Possible next demo step (offered, not started):** a switch between three made-up customers (20L household,
  Bluemins shop, a customer who buys both) so the owner can feel each version.

## 15. Screens per customer type (proposal, 2026-11-06, to discuss)

Owner (2026-11-06): "The Bluemins (B2B) / Mr.Charge (B2B) and 20L customer (B2C), so we need to plan it correctly,
the screens I mean."

### 15.1 The main idea: the app adapts to what each customer buys

No brand choice and no separate apps. At login PlantOps already knows what the customer buys, and the app shows only
those sections:
- a **20L-only household** sees only 20L screens
- a **Bluemins shop** sees only B2B screens (a **Mr.Charge shop** the same, with its products)
- a **customer who buys both** (e.g. boxes for the shop and 20L for the staff) sees both

### 15.2 What each customer cares about

| | **20L household / office (B2C)** | **Bluemins shop / distributor (B2B)** | **Mr.Charge battery / auto shop (B2B)** |
|---|---|---|---|
| Main worry | "Will my jar come today? How much do I owe?" | "Is my order coming? Where's my GST invoice? What do I owe?" | Same as Bluemins |
| How they buy | Regular delivery (daily / weekly) | An order now and then, often the same as last time | An order now and then, smaller |
| Money | Monthly bill, cash / UPI | Credit, GST invoices for their accounts | Same |
| Wants from the app | Today's delivery, jars, bill, pause, extra jar | Order status, invoices, outstanding, their price list, offers | Same |

### 15.3 Proposed screens

**A. 20L customer (B2C).** Tabs: **Home · Deliveries · Bills · Help**
1. **Home:** today's delivery ("2 jars coming this morning" / "Delivered 9:10 am"), jars with you, amount due, last
   delivery, an offer card
2. **Deliveries:** the month card (date, given, empties back, balance), previous months
3. **Bills:** the monthly bill (PDF, share), payments made, due now
4. **Help:** call / WhatsApp, support hours, complaints and their status, past calls and messages
5. *Later buttons:* **Extra jar**, **Pause delivery** (going out of town), **Pay by UPI**

> **Changed by decision 18.3 (owner, 2026-11-07):** a shop sees only its **current order** (on the way / delivered
> today: products and boxes, no rates or amounts), **no order history and no statement**; the account shows only the
> **total due**. Points 2–4 below are superseded where they show history, invoices, statements or prices.
> **Then decision 18.5 (owner, 2026-11-08):** Bluemins water-bottle shops also see **box totals** (this month, last
> month, this year vs last), boxes only.

**B. Bluemins / Mr.Charge shop (B2B).** Tabs: **Home · Orders · Account · Products · Help**
1. **Home:** orders on the way, last delivered order, outstanding amount, an offer / scheme card
2. **Orders:** all orders with brand tags and status; each order shows its lines, total and **GST invoice** (Zoho)
3. **Account:** a statement like a passbook (invoices, payments received, balance), downloadable for their accountant
4. **Products:** *their own* price list (their rates, not one price for all), new products, schemes
5. **Help:** call / WhatsApp, complaints, past calls and messages
6. *Later buttons:* **Order again**, **Pay by UPI**

Mr.Charge shops get the same B2B screens with their products; a shop buying both brands sees both in the same tabs,
with brand tags.

**C. Customers who buy both (B2B + 20L).** The union: **Home · Orders · 20L · Account · Help**; Home shows both
summaries.

### 15.4 Points to decide (with my recommendation)

1. **B2B outstanding (Account tab): where from?** *Changed by decision 4.9:* from the PlantOps ledger (bills and
   payments in PlantOps), not read live from Zoho. Zoho holds only the GST invoice copies; a monthly check matches the
   two (section 16.2).
2. **B2B price list:** does a shop see its own rates? *Recommend: yes, only their own (saves "what's the rate?" calls;
   nobody sees anyone else's).* This refines decision 4.6 ("app price same for all"): one price for 20L / households,
   own rates for shops (also open question 12.6).
3. ~~More than one phone per business?~~ **Decided (owner, 2026-11-06): one primary phone + any number of secondary
   phones.** The shop (customer name) is always tied to the primary; secondaries log in to the same shop. Schema change
   (a phones table): approve when planned. Still to settle in the phase plan (my recommendations):
   - Secondaries see the same as the primary, amounts included (they order and pay for the shop).
   - Staff add / remove secondaries in Order Capture; the primary adding them from the app comes later.
   - A phone belongs to **one shop only** (bot, calls and login find the shop by any of its phones; today's rule "one
     customer per phone per plant" stays).
   - Order Capture fixes a customer's phone today; making a secondary the new primary (owner's number changes) needs a
     "Change primary" step for the owner, audited.
4b. **Mr.Charge shops (decided, owner 2026-11-06):** the same B2B screens with their own products; a shop buying both
    brands sees both in the same tabs, with brand tags.
4. **Language:** many 20L households may prefer Odia / Hindi. *Recommend: English first, every text kept in one place
   so Odia follows soon (Hindi / Odia were always planned for PlantOps).*
5. **Event customers** (wedding halls, a police party) take 20L now and then. *Recommend: 20L customers with no fixed
   schedule; Home shows "Last delivery" instead of "Today's delivery".*
6. **Offers per group?** *Recommend: yes: households see "Bluemins for your function", shops see schemes and new
   products (fits cross-selling, section 9).*

## 16. Capacity and the Zoho send queue (2026-11-06)

### 16.1 Is the current Railway setup enough for 1,000–2,000 customers?

**Yes, for the read-only app**, with the four rules below. Estimate only, not measured yet (no load test so far).

| Moment | Assumption | Requests / second |
|---|---|---|
| Normal day | 2,000 customers, ~20 % open the app, ~5 calls each | under 0.1 |
| Busy hour | 300 opens in an hour | about 0.5 |
| Push to everyone ("bill ready") | half open within 2 minutes | about 40 |
| Extreme | all 2,000 within 1 minute | about 170 |

One Order Capture copy (one Node process, 10 database connections) is estimated at 200–500 simple API calls a second,
shared with the staff screens. 2,000 customers' data is small for Postgres.

**Rules:**
1. **Pushes to everyone go out in batches** (e.g. 200 a minute), so a push never makes a spike.
2. **The app never calls Zoho** (decision 4.9): everything shown comes from PlantOps.
3. **Long customer sessions** (e.g. 90 days), so paid WhatsApp login codes stay few.
4. **A limit per customer phone** (like the bot API). The customer API starts inside Order Capture; it moves to its
   own Railway service (≈ ₹1,000–2,000 a year) only if staff screens slow down at peaks.

Customers see downtime, staff only felt it before: deploy after 21:00 IST and add an uptime monitor on Order Capture's
`/health` before launch.

**Before launch (in the phase plan):** a load test on the local copy: 2,000 customers opening within 2 minutes while
staff save orders.

### 16.2 Zoho send queue (only bills that need a GST invoice)

Same pattern as `notification_outbox` (schema change: ask when planned):
1. A bill is marked "needs GST invoice" (rule from the CA's answer, question 12.11: e.g. a customer with a GSTIN, or
   the owner's tick).
2. A row goes into the queue; a background job sends it to Zoho in batches, retries when Zoho is down, never twice.
3. The Zoho invoice number and link are saved on the PlantOps bill; the app shows "GST invoice" on it.
4. A failed send alerts the owner (never silent; `docs/STABILITY_PLAN.md` section 6 item 5).
5. A monthly check: bills marked for GST vs invoices in Zoho.

Bills and payments in PlantOps are append-only (a mistake is a new entry), and covered by the nightly encrypted backup.

## 17. Retailer-app examples researched (2026-11-07)

Public Google Play listings were checked to understand what established beverage companies offer. These descriptions
are published by the app developers; the apps were not installed or independently tested, and features can vary by
bottler, market and version.

### 17.1 Coca-Cola bottler retailer app: Coke Buddy for HCCB

[Coke Buddy for HCCB — Google Play](https://play.google.com/store/apps/details?id=com.applicate.kbuddy.app) describes a
retailer ordering platform that also works through WhatsApp and a website. Listed features include:

- product catalogue and ordering, including one-click repeat orders
- personalized product suggestions based on purchase history
- product / order-value schemes and online-only offers
- retail-margin, discount and estimated-invoice visibility
- order tracking, history and status notifications
- new-product information, offers and customer support

This is the closest example found to the proposed Bluemins B2B app. It suggests that retailers may get more value from
placing orders, understanding schemes and margins, and receiving useful purchase-history suggestions than from
read-only order history alone. It does not establish that Bluemins customers want every feature.

### 17.2 Bisleri apps checked

- [Bisleri@Doorstep — Google Play](https://play.google.com/store/apps/details?id=com.bisleri.bisleri) is a consumer
  app, not a retailer ordering app. Its listing describes one-time home orders, customizable delivery subscriptions,
  delivery schedules, changes to subscriptions, and subscriber offers.
- [Bisleri Delivery — Google Play](https://play.google.com/store/apps/details?id=com.bislerideliveryapp) is for
  delivery operations, not shop customers. Its listing describes order management, route planning, GPS and OTP
  delivery confirmation, customer calling, rescheduling, and empty-jar tracking.
- [Bisleri official website](https://www.bisleri.com/) and its [20 L product page](https://www.bisleri.com/bisleri-water-bottles/BISW-20LTR01-100.html)
  describe the consumer doorstep service and subscriptions.

The public sources checked did not establish the features of a Bisleri B2B retailer app. Search results surfaced
references to a Bisleri DMS app, but without a sufficiently clear retailer-facing feature description to rely on.

### 17.3 Implication for Bluemins

Potential retailer-value features to validate with Bluemins shops are **easy repeat ordering**, **clear and applicable
schemes / savings**, **relevant suggestions based on the shop's own purchases**, and **dependable order and delivery
updates**. Treat these as ideas, not approved scope. First ask retailers which of these would genuinely help them;
do not assume that copying another company's feature list will create adoption.

## 18. Customer-value discussion (2026-11-07)

The owner questioned whether showing **order history, delivery status and the shop's own prices** creates enough value
for an existing Bluemins retailer. These features may be convenient, but mostly expose information the customer
already has; they do not by themselves establish a compelling reason to install and regularly use an app.

The owner noted that seeing their purchasing history might help a shop understand its usage and scale up. This could
help a retailer review what it buys from Bluemins and consider larger quantities or related products. It should not be
presented as visibility into the shop's own sell-through: PlantOps order data does not show the retailer's sales or
remaining shelf stock.

The owner also raised a concern about showing prices: a retailer could show its Bluemins price to a competing supplier
and use it to bargain. Customer-specific prices are therefore both a possible convenience and commercially sensitive
information. A login can limit access to the intended customer, but cannot prevent screenshots, photos or deliberate
sharing. Before including prices, decide whether the customer benefit outweighs the risk of wider disclosure. Do not
show internal cost, margin or another customer's terms. If prices are shown, make clear what they apply to (product,
pack, quantity and effective period) and ensure the displayed price is accurate; hiding the price may reduce this
particular exposure, but may also make the app less useful.

**Practical way to handle the trade-off:** treat any price a customer can see as potentially shareable; login is an
access control, not a way to keep a price secret from competitors. For an initial pilot, consider not showing a
general product price list. Show the customer's order quantities and status, and provide their own bills / invoices
when needed for account records. Those documents may necessarily disclose transaction amounts, so do not promise
that app prices are confidential. Keep internal costs, margins and other customers' terms out of the customer app.
If the concern is specifically negotiated rates, test whether shops still find the app useful with a request-a-quote
or contact-us path instead of a standing price list. Make the pricing policy and who can approve discounts clear to
staff; the app itself cannot prevent a customer using a shared quote to negotiate.

As an alternative to displaying negotiated prices, the owner prefers **loyalty points calculated from the invoice
value, rather than box count**, with points redeemable for gifts. This recognizes the value of the business a
retailer gives Bluemins, including orders with different products and prices. The app would then combine B2B customer
service / ordering with a rewards-program feature; it would not be only a reward-management app. It does not remove
all commercial disclosure: points shown for each invoice, combined with a known earning formula, may let someone
estimate invoice value. One option to explore is showing the points balance and rewards progress, while keeping
individual prices and per-invoice point awards hidden.

A gift-redemption program would need clear rules for eligible purchases, earning and redemption, reward availability,
and cancelled, returned or unpaid invoices. The points basis still needs definition (for example, invoice value after
discounts, how GST is treated, and when points become redeemable). Bluemins should also check that the cost and
fulfilment of gifts are sustainable and that rewards are genuinely attractive to retailers. The calculation basis is
the owner's preference; the detailed rules and scheme are not yet approved.

The discussion then explored ways the app could help a retailer beyond supplying products. Early ideas included
helping shops attract customers, giving them ready-to-share product promotions, featuring participating retailers,
sharing practical retail tips, and helping them plan replenishment. The owner clarified that the question was about
**features inside the customer app**, rather than physical retail materials.

The competitor research in section 17 suggests possible app features to investigate:

- quick repeat ordering, including a one-tap repeat of a prior basket
- retailer-specific schemes, discounts, margins and estimated order value
- recommendations based on the retailer's own purchase history
- order tracking and useful delivery-status notifications
- new-product information and a direct support channel

The resulting working hypothesis is that **ordering convenience, transparent retailer benefits, and dependable
service** may offer more customer value than read-only records alone. This is a hypothesis, not a feature decision:
ask Bluemins retailers what would help their business, then pilot the smallest useful set. Do not promise discounts,
stock availability, delivery timing or sales growth unless Bluemins can reliably deliver them. Keep promotions
relevant and respect customer consent.

### 18.1 Additional customer-app feature ideas

The owner would also like to consider the following features for Bluemins retailers:

- **Find Bluemins near you:** an opt-in directory where participating shops can publish their location, hours and
  contact details so local buyers can find them.
- **Ready-to-share marketing kit:** Bluemins product photos, posters and short WhatsApp messages that a retailer can
  use to promote products.
- **Shop profile and promotion:** a simple retailer profile and, potentially, a promotion the shop chooses to share.
- **Product information:** pack sizes, product details, storage / handling guidance and answers to common questions.
- **Quality and trust resources:** approved quality information, certificates or documents retailers can show buyers.
- **Retailer learning:** short practical tips on product display, keeping packaged water presentable and answering
  common customer questions.
- **Support and feedback:** report a product or delivery issue, contact the right person, suggest improvements and
  see replies.
- **Announcements:** useful service updates, new launches and other retailer-relevant changes.
- **Loyalty account:** show the retailer's points balance and rewards progress. Points are intended to be based on
  invoice value, not box count; the calculation and program rules will be decided separately.
- **Rewards catalogue:** let a retailer browse eligible Bluemins products that can be exchanged for accumulated
  points. Product eligibility, point cost, availability, redemption and delivery rules remain to be designed.

These are ideas for discussion and validation, not approved scope. In particular, a shop directory needs the
retailer's consent and a way to keep its public details current; promotional content should be optional and
appropriate; reward products must be affordable to provide and reliably available. The shop's own profile or
promotion should be controlled by that retailer, while Bluemins controls official product, quality and service
information.

### 18.2 How each idea fits PlantOps, and which go first (proposal, 2026-11-07)

The owner (2026-11-07): "these things should be addressed in the app." Each idea below is matched to what PlantOps
already has, so nothing is built twice. **Content** = text / photos the owner writes once in an owner-only "Customer
app" page inside Sales (no new Railway service); **data** = comes from an existing module.

| # | Idea | What PlantOps already has | What is new | Who keeps it current | Proposed version |
|---|---|---|---|---|---|
| 1 | Product information | Products (size, pack, units per pack, HSN), brands on Rates | Owner text per product: details, storage / handling, FAQ, photo | Owner | **First** |
| 2 | Quality and trust | **Document Store** holds FSSAI / BIS / lab certificates with expiry | A per-document "show in customer app" tick (owner); app shows only **unexpired** ones, read through Document Store's API | Owner (renewals already tracked) | **First** |
| 3 | Support and feedback | **Complaint Box** (complaints, status, photos), Calls, support phone / hours on Business details | Customer sends an issue or a suggestion from the app → a Complaint Box complaint; a separate **"reply to customer"** text (staff notes stay hidden, section 6) | Complaint desk | **First** |
| 4 | Announcements | Notifications system (staff side only) | Owner writes an announcement → list in the app + push (sent in batches, 16.1 rule 1) | Owner | **First** |
| 5 | Marketing kit | — | Owner uploads posters / photos + ready WhatsApp texts; shop taps **Share** (phone's share sheet) | Owner | **First** (cheap to build; needs the owner's material) |
| 6 | Loyalty account | **Bills and payments in PlantOps since 6 Nov 2026** (the base for "points from invoice value") | Append-only points ledger; balance + progress in the app (per-bill points hidden, section 18 price concern) | Automatic from bills, by the rules the owner decides | **Second**, once the rules are decided |
| 7 | Rewards catalogue | Products, Sales orders | Reward items with a point cost; a redemption becomes a ₹0 "reward" order in Sales and is delivered like any order | Owner | **Second**, after 6 |
| 8 | Retailer learning | — | Short articles (same screen type as 1) | Owner | **Second** (content takes time to write) |
| 9 | Shop profile and promotion | Customer page: name, place, **shop location** (📍 since v0.45.0) | Shop edits its hours, photo, one promotion; **owner approves** before anything is public | The shop | **Third**, with 10 |
| 10 | Find Bluemins near you | Shop locations already saved by staff | A **public** page (no login) listing shops that opted in; e.g. `bluemins.life` linking to it | Shop (opt-in) + owner | **Third** |

**My recommendation: first version = 1–5 plus the current order and total due (decision 18.3).** Reasons:
- They give a shop reasons to open the app that it doesn't get today (certificates to show buyers, posters to share,
  issue tracking with replies, news), which answers the customer-value gap in section 1.1.
- They are mostly owner-written content and existing data, so they are cheap to build and carry no money risk.
- Loyalty (6, 7) handles money-like value: it needs the rules first (what counts: paid bills only? after discounts?
  GST included? cancelled / unpaid bills?), and points should only be shown once they are exact.
- 9 and 10 are the **only public, stranger-readable parts** (like Job applications' page): they need the shop's
  consent, the owner's approval of what is shown, and a way to drop shops that stop buying. Better after the app has
  real users.

**Ongoing work for the owner, not just a build:** 1, 2, 4, 5 and 8 are only as good as the content behind them. Before
the first version: product texts and photos, which certificates to show, 3–5 posters with WhatsApp texts, and the first
announcement.

**Schema changes these would need (ask when planned, none approved):** app content (products text, articles, kit
items, announcements), the "show in customer app" tick in Document Store, the "reply to customer" text in Complaint
Box, and later the points ledger, rewards, shop profiles and directory opt-in. Each with `tenant_id` + FORCE RLS.

**Points to decide (owner):**
1. First version = 1–5 + orders / account? *(recommended, reasons above)*
2. Loyalty rules: earn on **paid** bill value, after discounts, **before GST**, none for cancelled bills? *(recommended:
   pays only for business actually received, and GST is not Bluemins' money)*
3. Rewards: Bluemins products only, or gifts from outside too? *(recommended: own products first: no buying or stock of
   outside gifts)*
4. Directory: public web page, inside the app, or both? *(recommended: both later, from one opt-in list)*

### 18.3 Decision: current order only, no history (owner, 2026-11-07)

> **Partly replaced by decision 18.5 (owner, 2026-11-08):** Bluemins water-bottle customers also see their **box
> totals** (this month, last month, this year vs last year), boxes only, never money or a per-order list. Everything
> else below still holds.

**Concern (owner):** a shop could show its order history in the app to a competing supplier and use it to bargain.

**Decided: "Current order only".** For B2B shops the app shows:
- **Only an order that is on the way or delivered today:** products and boxes, status. **No rates, no amounts.**
- **No order history list, no bill list, no statement** in the app.
- **Account: the total due only** (one number, no per-bill breakdown).
- **Loyalty: the points balance and progress only** (no points per bill, section 18).

Enforced on the **server** (the customer API never sends history, rates or amounts), like amounts are hidden from
plant staff today. Bills and GST invoices still reach the shop as today (paper / WhatsApp / Zoho); the app just doesn't
put the whole buying record on one screen. Section 6's Orders / Bill rows and 15.3 B's Orders / Account / Products tabs
follow this decision. To revisit only if shops ask for history and the owner agrees (e.g. for their accountant, a
statement on request through staff).

### 18.4 Decision: Bluemins first; Mr.Charge switched on per customer (owner, 2026-11-07)

- **Drop starts with Bluemins packaged drinking water only.** Mr.Charge products, orders, posters and rewards don't
  appear by default.
- **Mr.Charge can be switched on for a chosen customer** (by their mobile number, i.e. their Sales customer record).
  That customer then also sees Mr.Charge in the same screens, with brand tags (decision 4b in 15.4).
- *Proposed (to approve in the phase plan):* an owner-only setting on the customer's page in Sales, "Brands shown in
  Drop" (Bluemins always; Mr.Charge ticked per customer), audited; the customer API filters on the server what it
  sends, so an unticked brand never reaches the phone. Brands stay data, never code (rule 5.4.2), so a third brand
  works the same way. **Schema change: ask.**
- This replaces "Bluemins + Mr.Charge shops" in the first step of section 8.

### 18.5 Decision: box totals for Bluemins water-bottle customers (owner, 2026-11-08)

**Asked by the owner (2026-11-08):** customers should be able to see how much they have ordered. This replaces the
"no history" part of 18.3 for one group of customers, in one limited form.

**Decided:**
- **Who:** for now, only **Bluemins water-bottle customers** (shops buying Bluemins packaged drinking water in boxes:
  1 L, 500 ml, 250 ml, 2 L…). Not Mr.Charge customers, not 20 L jar customers. Others can be added later only when the
  owner decides.
- **What:** **box totals only.** Example:

  | Shown | Example |
  |---|---|
  | This month | 120 boxes (1 L: 80 · 500 ml: 40) |
  | Last month | 95 boxes |
  | This year (April–March) | 1,050 boxes, against 870 last year |

- **What is still never shown** (18.3 unchanged here): rates, amounts, bill values, a list of orders or bills, a
  statement. The account still shows the total due only.
- **Only Bluemins bottles count** in the totals, even for a customer switched on for Mr.Charge (18.4): no Mr.Charge
  boxes, no 20 L jars, no empty bottles or connection charges.

**Why (owner, 2026-11-07 / 08):** seeing their own buying helps a shop plan and buy more (section 18). Box counts
without prices keep most of 18.3's protection: a rival learns how much the shop buys, never the Bluemins price. The
totals can also carry the loyalty progress later ("150 boxes more to reach …"; points themselves stay on invoice value,
section 18).

**How it will work (for the phase plan):**
- Worked out on the **server** when the app asks, never stored: the customer's bills that aren't cancelled (Zoho history
  up to 5 Nov 2026 + PlantOps bills) plus delivered orders without a bill, each box counted once. The customer API sends
  only the totals per period and size, never the lines they come from.
- Same counting as the owner's 8 Nov 2026 customer box list (plant 001: 664 customers, 31,584 boxes up to 7 Nov 2026).
- **To settle in the phase plan:** the Zoho-history items have no brand ("1L Water Bottle", "1 Litre Deionised Water"),
  so the owner confirms which old Zoho items are Bluemins bottles; and what makes someone a "Bluemins water-bottle
  customer" (recommended: has a delivered Bluemins bottle order or bill in the last 12 months).
- **No schema change needed** for the totals themselves (the customer API's own needs are listed in the phase plan).

## 19. WhatsApp login-code template (prepared 2026-11-08)

Drop's login (Phase 1): the customer types their phone number, PlantOps makes a 6-digit code (stored only as a hash,
single use, 10 minutes, rate-limited) and sends it with this template through the plant's existing Twilio WhatsApp
sender. **Own template, not Twilio Verify** (recommended): Verify adds about $0.05 per login on top of WhatsApp's fee;
PlantOps already does codes, hashes and limits for staff PINs.

| Field (Twilio Content Template Builder) | Value |
|---|---|
| Template name | `drop_login_code_v1` |
| Language | English |
| Content type | **Authentication** (WhatsApp category Authentication) |
| Body | Fixed by Meta: "{{1}} is your verification code." |
| Add security recommendation | **On** ("For your security, do not share this code.") |
| Code expiration | **10 minutes** (footer "This code expires in 10 minutes.") |
| Button | **Copy code**, text "Copy code" |

- Meta usually approves authentication templates within minutes to hours; no URLs, emojis or extra text are allowed.
- **One-tap autofill** (Android fills the code by itself) needs Drop's package name and the Play signing key's hash,
  known only after the Play account exists: then a `drop_login_code_v2` with a one-tap button.
- Cost per code: Meta's India authentication rate + Twilio's per-message fee (well under ₹1; check Twilio's pricing
  page). 90-day sessions keep the number of codes low (section 16.1 rule 3).
- **Config (Phase 1, ask before changing):** the SID goes into the plant's `TWILIO_WHATSAPP_SENDERS` entry as
  `login_content_sid`, given to the owner as the **complete** value with the existing `from`, `content_sid`,
  `reminder_content_sid` and `thanks_brands` (rule: `docs/STABILITY_PLAN.md` section 6 item 5).

## 20. Phase 0 decisions (owner, 2026-11-08)

1. **First version = the full first set:** current order (products and boxes, no rates or amounts), total due (one
   number), box totals (18.5), product information, quality certificates (unexpired, ticked in Document Store),
   support and feedback with replies (Complaint Box), announcements, marketing kit. Loyalty, rewards, shop profile and
   directory come later (18.2).
2. **Only shops the owner switches on can log in:** an owner-only "Can use Drop" switch on the customer's page in
   Sales, audited. Pilot with 10–20 shops, then everyone. A phone that isn't switched on gets "not available yet" and
   **no login code is sent** (no WhatsApp charge).
3. **Box totals for Bluemins water-bottle customers = a delivered Bluemins bottle order or bill in the last 12
   months**, worked out automatically; a shop that stops buying stops seeing them.
4. **Extra phones see exactly what the main phone sees** (total due included). Owner / Order desk add or remove them
   on the customer's page; a phone belongs to one shop only; "Make main phone" is owner-only and audited.

**Still open before the phase plan:**
- Which old Zoho items are Bluemins bottles (they have no brand). **Owner, 2026-11-08:** "1L Water Bottle" = Bluemins,
  "1 Litre Deionised Water" = Mr.Charge. Proposed rule for the rest: "… Water Bottle" = Bluemins, "Deionised" /
  "Distilled" = Mr.Charge, anything else (20 L, empties, connection charges) not counted; checked against the full list
  of Zoho item names when the phase plan is written, and any item that fits neither goes to the owner.
  **Exact list (live data read-only, 2026-11-08; boxes = billed quantity, cancelled bills left out):**
  - **Counted as Bluemins bottles:** Zoho "1L Water Bottle" (16,874), "500ml Water Bottle" (8,481), "250ml Water
    Bottle" (811); PlantOps products "Bluemins 1L Water Bottle" (1 L × 12), "Bluemins 500ml Water Bottle" (500 ml × 24),
    "Bluemins 250ml Water Bottle" (250 ml × 35).
  - **Mr.Charge, not counted:** Zoho "1 Litre / 2 Litre / 5 Litre Deionised Water", "5 Litre Deionised Water Pro",
    "1 Litre / 2 Litre Distilled Water"; PlantOps "Mr.Charge 1 / 2 / 5 Litre Deionised Water (Pro)".
  - **Not counted:** "Bluemins Water - 20 Litre" and "Blumeins 20L Connection" (20 L, decision 18.5), "2L PV Empty
    Bottle", the empty-bottle products.
  - **Asked the owner:** "Hemex 1L" (65 boxes, third brand) and Zoho "Bluemins Water" (pcs, 72, Oct–Dec 2025).
    **Hemex: separate brand, not counted (owner, 2026-11-08).** "Bluemins Water" (pcs): not counted, treated as the
    20 L jar unless the owner says otherwise.
  - **Owner confirmed the counted list (2026-11-08)** and that 6–7 Nov 2026 data is in PlantOps (bills from 6 Nov);
    Zoho covers up to 5 Nov. Each box is counted once: from its bill, or from the delivered order when it has no bill.
- Loyalty rules (18.2 point 2) and rewards (point 3): only when that later phase starts.
- Directory (point 4): later.
