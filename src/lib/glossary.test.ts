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
  it('予定の組み方の言葉（PRD D242）：名前と、何に効くか・何が変わらないか', () => {
    expect(GLOSSARY.confirmed.label).toBe('確定');
    expect(glossaryText('confirmed', terms)).toContain('シッターの画面・メール・印刷');
    expect(GLOSSARY.confirmed.text).toContain('変わりません');
    expect(GLOSSARY.pinned.label).toBe('固定');
    expect(GLOSSARY.pinned.text).toContain('担当は変わらず');
    expect(GLOSSARY.unconfirmed.label).toBe('未確定');
    expect(GLOSSARY.confirmDiff.label).toBe('未確定の変更あり');
    expect(GLOSSARY.aiPlan.label).toBe('AI案');
    expect(GLOSSARY.preset.label).toBe('プリセット');
    expect(GLOSSARY.attention.label).toBe('要対応');
    expect(GLOSSARY.stale.label).toBe('条件が変わった');
  });
  it('説明は「です・ます」で終わる', () => {
    for (const [k, e] of Object.entries(GLOSSARY)) expect(e.text, k).toMatch(/(です|ます|ません)(（[^）]*）)?。$/);
  });
});
