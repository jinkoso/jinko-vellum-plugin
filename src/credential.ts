/**
 * Where the Jinko API key comes from.
 *
 * A plugin cannot ship a credential: `mcp.json` headers are literal
 * package data and the spec defines no vault placeholder. The key is
 * therefore read at process start, either from `JINKO_API_KEY` (local
 * development, or a host that injects it) or from the Vellum credential
 * vault through `@vellumai/plugin-api`.
 *
 * The plugin-api import is dynamic for two reasons. Outside Vellum the
 * package may be absent entirely, and the published npm package is a stub
 * that re-exports whatever the host parked on `globalThis` — so its
 * `resolveCredential` is `undefined` rather than a function. Both cases
 * must produce the setup instructions, not a module-load crash or a
 * "not a function" TypeError.
 */

/** Credential field this plugin stores under its own service name. */
export const API_KEY_FIELD = "api_key";

/** Env var that overrides the vault lookup. */
export const API_KEY_ENV = "JINKO_API_KEY";

/** Domains the stored credential is allowed to be sent to. */
export const ALLOWED_DOMAINS = [
  "mcp.builders.gojinko.com",
  "jinko-e90ee33b.alpic.live",
] as const;

/** Label shown in the credential prompt. */
export const CREDENTIAL_LABEL = "Jinko API key";

/** Description shown in the credential prompt. */
export const CREDENTIAL_DESCRIPTION =
  "Tenant API key (jnk_t_...) issued by Jinko for this Vellum organization";

/** Placeholder shown in the credential prompt. */
export const CREDENTIAL_PLACEHOLDER = "jnk_t_...";

/** Raised when no key could be resolved. Carries the operator instructions. */
export class MissingJinkoApiKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissingJinkoApiKeyError";
  }
}

/** The `assistant credentials prompt` invocation that stores the key. */
export function credentialsPromptCommand(pluginName: string): string {
  return [
    "assistant credentials prompt",
    `--service ${pluginName}`,
    `--field ${API_KEY_FIELD}`,
    `--label "${CREDENTIAL_LABEL}"`,
    `--description "${CREDENTIAL_DESCRIPTION}"`,
    `--placeholder "${CREDENTIAL_PLACEHOLDER}"`,
    `--allowed-domains ${ALLOWED_DOMAINS.join(",")}`,
  ].join(" ");
}

/** Argv form of {@link credentialsPromptCommand}, for spawning. */
export function credentialsPromptArgs(pluginName: string): string[] {
  return [
    "credentials",
    "prompt",
    "--service",
    pluginName,
    "--field",
    API_KEY_FIELD,
    "--label",
    CREDENTIAL_LABEL,
    "--description",
    CREDENTIAL_DESCRIPTION,
    "--placeholder",
    CREDENTIAL_PLACEHOLDER,
    "--allowed-domains",
    ALLOWED_DOMAINS.join(","),
  ];
}

/** What to tell the operator when no key is available. */
export function missingKeyMessage(
  pluginName: string,
  cause?: string,
): string {
  const lines = [
    `No Jinko API key is available, so the "${pluginName}" MCP server cannot start.`,
    "",
    "Store the key in the Vellum credential vault:",
    `  ${credentialsPromptCommand(pluginName)}`,
    "",
    "or run the plugin's setup script, which issues exactly that command:",
    "  bun skills/jinko-travel/scripts/setup.ts",
    "",
    `For local development, set ${API_KEY_ENV} in the environment instead.`,
  ];
  if (cause !== undefined && cause.length > 0) {
    lines.push("", `Vault lookup reported: ${cause}`);
  }
  return lines.join("\n");
}

/**
 * Loads `resolveCredential` from `@vellumai/plugin-api`, or `undefined`
 * when the package is absent or is the unbound npm stub.
 */
export type ResolveCredentialLoader = () => Promise<
  ((ref: string) => Promise<string>) | undefined
>;

/**
 * Default loader. The import is wrapped because the package is a peer the
 * host provides: outside Vellum it may not resolve at all.
 */
export const loadHostResolveCredential: ResolveCredentialLoader = async () => {
  const mod: unknown = await import("@vellumai/plugin-api");
  if (typeof mod !== "object" || mod === null) {
    return undefined;
  }
  const candidate = (mod as { resolveCredential?: unknown }).resolveCredential;
  return typeof candidate === "function"
    ? (candidate as (ref: string) => Promise<string>)
    : undefined;
};

export interface ResolveApiKeyOptions {
  /** Plugin install-directory name; scopes the credential reference. */
  readonly pluginName: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly loadResolveCredential?: ResolveCredentialLoader;
}

/**
 * Resolve the Jinko API key: `JINKO_API_KEY` first, then
 * `<pluginName>/api_key` from the vault.
 *
 * @throws {MissingJinkoApiKeyError} when neither source yields a key. The
 *   message names the command that stores one; it never contains a key.
 */
export async function resolveJinkoApiKey(
  options: ResolveApiKeyOptions,
): Promise<string> {
  const env = options.env ?? process.env;
  const fromEnv = env[API_KEY_ENV]?.trim();
  if (fromEnv !== undefined && fromEnv.length > 0) {
    return fromEnv;
  }

  const load = options.loadResolveCredential ?? loadHostResolveCredential;
  const ref = `${options.pluginName}/${API_KEY_FIELD}`;

  let resolve: ((ref: string) => Promise<string>) | undefined;
  try {
    resolve = await load();
  } catch (err) {
    throw new MissingJinkoApiKeyError(
      missingKeyMessage(options.pluginName, describe(err)),
    );
  }
  if (resolve === undefined) {
    throw new MissingJinkoApiKeyError(
      missingKeyMessage(
        options.pluginName,
        "@vellumai/plugin-api did not provide resolveCredential (running outside a Vellum assistant)",
      ),
    );
  }

  let value: string;
  try {
    value = await resolve(ref);
  } catch (err) {
    throw new MissingJinkoApiKeyError(
      missingKeyMessage(options.pluginName, describe(err)),
    );
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new MissingJinkoApiKeyError(
      missingKeyMessage(options.pluginName, `${ref} is stored but empty`),
    );
  }
  return trimmed;
}

/** Error text for the operator; never includes a credential value. */
function describe(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}
