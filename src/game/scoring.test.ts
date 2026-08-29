import { describe, expect, it } from 'vitest';
import {
  chooseJoker,
  chooseMinimaleIngredient,
  finalizeRound,
  resolveHandTopUp,
  revealNext,
  startRoundEnd,
} from './scoring';
import { GameError } from './engine';
import { makeIngredientCard } from './cards';
import { zeroIngredientRecord } from './ingredients';
import type { GameState, OrderCard, Player } from './types';

function order(color: Player['color'], requirement: OrderCard['requirement'], name = 'Test'): OrderCard {
  return { id: `order-${Math.random()}`, kind: 'order', color, name, requirement };
}

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
    players: [makePlayer({ hasMammaMia: true }), makePlayer({ id: 'p2', name: 'Bianca', color: 'red' })],
    currentPlayerIndex: 0,
    supply: [],
    oven: [],
    round: 1,
    maxRounds: 3,
    phase: { name: 'roundEnd' },
    log: [],
    nextLogId: 0,
    hasPlayedIngredientThisTurn: false,
    ovenIngredientTally: zeroIngredientRecord(),
    ...overrides,
  };
}

describe('round-end oven reveal', () => {
  it('sorts ingredient cards face up by kind as they are revealed', () => {
    const oven = [makeIngredientCard('salami'), makeIngredientCard('salami'), makeIngredientCard('olive')];
    let state = startRoundEnd(makeState({ oven }));
    state = revealNext(state);
    state = revealNext(state);
    state = revealNext(state);
    expect(state.roundEnd!.sortedIngredients.salami).toHaveLength(2);
    expect(state.roundEnd!.sortedIngredients.olive).toHaveLength(1);
  });

  it('auto-delivers a normal order when the table already has enough ingredients', () => {
    // Oven array is in original placement order (index 0 = placed first).
    // Reveal replays that same order (the Mamma Mia player flips the whole
    // stack as one motion before dealing, which inverts physical top/bottom
    // back to placement order) — so cards placed before the order card are
    // revealed, and therefore already sorted, before the order card itself.
    const oven = [
      makeIngredientCard('pepper'),
      makeIngredientCard('pepper'),
      makeIngredientCard('pepper'),
      order('green', { kind: 'normal', requirements: { pepper: 3 } }),
    ];
    let state = startRoundEnd(makeState({ oven }));
    state = revealNext(state); // pepper
    state = revealNext(state); // pepper
    state = revealNext(state); // pepper
    state = revealNext(state); // order -> auto fulfilled
    expect(state.players[0].delivered).toHaveLength(1);
    expect(state.roundEnd!.sortedIngredients.pepper).toHaveLength(0);
  });

  it('pauses for a hand top-up when the table is short, and fails the order if the player gives up', () => {
    const oven = [makeIngredientCard('pepper'), order('green', { kind: 'normal', requirements: { pepper: 3 } })];
    let state = startRoundEnd(makeState({ oven }));
    state = revealNext(state);
    state = revealNext(state);
    expect(state.roundEnd!.pending).toMatchObject({ type: 'awaitingHandTopUp', shortfall: { pepper: 2 } });

    const failed = resolveHandTopUp(state, null);
    expect(failed.players[0].waiter).toHaveLength(1);
    expect(failed.players[0].delivered).toHaveLength(0);
    expect(failed.roundEnd!.pending).toBeNull();
  });

  it('delivers a normal order after topping up the exact shortfall from hand', () => {
    const extraPepper = makeIngredientCard('pepper');
    const oven = [makeIngredientCard('pepper'), order('green', { kind: 'normal', requirements: { pepper: 2 } })];
    let state = startRoundEnd(
      makeState({ oven, players: [makePlayer({ hasMammaMia: true, hand: [extraPepper] }), makePlayer({ id: 'p2' })] }),
    );
    state = revealNext(state);
    state = revealNext(state);
    state = resolveHandTopUp(state, [extraPepper.id]);
    expect(state.players[0].delivered).toHaveLength(1);
    expect(state.players[0].hand).toHaveLength(0);
    expect(state.roundEnd!.usedIngredients).toHaveLength(2);
  });

  it('rejects a hand top-up that does not exactly match the shortfall', () => {
    const wrongKind = makeIngredientCard('olive');
    const oven = [makeIngredientCard('pepper'), order('green', { kind: 'normal', requirements: { pepper: 2 } })];
    let state = startRoundEnd(
      makeState({ oven, players: [makePlayer({ hasMammaMia: true, hand: [wrongKind] }), makePlayer({ id: 'p2' })] }),
    );
    state = revealNext(state);
    state = revealNext(state);
    expect(() => resolveHandTopUp(state, [wrongKind.id])).toThrow(GameError);
  });
});

