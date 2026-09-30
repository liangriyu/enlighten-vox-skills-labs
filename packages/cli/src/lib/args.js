const STRING_OPTIONS = new Set([
  "agent",
  "scope",
  "project-dir",
  "registry",
  "enlighten-flavor",
  "enlighten-user-data",
  "state-dir",
  "organization-id",
  "space-id",
  "suite",
  "skill"
]);

const BOOLEAN_OPTIONS = new Set(["dry-run", "yes", "verbose", "help", "force", "list"]);

export function parseArgs(argv) {
  const [command, ...tokens] = argv;
  if (command === "--help" || command === "-h") {
    return {
      command: "help",
      target: undefined,
      positional: [],
      options: {
        help: true
      }
    };
  }

  const options = {};
  const positional = [];

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }

    const raw = token.slice(2);
    const [name, inlineValue] = splitOption(raw);

    if (BOOLEAN_OPTIONS.has(name)) {
      options[toCamel(name)] = inlineValue === undefined ? true : inlineValue !== "false";
      continue;
    }

    if (!STRING_OPTIONS.has(name)) {
      throw new Error(`Unknown option: --${name}`);
    }

    const value = inlineValue ?? tokens[i + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for --${name}`);
    }

    if (inlineValue === undefined) {
      i += 1;
    }
    options[toCamel(name)] = value;
  }

  return {
    command: command ?? "help",
    target: positional[0],
    positional,
    options
  };
}

function splitOption(raw) {
  const equalsIndex = raw.indexOf("=");
  if (equalsIndex === -1) {
    return [raw, undefined];
  }
  return [raw.slice(0, equalsIndex), raw.slice(equalsIndex + 1)];
}

function toCamel(name) {
  return name.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}
