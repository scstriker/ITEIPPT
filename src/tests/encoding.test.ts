// AC-033: no mojibake in front-end source files (user-visible text lives here).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const SKIP_DIRS = new Set(['node_modules', 'dist', 'tests', 'e2e', 'public', 'test-results', 'playwright-report']);
const EXTENSIONS = ['.ts', '.tsx', '.css', '.html'];
// U+FFFD and character runs produced when UTF-8 Chinese is decoded as GBK.
const MOJIBAKE = /�|锛|鈥|銆|鏂囨|涓€|璇存|缁撴|鍐呭/;

function listFiles(dir: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(name)) {
        files.push(...listFiles(full));
      }
    } else if (EXTENSIONS.some((ext) => name.endsWith(ext))) {
      files.push(full);
    }
  }
  return files;
}

describe('source encoding', () => {
  it('has no mojibake', () => {
    const offenders: string[] = [];
    for (const file of listFiles(ROOT)) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, index) => {
        if (MOJIBAKE.test(line)) {
          offenders.push(`${relative(ROOT, file)}:${index + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
