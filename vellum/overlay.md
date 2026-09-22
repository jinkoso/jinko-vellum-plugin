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
