import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CliUsageError } from "./errors.js";

export async function resolveProjectScope(options, io = {}) {
  const scope = options.scope ?? "global";
  if (scope !== "project") {
    return null;
  }

  const cwd = io.cwd ?? process.cwd();
  const projectDirInput = options.projectDir ?? cwd;

  const projectDir = resolveExistingDirectory(projectDirInput, cwd);
  return {
    projectDir,
    projectId: makeProjectId(projectDir)
  };
}

export function resolveExistingDirectory(input, cwd = process.cwd()) {
  if (!input || !input.trim()) {
    throw new CliUsageError("Project directory cannot be empty.");
  }

  const absolutePath = path.resolve(cwd, input);
  if (!fs.existsSync(absolutePath)) {
    throw new CliUsageError(`Project directory does not exist: ${absolutePath}`);
  }

  const stat = fs.statSync(absolutePath);
  if (!stat.isDirectory()) {
    throw new CliUsageError(`Project path is not a directory: ${absolutePath}`);
  }

  return fs.realpathSync(absolutePath);
}

export function makeProjectId(projectDir) {
  const digest = crypto.createHash("sha256").update(projectDir).digest("hex").slice(0, 12);
  return `project-${digest}`;
}
