# Repro: `resolveCredential()` fails on first call from a plugin-spawned stdio MCP server

Observed on vellum-assistant `175c45b6fa76` (2026-09-22), macOS, self-hosted
`vellum hatch --remote local`, credential backend `ces-rpc` (CES RPC ready).

## Symptom

A plugin declares a stdio MCP server in `mcp.json`. The server's script calls
`resolveCredential("<plugin>/<field>")` from `@vellumai/plugin-api` at start.
The credential is stored and visible in `assistant credentials list`, yet the
first call throws:

```
CredentialResolutionError: Credential store is unreachable
```

and the server exits, so the daemon logs `MCP error -32000: Connection closed`.
Setting the same value in the child's environment instead works, so the plugin
code and the stored value are fine; only the vault read path fails.

## Steps

1. Install this plugin into a workspace:

   ```bash
   git clone https://github.com/jinkoso/jinko-vellum-plugin \
     "<workspace>/plugins/jinko-vellum-plugin"
   cd "<workspace>/plugins/jinko-vellum-plugin"
   bun install --omit=dev --ignore-scripts --no-save
   ```

2. Store a credential under the plugin's service name. Any value reproduces the
   read failure; a real key is only needed to see the server connect afterwards.

   ```bash
   assistant credentials prompt --service jinko-vellum-plugin --field api_key \
     --label "Jinko API key" --placeholder "jnk_t_..."
   assistant credentials list          # shows jinko-vellum-plugin / api_key
   ```

3. Make sure `JINKO_API_KEY` is not set in the daemon's environment (the plugin
   prefers it over the vault), then reconnect:

   ```bash
   assistant mcp reload
   ```

4. Read `<workspace>/data/logs/assistant-<date>.log`:

   ```
   [mcp-client] Connecting to MCP server
       serverId: "jinko-vellum-plugin__jinko"
   No Jinko API key is available, so the "jinko-vellum-plugin" MCP server cannot start.
   ...
   Vault lookup reported: Credential store is unreachable.
   [mcp-client] MCP server connection failed
       serverId: "jinko-vellum-plugin__jinko"
       err: { "name": "McpError", "message": "MCP error -32000: Connection closed", "code": -32000 }
   ```

   `assistant mcp list` keeps the server in `declared`.

5. Control: export `JINKO_API_KEY=<same value>` into the daemon environment and
   reload. The server connects, `assistant mcp list` shows `connected`, and
   `assistant tools list` shows the `mcp__jinko-vellum-plugin__jinko__*` tools.

## Minimal probe without this plugin

Run a script as a child with the daemon's environment (so CES discovery works)
and `VELLUM_PLUGIN_NAME=jinko-vellum-plugin`:

```ts
import { resolveCredential } from "@vellumai/plugin-api";

try {
  await resolveCredential("jinko-vellum-plugin/api_key");
} catch (err) {
  console.log(String(err));
  // CredentialResolutionError: Credential store is unreachable
}
```

In the same process, any call that goes through `resolveBackendAsync()` in
`assistant/src/security/secure-keys.ts` (for example `getSecureKeyResultAsync`
on the credential's storage key) connects the child to CES. A second
`resolveCredential("jinko-vellum-plugin/api_key")` then succeeds and returns
the stored value. The order of the two calls is the whole difference.

## Where it comes from

`assistant/src/plugin-api/resolve-credential.ts`:

```ts
let resolved = resolveCredentialRef(ref);            // in-process cache: empty in a child
if (!resolved && pluginName !== undefined) {
  resolved = await resolveCredentialRefLive(ref);    // throws "unreachable" here
}
...
const { value } = await getSecureKeyResultAsync(resolved.storageKey);  // never reached
```

`resolveCredentialRefLive()` calls `listCredentialRecordsLive()`, which reads
`_recordBackend`. That field is attached by `setCesClient()`, which in the
daemon happens at boot. In a plugin-spawned child the CES session is opened
lazily, and the lazy connect is only reached through `getSecureKeyResultAsync`
→ `resolveBackendAsync()`, after the live lookup has already thrown.

## Expected

`resolveCredential("<plugin>/<field>")` in a plugin-spawned stdio child resolves
a stored credential on the first call, as `ensure-plugin-api-shim.ts` describes
for out-of-process plugin code. Connecting the backend before the live record
lookup (for example awaiting `resolveBackendAsync()` first) would do it.
