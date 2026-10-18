// 〈利用者さん〉の段階（PRD D73。ADR-0015）：相談受付 → 顔合わせ → 契約 → 利用中 → 終了。
// 段階が正で、予定・AI案の対象（active）と仮押さえ（tentative）は段階から決める。純粋関数（データは書き換えない）
import type { Client, ClientStage } from '../contracts/documents';

export const STAGE_LABELS: Record<ClientStage, string> = {
  inquiry: '相談受付',
  meeting: '顔合わせ',
  contract: '契約',
  active: '利用中',
  ended: '終了',
};

/** 利用中の前の段階（仮押さえできる） */
export const isBeforeActive = (stage: ClientStage): boolean =>
  stage === 'inquiry' || stage === 'meeting' || stage === 'contract';

/**
 * 段階と仮押さえから、active（予定・AI案の対象）と tentative を決める：
 * 利用中＝対象（仮押さえは外す）、終了＝対象でない（仮押さえは外す）、利用中の前＝仮押さえしているときだけ対象
 */
export function stageFlags(stage: ClientStage, tentative: boolean): { active: boolean; tentative: boolean } {
  if (stage === 'active') return { active: true, tentative: false };
  if (stage === 'ended') return { active: false, tentative: false };
  return { active: tentative, tentative };
}

/** 段階を変える（active・tentative も合わせる）。tentative を渡さなければ今の仮押さえのまま */
export function withStage<T extends Pick<Client, 'stage' | 'active' | 'tentative'>>(
  c: T,
  stage: ClientStage,
  tentative: boolean = c.tentative,
): T {
  const f = stageFlags(stage, tentative);
  if (c.stage === stage && c.active === f.active && c.tentative === f.tentative) return c;
  return { ...c, stage, ...f };
}
