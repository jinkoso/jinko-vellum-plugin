# Jinko Travel — Vellum Assistant plugin

Exposes Jinko's remote MCP server to a Vellum assistant: flight and hotel
search, trip assembly, checkout, agentic payment, and servicing (refund,
exchange, cancel). The plugin ships no travel logic of its own — every tool,
schema, and instruction comes from the Jinko server.

## Architecture

```
Vellum assistant
      │  stdio (MCP)
      ▼
skills/jinko-travel/scripts/mcp-proxy.ts     ← this plugin
      │  Streamable HTTP + Authorization: Bearer jnk_t_...
      ▼
https://mcp.builders.gojinko.com/mcp         ← Jinko remote MCP server
```

The remote server is Streamable HTTP and `mcp.json` can declare that
transport directly, but a plugin cannot put a per-user credential in it:
`headers` in `mcp.json` are literal package data, the spec defines no vault
placeholder, and the host never lends a plugin its own `mcp:<id>:*`
credentials. So the plugin declares a `stdio` server instead. The child
resolves the key at start, opens one authenticated session to Jinko, and
relays `tools/list` and `tools/call`. The remote's `instructions` and tools
capability are copied into the proxy's own initialize response, so the
assistant reads the same booking guidance a direct connection would give it.

The proxy script lives under `skills/jinko-travel/scripts/` because that is
where it has to be. The host does not inject `VELLUM_PLUGIN_NAME` into MCP
children; its credential scoping recovers the plugin name from an entry
script path shaped `plugins/<name>/skills/<skill>/{scripts,tools}/<file>`.
Moving the script breaks the vault lookup.

## Install

```bash
assistant plugins install https://github.com/jinkoso/jinko-vellum-plugin
```

Until the plugin is listed in the Vellum marketplace (`plugins/marketplace.json`),
it installs as an unreviewed plugin: the install itself is the only review.

## Authentication

Jinko issues one tenant API key (`jnk_t_...`) per Vellum organization. The
key is sent as `Authorization: Bearer <key>`; `X-API-Key` is not accepted.

The key is not shipped with the plugin. At start, the MCP child reads it
from the assistant's credential vault under `jinko-vellum-plugin/api_key`,
or from `JINKO_API_KEY` in the environment when a host injects it there.
The credential's service name must equal the plugin's install-directory
name, because the host scopes a plugin's vault reads to its own name.

There are two ways the key gets into the vault.

**Platform-provisioned (Vellum Cloud).** The Vellum control plane writes
the organization's key into every managed assistant's vault as a
platform-managed credential, the same way it provisions
`vellum:assistant_api_key`: pushed through the daemon's `POST /v1/secrets`,
hidden from `assistant credentials list` and `reveal`, and not deletable
by the user. The plugin then needs no setup step. This requires Vellum to
extend its platform-managed credential set with `jinko-vellum-plugin:api_key`
and to keep the owning plugin's `resolveCredential` able to read it.

**Self-stored (self-hosted assistants, or before provisioning exists).**
Request a tenant API key for your organization from Jinko and store it:

```bash
bun skills/jinko-travel/scripts/setup.ts
```

which runs:

```bash
assistant credentials prompt \
  --service jinko-vellum-plugin \
  --field api_key \
  --label "Jinko API key" \
  --description "Tenant API key (jnk_t_...) issued by Jinko for this Vellum organization" \
  --placeholder "jnk_t_..." \
  --allowed-domains mcp.builders.gojinko.com,jinko-e90ee33b.alpic.live
```

A self-stored credential is readable back with `assistant credentials
reveal` by whoever controls that assistant, so a shared organization key
should only be distributed this way to people allowed to hold it.

The MCP child reads the key once, at start. After storing a key, disable and
re-enable the plugin (or restart the assistant) so the server reconnects.

## Configuration

`mcp.json` sets `JINKO_MCP_URL`; the other two are for local work or a host
that supplies the key itself.

| Variable               | Required | Default (from `mcp.json`)               | Effect                                                                        |
| ---------------------- | -------- | --------------------------------------- | ----------------------------------------------------------------------------- |
| `JINKO_MCP_URL`        | yes      | `https://mcp.builders.gojinko.com/mcp`  | Remote endpoint. Dev builder: `https://jinko-e90ee33b.alpic.live/mcp`.         |
| `JINKO_TOOL_ALLOWLIST` | no       | unset                                   | Comma-separated tool names. When set, only these are advertised and callable.  |
| `JINKO_API_KEY`        | no       | unset                                   | Overrides the vault lookup. Used for local development.                        |

## Tools

The proxy advertises whatever the remote advertises. The production builder
exposes 14:

