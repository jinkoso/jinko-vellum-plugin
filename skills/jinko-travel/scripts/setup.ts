#!/usr/bin/env bun
/**
 * Store the Jinko API key in the Vellum credential vault.
 *
 * The plugin cannot ship the key and the MCP child reads it at start, so
 * this script issues the one `assistant credentials prompt` invocation
 * that puts it where the child will look: `<plugin name>/api_key`.
 */

import { fileURLToPath } from "node:url";

import { credentialsPromptArgs } from "../../../src/credential.ts";
import { resolvePluginName } from "../../../src/plugin-name.ts";

/** Exit codes `assistant credentials prompt` reports. */
const STORED = 0;
const DISMISSED = 130;
const PENDING = 75;

const pluginName = resolvePluginName(fileURLToPath(import.meta.url));
const args = credentialsPromptArgs(pluginName);

const child = Bun.spawn(["assistant", ...args], {
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});
const code = await child.exited;

switch (code) {
  case STORED:
    console.log(
      `Stored ${pluginName}/api_key. Disable and re-enable the plugin (or ` +
        "restart the assistant) so the jinko MCP server reconnects and picks " +
        "up the key.",
    );
    break;
  case DISMISSED:
    console.log("Cancelled. No credential was stored.");
    break;
  case PENDING:
    console.log(
      "Nothing is stored yet: with no conversation attached, the command " +
        "returned a one-time collection link instead of opening the prompt. " +
        "Relay the link printed above to the user. Once they submit the key, " +
        "disable and re-enable the plugin so the jinko MCP server reconnects.",
    );
    break;
  default:
    console.error(
      `assistant credentials prompt exited with code ${code}; ` +
        `${pluginName}/api_key was not stored.`,
    );
    break;
}

process.exit(code);
