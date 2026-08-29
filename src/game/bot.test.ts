import { describe, expect, it } from 'vitest';
import {
  chooseDrawSource,
  chooseHandTopUp,
  chooseIngredientsToPlay,
  chooseJokerIngredient,
  chooseMinimaleTieBreak,
  choosePlaceOrder,
} from './bot';
import { makeIngredientCard } from './cards';
import { zeroIngredientRecord } from './ingredients';
import type { GameState, OrderCard, Player } from './types';

function order(requirement: OrderCard['requirement']): OrderCard {
  return { id: 'order-1', kind: 'order', color: 'green', name: 'Test', requirement };
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
    isBot: true,
    ...overrides,
  };
}

function makeState(tally: Partial<Record<string, number>> = {}): GameState {
  return {
    players: [],
    currentPlayerIndex: 0,
    supply: [],
    oven: [],
    round: 1,
    maxRounds: 3,
    phase: { name: 'turn', step: 'order' },
    log: [],
    nextLogId: 0,
    hasPlayedIngredientThisTurn: false,
    ovenIngredientTally: { ...zeroIngredientRecord(), ...tally },
  };
}

describe('chooseIngredientsToPlay', () => {
  it('returns null when hand has no ingredient cards', () => {
    expect(chooseIngredientsToPlay(makePlayer({ hand: [] }))).toBeNull();
  });

  it('plays the largest same-kind group', () => {
    const hand = [
      makeIngredientCard('salami'),
      makeIngredientCard('olive'),
      makeIngredientCard('olive'),
      makeIngredientCard('olive'),
    ];
    const ids = chooseIngredientsToPlay(makePlayer({ hand }));
    expect(ids).toHaveLength(3);
  });
});

describe('choosePlaceOrder — uses the exact public oven tally, not a blind count', () => {
  it('holds a normal order until every required ingredient is actually present in the tally', () => {
    const player = makePlayer({ handOrders: [order({ kind: 'normal', requirements: { pepper: 1, salami: 4 } })] });
    const notYet = makeState({ pepper: 1, salami: 3 }); // salami short by 1
    expect(choosePlaceOrder(notYet, player)).toBeNull();

    const ready = makeState({ pepper: 1, salami: 4 });
    expect(choosePlaceOrder(ready, player)).toBe('order-1');
  });

  it('plays Bombastica only once the tally totals 15+, regardless of a single kind dominating', () => {
    const player = makePlayer({ handOrders: [order({ kind: 'bombastica' })] });
    expect(choosePlaceOrder(makeState({ salami: 14 }), player)).toBeNull();
    expect(choosePlaceOrder(makeState({ salami: 10, olive: 5 }), player)).toBe('order-1');
  });

  it('requires the personal ingredient plus enough of some other kind for Monotoni', () => {
    const player = makePlayer({ handOrders: [order({ kind: 'monotoni', jokerCount: 6 })] }); // green's personal is pepper
    expect(choosePlaceOrder(makeState({ pepper: 0, salami: 6 }), player)).toBeNull(); // missing personal
    expect(choosePlaceOrder(makeState({ pepper: 1, salami: 5 }), player)).toBeNull(); // joker candidate short
    expect(choosePlaceOrder(makeState({ pepper: 1, salami: 6 }), player)).toBe('order-1');
  });

  it('requires the personal ingredient plus enough of the rarest-eligible kind for Minimale', () => {
    const player = makePlayer({ handOrders: [order({ kind: 'minimale', otherCount: 3 })] });
    expect(choosePlaceOrder(makeState({ pepper: 1, olive: 2 }), player)).toBeNull();
    expect(choosePlaceOrder(makeState({ pepper: 1, olive: 3 }), player)).toBe('order-1');
  });

  it('returns null when there is no held order card', () => {
    expect(choosePlaceOrder(makeState(), makePlayer({ handOrders: [] }))).toBeNull();
  });
});

describe('chooseDrawSource', () => {
  it('refreshes the order hand from the waiter once it is empty', () => {
    expect(chooseDrawSource(makePlayer({ handOrders: [], waiter: [order({ kind: 'bombastica' })] }))).toBe('waiter');
  });

  it('otherwise draws ingredients from the supply', () => {
    expect(chooseDrawSource(makePlayer({ handOrders: [order({ kind: 'bombastica' })] }))).toBe('supply');
  });
});

describe('chooseJokerIngredient / chooseMinimaleTieBreak', () => {
  it('picks the most plentiful non-personal ingredient as the joker', () => {
    const table = {
      salami: [],
      pineapple: [],
      mushroom: [],
      pepper: [],
      olive: [makeIngredientCard('olive'), makeIngredientCard('olive')],
    };
    expect(chooseJokerIngredient(table, 'pepper')).toBe('olive');
  });

  it('takes the first tied candidate for Minimale', () => {
    expect(chooseMinimaleTieBreak(['salami', 'olive'])).toBe('salami');
  });
});

describe('chooseHandTopUp', () => {
  it('returns null when the hand cannot cover the shortfall', () => {
    const owner = makePlayer({ hand: [makeIngredientCard('salami')] });
    expect(chooseHandTopUp(owner, { salami: 2 })).toBeNull();
  });

  it('picks exactly the cards needed to cover the shortfall', () => {
    const salami = [makeIngredientCard('salami'), makeIngredientCard('salami')];
    const owner = makePlayer({ hand: [...salami, makeIngredientCard('olive')] });
    const ids = chooseHandTopUp(owner, { salami: 2 });
    expect(ids).toHaveLength(2);
    expect(ids).toEqual(expect.arrayContaining(salami.map((c) => c.id)));
  });
});
