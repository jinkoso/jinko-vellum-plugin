/**
 * The stdio-to-remote proxy that backs the `jinko` MCP server.
 *
 * `mcp.json` can declare a `streamable-http` server directly, but its
 * `headers` are literal package data — a plugin cannot put a per-user
 * credential there, and the host never lends its own `mcp:<id>:*`
 * credentials to a plugin-chosen URL. So the plugin declares a `stdio`
 * server whose command is this script: the child reads the key at start
 * (env, else the credential vault), opens one Streamable HTTP session to
 * Jinko with an `Authorization` header, and relays `tools/list` and
 * `tools/call` between the two transports.
 *
 * Everything the assistant sees — the instructions text, the tool set,
 * the error messages — comes from the remote server. The proxy adds only
 * the allowlist filter and the key.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  CallToolRequestSchema,
  CallToolResultSchema,
  ListToolsRequestSchema,
  McpError,
  ErrorCode,
  ToolListChangedNotificationSchema,
  type ServerCapabilities,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";

import pkg from "../package.json" with { type: "json" };

import { resolveJinkoApiKey, MissingJinkoApiKeyError } from "./credential.ts";
import { resolvePluginName } from "./plugin-name.ts";

/** Server id in `mcp.json`; also the name reported to the assistant. */
export const SERVER_NAME = "jinko";

/** Env var carrying the remote endpoint. `mcp.json` sets the prod value. */
export const URL_ENV = "JINKO_MCP_URL";

/** Env var carrying an optional comma-separated tool allowlist. */
export const ALLOWLIST_ENV = "JINKO_TOOL_ALLOWLIST";

/**
 * Tools the assistant keeps per MCP server. The host truncates with
 * `tools.slice(0, 20)` and says nothing, so the proxy says it instead.
 */
export const VELLUM_TOOL_CAP = 20;

/**
 * Timeout for a forwarded `tools/call`. The SDK default is 60s, which is
 * below the latency of a live flight search (the remote fans out to GDS
 * and aggregator backends). Progress notifications reset it.
 */
export const REMOTE_CALL_TIMEOUT_MS = 180_000;

/** The Jinko server rejected the key. Distinguished so the exit is explicit. */
export class JinkoAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JinkoAuthError";
  }
}

export interface RemoteOptions {
  /** Full endpoint URL, including the `/mcp` path. */
  readonly url: string;
  /** Bearer token sent on every request. Never logged. */
  readonly apiKey: string;
}

export interface ProxyOptions extends RemoteOptions {
  /** When set, the only tools advertised and callable. */
  readonly allowlist?: readonly string[] | undefined;
  /** Diagnostics sink. Defaults to stderr, which the host captures. */
  readonly warn?: (message: string) => void;
}

/** Parse `JINKO_TOOL_ALLOWLIST`. An unset or all-blank value means no filter. */
export function parseAllowlist(
  raw: string | undefined,
): string[] | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const names = raw
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  return names.length > 0 ? names : undefined;
}

/**
 * Open the remote session.
 *
 * @throws {JinkoAuthError} when the server answers 401/403, so the caller
 *   can report a rejected key rather than a generic transport failure.
 */
export async function connectRemote(options: RemoteOptions): Promise<Client> {
  const client = new Client(
    { name: `${SERVER_NAME}-proxy`, version: pkg.version },
    { capabilities: {} },
  );
  const transport = new StreamableHTTPClientTransport(new URL(options.url), {
    requestInit: {
      headers: { Authorization: `Bearer ${options.apiKey}` },
    },
  });
  try {
    await client.connect(transport);
  } catch (err) {
    if (isAuthFailure(err)) {
      throw new JinkoAuthError(
        `The Jinko MCP server at ${options.url} rejected the API key. ` +
          "Store a current key and reconnect the plugin. " +
          `Underlying error: ${describe(err)}`,
      );
    }
    throw err;
  }
  return client;
}

/**
 * Build the local stdio-facing server. Its initialize response carries the
 * remote's instructions and tools capability, so the assistant reads the
 * same booking-flow guidance a direct connection would give it.
 */
