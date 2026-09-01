import { describe, expect, it } from 'vitest';
import {
  chooseDrawSource,
  chooseHandTopUp,
  chooseIngredientsToPlay,
  chooseJokerIngredient,
  chooseMinimaleTieBreak,
  choosePlaceOrder,
  mostCompleteHeldOrder,
} from './bot';
import { makeIngredientCard } from './cards';
import { zeroIngredientRecord, type Ingredient } from './ingredients';
import type { GameState, IngredientCard, OrderCard, Player } from './types';

let orderSeq = 0;
function order(requirement: OrderCard['requirement'], name = 'Test'): OrderCard {
  orderSeq += 1;
  return { id: `order-${orderSeq}`, kind: 'order', color: 'green', name, requirement };
}

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: 'p1',
    name: 'Alberto',
    color: 'green', // personal ingredient: pepper
    hand: [],
    waiter: [],
    handOrders: [],
    delivered: [],
    hasMammaMia: false,
    isBot: true,
    ...overrides,
  };
}

interface StateOverrides {
  tally?: Partial<Record<Ingredient, number>>;
  supply?: number;
  playerCount?: number;
  oven?: GameState['oven'];
}

function makeState({ tally = {}, supply = 40, playerCount = 3, oven = [] }: StateOverrides = {}): GameState {
  return {
    players: Array.from({ length: playerCount }, (_, i) => makePlayer({ id: `p${i}` })),
    currentPlayerIndex: 0,
    supply: Array.from({ length: supply }, () => makeIngredientCard('salami')),
    oven,
    round: 1,
    maxRounds: 3,
    phase: { name: 'turn', step: 'order' },
    log: [],
    nextLogId: 0,
    hasPlayedIngredientThisTurn: false,
    ovenIngredientTally: { ...zeroIngredientRecord(), ...tally },
  };
}

function hand(spec: Partial<Record<Ingredient, number>>): IngredientCard[] {
  return (Object.entries(spec) as [Ingredient, number][]).flatMap(([ing, n]) =>
    Array.from({ length: n }, () => makeIngredientCard(ing)),
  );
}

function kindsOf(ids: string[] | null, player: Player): Ingredient[] {
  return (ids ?? []).map((id) => {
    const card = player.hand.find((c) => c.id === id);
    if (!card || card.kind !== 'ingredient') throw new Error('not an ingredient');
    return card.ingredient;
  });
}

describe('chooseIngredientsToPlay', () => {
  it('returns null when hand has no ingredient cards', () => {
    expect(chooseIngredientsToPlay(makeState(), makePlayer({ hand: [] }))).toBeNull();
  });

  it('sheds a single spare card (from the smallest set) when it has no order to build toward', () => {
    const player = makePlayer({ hand: hand({ salami: 1, olive: 3 }) });
    const ids = chooseIngredientsToPlay(makeState(), player);
    expect(ids).toHaveLength(1);
    expect(kindsOf(ids, player)).toEqual(['salami']);
  });

  it('avoids breaking into its personal ingredient when shedding a spare', () => {
    const player = makePlayer({ hand: hand({ pepper: 1, olive: 1, salami: 3 }) });
    const ids = chooseIngredientsToPlay(makeState(), player);
    expect(kindsOf(ids, player)).toEqual(['olive']);
  });

  it('pushes toward a held order — plays exactly the missing salami, not the bigger olive set', () => {
    const player = makePlayer({
      hand: hand({ salami: 5, olive: 6 }),
      handOrders: [order({ kind: 'normal', requirements: { pepper: 1, salami: 4 } })],
    });
    const ids = chooseIngredientsToPlay(makeState({ tally: { salami: 1 } }), player);
    // needs 4 salami, oven has 1 → play 3
    expect(kindsOf(ids, player)).toEqual(['salami', 'salami', 'salami']);
  });

  it('floods with the largest set when it holds a reachable Bombastica', () => {
    const player = makePlayer({
      hand: hand({ salami: 4, olive: 2 }),
      handOrders: [order({ kind: 'bombastica' })],
    });
    const ids = chooseIngredientsToPlay(makeState({ tally: { mushroom: 8 } }), player);
    expect(kindsOf(ids, player)).toEqual(['salami', 'salami', 'salami', 'salami']);
  });

  it('reserves cards an already-committed order still needs, shedding a bigger unrelated set instead', () => {
    const committed = order({ kind: 'normal', requirements: { pepper: 1, olive: 4 } }, 'Committed');
    const player = makePlayer({ hand: hand({ salami: 3, olive: 1 }) });
    // committed order sits in the oven with pepper + 3 olive → 1 olive owed
    // from hand at the reveal. The bot has nothing to build, so it sheds a
    // salami and keeps its last olive.
    const ids = chooseIngredientsToPlay(makeState({ tally: { pepper: 1, olive: 3 }, oven: [committed] }), player);
    expect(kindsOf(ids, player)).toEqual(['salami']);
  });
});

