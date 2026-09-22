---
name: jinko-travel
description: "Search, price, book and service travel through Jinko's Builder MCP: flights (find_destination, flight_calendar, find_dates, lowest_fare, price_monitoring, flight_search), hotels (hotel_search, hotel_details), trains/buses/ferries (find_ground), car rental (car_search), the booking flow (trip → checkout → submit_agent_payment → get_trip / get_booking) and post-booking servicing (flight_refund, flight_exchange, hotel_cancel, ground_cancel, ground_exchange, car_cancel, car_exchange). Use whenever a user wants to find, compare, monitor, book, pay for, refund, exchange or cancel flights, hotels, ground transport or rental cars with the Jinko MCP tools: it says which tool to call first, how to go from cached discovery to live pricing, how to build a trip and check out, and the rules that must never be broken (real traveler data only, preview before commit, no retry loops)."
compatibility: "Requires the Jinko Builder / DevPlatform MCP server connected as a tool source (streamable HTTP; Authorization: Bearer with a jnk_* API key or an OAuth JWT)."
metadata:
  author: jinkoso
  version: "0.1.0"
  surface: builder-mcp
  vellum:
    category: "travel"
    display-name: "Jinko Travel"
    emoji: "✈️"
    activation-hints:
      - "book a flight"
      - "find a hotel"
      - "search flights"
      - "plan a trip"
      - "cancel my booking"
      - "refund my flight"
      - "change my flight"
---

# Jinko Travel (Builder MCP)

Jinko Travel API — flight and hotel search, pricing and booking, plus ground transport (rail / coach /
ferry) and car rental, exposed as MCP tools. Authenticate with an `Authorization: Bearer <token>`
header (OAuth JWT or a `jnk_*` API key). Do NOT use an `X-API-Key` header.

Tool descriptions remain the reference for parameters and response shapes. This skill carries the
way-of-use: which tool first, how the steps chain, and the rules that always apply. Details per domain
are in the three references linked at the end.

## Tool map

Flights — cached discovery (1 credit per call) and live search (10 credits per call):

- `find_destination` — discover destinations reachable from your departure airports, globally or filtered to regions, sorted by cheapest available flight.
- `flight_calendar` — flights between a known origin and destination using cached pricing; loose / flexible dates (single dates, date arrays, ranges, stay days).
- `find_dates` — same inputs as `flight_calendar`, but returns up to ten cheapest itineraries, one per (departure, return) date pair, spread across the window.
- `lowest_fare` — same inputs as `flight_calendar`, but for one FIXED departure date (one-way, or with a return date): up to ten itineraries, cheapest first.
- `price_monitoring` — cache-only price snapshot for a fixed route + dates; for scheduled polling, NOT one-shot shopping or booking.
- `flight_search` — live flight pricing and fare options: `search` (route + exact dates) or `price_check` (an `offer_token` from a discovery tool). Returns the `trip_item_token` per fare.

Hotels:

- `hotel_search` — live hotel inventory and rates; Mode A (the user named a hotel) or Mode B (the user is exploring a destination). Returns `htl_*` offer tokens (10 credits per call).
- `hotel_details` — rich metadata (gallery, facilities, policies, per-room details) for one hotel after `hotel_search`; read-only.

Trip, checkout, payment, inspection:

- `trip` — create and manage a trip: `add_item`, `remove_item`, `upsert_travelers`, `select_ancillaries`. Flights, hotels, ground and cars share one cart.
- `checkout` — finalize a trip: returns the `checkout_url` a human opens to pay plus `agent_spt_params` for programmatic agent payment.
- `submit_agent_payment` — submit a Shared Payment Token (SPT) to authorize the booking server-side; the agent-pay alternative to the checkout page.
- `get_trip` — full lifecycle state of a trip: cart, travelers, quote, fulfillment, `booking_ref`. Read-only.
- `get_booking` — retrieve a booking by Jinko `booking_ref` + traveler last name. No login required.

Post-booking (no login required — `booking_ref` + `last_name`):

- `flight_refund` — cancel a booked flight: refund the tickets, or void them inside the airline's void window. Preview first.
- `flight_exchange` — exchange a booked flight for a different itinerary: shop → price → commit → status.
- `hotel_cancel` — cancel a hotel booking. Preview first.

Ground transport (Distribusion) — optional tool group, not registered on every deployment:

- `find_ground` — bus/coach, rail or ferry connections between two cities or stations on a date. Each connection carries a `trip_item_token`.
- `ground_cancel` — cancel a ground booking: preview → commit → status.
- `ground_exchange` — exchange a ground booking for a new date and/or stations: preview → commit → status.

