import { CARD_DB } from '../src/cards';
import { loadRegistry } from '../src/engine/registry';
export { checkDeck, createGame, legalActions, step } from '../src/engine/engine';
export const loadRegistryFor = () => loadRegistry(CARD_DB);
