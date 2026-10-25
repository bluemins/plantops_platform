# WhatsApp chat: a clearer conversation with customers — plan

**Status:** plan, written 2026-10-24. **Owner's decisions given 2026-10-25: 1a 2a 3a 4a 5 yes 6 me 7a** (all as
recommended; section 7). No code yet. TODO #1; to be live **before 2026-11-09**, when the first reorder reminders lead
customers into this chat.

**Two phases (owner, 2026-10-25):**
- **Phase 1 — English only.** The owner creates the **7 English templates** (T1, T2, T4–T8, `_en`) in Twilio now; the
  bot sends the whole chat in English (changes C2–C5; C1's language switch waits). Today's Odia order steps become
  English until Phase 2. T2 leaves out "Type ENGLISH or ଓଡ଼ିଆ…". T8 keeps the full `optin-v1` text (with "or reply 1
  for Yes, 2 for No"), so the consent wording stays `optin-v1`. `CONTENT_SIDS` holds the 7 English ids.
- **Phase 2 — Odia.** The owner writes the Odia (section 10), creates the 7 `_od` templates; the bot adds C1 (Odia
  first, English on request, decision 1a) and the Odia consent `optin-v1-od` (7a).

**Where:** the bot repo only (`~/projects/order_handoff`). Based on the bot's code (`src/app.js`, `texts.js`,
`messages.js`, `catalog.js`, `commands.js`) and the Sheet logs `Message_Logs` / `Sessions_Log` (13 Sep–24 Oct).

## 1. What does NOT change

The conversation changes; how orders are handled does not.

- **Order Capture:** no change. The bot keeps calling the same three things it uses today: the customer lookup, create
  order (same idempotency key, same YES rule), and the consent answer. No new endpoint, no schema, no new setting.
- **Orders:** still created only after an exact YES on the summary; the reference (O-00xx) only after Order Capture
  answers. Staff, the order list, notifications, CSV and the tile see bot orders exactly as today.
- **Reminders and consent:** Order Capture still sends the reminder; the bot still asks the reminder question once
  after an order, and STOP / START work as today. The pilot's groups and caps are untouched.
- **Delivery thank-you:** still sent only by Order Capture. The bot only *answers* when a customer taps its buttons.
- **Unknown numbers, Order Capture down, `BOT_ORDERS=off`:** still the Sheet `lead` path ("our team will call").
- **No AI.** Fixed menus, fixed words, fixed steps.
- **The bot never sends a message on its own.** Every change below is a reply to something the customer sent.

## 2. Today's chat (owner's phone, 24 Oct)

| # | Customer | Bot | Language |
|---|---|---|---|
| 1 | Order | "Your last order (24 Oct): 5 box Bluemins 1L … Reply REPEAT …, or tap a size below." + size buttons | English + Odia |
| 2 | taps 1L | "Bluemins 1L ବାଛ୍ ଲେ ଆପଣ .. କେତେଟା ବକ୍ସ୍ …" | Odia |
| 3 | 10 | "ଆଉ କିଛି ଲାଗବା …?" + buttons | Odia |
| 4 | taps "ଆଉ ନାଇଁ ଲାଗେ କିଛି" | "Where should we deliver? Type a landmark …, or SKIP." | English |
| 5 | Near shiva temple | "Please check your order: … Reply YES …, EDIT …, or CANCEL." | English |
| 6 | Yes | "Thank you. Your order O-0072 is placed …" + "Would you like … reminder …? Reply 1 / 2" | English |
| 7 | 1 | "Thank you. We will send you a reminder …" | English |

Six replies from "Order" to a placed order, seven with the reminder question; the language switches three times.
Even with REPEAT, a known customer needs four replies (Order → REPEAT → landmark → YES).

## 3. What goes wrong (logs + code)

| # | What happened | Cause in the code | Effect |
|---|---|---|---|
| P1 | **Lost order** (…155459, 20 Sep): 250 ml × 10, then typed "500ml", "Another size", "500 ml / 1 l" (one message), "1", "10", then stopped | At "anything more?" a typed size isn't understood (only *more* / *done*); two sizes in one message aren't understood; "1" was read as 1 L | The customer gave up with a full basket; nobody knew |
| P2 | **Got nowhere** (…018508, 9 Oct): "Hii", "Rate", "Hindi", "Massage Kari", "Majalgaon", "??" | No answer for a price question, a language request or a place; every message → "Say 'Hi' to start" | Two misses → "passed to our team" (Majalgaon is in Maharashtra: outside the area) |
| P3 | **Thank-you buttons ignored**: 5 customers tapped "Okay" / "Great" on the delivery thank-you | Those buttons aren't known to the bot → "Say 'Hi' to start placing an order." (logged *unrecognised*) | The happiest customers get a confusing answer; a second tap → "passed to our team" + a staff alert for nothing |
| P4 | "Repeat" right after an order; "Not great" outside the feedback questions | REPEAT only works inside the size picker; feedback buttons only inside feedback | *unrecognised* |
| P5 | **Mixed languages** in one order | Order steps' Odia texts (old `messages.js`, Twilio templates) + Step 1–4 texts in English only (`texts.js`) | An Odia-only customer is lost at the landmark and the summary |
| P6 | Chats that stop after "Hi" | The welcome (Twilio template `CONTENT_SID_INTRO`) | Unclear what to do next (mostly tests, but the same for real customers) |
| P7 | Small gaps | YES needs the exact word (not "ok", "haan"); greetings only *hi / hello / hey* (not "namaskar", "johar"); Odia digits (୧୦) not read as numbers | *unrecognised* → handoff |

## 4. The plan: five changes

### C1 — One language per chat
- Every text the bot sends lives in one place (`texts.js`), each in **Odia and English**.
- The chat runs in **one language from start to end**. Default: **Odia**. The customer switches with a word or button:
  *English* / *ଓଡ଼ିଆ*. The choice is kept for the phone number (Redis, 1 year; no Order Capture change).
- **The Odia wording comes from the owner (or staff)**, in the plant's own Sambalpuri Odia, like today's order
  messages. I draft the English and the list of lines; I don't invent Odia text.
- The reminder message itself (Order Capture's Twilio template) stays as approved.

### C2 — Fewer steps for a known customer
- **"Order" from a customer with a last order** → one message: *"Same as last time? 5 box 1L, near Shiva temple"* with
  buttons **Same again** / **Change**. *Same again* goes straight to the summary → YES. **3 replies** instead of 6
  (Order → Same again → YES).
- **Landmark remembered:** the last landmark a customer typed is kept by the bot (Redis, per phone, 180 days) and
  offered next time: *"Deliver near Shiva temple again?"* **Yes** / type a new one. It still goes to Order Capture in the
  order note, as today. (The customer can always type a new one.)
- The reminder's **"Order again"** button uses the same short path.
- New sizes / changes keep today's steps (size → quantity → anything more?).

### C3 — Understand more of what people type
- **At "anything more?":** a typed size starts that size ("500ml" → quantity for 500 ml). Fixes P1.
- **Size + quantity in one message:** "500ml 10", "10 box 1L", and several lines ("500 ml 10 / 1 l 5") → all added,
  then "anything more?". Anything unclear → ask only for the unclear part.
- **Numbers:** "10", "10 box", "10 boxes", Odia digits ୧୦.
- **YES:** *yes, ok, okay, haan, ha, ହଁ, ହ, confirm*. (Order Capture still gets the same create call; only the words the
  bot accepts grow. "ok" was a Step 3 leftover.)
- **Greetings:** *hi, hello, hey, namaskar, namaste, johar, ଜୁହାର, ନମସ୍କାର*.
- Unknown size: the size buttons again, not an error.

### C4 — Never a dead end
| Customer sends | Today | Planned reply |
|---|---|---|
| Taps **Okay / Great / Not great** on the thank-you | "Say 'Hi' to start…" → second time a staff alert | Saved as that delivery's rating (Feedback tab, like the feedback questions; the buttons already send the same ids `okay` / `great` / `not_great`), then "Thank you! Send ORDER whenever you need water again." *Not great* → the existing "Not great" staff alert |
| "Repeat" / "order" right after placing | *unrecognised* | "Your order O-00xx is placed. Send ORDER for another one." |
| **Rate / price / ଦାମ / dam** | *unrecognised* | "Prices depend on the order: our team will call you with today's price. Send ORDER to place one, or PERSON to talk to us." (no prices in the bot, as decided) |
| **Hindi / English / ଓଡ଼ିଆ** | *unrecognised* | Switches the language (Hindi: see decision 2) |
| Anything else, first time | "Say 'Hi' to start…" | The welcome menu (C5) |
| Anything else, second time | handoff + alert | handoff + alert (as today, so a real question still reaches staff) |

### C5 — A clear welcome
"Hi" (or anything unclear when no chat is open) → one short message with **numbered choices and buttons**:
1 **Order water** · 2 **Same as last time** (only if there is a last order) · 3 **Talk to us** · 4 **Feedback**.
Typing the number works too. The welcome and the size / "anything more?" buttons are **Twilio Content templates**:
changing them is a Twilio setting (decision 5). Replies inside a chat don't need Meta approval.

## 5. Not in this plan
- AI, free conversation, prices in the bot.
- New customers ordering into Order Capture (area list): waits until the bot takes new customers (build plan).
- Marketing or festival messages (need consent + approved templates; only the reminder pilot sends first).
- Any Order Capture or PlantOps change.

## 6. How we build and check it
1. **Decisions + Odia text** (owner, section 7): by ~28 Oct.
2. **Build** in the bot repo with tests for every line in sections 3–4 (the 20 Sep lost order and the 9 Oct chat are
   replayed as tests). Release 3.5.0 on `main`; nothing goes live by pushing `main`.
3. **Live** when the owner says so (~1 Nov): `production` push, then the owner's phone test: Hi, Order, Same again,
   a typed "500ml 10", thank-you button, Rate, English / ଓଡ଼ିଆ, YES as "ok". Undo = the previous commit.
4. **Measure** from `Sessions_Log` (2 weeks before vs after): chats from "Order" to a placed order, *unrecognised* per
   week, handoffs, replies per order. Group counts only.

## 7. Decisions for the owner (my recommendation first)

**Decided by the owner 2026-10-25: 1a, 2a, 3a, 4a, 5 yes, 6 the owner writes the Odia, 7a.**
1. **Language:** (a) **Odia first, English on request** *(recommended: most customers are local)* · (b) English first ·
   (c) ask at the start (one more step).
2. **Hindi:** (a) **not now** *(recommended: one Hindi request so far, from outside the area; add when needed)* ·
   (b) add Hindi now (needs Hindi text too).
3. **Remember the last landmark** (bot Redis, 180 days): (a) **yes, offer it next time** *(recommended: saves a step
   every order)* · (b) ask every time.
4. **Price question:** (a) **"our team will call with today's price"** *(recommended: no Order Capture change, prices
   stay with staff)* · (b) show the default rate (would need an Order Capture change: not in this plan).
5. **Twilio templates** (welcome, size picker, "anything more?"): may I change them in Twilio when we go live?
   *(recommended: yes; I prepare the new text and steps, you click save in Twilio, the old ones stay as backup)*
6. **Odia text:** who writes it? *(recommended: you or a staff member who writes to customers today; I send the list of
   lines in English with today's Odia next to each, ~25 short lines)*

---

## 8. The conversation, message by message

`[buttons]` = tap buttons (a Twilio template, section 9); everything else is plain text. Each line exists in Odia and
English (C1); English shown here. **T-codes** are the Twilio templates of section 9; **M-codes** are plain texts the
bot sends itself (no Twilio work, only the Odia wording, section 10).

### A. Known customer, same as last time (the common case — 3 replies)
| Who | Message |
|---|---|
| Customer | Hi *(or Order, Johar, Namaskar…)* |
| Bot **T1** | "Johar Rocky! What would you like?" `[Same as last time] [New order] [Talk to us]` |
| Customer | taps **Same as last time** |
| Bot **M1** | the summary: "Please check your order: Rocky, Bijepur · Bluemins 1L (1 L × 12): 5 box · Deliver near: Shiva temple · Our team will call you about the price." |
| Bot **T7** | "Place this order?" `[YES] [EDIT] [CANCEL]` |
| Customer | taps **YES** *(or types yes / ok / haan / ହଁ)* |
| Bot **M2** | "Thank you. Your order O-0073 is placed. Our team will call you about the price and delivery." |
| Bot **T8** | *(only the first time, as today)* "Would you like a WhatsApp reminder when it may be time to order again? You can send STOP at any time." `[Yes, remind me] [No thanks]` |
| Customer | taps one → **M3** "Thank you. We will remind you…" / **M4** "Okay, no reminders. Thank you." |

*No landmark question:* the last landmark is reused and shown on the summary (decision 3). EDIT → path B.

### B. Known customer, new basket (or EDIT)
| Who | Message |
|---|---|
| Customer | taps **New order** (or EDIT, or the reminder's "Change order") |
| Bot **T4** | "Which size?" `[1L box (12)] [500ml box (24)] [250ml box (35)]` |
| Customer | taps **500ml** *(or types "500ml", "2", or "500ml 10" = size + quantity at once, C3)* |
| Bot **M5** | "How many boxes of 500 ml? (1, 2, 5 …)" |
| Customer | 10 *(or "10 box", ୧୦)* |
| Bot **T5** | "Added 10 box 500 ml. Anything more?" `[Add another size] [That's all]` |
| Customer | taps **That's all** *(typing "1L 5" here adds 1 L × 5 instead, C3)* |
| Bot **T6** | "Deliver near Shiva temple again? Or type a new landmark." `[Yes, same place] [Skip]` *(no last landmark: **M6** "Where should we deliver? Type a landmark, or SKIP.")* |
| Customer | taps **Yes, same place** or types a new landmark |
| Bot | **M1** summary + **T7** `[YES] [EDIT] [CANCEL]` → as in A |

### C. Number not in Order Capture (new customer) or ordering switched off
| Who | Message |
|---|---|
| Customer | Hi |
| Bot **T2** | "Johar! Bluemins packaged drinking water. What would you like?" `[Order water] [Talk to us] [Feedback]` |
| Customer | **Order water** → sizes and quantities as in B (T4 → M5 → T5) |
| Bot **M7** | "What name should we write for this order?" → **M8** "Where should we deliver? Village / landmark." |
| Bot **M9** | summary + "Reply YES …" → YES → **M10** "Thank you. We have noted your order. Our team will call you to confirm it." *(Sheet `lead`, unchanged)* |

### D. Delivery thank-you buttons (sent by Order Capture, unchanged)
| Customer taps | Bot |
|---|---|
| **Great** / **Okay** | **M11** "Thank you! Send ORDER whenever you need water again." (rating saved) |
| **Not great** | **M12** "Sorry about that. Our team will call you." (rating saved + staff alert, as the feedback flow does) |

### E. Reorder reminder buttons (Order Capture's reminder, unchanged)
| Customer taps | Bot |
|---|---|
| **Order again** (`reorder_repeat`) | summary of the last order + T7 (path A) |
| **Change order** (`reorder_edit`) | T4 sizes (path B) |
| **Stop reminders** (`optout_stop`) | **M13** today's "You will not get reminder messages…" |

### F. Questions and other messages
| Customer sends | Bot |
|---|---|
| Rate / price / ଦାମ / dam | **M14** "Prices depend on the order: our team will call you with today's price. Send ORDER to place one, or PERSON to talk to us." |
| English / ଓଡ଼ିଆ / Odia | **M15** "Okay, English from now on." / the Odia line, then the welcome (T1 / T2) in that language |
| Hindi | **M16** (decision 2 a) "Sorry, we can chat in Odia or English. Our team will call you if you need Hindi." + staff alert |
| Repeat / Order right after placing | **M17** "Your order O-0073 is placed. Send ORDER for another one." |
| Anything not understood | 1st time: the welcome (T1 / T2) · 2nd time: **M18** today's "We have passed your message to our team…" + staff alert |
| HELP · MENU · CANCEL · PERSON · STOP · START · FEEDBACK | as today (M19–M24, today's texts in both languages) |

## 9. What to create in Twilio (guide)

**Where:** Twilio Console → **Messaging → Content Template Builder → Create new**. All of these are *in-chat* messages
(the bot only sends them as a reply within 24 hours of the customer's message), so they **don't need WhatsApp / Meta
approval**: create, **Save**, and **don't** press "Submit for WhatsApp approval". Each saved template gets an id
starting with **HX…**: copy it into the list at the end.

**Rules for every template:**
- **Content type: Quick reply.** WhatsApp allows **at most 3 buttons** in a chat message, and **20 characters** per
  button title (Odia letters count too: keep titles short).
- Each button has a **title** (what the customer sees) and an **ID** (what the bot receives). **Type the IDs exactly as
  below** (small letters, underscores). Same IDs in the Odia and the English template.
- `{{1}}`, `{{2}}` are filled in by the bot. Twilio asks for a **sample value** for each: use the samples below.
  A filled-in value is always one line (no line breaks), so the summary stays a plain text message (M1).
- **Language field:** pick **English** for both versions if Odia isn't in Twilio's list (for in-chat messages it is only
  a label; what the customer sees is the text you type).
- **Names:** `bm_<what>_od` and `bm_<what>_en`, e.g. `bm_welcome_known_od`.
- **Don't delete or edit the six templates in use today** (welcome, size picker, anything more, estimator, two feedback):
  they are the way back if we have to undo. They can be deleted a month after go-live.

| Code | Template name (×2: `_od`, `_en`) | Body (English; Odia in section 10) | Buttons: title → **ID** | Variables (sample) |
|---|---|---|---|---|
| **T1** | `bm_welcome_known` | Johar {{1}}! What would you like? | Same as last time → **menu_same** · New order → **menu_order** · Talk to us → **menu_person** | {{1}} name (Rocky) |
| **T2** | `bm_welcome_new` | Johar! Bluemins packaged drinking water. What would you like? Type ENGLISH or ଓଡ଼ିଆ to change the language. | Order water → **menu_order** · Talk to us → **menu_person** · Feedback → **menu_feedback** | — |
| **T4** | `bm_sizes` | Which size? | 1L box (12) → **PV_BM_1** · 500ml box (24) → **PV_BM_500** · 250ml box (35) → **PV_BM_250** | — |
| **T5** | `bm_more` | Added {{1}}. Anything more? | Add another size → **add_more** · That's all → **order_done** | {{1}} what was added (10 box 500 ml) |
| **T6** | `bm_landmark_again` | Deliver near {{1}} again? Or type a new landmark. | Yes, same place → **landmark_same** · Skip → **landmark_skip** | {{1}} last landmark (Shiva temple) |
| **T7** | `bm_confirm` | Place this order? | YES → **confirm_yes** · EDIT → **confirm_edit** · CANCEL → **confirm_cancel** | — |
| **T8** | `bm_optin` | Would you like a WhatsApp reminder when it may be time to order again? You can send STOP at any time. | Yes, remind me → **optin_yes** · No thanks → **optin_no** | — |

*T3 (the old "repeat offer" text) is no longer needed: "Same as last time" on T1 replaces it.*

**Total: 7 templates × 2 languages = 14.** The size buttons keep today's IDs (`PV_BM_1` …) and "anything more?" keeps
`add_more` / `order_done`, so the bot reads old and new templates the same way.

**T8 is the consent question.** Its English text is today's approved wording *(optin-v1)*, only with buttons added.
The Odia version is a new wording and is saved with each answer as **optin-v1-od** (consent records keep the wording
shown). This is a consent change: **your OK is needed** (decision 7).

**Nothing changes in Twilio for:** the delivery thank-you and the reorder reminder (Order Capture's approved
templates), the WhatsApp number, the webhook address, or the estimator / feedback templates.

**When done, send me the 14 HX ids** in this form (or a screenshot of the list). At go-live they go into **one** Railway
variable on `whatsappbot`, `CONTENT_SIDS` (I prepare the exact value, you paste it):

```
T1 od HX…   T1 en HX…
T2 od HX…   T2 en HX…
T4 od HX…   T4 en HX…
T5 od HX…   T5 en HX…
T6 od HX…   T6 en HX…
T7 od HX…   T7 en HX…
T8 od HX…   T8 en HX…
```

## 10. Odia wording to write (owner / staff)

One column to fill: the Odia for every line. Today's Odia is kept where it exists; change it if you like.
Button titles: at most 20 characters.

| Code | English | Odia (today's, or *to write*) |
|---|---|---|
| T1 body | Johar {{1}}! What would you like? | *to write* |
| T1 buttons | Same as last time · New order · Talk to us | *to write* |
| T2 body | Johar! Bluemins packaged drinking water. What would you like? Type ENGLISH or ଓଡ଼ିଆ to change the language. | today's welcome: "ଅଜ୍ଞ୍ୟା ଜୁହାର... ଆପଣକୁ କେନ ଟା ଦରକାର ଅଛେ ଯେ ବାଛି ଦଉନ…" (adapt) |
| T2 buttons | Order water · Talk to us · Feedback | *to write* |
| T4 body / buttons | Which size? · 1L box (12) · 500ml box (24) · 250ml box (35) | today: "1L - ବକ୍ସ୍ (12) ଟା" · "500ml ବକ୍ସ୍ ( 24 ଟା)" · *250 ml to write* |
| M5 | How many boxes of {size}? (1, 2, 5 …) | today: "{size} ବାଛ୍ ଲେ ଆପଣ .. କେତେଟା ବକ୍ସ୍ ଦରକାର ଯେ ଲେଖି ଦଉନ \| ( 1 / 2 କି 5 ...)" |
| T5 body / buttons | Added {{1}}. Anything more? · Add another size · That's all | today: "ଆଉ କିଛି ଲାଗବା ଭାଏଲ.....? କି ଅପଣଂକର ସବୁ ହେଇଗଲା!" · *add another: to write* · "ଆଉ ନାଇଁ ଲାଗେ କିଛି" (17 letters: fits) |
| T6 body / buttons | Deliver near {{1}} again? Or type a new landmark. · Yes, same place · Skip | *to write* |
| M6 | Where should we deliver? Type a landmark (for example: near the Shiv temple), or SKIP. | *to write* |
| M1 | Please check your order: … Our team will call you about the price. | today's new-customer confirm is close: "{name} ଆଜ୍ଞ୍ୟା , ଅପଣଂକର ଅଡର …" (adapt; no "YES" line, the buttons follow) |
| T7 body / buttons | Place this order? · YES · EDIT · CANCEL | *to write* (button IDs stay English; titles may be Odia, e.g. ହଁ) |
| M2 | Thank you. Your order {ref} is placed. Our team will call you about the price and delivery. | *to write* |
| T8 body / buttons | (consent question above) · Yes, remind me · No thanks | *to write* (decision 7) |
| M3 / M4 | Thank you. We will remind you… · Okay, no reminders. Thank you. | *to write* |
| M7 / M8 | What name should we write for this order? · Where should we deliver? Village / landmark. | today: "ଆମକୁ ଲାଗୁଛେ ଯେ ଇଟା ଅପଣଂକର ପହେଲା ଅଡର ଆଏ…" · "ଧନ୍ୟବାଦ ଆଜ୍ଞ୍ୟା ! କେନ ଜାଗା କେ ସମାନ୍ ଯିବା…" |
| M10 | Thank you. We have noted your order. Our team will call you to confirm it. | *to write* |
| M11 / M12 | Thank you! Send ORDER whenever you need water again. · Sorry about that. Our team will call you. | *to write* |
| M14 | Prices depend on the order: our team will call you with today's price. Send ORDER to place one, or PERSON to talk to us. | *to write* |
| M15 / M16 / M17 | language switched · Hindi reply · order already placed | *to write* |
| M13, M18–M24 | today's STOP / handoff / HELP / MENU / CANCEL / PERSON / START texts (`texts.js`) | *to write* (11 short lines; I send them as a list) |

## 11. Order of work
1. Owner: decisions 1–7 (section 7, plus 7 below) — **by 27 Oct**.
2. Owner / staff: Odia column of section 10 — **by 28 Oct** (a photo of handwritten text is fine).
3. Owner: create the 14 templates in Twilio (section 9, about 45 minutes) and send me the HX ids — **by 29 Oct**.
4. Claude: build + tests in the bot repo (3.5.0 on `main`) — **29–31 Oct**.
5. Owner: "go live" → `CONTENT_SIDS` on Railway, Deploy, phone test (section 6) — **~1 Nov**, a week before the first
   reminders.

**Decision 7 (consent wording in Odia):** (a) **yes: the Odia consent question is used for Odia chats and saved as
optin-v1-od** *(recommended: a customer must understand what they agree to)* · (b) keep the consent question in English
only.

## 12. Phase 1 build plan: English chat (bot 3.5.0) — live 2026-10-25 (bot `production` = `a1c83f3`, `CONTENT_SIDS` set)

**Built** (owner "build" 2026-10-25; bot `a1c83f3`, tag 3.5.0 on `main`, 98 tests): as below, with two details
settled while building: **"Order"** typed by a customer with a last delivered order gets the T1 menu (so "Same as last
time" stays one tap), others go straight to T4; Odia / ଓଡ଼ିଆ gets the "English for now" reply + staff alert (owner,
2026-10-25). `package.json` keeps its old number (releases are git tags, as before).

Written 2026-10-25 after reading the bot's code (`src/app.js`, `catalog.js`, `commands.js`, `texts.js`, `store.js`,
`feedback-flow.js`). Bot repo only; Order Capture, PlantOps, the Sheet layout and the six templates in use today are
unchanged.

**Templates created by the owner (2026-10-25, English, Quick reply, not submitted to Meta):**

| Code | Name | Content SID |
|---|---|---|
| T1 | `bm_welcome_known_en` | `HX455339758bc15ef489c9d2d619d290d1` |
| T2 | `bm_welcome_new_en` | `HXec5df135cedd6fdc868567bff4373538` |
| T4 | `bm_sizes_en` | `HX77c43694b130a23ab5982ea22d9b2bfa` |
| T5 | `bm_more_en` | `HX498440b37adcd717a7457fffa3aeba2a` |
| T6 | `bm_landmark_again_en` | `HXcfd1a2b8a4b7d445f950bd26e4ab8cb3` |
| T7 | `bm_confirm_en` | `HXa1174f9a31c1615a9302b7569d4869be` |
| T8 | `bm_optin_en` | `HX262d12d0a62669a2ca9f9aa2495faba1` |

**One new Railway variable on `whatsappbot`** (the complete value; pasted only at go-live):
```
CONTENT_SIDS=T1=HX455339758bc15ef489c9d2d619d290d1,T2=HXec5df135cedd6fdc868567bff4373538,T4=HX77c43694b130a23ab5982ea22d9b2bfa,T5=HX498440b37adcd717a7457fffa3aeba2a,T6=HXcfd1a2b8a4b7d445f950bd26e4ab8cb3,T7=HXa1174f9a31c1615a9302b7569d4869be,T8=HX262d12d0a62669a2ca9f9aa2495faba1
```
- **Not set** → today's chat exactly (old templates, Odia order steps). This is also the undo: delete the variable,
  Deploy.
- **Set but broken** (a code missing, not `HX` + 32 hex) → loud error line at startup ("CONTENT_SIDS: T5 missing — new
  chat OFF") and today's chat. Never half the new chat.
- The startup line says which chat runs: `Chat: new (English, 7 templates)` / `Chat: old`.
- Templates with `{{1}}` are sent with `contentVariables`; values are made one line, ≤ 200 characters (WhatsApp
  refuses line breaks in variables). No name → T2 instead of T1.

**Changes, by file:**
1. `src/config-sids.js` (new, small): reads and checks `CONTENT_SIDS`.
2. `src/texts.js`: every English line of section 8 (M1–M17) in one place; the old English lines kept. `messages.js`
   (Odia) stays for Phase 2 and for the old chat.
3. `src/catalog.js`: `parseOrderText()` for C3: size + quantity in one message, several lines ("500ml 10 / 1l 5",
   "10 box 1L", "2 500ml"), split on new line, "/", ",", "+", "&", "and"; quantities "10", "10 box(es)", Odia digits
   ୧୦; a size alone = ask how many (M5); any part not understood = the parts understood are added and the bot asks
   about the rest. Greeting words (hi, hii, hello, hey, namaskar, namaste, johar, ଜୁହାର, ନମସ୍କାର), YES words (yes, ok,
   okay, haan, ha, confirm, ହଁ, ହ; T7's YES button), price words (rate, price, cost, dam, daam, ଦାମ), Hindi words.
4. `src/store.js`: last landmark per phone, `landmark:<phone>`, 180 days (decision 3a), written only when an Order
   Capture order is placed with a landmark.
5. `src/app.js`:
   - **Hi / MENU / anything unclear with no chat open** → Order Capture context; a customer with a last delivered
     order and a name → **T1**, everyone else → **T2**. Buttons `menu_same`, `menu_order`, `menu_person`,
     `menu_feedback` work even after the 30-minute session has expired.
   - **Same as last time** (and the reminder's "Order again") → last basket → **M1 summary + T7**; the remembered
     landmark is on the summary; no landmark yet → M6 first.
   - **New order / EDIT / "Order"** → **T4** → M5 → **T5** ("Added …") → remembered landmark **T6** (or M6) → M1 + T7.
   - **T7:** YES → Order Capture order (same idempotency key and lock as today; the word sent is the button / word);
     EDIT → T4; CANCEL → cancelled.
   - **After the order:** M2, then **T8** (first time only, unchanged rules; consent wording stays `optin-v1`).
   - **Text + template in a row** are sent one after the other through Twilio (as the repeat offer + picker today),
     so they arrive in order.
   - **Thank-you buttons** (`great` / `okay` / `not_great`, no feedback chat open) → a Feedback row
     `DELIVERY_BUTTON` with the rating, M11 / M12; Not great also alerts staff (as the feedback flow).
   - **Rate / price** → M14. **Hindi** → M16 + staff alert. **Odia / ଓଡ଼ିଆ** in Phase 1 → "We can chat in English for
     now; our team will call you if you'd like Odia." + staff alert (Phase 2 switches the language instead).
     **"Repeat" just after an order** → M17. "Order" just after an order starts a new one (the summary already says
     "You already have an order waiting").
   - **Not understood:** first time (no chat open) → the welcome (T1 / T2) instead of "Say 'Hi'…"; second time →
     handoff + alert, as today. Inside a step → that step's "please tap a button" line, as today.
   - Unknown numbers and `BOT_ORDERS=off`: same steps in English (M7, M8, M9 summary "Reply YES", M10); still a Sheet
     `lead`.
6. `src/server.js`: B-18, the Redis error line prints the error code.
7. `.env.example`, README, CLAUDE.md: `CONTENT_SIDS`; `package.json` version 3.5.0.

**Tests** (fake Twilio records `contentSid` + `contentVariables`): the 20 Sep lost order replayed ("500ml", "500 ml /
1 l", "1", "10" → an order); the 9 Oct chat ("Rate", "Hindi", "Majalgaon", "??" → M14, M16 + alert, welcome, handoff);
thank-you buttons (Okay, Great, Not great); "Repeat" after an order; "ok" as YES; Same as last time in 3 replies;
remembered landmark (T6, typed new one, Skip); EDIT; T8 + 1 / 2 still work; Odia digits; a part not understood;
201 boxes; `CONTENT_SIDS` missing / broken → today's chat unchanged (every old test passes untouched); variables one
line.

**To check at go-live (owner's phone):** the thank-you buttons really send `great` / `okay` / `not_great` (Message_Logs
"button" column); T1 shows the name; T5 / T6 show the filled-in text.

**Go-live** (owner's word, as every release): push `main:production`, add `CONTENT_SIDS`, **Deploy** (never Restart),
read the startup line, phone test (section 6): Hi → Same as last time → YES; New order with "500ml 10"; a thank-you
button; Rate; "ok" as YES. Undo: delete `CONTENT_SIDS` and Deploy (or push the previous commit).
