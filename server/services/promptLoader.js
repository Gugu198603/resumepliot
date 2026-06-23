import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const promptDir = path.resolve(__dirname, '../prompts');

export async function loadPrompt(name, fallback) {
  try {
    return await fs.readFile(path.join(promptDir, `${name}.txt`), 'utf8');
  } catch {
    return fallback;
  }
}
