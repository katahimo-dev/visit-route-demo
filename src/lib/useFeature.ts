// 機能の入り切り（ADR-0028）を画面から読むフック。store の org.features を読むだけ（書くのは画面の update(fn)）
import type { FeatureId, Features } from '../contracts/features';
import { useDemoData } from '../store';
import { isOn } from './features';

/** 今の入り切り（無い ID は入） */
export function useFeatures(): Features {
  return useDemoData().data.org.features;
}

/** その機能が使えるか（依存も見る。lib/features の isOn） */
export function useFeature(id: FeatureId): boolean {
  return isOn(useFeatures(), id);
}
