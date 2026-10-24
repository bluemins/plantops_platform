# WhatsApp chat: a clearer conversation with customers — plan

**Status:** plan, written 2026-10-24 for the owner's decisions (section 7). No code yet. TODO #1; to be live **before
2026-11-09**, when the first reorder reminders lead customers into this chat.

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
| Taps **Okay / Great** on the thank-you | "Say 'Hi' to start…" → second time a staff alert | "Thank you! Send ORDER whenever you need water again." No alert |
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
