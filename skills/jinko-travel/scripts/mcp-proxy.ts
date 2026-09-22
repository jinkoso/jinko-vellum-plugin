#!/usr/bin/env bun
/**
 * Entry point for the `jinko` stdio MCP server declared in `mcp.json`.
 *
 * This file must stay under `skills/<skill>/scripts/` : the host does not
 * inject `VELLUM_PLUGIN_NAME` for MCP children, and its credential scoping
 * recovers the plugin name from exactly this path shape.
 */

import { fileURLToPath } from "node:url";

import { runProxyMain } from "../../../src/proxy.ts";

await runProxyMain(fileURLToPath(import.meta.url));
