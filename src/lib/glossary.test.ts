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
    expect(GLOSSARY.confirmed.label).toBe('確定（伝えた）');
    expect(glossaryText('confirmed', terms)).toContain('シッターに伝えた内容');
    expect(GLOSSARY.confirmed.text).toContain('未連絡の変更');
    expect(GLOSSARY.pinned.label).toBe('ピン');
    expect(GLOSSARY.pinned.text).toContain('担当は変わりません');
    expect(GLOSSARY.unconfirmed.label).toBe('未確定');
    expect(GLOSSARY.confirmDiff.label).toBe('未連絡の変更あり');
    expect(GLOSSARY.proposal.label).toBe('提案（AI）');
    expect(GLOSSARY.preset.label).toBe('プリセット');
    expect(GLOSSARY.attention.label).toBe('要対応');
  });
  it('画面の文はふつうの言葉（PRD D307）：点数の付け方は「点数」の説明に寄せ、内部の言葉を使わない', () => {
    expect(GLOSSARY.score.label).toBe('点数');
    expect(GLOSSARY.score.text).toContain('100点満点');
    expect(GLOSSARY.hard.label).toBe('守れない条件');
    for (const [k, e] of Object.entries(GLOSSARY)) {
      for (const w of [
        '費用',
        '内訳',
        '稼働時間',
        '必須の違反',
        'プリセット「',
        '試す重み',
        '展開',
        'inputKey',
        '固定',
        '記録',
      ]) {
        expect(e.text, `${k}：${w}`).not.toContain(w);
      }
      // 括弧の中に括弧を重ねない
      expect(e.text, k).not.toMatch(/（[^）]*（/);
    }
  });
  it('説明は「です・ます」で終わる', () => {
    for (const [k, e] of Object.entries(GLOSSARY)) expect(e.text, k).toMatch(/(です|ます|ません)(（[^）]*）)?。$/);
  });
});
