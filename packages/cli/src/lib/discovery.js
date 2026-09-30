import fs from "node:fs/promises";
import path from "node:path";
import { CliUsageError } from "./errors.js";
import { readManifest } from "./manifest.js";

export async function discoverSource(sourceRoot) {
  const manifestFiles = await findFiles(sourceRoot, (filePath, entry) => {
    return entry.isFile() && entry.name === "skill.yaml";
  });
  const suiteFiles = await findFiles(sourceRoot, (filePath, entry) => {
    return (
      entry.isFile() &&
      entry.name.endsWith(".yaml") &&
      path.dirname(filePath).split(path.sep).includes("suites")
    );
  });

  const skills = [];
  for (const manifestPath of manifestFiles) {
    const manifest = readManifest(manifestPath);
    if (manifest.schema !== "skill/v1" && !manifest.id) {
      continue;
    }
    if (!manifest.id || !manifest.entry) {
      throw new CliUsageError(`Skill manifest is missing id or entry: ${manifestPath}`);
    }
    skills.push({
      ...manifest,
      manifestPath,
      directoryName: path.basename(path.dirname(manifestPath)),
      selectorNames: uniqueStrings([
        manifest.id,
        manifest.id.split("/").at(-1),
        manifest.name,
        path.basename(path.dirname(manifestPath))
      ])
    });
  }

  const suites = [];
  for (const manifestPath of suiteFiles) {
    const manifest = readManifest(manifestPath);
    if (manifest.schema !== "suite/v1" && !manifest.skills) {
      continue;
    }
    if (!manifest.id || !Array.isArray(manifest.skills)) {
      throw new CliUsageError(`Suite manifest is missing id or skills: ${manifestPath}`);
    }
    suites.push({
      ...manifest,
      manifestPath,
      selectorNames: uniqueStrings([manifest.id, manifest.id.split("/").at(-1), manifest.name])
    });
  }

  if (skills.length === 0) {
    skills.push(...(await discoverMarkdownSkills(sourceRoot)));
  }

  return {
    sourceRoot,
    skills: sortById(skills),
    suites: sortById(suites)
  };
}

export function selectDiscoveredRequest(discovered, options = {}) {
  const suiteSelector = options.suite;
  const skillSelector = options.skill;

  if (suiteSelector && skillSelector) {
    throw new CliUsageError("Use only one of --suite or --skill for a Git source.");
  }

  if (suiteSelector) {
    const suite = findCandidate(discovered.suites, suiteSelector, "suite");
    const skills = suite.skills.map((skillId) =>
      findCandidate(discovered.skills, skillId, "skill")
    );
    return {
      request: suiteSelector,
      targetType: "suite",
      suite,
      skills
    };
  }

  if (skillSelector) {
    const skill = findCandidate(discovered.skills, skillSelector, "skill");
    return {
      request: skillSelector,
      targetType: "skill",
      suite: null,
      skills: [skill]
    };
  }

  if (discovered.suites.length === 1) {
    const [suite] = discovered.suites;
    return {
      request: suite.id,
      targetType: "suite",
      suite,
      skills: suite.skills.map((skillId) =>
        findCandidate(discovered.skills, skillId, "skill")
      )
    };
  }

  if (discovered.skills.length === 1) {
    const [skill] = discovered.skills;
    return {
      request: skill.id,
      targetType: "skill",
      suite: null,
      skills: [skill]
    };
  }

  throw new CliUsageError(
    "Git source contains multiple Suites or Skills. Choose one with --suite <id> or --skill <id>."
  );
}

async function discoverMarkdownSkills(sourceRoot) {
  const markdownFiles = await findFiles(sourceRoot, (filePath, entry) => {
    return entry.isFile() && entry.name === "SKILL.md";
  });

  return Promise.all(
    markdownFiles.map(async (manifestPath) => {
      const metadata = await readSkillMarkdownMetadata(manifestPath);
      const directoryName = path.basename(path.dirname(manifestPath));
      const name = metadata.name ?? directoryName;
      const id = `external/${slugify(name)}`;
      return {
        schema: "skill/v1",
        id,
        version: "0.0.0",
        name,
        description: metadata.description,
        entry: "SKILL.md",
        resources: await buildResourceList(path.dirname(manifestPath)),
        manifestPath,
        directoryName,
        selectorNames: uniqueStrings([id, name, directoryName])
      };
    })
  );
}

async function readSkillMarkdownMetadata(filePath) {
  const content = await fs.readFile(filePath, "utf8");
  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    throw new CliUsageError(`Skill Markdown is missing frontmatter: ${filePath}`);
  }

  const metadata = {};
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (line === "---") {
      break;
    }
    if (!line || line.startsWith("#")) {
      continue;
    }
    const separator = line.indexOf(":");
    if (separator === -1) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    metadata[key] = stripQuotes(value);
  }

  if (!metadata.name || !metadata.description) {
    throw new CliUsageError(`Skill Markdown frontmatter needs name and description: ${filePath}`);
  }
  return metadata;
}

async function buildResourceList(skillRoot) {
  const files = await findFiles(skillRoot, (filePath, entry) => {
    return entry.isFile() && !entry.name.startsWith(".");
  });
  return files
    .map((filePath) => path.relative(skillRoot, filePath).split(path.sep).join("/"))
    .sort();
}

async function findFiles(rootDir, predicate, depth = 0) {
  if (depth > 12) {
    return [];
  }

  let entries;
  try {
    entries = await fs.readdir(rootDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.name === ".git" || entry.name === "node_modules" || entry.name.startsWith(".")) {
      continue;
    }
    const filePath = path.join(rootDir, entry.name);
    if (predicate(filePath, entry)) {
      files.push(filePath);
    }
    if (entry.isDirectory()) {
      files.push(...(await findFiles(filePath, predicate, depth + 1)));
    }
  }
  return files;
}

function findCandidate(candidates, selector, type) {
  const matches = candidates.filter((candidate) =>
    candidate.selectorNames?.includes(selector) || candidate.id === selector
  );
  if (matches.length === 1) {
    return matches[0];
  }
  if (matches.length > 1) {
    throw new CliUsageError(`Git source selector is ambiguous for ${type}: ${selector}`);
  }
  throw new CliUsageError(`Git source does not contain ${type}: ${selector}`);
}

function sortById(items) {
  return [...items].sort((left, right) => left.id.localeCompare(right.id));
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim()))];
}

function slugify(value) {
  const slug = String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "skill";
}

function stripQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