describe('choosePlaceOrder', () => {
  it('holds a normal order until every required ingredient is actually present in the tally', () => {
    const player = makePlayer({ handOrders: [order({ kind: 'normal', requirements: { pepper: 1, salami: 4 } })] });
    expect(choosePlaceOrder(makeState({ tally: { pepper: 1, salami: 3 } }), player)).toBeNull();
    expect(choosePlaceOrder(makeState({ tally: { pepper: 1, salami: 4 } }), player)?.startsWith('order-')).toBe(true);
  });

  it('plays Bombastica only once the tally totals 15+', () => {
    const player = makePlayer({ handOrders: [order({ kind: 'bombastica' })] });
    expect(choosePlaceOrder(makeState({ tally: { salami: 14 } }), player)).toBeNull();
    expect(choosePlaceOrder(makeState({ tally: { salami: 10, olive: 5 } }), player)).not.toBeNull();
  });

  it('requires the personal ingredient plus enough of some other kind for Monotoni', () => {
    const player = makePlayer({ handOrders: [order({ kind: 'monotoni', jokerCount: 6 })] });
    expect(choosePlaceOrder(makeState({ tally: { pepper: 0, salami: 6 } }), player)).toBeNull();
    expect(choosePlaceOrder(makeState({ tally: { pepper: 1, salami: 5 } }), player)).toBeNull();
    expect(choosePlaceOrder(makeState({ tally: { pepper: 1, salami: 6 } }), player)).not.toBeNull();
  });

  it('respects the rarest-eligible kind for Minimale (a plentiful kind does not satisfy it)', () => {
    const player = makePlayer({ handOrders: [order({ kind: 'minimale', otherCount: 3 })] });
    expect(choosePlaceOrder(makeState({ tally: { pepper: 1, olive: 2 } }), player)).toBeNull();
    // salami is plentiful but olive (1) is the rarest positive kind → still short
    expect(choosePlaceOrder(makeState({ tally: { pepper: 1, salami: 10, olive: 1 } }), player)).toBeNull();
    expect(choosePlaceOrder(makeState({ tally: { pepper: 1, olive: 3 } }), player)).not.toBeNull();
  });

  it('commits a top-up order once the oven covers most of it, but not while it is barely started', () => {
    const player = makePlayer({
      hand: hand({ salami: 3, pepper: 1 }),
      handOrders: [order({ kind: 'normal', requirements: { pepper: 1, salami: 4 } })],
    });
    // oven has 3 of the 4 salami (shortfall 2) → commit now for an early reveal slot
    expect(choosePlaceOrder(makeState({ tally: { pepper: 1, salami: 2 }, supply: 40 }), player)).not.toBeNull();
    // oven barely started (shortfall 4) → wait for it to fill…
    expect(choosePlaceOrder(makeState({ tally: { salami: 1 }, supply: 40 }), player)).toBeNull();
    // …unless the draw pile is nearly gone
    expect(choosePlaceOrder(makeState({ tally: { salami: 1 }, supply: 4 }), player)).not.toBeNull();
  });

  it('prefers the heavier of two currently-satisfiable orders', () => {
    const light = order({ kind: 'normal', requirements: { pepper: 1, olive: 4 } }, 'Light');
    const heavy = order({ kind: 'bombastica' }, 'Heavy');
    const player = makePlayer({ handOrders: [light, heavy] });
    const chosen = choosePlaceOrder(makeState({ tally: { pepper: 1, olive: 15 } }), player);
    expect(chosen).toBe(heavy.id);
  });

  it('returns null when there is no held order card', () => {
    expect(choosePlaceOrder(makeState(), makePlayer({ handOrders: [] }))).toBeNull();
  });
});

describe('mostCompleteHeldOrder', () => {
  it('picks the order with the smallest remaining gap given the oven and the bot hand', () => {
    const far = order({ kind: 'normal', requirements: { pepper: 1, olive: 4 } }, 'Far');
    const near = order({ kind: 'normal', requirements: { pepper: 1, salami: 4 } }, 'Near');
    const player = makePlayer({ hand: hand({ salami: 2 }), handOrders: [far, near] });
    const state = makeState({ tally: { pepper: 1, salami: 2 } });
    expect(mostCompleteHeldOrder(state, player)?.id).toBe(near.id);
  });
});