`find_destination`, `flight_calendar`, `price_monitoring`, `flight_search`,
`hotel_search`, `hotel_details`, `trip`, `get_trip`, `checkout`,
`submit_agent_payment`, `get_booking`, `flight_refund`, `flight_exchange`,
`hotel_cancel`.

The dev builder exposes 20 — the 14 above plus `find_ground`,
`ground_cancel`, `ground_exchange`, `car_search`, `car_cancel`,
`car_exchange`.

## Skill content

The guidance in `skills/jinko-travel/` — which tool to call first, the
booking order, the payment hand-off, the money and traveler-data rules — is
not written in this repository. It is rendered from Jinko's canonical Agent
Skills package, [jinkoso/jinko-skills](https://github.com/jinkoso/jinko-skills)
(internal), so a Vellum assistant reads the same skill every other host does.
The vendored commit is recorded in `vendor/jinko-skills/UPSTREAM.json`; today
it is `8015d30b69288afa488f296a37aa408ab5eae85c` of `skills/jinko-travel`.

```
vendor/jinko-skills/        pristine upstream, never edited here
  SKILL.md                    upstream frontmatter + body
  references/*.md             flights · hotels · booking · places
  UPSTREAM.json               repo, commit, path, sync date
vellum/frontmatter.json     the metadata.vellum block to merge
vellum/overlay.md           the Vellum-only sections
scripts/render-skill.ts     vendor + overlay → skills/jinko-travel/
scripts/sync-upstream.ts    refresh vendor/, then render
skills/jinko-travel/        rendered; do not hand-edit
```

The renderer keeps upstream's `name`, `description`, `compatibility` and
`metadata.author` / `version` / `surface` verbatim, merges
`metadata.vellum` from `vellum/frontmatter.json`, inserts the overlay just
before upstream's `## Read next` heading so the references list stays last,
and copies `references/` across unchanged. It is deterministic and
idempotent; `bun scripts/render-skill.ts --check` prints a unified diff and
exits 1 when `skills/jinko-travel/` has drifted, and CI runs it.

Upstream's rule is **moved, not rewritten**: upstream text is never edited
in this repository. Anything Vellum-specific — the `mcp__…__jinko__` tool
prefix, the setup script, paying through a Link spend request — belongs in
`vellum/overlay.md`.

To pick up a new upstream revision:

```bash
bun scripts/sync-upstream.ts /path/to/jinko-skills
```

With no argument it shallow-clones the upstream instead. Either way it needs
a maintainer who can read an internal repository, so CI never runs it — CI
only checks that what is committed matches the render.

Two things the rendered skill says that do not hold on this surface:

- It names `find_dates` and `lowest_fare` in the tool map and the routing
  list. The Builder MCP this plugin proxies advertises neither, on production
  or dev. The text is left as upstream wrote it; `flight_calendar` covers the
  same intent, and correcting the tool map is an upstream change.
- `references/places.md` documents `GET /api/v1/flights/places/resolve`. A
  Vellum assistant cannot call it: the proxy is the only authenticated path to
  Jinko and it speaks MCP, and the assistant itself holds no Jinko key. The
  page already says there is no `resolve_places` MCP tool and gives the
  MCP-side fallback, which is the part that applies here.

## Local development

```bash
bun install
bun run typecheck
bun test
bun scripts/render-skill.ts --check
```

The tests start a fake Jinko server in-process (the MCP SDK's own Streamable
HTTP server transport on a random port), so they make no network calls and
need no key.

To drive the proxy by hand against the dev builder:

```bash
JINKO_API_KEY=jnk_t_... JINKO_MCP_URL=https://jinko-e90ee33b.alpic.live/mcp \
  npx @modelcontextprotocol/inspector@2.7.0 \
  bun skills/jinko-travel/scripts/mcp-proxy.ts
```

Live tool calls cost Jinko credits. `tools/list` does not.

## Limitations

- **20 tools per server.** The assistant keeps the first 20 tools a server
  reports and drops the rest without a message. The dev builder is at exactly
  20 today; anything added beyond that is invisible. Use
  `JINKO_TOOL_ALLOWLIST` to choose which 20 survive. The proxy writes a
  warning to stderr when it forwards more than 20.
- **The key is read once, at start.** Storing or rotating a key does not
  reach a running server; the plugin has to be reconnected.
- **One key per assistant, not per end user.** The tenant key identifies the
  organization. Per-traveler identity lives inside the trip, not in the
  credential.
- **`cwd` in `mcp.json` is ignored by the host**, so the plugin passes an
  absolute `${PLUGIN_ROOT}` path in `args` instead.
