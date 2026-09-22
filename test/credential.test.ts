import { describe, expect, test } from "bun:test";

import {
  MissingJinkoApiKeyError,
  resolveJinkoApiKey,
} from "../src/credential.ts";

describe("resolveJinkoApiKey", () => {
  test("uses JINKO_API_KEY when it is set", async () => {
    const key = await resolveJinkoApiKey({
      pluginName: "jinko-vellum-plugin",
      env: { JINKO_API_KEY: " jnk_t_env " },
      loadResolveCredential: async () => {
        throw new Error("must not be consulted");
      },
    });
    expect(key).toBe("jnk_t_env");
  });

  test("names the credentials command when no key can be found", async () => {
    const attempt = resolveJinkoApiKey({
      pluginName: "jinko-vellum-plugin",
      env: {},
      loadResolveCredential: async () => {
        throw new Error("Cannot find package '@vellumai/plugin-api'");
      },
    });
    await expect(attempt).rejects.toThrow(MissingJinkoApiKeyError);
    await expect(attempt).rejects.toThrow(
      "assistant credentials prompt --service jinko-vellum-plugin --field api_key",
    );
  });

  test("the unbound npm stub is treated as no vault", async () => {
    const attempt = resolveJinkoApiKey({
      pluginName: "jinko-vellum-plugin",
      env: {},
      loadResolveCredential: async () => undefined,
    });
    await expect(attempt).rejects.toThrow(
      "assistant credentials prompt --service jinko-vellum-plugin --field api_key",
    );
  });

  test("a vault lookup failure keeps the original message", async () => {
    const attempt = resolveJinkoApiKey({
      pluginName: "jinko-vellum-plugin",
      env: {},
      loadResolveCredential: async () => async () => {
        throw new Error("Credential not found: jinko-vellum-plugin/api_key");
      },
    });
    await expect(attempt).rejects.toThrow(
      /Credential not found: jinko-vellum-plugin\/api_key/,
    );
  });
});
