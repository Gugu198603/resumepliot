export type SectionBlockKind = 'heading' | 'meta' | 'paragraph';

export interface SectionBlock {
  kind: SectionBlockKind;
  text: string;
}

const TERMINAL_PUNCTUATION_RE = /[。！？；.!?;）)]$/;
const KEY_VALUE_RE = /^[^:：\s]{1,6}[:：]\s*\S+/;
const DATE_RANGE_RE = /(?:19|20)\d{2}(?:[./-]\d{1,2})?\s*[-–—]\s*(?:(?:19|20)\d{2}(?:[./-]\d{1,2})?|至今|Present)/i;

function visibleLength(text = '') {
  return Array.from(text).length;
}

function isShortHeading(line = '') {
  const trimmed = line.trim();
  if (!trimmed || TERMINAL_PUNCTUATION_RE.test(trimmed)) return false;
  if (KEY_VALUE_RE.test(trimmed)) return false;
  if (DATE_RANGE_RE.test(trimmed)) return true;
  return visibleLength(trimmed) <= 28 && /项目|经历|经验|教育|技能|证书|奖项|实习|工作|学校|公司|系统|平台|应用/i.test(trimmed);
}

function classifyLine(line = ''): SectionBlockKind {
  if (KEY_VALUE_RE.test(line)) return 'meta';
  if (isShortHeading(line)) return 'heading';
  return 'paragraph';
}

function shouldMergeWithPrevious(previous: SectionBlock | undefined, line = '') {
  if (!previous) return false;
  if (previous.kind !== 'paragraph') return false;
  if (classifyLine(line) !== 'paragraph') return false;
  return !TERMINAL_PUNCTUATION_RE.test(previous.text);
}

export function buildSectionBlocks(lines: string[] = []): SectionBlock[] {
  const blocks: SectionBlock[] = [];
  for (const raw of lines) {
    const line = String(raw || '').trim();
    if (!line) continue;
    const previous = blocks[blocks.length - 1];
    if (shouldMergeWithPrevious(previous, line)) {
      previous.text += line;
    } else {
      blocks.push({ kind: classifyLine(line), text: line });
    }
  }
  return blocks;
}
