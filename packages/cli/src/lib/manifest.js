import fs from "node:fs";
import path from "node:path";
import { CliUsageError } from "./errors.js";

export function readManifest(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  return parseYamlSubset(content);
}

export function validateRegistryManifests(rootDir) {
  const registryPath = path.join(rootDir, "registry.yaml");
  if (!fs.existsSync(registryPath)) {
    throw new CliUsageError(`Registry manifest does not exist: ${registryPath}`);
  }

  const registry = readManifest(registryPath);
  if (registry.schema !== "registry/v1") {
    throw new CliUsageError(`Invalid registry schema: ${registryPath}`);
  }
  if (!Array.isArray(registry.domains) || registry.domains.length === 0) {
    throw new CliUsageError(`Registry must declare at least one domain: ${registryPath}`);
  }
  assertUniqueStrings(registry.domains, "registry domain", registryPath);

  const counts = {
    domains: 0,
    suites: 0,
    skills: 0,
    resources: 0
  };

  for (const domainId of registry.domains) {
    validateDomain(rootDir, domainId, counts);
  }

  return counts;
}

function validateDomain(rootDir, domainId, counts) {
  assertIdSegment(domainId, "domain id");
  const domainRoot = path.join(rootDir, "domains", domainId);
  const domainPath = path.join(domainRoot, "domain.yaml");
  if (!fs.existsSync(domainPath)) {
    throw new CliUsageError(`Domain manifest does not exist: ${domainPath}`);
  }

  const domain = readManifest(domainPath);
  if (domain.schema !== "domain/v1") {
    throw new CliUsageError(`Invalid domain schema: ${domainPath}`);
  }
  if (domain.id !== domainId) {
    throw new CliUsageError(`Domain id mismatch in ${domainPath}: ${domain.id}`);
  }
  assertNonEmptyString(domain.name, "domain name", domainPath);
  assertNonEmptyString(domain.description, "domain description", domainPath);
  counts.domains += 1;

  const suiteDir = path.join(domainRoot, "suites");
  for (const suitePath of listYamlFiles(suiteDir)) {
    validateSuite(rootDir, domainId, suitePath, counts);
  }

  const skillDir = path.join(domainRoot, "skills");
  for (const skillPath of listSkillManifests(skillDir)) {
    validateSkillManifest(rootDir, domainId, skillPath, counts);
  }
}

function validateSuite(rootDir, domainId, suitePath, counts) {
  const suite = readManifest(suitePath);
  if (suite.schema !== "suite/v1") {
    throw new CliUsageError(`Invalid suite schema: ${suitePath}`);
  }
  assertTargetId(suite.id, "suite id", suitePath);
  if (!suite.id.startsWith(`${domainId}/`)) {
    throw new CliUsageError(`Suite id must stay in domain ${domainId}: ${suitePath}`);
  }
  if (!suite.version) {
    throw new CliUsageError(`Suite manifest is missing version: ${suitePath}`);
  }
  assertNonEmptyString(suite.name, "suite name", suitePath);
  assertNonEmptyString(suite.description, "suite description", suitePath);
  if (!Array.isArray(suite.skills) || suite.skills.length === 0) {
    throw new CliUsageError(`Suite manifest must reference at least one skill: ${suitePath}`);
  }
  assertUniqueStrings(suite.skills, "suite skill reference", suitePath);

  for (const skillId of suite.skills) {
    assertTargetId(skillId, "suite skill reference", suitePath);
    const [skillDomain, skillName] = skillId.split("/");
    const skillPath = path.join(
      rootDir,
      "domains",
      skillDomain,
      "skills",
      skillName,
      "skill.yaml"
    );
    if (!fs.existsSync(skillPath)) {
      throw new CliUsageError(`Suite references missing skill ${skillId}: ${suitePath}`);
    }
  }
  counts.suites += 1;
}

function validateSkillManifest(rootDir, domainId, skillPath, counts) {
  const skill = readManifest(skillPath);
  if (skill.schema !== "skill/v1") {
    throw new CliUsageError(`Invalid skill schema: ${skillPath}`);
  }
  assertTargetId(skill.id, "skill id", skillPath);
  if (!skill.id.startsWith(`${domainId}/`)) {
    throw new CliUsageError(`Skill id must stay in domain ${domainId}: ${skillPath}`);
  }
  if (!skill.version) {
    throw new CliUsageError(`Skill manifest is missing version: ${skillPath}`);
  }
  assertNonEmptyString(skill.name, "skill name", skillPath);
  assertNonEmptyString(skill.description, "skill description", skillPath);
  if (!skill.entry) {
    throw new CliUsageError(`Skill manifest is missing entry: ${skillPath}`);
  }
  validateCompatibility(skill, skillPath);

  const skillRoot = path.dirname(skillPath);
  if (!Array.isArray(skill.resources) || skill.resources.length === 0) {
    throw new CliUsageError(`Skill manifest must declare at least one resource: ${skillPath}`);
  }
  assertUniqueStrings(skill.resources, "skill resource", skillPath);
  const resourcePatterns = skill.resources;
  if (!resourcePatterns.includes(skill.entry)) {
    throw new CliUsageError(`Skill resources must include entry ${skill.entry}: ${skillPath}`);
  }
  for (const resourcePattern of resourcePatterns) {
    const resourcePath = resolveDeclaredResource(skillRoot, resourcePattern);
    if (!fs.existsSync(resourcePath)) {
      throw new CliUsageError(`Skill resource does not exist (${resourcePattern}): ${skillPath}`);
    }
    counts.resources += 1;
  }
  counts.skills += 1;
}

