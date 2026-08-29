import { describe, expect, it } from 'vitest';
import { drawCards, placeIngredients, placeNoIngredients, placeOrder, GameError } from './engine';
import { makeIngredientCard, makeMammaMiaCard } from './cards';
import { zeroIngredientRecord } from './ingredients';
import type { GameState, Player } from './types';

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: 'p1',
    name: 'Alberto',
    color: 'green',
    hand: [],
    waiter: [],
    handOrders: [],
    delivered: [],
    hasMammaMia: false,
    isBot: false,
    ...overrides,
  };
}

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    players: [makePlayer(), makePlayer({ id: 'p2', name: 'Bianca', color: 'red' })],
    currentPlayerIndex: 0,
    supply: [],
    oven: [],
    round: 1,
    maxRounds: 3,
    phase: { name: 'turn', step: 'ingredients' },
    log: [],
    nextLogId: 0,
    hasPlayedIngredientThisTurn: false,
    ovenIngredientTally: zeroIngredientRecord(),
    ...overrides,
  };
}

describe('placeIngredients', () => {
  it('moves same-kind ingredient cards from hand to the oven and advances to the order step', () => {
    const salami = [makeIngredientCard('salami'), makeIngredientCard('salami')];
    const state = makeState({
      players: [makePlayer({ hand: salami }), makePlayer({ id: 'p2' })],
    });
    const next = placeIngredients(state, salami.map((c) => c.id));
    expect(next.players[0].hand).toHaveLength(0);
    expect(next.oven).toHaveLength(2);
    expect(next.phase).toEqual({ name: 'turn', step: 'order' });
  });

  it('rejects mixed ingredient kinds in a single placement', () => {
    const cards = [makeIngredientCard('salami'), makeIngredientCard('olive')];
    const state = makeState({ players: [makePlayer({ hand: cards }), makePlayer({ id: 'p2' })] });
    expect(() => placeIngredients(state, cards.map((c) => c.id))).toThrow(GameError);
  });

  it('requires at least one card', () => {
    const state = makeState();
    expect(() => placeIngredients(state, [])).toThrow(GameError);
  });
});

describe('placeNoIngredients', () => {
  it('is rejected when the player still has ingredient cards', () => {
    const state = makeState({
      players: [makePlayer({ hand: [makeIngredientCard('olive')] }), makePlayer({ id: 'p2' })],
    });
    expect(() => placeNoIngredients(state)).toThrow(GameError);
  });

  it('skips straight to the draw step when hand has no ingredient cards', () => {
    const state = makeState({ players: [makePlayer({ hand: [] }), makePlayer({ id: 'p2' })] });
    const next = placeNoIngredients(state);
    expect(next.phase).toEqual({ name: 'turn', step: 'draw' });
  });
});

describe('placeOrder', () => {
  it('is optional and can be skipped', () => {
    const state = makeState({ phase: { name: 'turn', step: 'order' } });
    const next = placeOrder(state, null);
    expect(next.phase).toEqual({ name: 'turn', step: 'draw' });
    expect(next.oven).toHaveLength(0);
  });
});

describe('drawCards', () => {
  it('draws only from the chosen pile, never mixing supply and waiter', () => {
    const state = makeState({
      phase: { name: 'turn', step: 'draw' },
      supply: [makeIngredientCard('salami'), makeIngredientCard('olive')],
      players: [
        makePlayer({
          hand: [],
          handOrders: [],
          waiter: [
            { id: 'o1', kind: 'order', color: 'green', name: 'X', requirement: { kind: 'bombastica' } },
            { id: 'o2', kind: 'order', color: 'green', name: 'Y', requirement: { kind: 'bombastica' } },
            { id: 'o3', kind: 'order', color: 'green', name: 'Z', requirement: { kind: 'bombastica' } },
          ],
        }),
        makePlayer({ id: 'p2' }),
      ],
    });

    const next = drawCards(state, 'supply');
    expect(next.players[0].hand).toHaveLength(2); // only what the supply had, no waiter mixing
    expect(next.players[0].waiter).toHaveLength(3); // untouched
    expect(next.supply).toHaveLength(0);
  });

  it('takes fewer than 7 cards if the chosen pile runs out, without touching the other pile', () => {
    const state = makeState({
      phase: { name: 'turn', step: 'draw' },
      supply: [makeIngredientCard('salami')],
      players: [makePlayer({ hand: [], waiter: [] }), makePlayer({ id: 'p2' })],
    });
    const next = drawCards(state, 'supply');
    expect(next.players[0].hand).toHaveLength(1);
  });

  it('sets aside the Mamma Mia! card and draws a replacement instead of counting it toward the hand', () => {
    const state = makeState({
      phase: { name: 'turn', step: 'draw' },
      supply: [makeMammaMiaCard(), makeIngredientCard('salami'), makeIngredientCard('olive')],
      players: [makePlayer({ hand: [] }), makePlayer({ id: 'p2' })],
    });
    const next = drawCards(state, 'supply');
    expect(next.players[0].hasMammaMia).toBe(true);
    expect(next.players[0].hand.every((c) => c.kind === 'ingredient')).toBe(true);
    expect(next.players[0].hand).toHaveLength(2);
  });

  it('ends the round the moment the supply is drawn empty', () => {
    const state = makeState({
      phase: { name: 'turn', step: 'draw' },
      supply: [makeIngredientCard('salami')],
      players: [makePlayer({ hand: [] }), makePlayer({ id: 'p2' })],
    });
    const next = drawCards(state, 'supply');
    expect(next.phase).toEqual({ name: 'roundEnd' });
  });

  it('advances to the next player via a passDevice screen when the round continues', () => {
    const state = makeState({
      phase: { name: 'turn', step: 'draw' },
      supply: Array.from({ length: 8 }, () => makeIngredientCard('salami')),
      players: [makePlayer({ hand: [] }), makePlayer({ id: 'p2' })],
    });
    const next = drawCards(state, 'supply');
    expect(next.players[0].hand).toHaveLength(7);
    expect(next.supply).toHaveLength(1);
    expect(next.phase).toEqual({ name: 'passDevice', nextPlayerIndex: 1 });
  });
});
