import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const skillsDir = path.resolve(__dirname, '../../skills');

async function readSkill(skillDir) {
  const file = path.join(skillsDir, skillDir, 'SKILL.md');
  const raw = await fs.readFile(file, 'utf8');
  const matchName = raw.match(/name:\s*"([^"]+)"/);
  const matchDesc = raw.match(/description:\s*"([^"]+)"/);
  return {
    id: skillDir,
    name: matchName?.[1] || skillDir,
    description: matchDesc?.[1] || '',
    content: raw
  };
}

export async function loadSkills() {
  const entries = await fs.readdir(skillsDir, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  return await Promise.all(dirs.map(readSkill));
}

export async function getSkillById(id) {
  return await readSkill(id);
}
