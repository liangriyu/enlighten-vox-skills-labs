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
  try {
    workspaceResolved = resolveRequest(target, {
      rootDir: options.rootDir ?? process.cwd()
    });
  } catch (error) {
    workspaceError = error;
  }

  if (workspaceResolved) {
    return callback(workspaceResolved);
  }

  let source;
  try {
    source = parseSource(target, { cwd: options.rootDir ?? process.cwd() });
  } catch {
    throw workspaceError;
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

export function skillDirectoryName(skillId) {
  return splitTarget(skillId)[1];
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
