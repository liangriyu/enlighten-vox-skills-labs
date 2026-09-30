import fs from "node:fs";
import path from "node:path";
import { CliUsageError } from "./errors.js";
import { discoverSource, selectDiscoveredRequest } from "./discovery.js";
import { withMaterializedSource } from "./git-source.js";
import { readManifest } from "./manifest.js";
import { parseSource } from "./source-parser.js";

export function resolveRequest(target, options = {}) {
  if (!target) {
    throw new CliUsageError("Missing target. Usage: skills add <domain>/<suite-or-skill>");
  }

  const rootDir = options.rootDir ?? process.cwd();
  const [domain, name] = splitTarget(target);
  const suitePath = path.join(rootDir, "domains", domain, "suites", `${name}.yaml`);
  const skillPath = path.join(rootDir, "domains", domain, "skills", name, "skill.yaml");

  if (fs.existsSync(suitePath)) {
    const suite = {
      ...readManifest(suitePath),
      manifestPath: suitePath
    };
    const skills = (suite.skills ?? []).map((skillId) => loadSkill(rootDir, skillId));
    return {
      request: target,
      targetType: "suite",
      suite,
      skills,
      source: {
        type: "workspace",
        localRoot: rootDir,
        request: target
      }
    };
  }

  if (fs.existsSync(skillPath)) {
    return {
      request: target,
      targetType: "skill",
      suite: null,
      skills: [loadSkill(rootDir, target)],
      source: {
        type: "workspace",
        localRoot: rootDir,
        request: target
      }
    };
  }

  throw new CliUsageError(`Unknown suite or skill: ${target}`);
}

export async function withResolvedInstallRequest(target, options = {}, callback) {
  let workspaceError;
  let workspaceResolved;
  const cwd = options.rootDir ?? process.cwd();
  const registryRoot = options.registry ? null : options.registryRoot ?? findRegistryRoot(cwd);

  try {
    if (registryRoot) {
      workspaceResolved = resolveRequest(target, {
        rootDir: registryRoot
      });
    }
  } catch (error) {
    workspaceError = error;
  }

  if (workspaceResolved) {
    return callback(workspaceResolved);
  }

  if (options.registry && looksLikeManagedTarget(target)) {
    return withRegistryRoot(options, ({ rootDir, repositoryRoot, source }) => {
      const resolved = resolveRequest(target, { rootDir });
      return callback({
        ...resolved,
        source: {
          ...source,
          localRoot: repositoryRoot,
          sourceRoot: rootDir,
          request: options.registry
        }
      });
    });
  }

  if (looksLikeManagedTarget(target)) {
    throw (
      workspaceError ??
      new CliUsageError(
        "No Skill registry checkout found. Run from the registry repository or pass --registry <path-or-git-source>."
      )
    );
  }

  let source;
  try {
    source = parseSource(target, { cwd });
  } catch {
    throw (
      workspaceError ??
      new CliUsageError(`Unsupported Skill source or registry target: ${target}`)
    );
  }

  return withMaterializedSource(
    source,
    async ({ rootDir, repositoryRoot, source: materializedSource }) => {
      const discovered = await discoverSource(rootDir);
      const selected = selectDiscoveredRequest(discovered, {
        suite: options.suite,
        skill: options.skill
      });

      return callback({
        ...selected,
        source: {
          ...materializedSource,
          localRoot: repositoryRoot,
          sourceRoot: rootDir,
          request: target
        }
      });
    },
    options
  );
}

export async function withRegistryRoot(options = {}, callback) {
  const cwd = options.rootDir ?? process.cwd();

  if (options.registry) {
    const source = parseSource(options.registry, { cwd });
    return withMaterializedSource(
      source,
      ({ rootDir, repositoryRoot, source: materializedSource }) =>
        callback({
          rootDir,
          repositoryRoot,
          source: materializedSource
        }),
      options
    );
  }

  const registryRoot = options.registryRoot ?? findRegistryRoot(cwd);
  if (!registryRoot) {
    throw new CliUsageError(
      "No Skill registry checkout found. Run from the registry repository or pass --registry <path-or-git-source>."
    );
  }

  return callback({
    rootDir: registryRoot,
    repositoryRoot: registryRoot,
    source: {
      type: "workspace",
      localRoot: registryRoot
    }
  });
}

export function findRegistryRoot(startDir) {
  let current = path.resolve(startDir);

  for (;;) {
    if (
      fs.existsSync(path.join(current, "registry.yaml")) &&
      fs.existsSync(path.join(current, "domains"))
    ) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

export function skillDirectoryName(skillId) {
  return splitTarget(skillId)[1];
}

export function looksLikeManagedTarget(target) {
  if (typeof target !== "string") {
    return false;
  }
  const parts = target.split("/");
  return (
    parts.length === 2 &&
    /^[a-z0-9-]+$/.test(parts[0]) &&
    /^[a-z0-9-]+$/.test(parts[1])
  );
}

function loadSkill(rootDir, skillId) {
  const [domain, name] = splitTarget(skillId);
  const manifestPath = path.join(rootDir, "domains", domain, "skills", name, "skill.yaml");
  if (!fs.existsSync(manifestPath)) {
    throw new CliUsageError(`Suite references missing skill: ${skillId}`);
  }

  return {
    ...readManifest(manifestPath),
    manifestPath,
    directoryName: name
  };
}

function splitTarget(target) {
  const parts = target.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new CliUsageError(`Target must use <domain>/<name>: ${target}`);
  }
  return parts;
}
