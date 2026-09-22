# Places — turning what the traveller said into IATA codes

Every flight tool takes three-letter IATA codes and nothing else. The traveller does not speak in
codes: they say "no US transit", "the cheapest way out of Thailand", "somewhere within about an hour
of Munich". This file is the bridge, and one rule runs through all of it:

**A three-letter code you are not sure exists is worse than no code at all.** The tools validate the
FORMAT, not the FACT. A well-formed invention passes validation, matches nothing, and comes back as
an empty result that reads as "there are no flights" rather than "that airport does not exist". You
will report a false negative to the traveller and never find out.

So: recall only what you are certain of, resolve what you can, and ASK when neither applies. "Which
airport did you mean?" is a good answer. A guessed code is not.

## Resolve, don't recall

Recall is safe for the handful of codes that are unambiguous and famous — `CDG`, `JFK`, `LHR`, `BKK`
— and for the major metropolitan city codes (`PAR`, `NYC`, `LON`, `TYO`). It is NOT safe for:

- which airports serve a mid-sized city, or which ones are "nearby" — this is where invented codes
  come from;
- every airport in a country (there are 2,145 usable ones in the United States alone);
- what lies within a distance of a point;
- whether an unfamiliar code exists at all.

Jinko resolves all four. On the REST surface: `GET /api/v1/flights/places/resolve`, one selector per
call — `place`, `country` or `codes`.

- `?place=Thailand` — free text: a country name, a city name, an IATA code, or `lat,lon`. Names
  resolve in English, French, German, Spanish, Italian, Chinese, Japanese and Korean.
- `?place=Munich&radius_km=50` — the airports within 50 km of the resolved place. No coordinates
  needed from you.
- `?country=US` — an explicit ISO-3166-1 alpha-2 code, for when "Mexico" or "Singapore" could be
  either the country or the city.
- `?codes=PAR,JFK,XQX` — validate and expand codes you already hold: a city code becomes its
  airports, an airport code passes through, an invented one comes back as a warning.

**There is no `resolve_places` MCP tool yet** — this is a REST route. On the MCP surface, apply the
rules below from what you can safely recall, and ask the traveller rather than guessing.

Read the answer: `airport_codes` is the complete list to paste into a tool parameter. `airports` is
the readable detail and is capped by `limit`; `airport_count` is the true total. `warnings` is never
decoration — an unknown place comes back as a 200 with a warning, not an error, so the warnings are
the only place a rejection is stated.

## Ambiguity is a question for the traveller, not a coin flip

When a name matches several places the answer carries `candidates` and NO airports. "Santiago" is
Chile's capital, Santiago de Compostela in Spain, and Santiago in the Dominican Republic. Picking
the first one books a flight to the wrong continent.

Show the candidates with their countries and ask which one is meant. Call again with the chosen
`code`.

When one match is clearly the notable one — "Munich" also matches a hamlet in Australia — it
resolves, lists the others as candidates, and says so in a warning. Relay that warning only if the
traveller's phrasing makes the smaller place plausible.

## "No US transit" — a country as a connection filter

`exclude_via_airports` bans connections at the airports you list. It takes IATA AIRPORT codes; there
is no country parameter. A country-level ban therefore means expanding the country to its airports.

**At most 9 airports per leg reach the provider.** The rest are enforced after the fact, on the
results that come back. That difference matters:

- The answer you give the traveller is CORRECT either way — nothing that connects at an excluded
  airport survives.
- But the provider was never told about codes 10 and beyond, so it spends its search budget on
  itineraries that are then thrown away. A country-sized exclusion can come back sparse, or empty,
  on a route that genuinely has options.

Therefore: **order the list so the nine that count come first** — the airports the traveller could
realistically connect through on that route. The resolver returns its list most-prominent-first for
exactly this reason, and warns whenever an answer is longer than nine.

Tell the traveller what they are getting: "excluding US connections — the strongest exclusions are
applied at search time, the rest are filtered from the results, so there may be fewer options than
usual." Do NOT promise an exhaustive filter, and do NOT hand back an empty result set as if the
route had no flights.

## A country as an ORIGIN or a destination

"The cheapest flight out of Thailand to KUL." `origins` takes codes, not countries, so resolve the
country and pass its airports. Two cautions:

- The full list is long: Thailand is 43 airports, the United States 2,145. Sending all of them is
  rarely what the traveller wants and is slow. Send the ones a scheduled international flight would
  actually leave from — the head of the resolver's list — and say which you searched.
- If the traveller named a region rather than a country ("the Caribbean", "a Greek island"), there
  is no single code for it. Resolve the countries it covers, or ask them to narrow it.

## A radius around a place

"Departing from airports within about 50 km of Munich, Stuttgart, or Cologne."

No flight tool has a radius parameter, and a radius cannot be pushed to the providers uniformly. The
portable form is an explicit airport list, which is what `?place=<city>&radius_km=<n>` gives you —
one call per city, then the union of the three answers.

It is great-circle distance, not driving time. When the traveller said "an hour away", turn that
into a distance yourself and say which you used; 50 km is a reasonable reading of an hour by car in
Europe.

## Codes on the discovery tools

- `find_destination` wants AIRPORT codes, not city codes, and wants every airport that serves the
  origin — `["CDG", "ORY"]` for Paris, not `["PAR"]`. Resolve the city rather than recalling its
  airports: `?place=PAR` returns exactly that list.
- `flight_calendar`, `find_dates` and `lowest_fare` take CITY codes by default. A city code already
  covers every airport in the metropolitan area — do not expand it yourself, and do not send a list
  of airports where one city code says the same thing.
- `price_monitoring` prefers city codes, and pins to an airport only when the traveller committed to
  one.
- Ten codes look like airports and are not: `BJS`, `CHI`, `LON`, `MIL`, `NYC`, `PAR`, `TYO`, `WAS`,
  `YMQ` and `YTO` are "all airports in this metro" aggregates. They are fine as a city code on a
  search; they are not an entry for an airport list.
