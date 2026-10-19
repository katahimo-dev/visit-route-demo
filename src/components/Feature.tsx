import type { ReactNode } from 'react';
import type { FeatureId } from '../contracts/features';
import { useFeature } from '../lib/useFeature';

/** 機能の入口を囲む（ADR-0028）。その機能が切なら何も出さない（データは消さない） */
export function Feature({ id, children }: { id: FeatureId; children: ReactNode }) {
  return useFeature(id) ? children : null;
}
