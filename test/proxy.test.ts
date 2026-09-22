import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import {
  JinkoAuthError,
  connectRemote,
  createProxyServer,
  parseAllowlist,
} from "../src/proxy.ts";
import {
  FAKE_INSTRUCTIONS,
  FAKE_TOOLS,
  startFakeJinko,
  type FakeJinko,
} from "./fake-jinko.ts";

const TEST_KEY = "jnk_t_test";

/** Wire a client to a proxy that is already connected to `remoteUrl`. */
async function openProxy(
  remoteUrl: string,
  allowlist?: readonly string[],
): Promise<{ client: Client; close: () => Promise<void> }> {
  const remote = await connectRemote({ url: remoteUrl, apiKey: TEST_KEY });
  const server = createProxyServer(remote, { allowlist, warn: () => {} });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
      await remote.close();
    },
  };
}

describe("proxy", () => {
  let fake: FakeJinko;

  beforeEach(async () => {
    fake = await startFakeJinko();
  });

  afterEach(async () => {
    await fake.close();
  });

  test("forwards tools/list and tools/call with the bearer key", async () => {
    const { client, close } = await openProxy(fake.url);
    try {
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name).sort()).toEqual(
        [...FAKE_TOOLS].sort(),
      );

      const result = await client.callTool({
        name: "flight_search",
        arguments: { origin: "CDG", destination: "JFK" },
      });
      expect(result.content).toEqual([
        { type: "text", text: "flights CDG->JFK" },
      ]);
      expect(fake.calls).toEqual([
        { name: "flight_search", args: { origin: "CDG", destination: "JFK" } },
      ]);
    } finally {
      await close();
    }

    expect(fake.authHeaders.length).toBeGreaterThan(0);
    for (const header of fake.authHeaders) {
      expect(header).toBe(`Bearer ${TEST_KEY}`);
    }
  });

  test("an allowlist hides other tools and rejects calls to them", async () => {
    const { client, close } = await openProxy(fake.url, ["flight_search"]);
    try {
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name)).toEqual(["flight_search"]);

      await expect(
        client.callTool({ name: "hotel_search", arguments: { city: "NCE" } }),
      ).rejects.toThrow(/JINKO_TOOL_ALLOWLIST/);
      expect(fake.calls).toEqual([]);
    } finally {
      await close();
    }
  });

  test("mirrors the remote instructions", async () => {
    const { client, close } = await openProxy(fake.url);
    try {
      expect(client.getInstructions()).toBe(FAKE_INSTRUCTIONS);
    } finally {
      await close();
    }
  });
});

describe("parseAllowlist", () => {
  test("splits, trims, and treats a blank value as no filter", () => {
    expect(parseAllowlist(undefined)).toBeUndefined();
    expect(parseAllowlist("  , ,")).toBeUndefined();
    expect(parseAllowlist("flight_search, hotel_search")).toEqual([
      "flight_search",
      "hotel_search",
    ]);
  });
});

describe("rejected key", () => {
  test("a 401 from the remote surfaces as a rejected-key error", async () => {
    const fake401 = await startFakeJinko({ rejectWithStatus: 401 });
    try {
      const attempt = connectRemote({ url: fake401.url, apiKey: TEST_KEY });
      await expect(attempt).rejects.toThrow(JinkoAuthError);
      await expect(attempt).rejects.toThrow(/rejected the API key/);
    } finally {
      await fake401.close();
    }
  });
});
