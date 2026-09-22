/**
 * A stand-in for the Jinko remote MCP server.
 *
 * It speaks Streamable HTTP through the SDK's own server transport, so the
 * proxy talks to the same protocol implementation it will meet in
 * production, and it records what the proxy sent: the `Authorization`
 * header on every request, and the name and arguments of every tool call.
 */

import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

/** Instructions the fake reports at initialize, mirrored by the proxy. */
export const FAKE_INSTRUCTIONS = "test instructions";

/** Tools the fake exposes, in advertised order. */
export const FAKE_TOOLS = ["flight_search", "hotel_search", "checkout"];

export interface ToolCallRecord {
  readonly name: string;
  readonly args: unknown;
}

export interface FakeJinko {
  /** Endpoint to hand the proxy, including the `/mcp` path. */
  readonly url: string;
  /** `Authorization` header of every request received, in order. */
  readonly authHeaders: (string | undefined)[];
  /** Every tool call the fake executed, in order. */
  readonly calls: ToolCallRecord[];
  close(): Promise<void>;
}

export interface FakeJinkoOptions {
  /**
   * When set, every request is answered with this status and no MCP
   * exchange happens — used to exercise the rejected-key path.
   */
  readonly rejectWithStatus?: number;
}

function buildMcpServer(calls: ToolCallRecord[]): McpServer {
  const server = new McpServer(
    { name: "fake-jinko", version: "0.0.0" },
    { instructions: FAKE_INSTRUCTIONS },
  );
  server.registerTool(
    "flight_search",
    {
      description: "Search flights",
      inputSchema: { origin: z.string(), destination: z.string() },
    },
    async (args) => {
      calls.push({ name: "flight_search", args });
      return {
        content: [
          { type: "text", text: `flights ${args.origin}->${args.destination}` },
        ],
      };
    },
  );
  server.registerTool(
    "hotel_search",
    { description: "Search hotels", inputSchema: { city: z.string() } },
    async (args) => {
      calls.push({ name: "hotel_search", args });
      return { content: [{ type: "text", text: `hotels ${args.city}` }] };
    },
  );
  server.registerTool(
    "checkout",
    { description: "Check out a trip", inputSchema: { trip_id: z.string() } },
    async (args) => {
      calls.push({ name: "checkout", args });
      return { content: [{ type: "text", text: `checkout ${args.trip_id}` }] };
    },
  );
  return server;
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (raw.length === 0) {
    return undefined;
  }
  return JSON.parse(raw);
}

export async function startFakeJinko(
  options: FakeJinkoOptions = {},
): Promise<FakeJinko> {
  const authHeaders: (string | undefined)[] = [];
  const calls: ToolCallRecord[] = [];

  const http: Server = createServer((req, res) => {
    authHeaders.push(req.headers.authorization);
    void (async () => {
      if (options.rejectWithStatus !== undefined) {
        res.writeHead(options.rejectWithStatus, {
          "Content-Type": "application/json",
        });
        res.end(JSON.stringify({ error: "invalid_token" }));
        return;
      }
      // Stateless: a fresh server and transport per request, so no session
      // state is carried and the proxy's reconnects are all equivalent.
      const server = buildMcpServer(calls);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, await readBody(req));
    })().catch((err: unknown) => {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
      }
      res.end(JSON.stringify({ error: String(err) }));
    });
  });

  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const { port } = http.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}/mcp`,
    authHeaders,
    calls,
    close: () =>
      new Promise<void>((resolve, reject) => {
        http.close((err) => (err ? reject(err) : resolve()));
        http.closeAllConnections?.();
      }),
  };
}