Car rental (Auto Europe) — optional tool group, not registered on every deployment:

- `car_search` — live car rental offers; each `offer_id` IS the trip item token (there is no car-specific booking tool).
- `car_cancel` — cancel a rental and refund less the fee: preview → commit → status.
- `car_exchange` — change a rental in place (dates, vehicle, extras). This is the tool for "modify", "change my dates", "amend", "upgrade": preview → commit → status.

## Which tool first

Pick by what the user already knows. This is the only place the routing is stated.

Flights:

1. No destination yet — "Where should I go from Paris?", "Beach destinations from London", "Cheap flights from SF" → `find_destination` (inspiration from an origin).
2. Origin + destination, flexible or loose dates — "Paris to Barcelona for a weekend in April", "Find flights from JFK to CDG next month" → `flight_calendar` (cached, the full price-per-date list). Also the right tool for "cheapest flight", "best flight", "find me a flight", "cheapest date" phrasings.
3. Origin + destination, flexible dates, but the user wants a short, spread-out shortlist of the best date options — "When is the cheapest time to fly Paris → New York in June?", "Best weekends to go from London to Lisbon next month" → `find_dates` (cached).
4. Origin + destination + ONE exact date, cheapest options that day — "Cheapest flight Paris → New York on June 15" → `lowest_fare` (cached).
5. Track the price of a specific route + exact dates over time (cron / scheduled job / price-drop alert) → `price_monitoring` (cached, cache-only, poll-friendly — never triggers a live call). It returns the single cheapest cached itinerary, or `status: "stale"` when the cache is cold; do NOT silently fall back to `flight_search` — that is a different intent.
6. Origin + destination + EXACT departure date (plus the return date when it is a round trip), ready to see bookable fares — "Paris → NYC, June 17 → June 26", "Toronto → Cape Town on January 25" → `flight_search` with `search` (live pricing; each call has a cost). A departure date with no return date is a one-way search — run it, do not ask.
7. Holding an `offer_token` from any discovery tool → `flight_search` with `price_check` (live re-price → `trip_item_token`).

Hotels: exploring a destination → `hotel_search` Mode B; the user named a specific hotel → `hotel_search` Mode A; the user wants a closer look at one result → `hotel_details`.

Ground and cars: train, bus/coach or ferry between two places → `find_ground`; rent / hire a car between two date-times → `car_search`.

Existing booking: inspect → `get_booking` (`booking_ref` + `last_name`) or `get_trip` (`trip_id`). Cancel a flight → `flight_refund`; change a flight → `flight_exchange`; cancel a hotel → `hotel_cancel`; ground → `ground_cancel` / `ground_exchange`; end a rental → `car_cancel`; change a rental → `car_exchange`.

## End-to-end booking flow

Each step depends on the previous one — do not skip steps.

1. Get flights, either via discovery (`find_destination` / `flight_calendar` / `find_dates` / `lowest_fare` → `offer_token` → `flight_search` with `price_check`) or via direct search (`flight_search` with `search`, when the user has route + exact dates). For hotels: `hotel_search` (then `hotel_details` if the user wants a closer look).
2. `flight_search` returns flights with fare options and a `trip_item_token` per fare; `hotel_search` returns rates with an `htl_*` `offer_id`. If `flight_search` status is `"flight_unavailable"`: show the alternatives and let the user choose.
3. `trip` with `add_item` and the token of the fare / rate the user chose → creates the trip, returns `trip_id`. Flights and hotels (and ground / cars) can be added to the same trip: one cart, one Stripe checkout.
4. `trip` with `upsert_travelers` (`trip_id`) → set real passenger info and contact (MUST be provided by the user).
5. Optional: `trip` with `select_ancillaries` → bags, seats, meals (check `available_ancillaries` in the trip response; flights only).
6. `checkout(trip_id)` → one synchronous call: the quote is scheduled and polled until ready, fulfillment is scheduled, and a Stripe `checkout_url` PLUS `agent_spt_params` come back.
7. Pay — human path: the user completes payment in the browser at `checkout_url`; Stripe webhooks finalize the booking, no client-side confirm step. Agent path: mint a Shared Payment Token scoped to `agent_spt_params`, then `submit_agent_payment(trip_id, shared_payment_token)`; on success it returns `booking_ref` (JNK-XXXXXX) — keep it. A 3DS step-up or decline falls back to `checkout_url`.
8. Any time after step 3: `get_trip(trip_id)` → cart, quote, fulfillment and booking state. It carries `booking_ref` as soon as fulfillment is scheduled — possibly before payment completes — so read `fulfillment.status` instead of treating its presence as paid.

