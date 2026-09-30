import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { validateRegistryManifests } from "../src/lib/manifest.js";

test("validates registry, domain, suite, skill metadata, and resources", async () => {
  const rootDir = await createRegistryFixture();

  assert.deepEqual(validateRegistryManifests(rootDir), {
    domains: 1,
    suites: 1,
    skills: 1,
    resources: 1
  });
});

test("rejects skill manifests without a description", async () => {
  const rootDir = await createRegistryFixture({
    skillManifest: [
      "schema: skill/v1",
      "id: demo-domain/demo-skill",
      "version: 1.0.0",
      "name: Demo Skill",
      "entry: SKILL.md",
      "compatibility:",
      "  agents:",
      "    - codex",
      "resources:",
      "  - SKILL.md",
      ""
    ].join("\n")
  });

  assert.throws(
    () => validateRegistryManifests(rootDir),
    /Manifest is missing skill description/
  );
});

test("rejects unsupported compatible agents", async () => {
  const rootDir = await createRegistryFixture({
    skillManifest: [
      "schema: skill/v1",
      "id: demo-domain/demo-skill",
      "version: 1.0.0",
      "name: Demo Skill",
      "description: A valid demo skill.",
      "entry: SKILL.md",
      "compatibility:",
      "  agents:",
      "    - cursor",
      "resources:",
      "  - SKILL.md",
      ""
    ].join("\n")
  });

  assert.throws(
    () => validateRegistryManifests(rootDir),
    /Unsupported compatible agent/
  );
});

test("rejects skill resources that omit the entry file", async () => {
  const rootDir = await createRegistryFixture({
    skillManifest: [
      "schema: skill/v1",
      "id: demo-domain/demo-skill",
      "version: 1.0.0",
      "name: Demo Skill",
      "description: A valid demo skill.",
      "entry: SKILL.md",
      "compatibility:",
      "  agents:",
      "    - codex",
      "resources:",
      "  - references/**",
      ""
    ].join("\n")
  });

  assert.throws(
    () => validateRegistryManifests(rootDir),
    /Skill resources must include entry SKILL.md/
  );
});

async function createRegistryFixture(options = {}) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "skills-registry-validation-"));
  const domainRoot = path.join(rootDir, "domains", "demo-domain");
  const skillRoot = path.join(domainRoot, "skills", "demo-skill");

  await fs.mkdir(path.join(domainRoot, "suites"), { recursive: true });
  await fs.mkdir(skillRoot, { recursive: true });

  await fs.writeFile(
    path.join(rootDir, "registry.yaml"),
    ["schema: registry/v1", "domains:", "  - demo-domain", ""].join("\n"),
    "utf8"
  );
  await fs.writeFile(
    path.join(domainRoot, "domain.yaml"),
    [
      "schema: domain/v1",
      "id: demo-domain",
      "name: Demo Domain",
      "description: Demo domain for validation tests.",
      ""
    ].join("\n"),
    "utf8"
  );
  await fs.writeFile(
    path.join(domainRoot, "suites", "demo-suite.yaml"),
    [
      "schema: suite/v1",
      "id: demo-domain/demo-suite",
      "version: 1.0.0",
      "name: Demo Suite",
      "description: Demo suite for validation tests.",
      "skills:",
      "  - demo-domain/demo-skill",
      ""
    ].join("\n"),
    "utf8"
  );
  await fs.writeFile(
    path.join(skillRoot, "skill.yaml"),
    options.skillManifest ?? defaultSkillManifest(),
    "utf8"
  );
  await fs.writeFile(path.join(skillRoot, "SKILL.md"), "# Demo\n", "utf8");

  if (options.references !== false) {
    await fs.mkdir(path.join(skillRoot, "references"), { recursive: true });
    await fs.writeFile(path.join(skillRoot, "references", "note.md"), "note\n", "utf8");
  }

  return rootDir;
}

function defaultSkillManifest() {
  return [
    "schema: skill/v1",
    "id: demo-domain/demo-skill",
    "version: 1.0.0",
    "name: Demo Skill",
    "description: A valid demo skill.",
    "entry: SKILL.md",
    "compatibility:",
    "  agents:",
    "    - codex",
    "resources:",
    "  - SKILL.md",
    ""
  ].join("\n");
}
