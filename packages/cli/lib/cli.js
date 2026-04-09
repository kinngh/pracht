import { HTTP_METHODS, VERSION } from "./constants.js";

export function printHelp() {
  console.log(`pracht ${VERSION}

Usage:
  pracht dev [port]                 Start development server with HMR
  pracht build                      Production build (client + server)
  pracht generate <kind> [flags]    Scaffold framework files
  pracht doctor [--json]            Validate app wiring

Generate kinds:
  route       --path /dashboard [--render ssr|spa|ssg|isg] [--shell app] [--middleware auth] [--loader]
  shell       --name app
  middleware  --name auth
  api         --path /health [--methods GET,POST]
`);
}

export function printGenerateHelp() {
  console.log(`Usage:
  pracht generate route --path /dashboard [--render ssr|spa|ssg|isg] [--shell app] [--middleware auth] [--loader] [--json]
  pracht generate shell --name app [--json]
  pracht generate middleware --name auth [--json]
  pracht generate api --path /health [--methods GET,POST] [--json]
`);
}

export function parseFlags(args) {
  const options = { _: [] };

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith("--")) {
      options._.push(token);
      continue;
    }

    if (token.startsWith("--no-")) {
      options[token.slice(5)] = false;
      continue;
    }

    const equalsIndex = token.indexOf("=");
    if (equalsIndex !== -1) {
      const key = token.slice(2, equalsIndex);
      const value = token.slice(equalsIndex + 1);
      assignOption(options, key, value);
      continue;
    }

    const key = token.slice(2);
    const next = args[index + 1];
    if (next && !next.startsWith("--")) {
      assignOption(options, key, next);
      index += 1;
      continue;
    }

    assignOption(options, key, true);
  }

  return options;
}

export function requireStringOption(options, key) {
  const value = requireOptionalString(options, key);
  if (!value) {
    throw new Error(`Missing required flag --${key}.`);
  }
  return value;
}

export function requireOptionalString(options, key) {
  const value = options[key];
  if (Array.isArray(value)) {
    return String(value[value.length - 1]);
  }
  if (typeof value === "string") {
    return value;
  }
  return null;
}

export function requireEnumOption(options, key, allowed, fallback) {
  const value = requireOptionalString(options, key) ?? fallback;
  if (!allowed.includes(value)) {
    throw new Error(`Invalid value for --${key}. Expected one of ${allowed.join(", ")}.`);
  }
  return value;
}

export function requirePositiveIntegerOption(options, key, fallback) {
  const raw = requireOptionalString(options, key);
  const value = raw == null ? fallback : Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`--${key} must be a positive integer.`);
  }
  return value;
}

export function parseCommaList(value) {
  if (!value) return [];
  const values = Array.isArray(value) ? value : [value];
  return values
    .flatMap((entry) => String(entry).split(","))
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function parseApiMethods(value) {
  const methods = parseCommaList(value);
  const normalized = methods.length === 0 ? ["GET"] : methods.map((entry) => entry.toUpperCase());

  for (const method of normalized) {
    if (!HTTP_METHODS.has(method)) {
      throw new Error(`Unsupported HTTP method "${method}".`);
    }
  }

  return [...new Set(normalized)];
}

export function quote(value) {
  return JSON.stringify(value);
}

export function ensureTrailingNewline(value) {
  return value.endsWith("\n") ? value : `${value}\n`;
}

export function handleCliError(error, { json }) {
  const message = error instanceof Error ? error.message : String(error);
  if (json) {
    console.error(JSON.stringify({ ok: false, error: message }, null, 2));
  } else {
    console.error(message);
    if (error instanceof Error && error.stack && process.env.DEBUG) {
      console.error(error.stack);
    }
  }
  process.exit(1);
}

function assignOption(options, key, value) {
  if (!(key in options)) {
    options[key] = value;
    return;
  }

  if (!Array.isArray(options[key])) {
    options[key] = [options[key]];
  }
  options[key].push(value);
}
