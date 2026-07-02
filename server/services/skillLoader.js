import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const skillsDir = path.resolve(__dirname, '../../skills');

async function readSkill(skillDir) {
  const file = path.join(skillsDir, skillDir, 'SKILL.md');
  const manifestFile = path.join(skillsDir, skillDir, 'manifest.json');
  const [raw, manifestRaw] = await Promise.all([
    fs.readFile(file, 'utf8'),
    fs.readFile(manifestFile, 'utf8')
  ]);
  const manifest = validateSkillManifest(JSON.parse(manifestRaw), skillDir);
  return {
    ...manifest,
    manifest,
    content: raw
  };
}

export function validateSkillManifest(manifest, directoryId = manifest?.id) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error(`Skill ${directoryId || 'unknown'} manifest must be an object.`);
  }
  for (const field of ['id', 'name', 'version', 'description']) {
    if (!String(manifest[field] || '').trim()) throw new Error(`Skill ${directoryId} manifest requires ${field}.`);
  }
  if (manifest.id !== directoryId) throw new Error(`Skill manifest id ${manifest.id} does not match directory ${directoryId}.`);
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version)) {
    throw new Error(`Skill ${manifest.id} version must use semantic versioning.`);
  }
  if (!Array.isArray(manifest.triggers) || !manifest.triggers.length) throw new Error(`Skill ${manifest.id} requires triggers.`);
  if (!Array.isArray(manifest.allowedTools)) throw new Error(`Skill ${manifest.id} allowedTools must be an array.`);
  const minConfidence = Number(manifest.routing?.minConfidence);
  if (!Number.isFinite(minConfidence) || minConfidence < 0 || minConfidence > 1) {
    throw new Error(`Skill ${manifest.id} routing.minConfidence must be between 0 and 1.`);
  }
  for (const schemaField of ['inputSchema', 'outputSchema']) {
    if (manifest[schemaField]?.type !== 'object') throw new Error(`Skill ${manifest.id} ${schemaField} must be an object schema.`);
  }
  return Object.freeze({
    ...manifest,
    triggers: [...new Set(manifest.triggers.map((item) => String(item).trim()).filter(Boolean))],
    allowedTools: [...new Set(manifest.allowedTools.map((item) => String(item).trim()).filter(Boolean))]
  });
}

export async function loadSkills() {
  const entries = await fs.readdir(skillsDir, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  return await Promise.all(dirs.map(readSkill));
}

export async function getSkillById(id) {
  return await readSkill(id);
}