describe('chooseDrawSource', () => {
  it('refreshes the order hand from the waiter once it is empty', () => {
    expect(
      chooseDrawSource(makeState(), makePlayer({ handOrders: [], waiter: [order({ kind: 'bombastica' })] })),
    ).toBe('waiter');
  });

  it('otherwise draws ingredients from the supply', () => {
    expect(chooseDrawSource(makeState(), makePlayer({ handOrders: [order({ kind: 'bombastica' })] }))).toBe('supply');
  });

  it('stalls via the waiter when a supply draw would end the round but a finishable order is still in hand', () => {
    const player = makePlayer({
      hand: hand({ salami: 2 }),
      handOrders: [order({ kind: 'normal', requirements: { pepper: 1, salami: 4 } })],
      waiter: [order({ kind: 'bombastica' })],
    });
    // oven has pepper + 2 salami, hand covers the other 2 salami → finishable, but not yet placed
    const state = makeState({ tally: { pepper: 1, salami: 2 }, supply: 2 });
    expect(chooseDrawSource(state, player)).toBe('waiter');
  });

  it('does not stall when the order cannot be finished even with a hand top-up', () => {
    const player = makePlayer({
      hand: [],
      handOrders: [order({ kind: 'normal', requirements: { pepper: 1, salami: 4 } })],
      waiter: [order({ kind: 'bombastica' })],
    });
    const state = makeState({ tally: { pepper: 1, salami: 2 }, supply: 2 });
    expect(chooseDrawSource(state, player)).toBe('supply');
  });

  it('draws a second order from the waiter when its one held order is far from done', () => {
    const player = makePlayer({
      handOrders: [order({ kind: 'normal', requirements: { pepper: 1, salami: 4 } })],
      waiter: [order({ kind: 'bombastica' })],
    });
    expect(chooseDrawSource(makeState({ supply: 40 }), player)).toBe('waiter');
  });

  it('takes ingredients instead of a second order when the held one is close', () => {
    const player = makePlayer({
      hand: hand({ salami: 4, pepper: 1 }),
      handOrders: [order({ kind: 'normal', requirements: { pepper: 1, salami: 4 } })],
      waiter: [order({ kind: 'bombastica' })],
    });
    expect(chooseDrawSource(makeState({ tally: { salami: 2 }, supply: 40 }), player)).toBe('supply');
  });
});

describe('chooseJokerIngredient / chooseMinimaleTieBreak', () => {
  it('picks the most plentiful non-personal ingredient as the joker when none is fully covered', () => {
    const table = {
      salami: [],
      pineapple: [],
      mushroom: [],
      pepper: [],
      olive: [makeIngredientCard('olive'), makeIngredientCard('olive')],
    };
    expect(chooseJokerIngredient(table, 'pepper')).toBe('olive');
  });

  it('prefers a joker the owner can actually deliver from table + hand', () => {
    const table = {
      salami: [makeIngredientCard('salami'), makeIngredientCard('salami'), makeIngredientCard('salami')],
      pineapple: [],
      mushroom: [makeIngredientCard('mushroom'), makeIngredientCard('mushroom'), makeIngredientCard('mushroom'), makeIngredientCard('mushroom'), makeIngredientCard('mushroom')],
      pepper: [],
      olive: [],
    };
    const ownerHand = { ...zeroIngredientRecord(), mushroom: 1 };
    // mushroom: 5 table + 1 hand = 6 → deliverable; salami: only 3 → not
    expect(chooseJokerIngredient(table, 'pepper', ownerHand, 6)).toBe('mushroom');
  });

  it('takes the first tied candidate for Minimale with no extra info', () => {
    expect(chooseMinimaleTieBreak(['salami', 'olive'])).toBe('salami');
  });

  it('breaks a Minimale tie toward the kind the owner can cover from hand', () => {
    const table = { salami: [makeIngredientCard('salami')], pineapple: [], mushroom: [], pepper: [], olive: [makeIngredientCard('olive')] };
    const ownerHand = { ...zeroIngredientRecord(), olive: 2 };
    expect(chooseMinimaleTieBreak(['salami', 'olive'], table, ownerHand, 3)).toBe('olive');
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