describe('Pizza Bombastica', () => {
  it('takes ALL sorted ingredients (leaving the oven empty) once 15+ are face up', () => {
    const oven = [
      ...Array.from({ length: 10 }, () => makeIngredientCard('salami')),
      ...Array.from({ length: 8 }, () => makeIngredientCard('olive')),
      order('green', { kind: 'bombastica' }),
    ];
    let state = startRoundEnd(makeState({ oven }));
    for (let i = 0; i < 18; i += 1) state = revealNext(state);
    state = revealNext(state); // the order card
    expect(state.players[0].delivered).toHaveLength(1);
    expect(state.roundEnd!.sortedIngredients.salami).toHaveLength(0);
    expect(state.roundEnd!.sortedIngredients.olive).toHaveLength(0);
    expect(state.roundEnd!.usedIngredients).toHaveLength(18);
  });

  it('fails outright with no hand top-up option when fewer than 15 are face up', () => {
    const owner = 'green';
    const oven = [...Array.from({ length: 10 }, () => makeIngredientCard('salami')), order(owner, { kind: 'bombastica' })];
    let state = startRoundEnd(
      makeState({ oven, players: [makePlayer({ hasMammaMia: true, hand: [makeIngredientCard('olive')] }), makePlayer({ id: 'p2', color: 'red' })] }),
    );
    for (let i = 0; i < 10; i += 1) state = revealNext(state);
    state = revealNext(state); // the order card: <15 on the table, no pending decision is offered
    expect(state.roundEnd!.pending).toBeNull();
    expect(state.players[0].delivered).toHaveLength(0);
    expect(state.players[0].waiter).toHaveLength(1);
    expect(state.players[0].hand).toHaveLength(1); // untouched — no hand cards were ever eligible to be spent
  });
});

describe('Pizza Monotoni (joker)', () => {
  it('forbids choosing the personal ingredient as the joker', () => {
    const oven = [makeIngredientCard('pepper'), order('green', { kind: 'monotoni', jokerCount: 6 })];
    let state = startRoundEnd(makeState({ oven }));
    state = revealNext(state);
    state = revealNext(state);
    expect(state.roundEnd!.pending?.type).toBe('awaitingJokerChoice');
    expect(() => chooseJoker(state, 'pepper')).toThrow(GameError); // green's personal ingredient
  });

  it('requires 1 personal + N of the chosen joker ingredient', () => {
    const oven = [
      makeIngredientCard('pepper'),
      ...Array.from({ length: 6 }, () => makeIngredientCard('olive')),
      order('green', { kind: 'monotoni', jokerCount: 6 }),
    ];
    let state = startRoundEnd(makeState({ oven }));
    for (let i = 0; i < 7; i += 1) state = revealNext(state);
    state = revealNext(state);
    state = chooseJoker(state, 'olive');
    expect(state.players[0].delivered).toHaveLength(1);
  });
});

