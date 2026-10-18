import { describe, expect, it } from 'vitest';
import { GLOSSARY, type GlossaryKey, glossaryText } from './glossary';

const terms = { staff: 'シッター', client: 'お客様' };

describe('glossary', () => {
  it('どの用語も名前と短い説明（その場で読める長さ）がある', () => {
    for (const [k, e] of Object.entries(GLOSSARY)) {
      expect(e.label.length, k).toBeGreaterThan(0);
      expect(e.text.length, k).toBeGreaterThan(10);
      expect(e.text.length, k).toBeLessThanOrEqual(90);
    }
  });
  it('言い換え：拘束は「出勤〜退勤（拘束）」、待ちは「空き時間（待ち）」（元の言葉を括弧に残す）', () => {
    expect(GLOSSARY.span.label).toBe('出勤〜退勤（拘束）');
    expect(GLOSSARY.wait.label).toBe('空き時間（待ち）');
  });
  it('説明の〈staff〉〈client〉を事業所の呼び方に置き換える', () => {
    for (const k of Object.keys(GLOSSARY) as GlossaryKey[]) {
      const t = glossaryText(k, terms);
      expect(t).not.toContain('〈staff〉');
      expect(t).not.toContain('〈client〉');
    }
    expect(glossaryText('dropped', terms)).toContain('どのシッターの予定にも');
    expect(glossaryText('terms', terms)).toContain('シッター・お客様');
  });
});
