// カード種類(面の type)の表示名。カード表示・詳細・演出で共通。
import type { FaceType } from '../engine/types';

const LABEL: Record<FaceType, string> = {
  creature: 'クリーチャー',
  spell: '呪文',
  evolution: '進化',
  smaxEvolution: 'S-MAX進化',
  tamaseed: 'タマシード',
  field: 'フィールド',
  crossgear: 'クロスギア',
};

export const faceTypeLabel = (t: FaceType): string => LABEL[t];