function resolveDeclaredResource(skillRoot, resourcePattern) {
  if (typeof resourcePattern !== "string" || !resourcePattern.trim()) {
    throw new CliUsageError("Skill resource must be a non-empty relative path.");
  }
  const trimmed = resourcePattern.trim();
  const source = trimmed.endsWith("/**") ? trimmed.slice(0, -3).replace(/\/$/, "") : trimmed;
  if (path.isAbsolute(source) || source.split("/").includes("..")) {
    throw new CliUsageError(`Skill resource must stay inside its package: ${resourcePattern}`);
  }
  return path.join(skillRoot, source);
}

function listYamlFiles(directory) {
  if (!fs.existsSync(directory)) {
    return [];
  }
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".yaml"))
    .map((entry) => path.join(directory, entry.name))
    .sort();
}

function listSkillManifests(directory) {
  if (!fs.existsSync(directory)) {
    return [];
  }

  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(directory, entry.name, "skill.yaml"))
    .filter((manifestPath) => fs.existsSync(manifestPath))
    .sort();
}

function assertTargetId(value, label, manifestPath) {
  if (typeof value !== "string" || !/^[a-z0-9-]+\/[a-z0-9-]+$/.test(value)) {
    throw new CliUsageError(`Invalid ${label} in ${manifestPath}: ${value}`);
  }
}

function assertIdSegment(value, label) {
  if (typeof value !== "string" || !/^[a-z0-9-]+$/.test(value)) {
    throw new CliUsageError(`Invalid ${label}: ${value}`);
  }
}

function assertNonEmptyString(value, label, manifestPath) {
  if (typeof value !== "string" || !value.trim()) {
    throw new CliUsageError(`Manifest is missing ${label}: ${manifestPath}`);
  }
}

function assertUniqueStrings(values, label, manifestPath) {
  const seen = new Set();
  for (const value of values) {
    if (typeof value !== "string" || !value.trim()) {
      throw new CliUsageError(`Invalid ${label} in ${manifestPath}: ${value}`);
    }
    if (seen.has(value)) {
      throw new CliUsageError(`Duplicate ${label} in ${manifestPath}: ${value}`);
    }
    seen.add(value);
  }
}

function validateCompatibility(skill, skillPath) {
  const agents = skill.compatibility?.agents;
  if (agents === undefined) {
    return;
  }
  if (!Array.isArray(agents) || agents.length === 0) {
    throw new CliUsageError(`Skill compatibility.agents must be a non-empty list: ${skillPath}`);
  }
  assertUniqueStrings(agents, "compatible agent", skillPath);

  for (const agent of agents) {
    if (!["codex", "enlighten-ai"].includes(agent)) {
      throw new CliUsageError(`Unsupported compatible agent in ${skillPath}: ${agent}`);
    }
  }
}

export function parseYamlSubset(content) {
  const root = {};
  let currentKey = null;
  let nestedKey = null;

  for (const rawLine of content.split(/\r?\n/)) {
    const lineWithoutComment = rawLine.replace(/\s+#.*$/, "");
    if (!lineWithoutComment.trim()) {
      continue;
    }

    const indent = rawLine.search(/\S/);
    const line = lineWithoutComment.trim();

    if (indent === 0) {
      const [key, value] = splitKeyValue(line);
      currentKey = key;
      nestedKey = null;
      root[key] = value === "" ? {} : parseScalar(value);
      continue;
    }

    if (indent === 2 && line.startsWith("- ")) {
      if (!Array.isArray(root[currentKey])) {
        root[currentKey] = [];
      }
      root[currentKey].push(parseScalar(line.slice(2).trim()));
      continue;
    }

    if (indent === 2) {
      const [key, value] = splitKeyValue(line);
      if (!root[currentKey] || Array.isArray(root[currentKey])) {
        root[currentKey] = {};
      }
      nestedKey = key;
      root[currentKey][key] = value === "" ? [] : parseScalar(value);
      continue;
    }

    if (indent === 4 && line.startsWith("- ")) {
      if (!root[currentKey] || !Array.isArray(root[currentKey][nestedKey])) {
        throw new Error(`Unsupported YAML list placement near: ${rawLine}`);
      }
      root[currentKey][nestedKey].push(parseScalar(line.slice(2).trim()));
      continue;
    }

    throw new Error(`Unsupported YAML subset line: ${rawLine}`);
  }

  return root;
}

function splitKeyValue(line) {
  const separatorIndex = line.indexOf(":");
  if (separatorIndex === -1) {
    throw new Error(`Invalid YAML line: ${line}`);
  }
  return [line.slice(0, separatorIndex).trim(), line.slice(separatorIndex + 1).trim()];
}

function parseScalar(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^".*"$/.test(value) || /^'.*'$/.test(value)) {
    return value.slice(1, -1);
  }
  return value;
}
