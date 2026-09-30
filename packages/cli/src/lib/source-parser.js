import path from "node:path";
import { CliUsageError } from "./errors.js";

const HOST_TYPES = new Map([
  ["github.com", "github"],
  ["www.github.com", "github"],
  ["gitee.com", "gitee"],
  ["www.gitee.com", "gitee"],
  ["gitlab.com", "gitlab"],
  ["www.gitlab.com", "gitlab"]
]);

export function parseSource(input, options = {}) {
  if (typeof input !== "string" || !input.trim()) {
    throw new CliUsageError("Git source cannot be empty.");
  }

  const value = input.trim();
  const cwd = options.cwd ?? process.cwd();

  const shorthand = parseShorthand(value);
  if (shorthand) {
    return shorthand;
  }

  if (looksLikeLocalPath(value)) {
    return {
      type: "local",
      input: value,
      localPath: path.resolve(cwd, value)
    };
  }

  const scpStyle = parseScpStyle(value);
  if (scpStyle) {
    return scpStyle;
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(value);
  } catch {
    const shorthandRepo = parseGithubRepoShorthand(value);
    if (shorthandRepo) {
      return shorthandRepo;
    }
    throw new CliUsageError(`Unsupported Git source: ${input}`);
  }

  if (parsedUrl.protocol === "file:") {
    return {
      type: "git",
      input: value,
      url: value,
      ref: undefined,
      subpath: undefined
    };
  }

  if (!["http:", "https:", "git:", "ssh:"].includes(parsedUrl.protocol)) {
    throw new CliUsageError(`Unsupported Git source protocol: ${parsedUrl.protocol}`);
  }

  const hostType = HOST_TYPES.get(parsedUrl.hostname.toLowerCase());
  if (hostType && (parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:")) {
    return parseHostedUrl(parsedUrl, hostType, value);
  }

  if (parsedUrl.protocol === "ssh:" || parsedUrl.protocol === "git:") {
    return {
      type: hostType ?? "git",
      input: value,
      url: stripUrlFragment(parsedUrl),
      ref: undefined,
      subpath: undefined
    };
  }

  return {
    type: hostType ?? "git",
    input: value,
    url: stripUrlFragment(parsedUrl),
    ref: undefined,
    subpath: undefined
  };
}

export function isSourceReference(input, options = {}) {
  try {
    parseSource(input, options);
    return true;
  } catch {
    return false;
  }
}

export function normalizeSourceSubpath(value) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const raw = String(value).replaceAll("\\", "/");
  if (raw.startsWith("/") || raw.split("/").includes("..")) {
    throw new CliUsageError(`Git source subpath must stay inside the repository: ${value}`);
  }

  const normalized = raw.replace(/^\/+|\/+$/g, "");
  if (!normalized || normalized === ".") {
    return undefined;
  }

  if (path.posix.isAbsolute(normalized) || normalized.split("/").includes("..")) {
    throw new CliUsageError(`Git source subpath must stay inside the repository: ${value}`);
  }

  return normalized
    .split("/")
    .filter((segment) => segment && segment !== ".")
    .join("/");
}

function parseShorthand(value) {
  const match = /^(github|gitee|gitlab):(.+)$/.exec(value);
  if (!match) {
    return null;
  }

  const type = match[1];
  const repoPath = normalizeRepoPath(match[2], type);
  return {
    type,
    input: value,
    url: `https://${hostForType(type)}/${repoPath}.git`,
    ref: undefined,
    subpath: undefined
  };
}

function parseHostedUrl(parsedUrl, type, input) {
  const segments = decodePathSegments(parsedUrl.pathname);
  const markerIndex = type === "gitlab"
    ? findGitLabTreeMarker(segments)
    : segments.indexOf("tree");

  if (markerIndex >= 0) {
    const repoEnd = type === "gitlab" && segments[markerIndex - 1] === "-"
      ? markerIndex - 1
      : markerIndex;
    const repoSegments = segments.slice(0, repoEnd);
    const ref = segments[markerIndex + 1];
    const subpath = normalizeSourceSubpath(segments.slice(markerIndex + 2).join("/"));
    if (!ref || repoSegments.length < 2) {
      throw new CliUsageError(`Invalid ${type} tree source: ${input}`);
    }

    const repoPath = normalizeRepoPath(repoSegments.join("/"), type);
    return {
      type,
      input,
      url: `https://${parsedUrl.hostname}/${repoPath}.git`,
      ref,
      subpath
    };
  }

  const repoPath = normalizeRepoPath(segments.join("/"), type);
  return {
    type,
    input,
    url: `https://${parsedUrl.hostname}/${repoPath}.git`,
    ref: undefined,
    subpath: undefined
  };
}

function parseScpStyle(value) {
  const match = /^([^/@:]+)@([^:]+):(.+)$/.exec(value);
  if (!match) {
    return null;
  }

  const [, user, hostname, rawRepoPath] = match;
  const type = HOST_TYPES.get(hostname.toLowerCase()) ?? "git";
  const repoPath = normalizeRepoPath(rawRepoPath, type);
  return {
    type,
    input: value,
    url: `${user}@${hostname}:${repoPath}.git`,
    ref: undefined,
    subpath: undefined
  };
}

function parseGithubRepoShorthand(value) {
  if (!/^[^/:\\\s]+\/[^/:\\\s]+$/.test(value)) {
    return null;
  }

  const repoPath = normalizeRepoPath(value, "github");
  return {
    type: "github",
    input: value,
    url: `https://github.com/${repoPath}.git`,
    ref: undefined,
    subpath: undefined
  };
}

function normalizeRepoPath(value, type) {
  const normalized = String(value)
    .replaceAll("\\", "/")
    .replace(/^\/+|\/+$/g, "")
    .replace(/\.git$/i, "");
  const segments = normalized.split("/");

  if (
    segments.length < 2 ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new CliUsageError(`Invalid ${type} repository path: ${value}`);
  }

  return segments.join("/");
}

function findGitLabTreeMarker(segments) {
  for (let index = 0; index < segments.length - 1; index += 1) {
    if (segments[index] === "-" && segments[index + 1] === "tree") {
      return index + 1;
    }
  }
  return -1;
}

function decodePathSegments(value) {
  return value
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        throw new CliUsageError(`Invalid encoded Git source path: ${value}`);
      }
    });
}

function hostForType(type) {
  if (type === "github") return "github.com";
  if (type === "gitee") return "gitee.com";
  if (type === "gitlab") return "gitlab.com";
  throw new CliUsageError(`Unsupported hosted Git type: ${type}`);
}

function stripUrlFragment(parsedUrl) {
  const cloneUrl = new URL(parsedUrl.toString());
  cloneUrl.hash = "";
  return cloneUrl.toString();
}

function looksLikeLocalPath(value) {
  return (
    value.startsWith("./") ||
    value.startsWith("../") ||
    value.startsWith("/") ||
    value.startsWith("~") ||
    /^[A-Za-z]:[\\/]/.test(value)
  );
}
