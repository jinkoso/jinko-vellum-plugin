# Flights — discovery and live search

Six tools. Five read Jinko's price cache (`find_destination`, `flight_calendar`, `find_dates`,
`lowest_fare`, `price_monitoring` — 1 credit per call); one hits live pricing (`flight_search` —
10 credits per call). Which one to call first is decided in
[SKILL.md › Which tool first](../SKILL.md#which-tool-first) and is not repeated here.

## Cached prices are indicative — confirm live before presenting a bookable fare

`flight_calendar`, `find_dates`, `lowest_fare` and `price_monitoring` return fares from Jinko's price
cache. Even at the highest-confidence cache age their price accuracy is roughly 80%. Use them to
identify good candidate dates and routes, then ALWAYS re-run live shopping to confirm the price before
you present a fare as bookable or add it to a trip:

- `flight_search` with `price_check` and the `offer_token` the cached result carried, or
- `flight_search` with `search` on the exact dates the user picked.

Present cached figures to the user as indicative ("from about …"), never as the bookable price.

## Dates and airport codes (flight_calendar, find_dates, lowest_fare)

- All dates in query parameters (`departure_dates`, `departure_date_ranges`, `return_dates`,
  `return_date_ranges`) MUST be in the future. Never use past dates.
- Origin and destination must be IATA city codes by default (PAR, NYC, LON), or IATA airport codes if
  the user specifies an airport (CDG, JFK, LHR).
- `flight_calendar` and `find_dates` only: by default search roundtrip unless the user explicitly asks
  for one-way; use `trip_type="oneway"` ONLY when the user explicitly asks for a one-way trip.
  (`lowest_fare`: `trip_type="roundtrip"` with a return date, otherwise `"oneway"`.) This default does
  NOT apply to `flight_search` — there, no return date means a one-way search; see its section.
- Fill as many search parameters as possible from the user's intent to get the best results.

Per-tool differences: `find_destination` wants AIRPORT codes, not city codes (see below);
`price_monitoring` prefers city codes and pins to an airport only when the user committed to one.

## find_destination

Discover travel destinations accessible from your departure airports. Search globally or filter to
specific regions. Returns destinations sorted by cheapest available flight.

- IMPORTANT: use airport codes (CDG, ORY, JFK), NOT city codes (PAR, NYC). Include all nearby
  airports for best results (e.g. CDG + ORY for Paris).
- Next step: `flight_calendar` with the destination to get specific flights with `offer_token`s for
  pricing.

## flight_calendar

Search flights between a known origin and destination using cached pricing. Use it whenever the user
specifies BOTH where they are flying FROM and where they are flying TO.

- Supports loose / flexible dates: single dates, date arrays, date ranges, `stay_days`.
- Also the right tool for "cheapest flight", "best flight", "find me a flight", "cheapest date"
  phrasings — it returns the cheapest cached itineraries.

Route search:

- Use exact 3-letter IATA airport codes or an IATA city code for both origin and destination.
- Date ranges OR a stay duration for flexible trip planning.
- Natural trip duration (`stay_days`) instead of exact return dates.

Use cases:

- "Find flights from JFK to CDG next month" — specific route with a date range
- "Fly from Los Angeles to Tokyo for a week in December" — uses `departure_date` + `stay_days`
- "Paris to Barcelona for a weekend in April" — specific route
- "Cheapest flight from ORD to LHR under $600" — specific route with a budget
- "Direct flight in business class from New York to London" — specific route with preferences

Flow: `flight_calendar` → `flight_search` (price-check) → `trip` → `checkout`

## find_dates

Find the best date options for a known origin and destination using cached pricing. Takes the SAME
inputs as `flight_calendar`, but returns up to ten cheapest itineraries — one per (departure, return)
date pair — spread across the requested departure window, so the user sees a diverse set of "when
should I fly?" options rather than the full per-date list.

- Use when the user knows the route (origin AND destination), is flexible on WHEN, and wants a short,
  spread-out shortlist of the best date options.
- Examples: "When is the cheapest time to fly Paris → New York in June?", "Best weekends to go from
  London to Lisbon next month", "Give me a few good date options for a week in Tokyo".
- For the full price-per-date list / calendar grid, use `flight_calendar` instead.

Flow: `find_dates` → `flight_search` (price-check the chosen dates) → `trip` → `checkout`

## lowest_fare

Find the cheapest fares for a known origin, destination and FIXED date using cached pricing. Takes the
SAME inputs as `flight_calendar`, but for one specific departure date (one-way, or with a return date
for round-trip) it returns up to ten itineraries sorted cheapest-first.

- Use when the user knows the route AND the exact date, and just wants the cheapest options that day.
- Examples: "Cheapest flight Paris → New York on June 15", "What's the lowest fare CDG→JFK on the
  15th?".
- Use `trip_type="roundtrip"` with a return date for a round-trip; otherwise `"oneway"`.
- Flexible on dates (a range, "when should I fly?") → `flight_calendar` (full grid) or `find_dates`
  (curated date spread) instead.

Flow: `lowest_fare` → `flight_search` (price-check) → `trip` → `checkout`

## price_monitoring

Cache-only flight price snapshot for a fixed origin/destination + dates pair. Intended for scheduled
polling — NOT for one-shot shopping or booking.

When to use:

- Track the price of a specific route + dates over time and react when it drops (cron / scheduled
  job).
- Recommended cadence: poll no faster than the cache refresh interval. Polling faster is wasted work.
- It requires an exact `departure_date` (+ optional exact `return_date`); flexible dates or ranges
  belong to `flight_calendar` / `find_destination`, and a user who has not committed to a specific
  route is still exploring. A user ready to book NOW, or one-shot exploration you will not come back
  to, belongs to `flight_search`.

What it returns:

- The single cheapest cached itinerary matching the request filters (lowest WITHIN the filter
  constraints — filters constrain the candidate set, not the win condition).
- An `offer_token` that remains re-shoppable via `flight_search` (`price_check` mode) when the user
  decides to book.
- `status`: `"ok"` (offer present) or `"stale"` (cache had no matching itinerary — retry later, or
  call `flight_search` for a live quote).

Cache-only contract: this tool NEVER triggers a live connector call. `status: "stale"` is the correct
response when the cache is cold — do not retry in a tight loop and do not silently fall back to
`flight_search`.

Input notes:

- Origin / destination: IATA city code preferred (PAR, NYC, LON); pin to an airport only when the
  user actually committed to a specific airport.
- Use the SAME filter set the user has been monitoring against between polls.

Result hints (attached to every result): on `"stale"` — "Cache had no matching itinerary for this
poll. Retry later, or call flight_search if a live quote is needed right now."; on `"ok"` — "Cheapest
cached itinerary matching the request filters. offer_token is re-shoppable via flight_search
(price_check mode) when ready to book."

## flight_search

Get live flight pricing and fare options. Provide exactly one of the `search` or `price_check` nested
objects. IMPORTANT: they are nested objects, not string values — do NOT pass them as strings.

### 1. `search` — live flight search by route and dates

Example: `{ "search": { "origin": "PAR", "destination": "NYC", "departure_date": "2027-06-01" } }`

Required fields: `origin`, `destination`, `departure_date`.

`trip_type` is optional and is derived from `return_date` when omitted: a departure date with no return
date is a one-way search — run it; do not ask whether the trip is round trip. Send `return_date` (with
`trip_type="roundtrip"`) only when the user gave a return date or asked for a round trip.

Optional filters: `return_date`, `trip_type`, `cabin_class`, `max_stops`, `multi_fare`, `max_price`,
`limit`, `include_carriers`, `exclude_carriers`, `single_carrier_only`, `departure_time_range`,
`arrival_time_range`, `return_departure_time_range`, `return_arrival_time_range`,
`connection_time_min_minutes`, `connection_time_max_minutes`, `max_total_duration_minutes`,
`refundable_only`, `changeable_only`, `checked_bag_included`, `via_airports`, `exclude_via_airports`,
`aircraft_types`, `origin_alternate_airports`, `destination_alternate_airports`, `nearby_airports`,
`same_connection_airport_only`, `same_origin_airport_only`, `same_turnaround_airport_only`,
`origin_type`, `destination_type`.

Date flexibility: this call prices ONE exact date pair. Send "give or take a day", open windows and
date ranges to `flight_calendar` instead. `flight_calendar` takes only `direct_only`, `cabin_class`,
`max_price` and the time windows — `refundable_only`, `changeable_only`, `checked_bag_included`,
`max_stops` and the carrier lists are NOT in its input. So when the user gave constraints like those,
do not stop at the calendar result: once they pick dates there, call `flight_search` again on those
exact dates WITH the original filters.

### 2. `price_check` — live pricing for a specific deal from a discovery tool

Example: `{ "price_check": { "offer_token": "token_from_discovery" } }`

`price_check` may return status `"flight_unavailable"` with alternatives if the flight is no longer
available — ask the user to choose. Do NOT proceed to booking on `"flight_unavailable"`.

### Response

- Each flight includes detailed segments, fare options with baggage / refund / change rules, and a
  `trip_item_token` per fare. Every fare also carries `refundable`, `changeable` and
  `checked_bag_included` booleans.
- `applied_filters` lists the search filters this result set enforces; `unapplied_filters` lists the
  ones NO provider could enforce, each with a reason (and `filters_notice` spells the same thing out in
  one sentence). A filter in `unapplied_filters` still has to be applied by you — the flights were not
  narrowed by it. Both reports name a leg SIDE for the alternate-airport lists: an
  `origin_alternate_airports` / `destination_alternate_airports` list appears as `"origin"` /
  `"destination"`.
- `origin_alternate_airports` / `destination_alternate_airports` take effect only against an AIRPORT
  anchor. Sent with a city anchor (`origin_type` / `destination_type` `"city"`, or a code that resolves
  to a city) the search still runs and returns flights, the list is ignored, and the side comes back in
  `unapplied_filters` with the reason — that is a warning to relay, not an error.

### Next step

Use the `trip` tool with `add_item` and the `trip_item_token` from the fare the user selects.

Flow: discovery (`flight_calendar` / `find_destination` / `find_dates` / `lowest_fare`) or direct
search → `flight_search` → `trip` → `checkout`

Passengers: if a search fails, surface the error — never retry with a changed passenger list (e.g.
dropping an infant); that silently changes the user's request.