export function createProxyServer(
  remote: Client,
  options: Pick<ProxyOptions, "allowlist" | "warn">,
): Server {
  const warn = options.warn ?? defaultWarn;
  const allowed =
    options.allowlist === undefined
      ? undefined
      : new Set<string>(options.allowlist);

  const remoteTools = remote.getServerCapabilities()?.tools;
  const capabilities: ServerCapabilities = { tools: remoteTools ?? {} };

  const server = new Server(
    { name: SERVER_NAME, version: pkg.version },
    {
      capabilities,
      ...(remote.getInstructions() !== undefined && {
        instructions: remote.getInstructions(),
      }),
    },
  );

  let capWarned = false;

  server.setRequestHandler(ListToolsRequestSchema, async (request, extra) => {
    const result = await remote.listTools(request.params, {
      signal: extra.signal,
    });
    const tools: Tool[] =
      allowed === undefined
        ? result.tools
        : result.tools.filter((tool) => allowed.has(tool.name));
    if (tools.length > VELLUM_TOOL_CAP && !capWarned) {
      capWarned = true;
      warn(
        `The Jinko server exposes ${tools.length} tools; the assistant keeps ` +
          `only the first ${VELLUM_TOOL_CAP} and drops the rest without a ` +
          `message. Set ${ALLOWLIST_ENV} to the tools you need.`,
      );
    }
    return { ...result, tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const name = request.params.name;
    if (allowed !== undefined && !allowed.has(name)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Tool "${name}" is not in ${ALLOWLIST_ENV}. Allowed: ${[...allowed]
          .sort()
          .join(", ")}.`,
      );
    }
    // Errors from the remote are rethrown untouched: an McpError keeps its
    // code and message, anything else reaches the peer as an internal error
    // carrying the original message.
    return await remote.callTool(request.params, CallToolResultSchema, {
      signal: extra.signal,
      timeout: REMOTE_CALL_TIMEOUT_MS,
      resetTimeoutOnProgress: true,
    });
  });

  if (remoteTools?.listChanged === true) {
    remote.setNotificationHandler(
      ToolListChangedNotificationSchema,
      async () => {
        await server.sendToolListChanged();
      },
    );
  }

  return server;
}

export interface RunningProxy {
  readonly server: Server;
  readonly remote: Client;
  close(): Promise<void>;
}

/** Connect to Jinko, then serve the proxy over `transport`. */
export async function startProxy(
  options: ProxyOptions,
  transport: Transport,
): Promise<RunningProxy> {
  const remote = await connectRemote(options);
  let server: Server;
  try {
    server = createProxyServer(remote, options);
    await server.connect(transport);
  } catch (err) {
    await remote.close().catch(() => undefined);
    throw err;
  }
  return {
    server,
    remote,
    close: async () => {
      await server.close().catch(() => undefined);
      await remote.close().catch(() => undefined);
    },
  };
}

/**
 * Entry point for `skills/jinko-travel/scripts/mcp-proxy.ts`.
 *
 * Resolves configuration and the key, then serves stdio. Every failure
 * path writes one actionable line to stderr and exits non-zero; none of
 * them prints the key.
 */
export async function runProxyMain(scriptPath: string): Promise<void> {
  const env = process.env;
  const url = env[URL_ENV]?.trim();
  if (url === undefined || url.length === 0) {
    process.stderr.write(
      `${URL_ENV} is not set. The plugin's mcp.json sets it to the Jinko ` +
        "production endpoint; set it explicitly when running this script by hand.\n",
    );
    process.exit(1);
  }

  const pluginName = resolvePluginName(scriptPath, env);
  let apiKey: string;
  try {
    apiKey = await resolveJinkoApiKey({ pluginName, env });
  } catch (err) {
    if (err instanceof MissingJinkoApiKeyError) {
      process.stderr.write(`${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }

  const allowlist = parseAllowlist(env[ALLOWLIST_ENV]);

  try {
    await startProxy({ url, apiKey, allowlist }, new StdioServerTransport());
  } catch (err) {
    if (err instanceof JinkoAuthError) {
      process.stderr.write(`${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }
}

function defaultWarn(message: string): void {
  process.stderr.write(`[${SERVER_NAME}] ${message}\n`);
}

/** Recognize a 401/403 from the transport, the SDK auth layer, or a JSON-RPC error. */
function isAuthFailure(err: unknown): boolean {
  if (err instanceof UnauthorizedError) {
    return true;
  }
  if (
    err instanceof Error &&
    /\b(401|403|unauthorized|forbidden)\b/i.test(err.message)
  ) {
    return true;
  }
  if (typeof err === "object" && err !== null && "code" in err) {
    const code = (err as { code: unknown }).code;
    if (code === 401 || code === 403) {
      return true;
    }
  }
  return false;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
