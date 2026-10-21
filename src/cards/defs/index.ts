// 25の王道(DM26-SD1)の新規カード(デッキごと)。docs/decks-25oudou.md
import type { CardDef } from '../../engine/types';
import { DECK_C } from './deckC';
import { DECK_D } from './deckD';
import { DECK_E } from './deckE';

export const SD1_CARDS: CardDef[] = [...DECK_C, ...DECK_D, ...DECK_E];
