---
name: jinko-travel
description: Search and book flights and hotels through Jinko, take payment with Link agentic payments or a Stripe checkout link, and cancel, refund, or exchange an existing booking
compatibility: "Designed for Vellum personal assistants"
metadata:
  vellum:
    category: "travel"
    display-name: "Jinko Travel"
    user-invocable: true
    activation-hints:
      - "book a flight"
      - "find a hotel"
      - "search flights"
      - "plan a trip"
      - "cancel my booking"
---

The `jinko` MCP server carries the tools. This skill covers the order they
run in, the payment hand-off, and what must not be invented.

## First-use setup

If the `jinko` tools are missing from the tool list, the MCP server did not
start — almost always because no Jinko API key is stored. Run:

```bash
bun skills/jinko-travel/scripts/setup.ts
```

It prompts for the key and stores it in the credential vault. The MCP
server reads the key only at start, so after storing it, disable and
re-enable the plugin (or restart the assistant) before retrying.

## Booking flow

Each step consumes a token or id the previous step returned. Do not skip a
step and do not start in the middle.

1. **Find flights.** `flight_search` for an exact origin, destination, and
   date; `flight_calendar` when the dates are loose; `find_destination`
   when the user has no destination yet. Each fare option carries its own
   `trip_item_token`.
2. **Find hotels.** `hotel_search` returns offers with `htl_*` tokens;
   `hotel_details` fetches the gallery, facilities, and policies for one
   hotel after the user picks it.
3. **Add to the trip.** `trip` with `add_item` and the token from the fare
   or room the user chose. The first `add_item` creates the trip and
   returns the `trip_id`; later items reuse it. Flights and hotels share
   one trip.
4. **Add travelers.** `trip` with `upsert_travelers`. Names must match the
   travel document.
5. **Check out.** `checkout` with the `trip_id`. It returns a
   `checkout_url` for browser payment and `agent_spt_params` for agentic
   payment.
6. **Pay.** See below.
7. **Confirm.** `get_booking` for the booking record; `get_trip` for the
   current state of the trip.

Servicing an existing booking: `flight_refund`, `flight_exchange`,
`hotel_cancel`. They act on a booking, not on a trip in progress.

## Payment

Prefer the Link agentic-payment path.

1. Read `agent_spt_params` from the `checkout` result: `max_amount`,
   `currency`, `stripe_profile`, `expires_at`.
2. Create a Link spend request for `max_amount` in `currency`, and get the
   user's approval **before** `expires_at`. An expired quote has to be
   re-checked out.
3. Pass the `spt_...` Shared Payment Token the approval produced to
   `submit_agent_payment` together with the `trip_id`.

Fall back to `checkout_url` — hand the user the link and let them pay in
the browser — when any of these happens:

- `max_amount` exceeds the 500 USD per-request cap on Link spend requests.
- The user declines or the approval fails.
- `submit_agent_payment` reports a 3-D Secure step-up or a decline.

Do not retry `submit_agent_payment` with a different amount than the one
approved.

## Tokens and ids

Offer tokens (`trip_item_token`, `htl_*`), `trip_id`, and booking ids are
opaque. Pass them back exactly as returned. Never construct, shorten,
reformat, or guess one: a fabricated token does not fail loudly, it prices
or books something the user did not choose.

If `flight_search` returns `status: "offer_unavailable"`, the fare is gone.
Show the alternatives it returned and let the user pick again.
