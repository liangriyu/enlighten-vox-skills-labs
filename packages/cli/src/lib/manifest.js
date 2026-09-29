import fs from "node:fs";

export function readManifest(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  return parseYamlSubset(content);
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
