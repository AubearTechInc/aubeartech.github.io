import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assetsDir = path.join(rootDir, "assets");
const distDir = path.join(rootDir, "dist");

const toPosix = (value) => value.split(path.sep).join("/");

async function fileExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function listFiles(dir, baseDir = dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(fullPath, baseDir));
    } else if (entry.isFile()) {
      files.push({
        fullPath,
        relativePath: toPosix(path.relative(baseDir, fullPath))
      });
    }
  }

  return files;
}

function hashedAssetPath(relativePath, buffer) {
  const parsed = path.posix.parse(relativePath);
  const hash = createHash("sha256").update(buffer).digest("hex").slice(0, 12);
  const fileName = `${parsed.name}.${hash}${parsed.ext}`;

  return toPosix(path.posix.join("assets", parsed.dir, fileName));
}

function replaceAssetReferences(source, assetMap) {
  let output = source;

  for (const [from, to] of assetMap) {
    output = output.split(from).join(to);
    output = output.split(`./${from}`).join(`./${to}`);
  }

  return output;
}

async function writeFileEnsuringDir(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
}

async function copyHashedAssets() {
  const assetFiles = await listFiles(assetsDir);
  const assetMap = new Map();

  for (const asset of assetFiles) {
    const buffer = await readFile(asset.fullPath);
    const from = toPosix(path.posix.join("assets", asset.relativePath));
    const to = hashedAssetPath(asset.relativePath, buffer);

    assetMap.set(from, to);
    await writeFileEnsuringDir(path.join(distDir, to), buffer);
  }

  return assetMap;
}

async function copyRootFile(fileName) {
  const sourcePath = path.join(rootDir, fileName);
  if (await fileExists(sourcePath)) {
    await copyFile(sourcePath, path.join(distDir, fileName));
  }
}

async function buildHtml(assetMap) {
  const htmlFiles = (await readdir(rootDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".html"))
    .map((entry) => entry.name);

  for (const fileName of htmlFiles) {
    const sourcePath = path.join(rootDir, fileName);
    const source = await readFile(sourcePath, "utf8");
    const output = replaceAssetReferences(source, assetMap);

    await writeFile(path.join(distDir, fileName), output);

    const referencedAssets = source.match(/assets\/[^"'()\s<>]+/g) ?? [];
    for (const assetPath of referencedAssets) {
      if (!assetMap.has(assetPath)) {
        console.warn(`Warning: ${fileName} references missing asset ${assetPath}`);
      }
    }
  }
}

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

const assetMap = await copyHashedAssets();
await buildHtml(assetMap);
await copyRootFile("CNAME");
await writeFile(path.join(distDir, ".nojekyll"), "");

console.log(`Built ${assetMap.size} hashed assets into dist/`);