Full detail for each step: [references/booking.md](references/booking.md).

## Rules that always apply

- Cached prices are indicative. `flight_calendar`, `find_dates`, `lowest_fare` and `price_monitoring` return cached fares whose price accuracy is roughly 80% even at the highest-confidence cache age. Use them to identify good candidate dates and routes, then ALWAYS re-run live shopping — `flight_search` with `price_check` and the `offer_token`, or `flight_search` with `search` on the exact dates — to confirm the price before presenting a fare as bookable or adding it to a trip.
- Never fabricate traveler data. Always ask the user for real passenger details; never use placeholder or default values.
- If `flight_search` returns status `"flight_unavailable"`, do NOT proceed to booking.
- Refunds, exchanges and cancellations: always preview (or shop and price) before committing, show the customer the amount, and get explicit user confirmation. `fee_known: false` means the fee is UNKNOWN — never present it as free.
- Do not retry in loops on errors. Rate limit: 1000 requests / 30 days per API key. `status: "stale"` from `price_monitoring` is a correct answer, not a reason to loop.
- If a search fails, surface the error — never retry with a changed passenger list (e.g. dropping an infant); that silently changes the user's request.
- Sessions expire after inactivity. If you receive a 404, re-initialize.
- Money: search, calendar, monitoring, trip, checkout and `get_trip` results carry a `display` string beside each price (`display` inside a money object, `<field>_display` beside a bare number, e.g. `min_price_display`, `price_display`, `total_amount_display`): the ISO currency code and the amount at the currency's decimals, e.g. `"EUR 484.40"` (`flight_search` prints its prices in the same form). Quote `display` verbatim; never compute a price from `value`, `amount` or `decimal_places`. Refund, exchange and cancellation tools state their own money rules.
- Authenticate with `Authorization: Bearer <token>`; not `X-API-Key`.

<!-- BEGIN vellum overlay — generated from vellum/overlay.md by scripts/render-skill.ts -->

## Vellum setup

The tools above reach Jinko through this plugin's `jinko` MCP server, so the
assistant sees them with an `mcp__…__jinko__` prefix (the qualifier is the
plugin's install-directory name, normally `mcp__jinko-vellum-plugin__jinko__`).
Every tool name in this skill is the suffix: `flight_search` is
`mcp__jinko-vellum-plugin__jinko__flight_search`.

If none of those tools are in the tool list, the MCP server did not start —
almost always because no Jinko API key is stored. Run:

```bash
bun skills/jinko-travel/scripts/setup.ts
```

It prompts for the key and stores it in the credential vault. The server reads
the key only at start, so after storing it, disable and re-enable the plugin
(or restart the assistant) before retrying.

## Paying with Link

On Vellum, the agent path is a Link spend request. After `checkout`:

1. Read `agent_spt_params` — `max_amount`, `currency`, `stripe_profile`,
   `expires_at`.
2. Create a Link spend request for `max_amount` in `currency` and get the
   user's approval **before** `expires_at`. An expired quote has to be checked
   out again.
3. Pass the `spt_...` Shared Payment Token the approval produced to
   `submit_agent_payment` with the `trip_id`.

Do not call `submit_agent_payment` with an amount other than the one approved.

Hand the user `checkout_url` instead when:

- `max_amount` exceeds the 500 USD per-request cap on Link spend requests;
- the user declines the spend request, or the approval fails;
- `submit_agent_payment` comes back with a `checkout_url` in place of
  `booking_ref`, which is the 3DS-step-up-or-decline response documented in
  [references/booking.md](references/booking.md).

<!-- END vellum overlay -->

## Read next

- [references/flights.md](references/flights.md) — the six flight tools: inputs, date and airport-code rules, `flight_search` filters and response fields.
- [references/places.md](references/places.md) — turning what the traveller said into IATA codes: when to resolve rather than recall, ambiguity, country-level transit exclusions and the 9-airport provider cap, a radius around a city.
- [references/hotels.md](references/hotels.md) — `hotel_search` (two modes, the 422 low-confidence recovery, examples) and `hotel_details`.
- [references/booking.md](references/booking.md) — `trip`, `checkout`, `submit_agent_payment`, `get_trip`, `get_booking`, `booking_ref` vs `booking_reference`, the multi-domain cart, and the post-booking / ground / car contracts.