describe('Pizza Minimale', () => {
  it('auto-selects the rarest non-personal ingredient when there is no tie', () => {
    const oven = [
      makeIngredientCard('pepper'), // personal for green
      makeIngredientCard('olive'),
      makeIngredientCard('salami'),
      makeIngredientCard('salami'),
      makeIngredientCard('salami'),
      order('green', { kind: 'minimale', otherCount: 3 }, 'Minimale'),
    ];
    let state = startRoundEnd(makeState({ oven }));
    for (let i = 0; i < 5; i += 1) state = revealNext(state);
    state = revealNext(state);
    // olive (1 card) is rarer than salami (3 cards) -> needs 3 olive, only 1 present -> top-up pending
    expect(state.roundEnd!.pending).toMatchObject({ type: 'awaitingHandTopUp', shortfall: { olive: 2 } });
  });

  it('excludes the personal ingredient and zero-count ingredients from candidates, and asks the owner on ties', () => {
    const oven = [
      makeIngredientCard('pepper'), // personal, excluded
      makeIngredientCard('olive'),
      makeIngredientCard('salami'),
      order('green', { kind: 'minimale', otherCount: 3 }, 'Minimale'),
    ];
    let state = startRoundEnd(makeState({ oven }));
    for (let i = 0; i < 3; i += 1) state = revealNext(state);
    state = revealNext(state);
    expect(state.roundEnd!.pending).toMatchObject({
      type: 'awaitingMinimaleChoice',
      candidates: expect.arrayContaining(['olive', 'salami']),
    });
    state = chooseMinimaleIngredient(state, 'olive');
    expect(state.roundEnd!.pending).toMatchObject({ shortfall: { olive: 2 } });
  });

  it('rejects choosing the personal ingredient or an unavailable ingredient', () => {
    const oven = [makeIngredientCard('olive'), makeIngredientCard('salami'), order('green', { kind: 'minimale', otherCount: 3 })];
    let state = startRoundEnd(makeState({ oven }));
    state = revealNext(state);
    state = revealNext(state);
    state = revealNext(state);
    expect(() => chooseMinimaleIngredient(state, 'pepper')).toThrow(GameError);
  });
});

describe('finalizeRound', () => {
  it('carries unused ingredients over as next round oven (it is NOT emptied) and reshuffles used ones with Mamma Mia into the new supply', () => {
    const leftover = makeIngredientCard('salami');
    const used = makeIngredientCard('olive');
    let state = makeState({
      round: 1,
      roundEnd: {
        holderId: 'p1',
        queue: [],
        sortedIngredients: { salami: [leftover], pineapple: [], mushroom: [], pepper: [], olive: [] },
        usedIngredients: [used],
        pending: null,
        lastRevealed: null,
      },
    });
    state = finalizeRound(state, { random: () => 0 });
    expect(state.oven).toEqual([leftover]);
    expect(state.supply.some((c) => c.kind === 'mammamia')).toBe(true);
    expect(state.supply.some((c) => c.kind === 'ingredient')).toBe(true);
    expect(state.round).toBe(2);
    expect(state.phase).toEqual({ name: 'passDevice', nextPlayerIndex: 0 });
    expect(state.players.every((p) => !p.hasMammaMia)).toBe(true);
  });

  it('ends the game after the max round, picking the winner by delivered orders then hand size', () => {
    let state = makeState({
      round: 3,
      maxRounds: 3,
      players: [
        makePlayer({ id: 'p1', hasMammaMia: true, delivered: [order('green', { kind: 'bombastica' })], hand: [] }),
        makePlayer({
          id: 'p2',
          delivered: [order('red', { kind: 'bombastica' })],
          hand: [makeIngredientCard('salami')],
        }),
      ],
      roundEnd: {
        holderId: 'p1',
        queue: [],
        sortedIngredients: { salami: [], pineapple: [], mushroom: [], pepper: [], olive: [] },
        usedIngredients: [],
        pending: null,
        lastRevealed: null,
      },
    });
    state = finalizeRound(state, { random: () => 0 });
    expect(state.phase).toEqual({ name: 'gameEnd' });
    expect(state.winnerIds).toEqual(['p2']);
  });
});
