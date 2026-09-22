/**
 * End-to-end check of the file `mcp.json` actually spawns: the real script,
 * as a child process, over stdio, against the fake remote.
 */

import { afterEach, beforeEach, expect, test } from "bun:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import {
  FAKE_INSTRUCTIONS,
  FAKE_TOOLS,
  startFakeJinko,
  type FakeJinko,
} from "./fake-jinko.ts";

const SCRIPT = new URL(
  "../skills/jinko-travel/scripts/mcp-proxy.ts",
  import.meta.url,
).pathname;

let fake: FakeJinko;

beforeEach(async () => {
  fake = await startFakeJinko();
});

afterEach(async () => {
  await fake.close();
});

test("the spawned script serves the remote tool set and instructions", async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SCRIPT],
    env: {
      PATH: process.env.PATH ?? "",
      JINKO_API_KEY: "jnk_t_test",
      JINKO_MCP_URL: fake.url,
    },
    stderr: "pipe",
  });
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(transport);
  try {
    expect(client.getInstructions()).toBe(FAKE_INSTRUCTIONS);
    const listed = await client.listTools();
    expect(listed.tools).toHaveLength(FAKE_TOOLS.length);
    expect(listed.tools.map((tool) => tool.name).sort()).toEqual(
      [...FAKE_TOOLS].sort(),
    );
  } finally {
    await client.close();
  }
}, 30_000);
