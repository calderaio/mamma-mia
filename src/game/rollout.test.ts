import { describe, expect, it } from 'vitest';
import { createGame } from './setup';
import { drawCards, placeIngredients, placeOrder, confirmPassDevice } from './engine';
import { INGREDIENTS, INGREDIENT_COUNT_PER_KIND } from './ingredients';
import { determinize, heuristicPlayout, strongChooseDraw, strongChooseIngredients, strongChooseOrder } from './rollout';
import type { GameState, IngredientCard } from './types';

function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A fresh 4-player all-bot game advanced to the first real turn decision. */
function gameAtFirstTurn(seed: number): GameState {
  let s = createGame(
    [0, 1, 2, 3].map((i) => ({ name: `P${i}`, isBot: true })),
    { random: seeded(seed), startingPlayerIndex: 0 },
  );
  while (s.phase.name === 'passDevice') s = confirmPassDevice(s);
  return s;
}

function totalIngredients(s: GameState): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const i of INGREDIENTS) counts[i] = 0;
  for (const p of s.players) {
    for (const c of p.hand) if (c.kind === 'ingredient') counts[c.ingredient] += 1;
  }
  for (const c of s.supply) if (c.kind === 'ingredient') counts[c.ingredient] += 1;
  for (const c of s.oven) if (c.kind === 'ingredient') counts[c.ingredient] += 1;
  return counts;
}

describe('determinize', () => {
  it('keeps the acting player\'s own cards and the oven, and preserves pile sizes', () => {
    const s = gameAtFirstTurn(1);
    const me = s.players[0];
    const d = determinize(s, me.id, seeded(99));

    const myAfter = d.players.find((p) => p.id === me.id)!;
    expect(myAfter.hand).toBe(me.hand);
    expect(myAfter.handOrders).toBe(me.handOrders);
    expect(d.oven).toBe(s.oven);
    expect(d.supply.length).toBe(s.supply.length);
    for (const opp of d.players.filter((p) => p.id !== me.id)) {
      const real = s.players.find((p) => p.id === opp.id)!;
      expect(opp.hand.length).toBe(real.hand.length);
      expect(opp.handOrders.length).toBe(real.handOrders.length);
      expect(opp.waiter.length).toBe(real.waiter.length);
    }
  });

  it('conserves the total number of each ingredient card (13 minus removals, 1 removed per kind at 4 players)', () => {
    const s = gameAtFirstTurn(2);
    const d = determinize(s, s.players[0].id, seeded(7));
    const totals = totalIngredients(d);
    for (const i of INGREDIENTS) {
      expect(totals[i]).toBe(INGREDIENT_COUNT_PER_KIND - 1);
    }
  });

  it('places the Mamma Mia! card in the supply while nobody holds it', () => {
    const s = gameAtFirstTurn(3);
    const d = determinize(s, s.players[0].id, seeded(11));
    expect(d.supply.filter((c) => c.kind === 'mammamia')).toHaveLength(1);
  });

  it('re-samples opponents\' hands (not a copy of the real ones)', () => {
    const s = gameAtFirstTurn(4);
    // Give the run something to diverge from: opponents' real hands are fixed.
    const d1 = determinize(s, s.players[0].id, seeded(1));
    const d2 = determinize(s, s.players[0].id, seeded(2));
    const h1 = d1.players[1].hand.map((c) => (c as IngredientCard).ingredient).sort().join();
    const h2 = d2.players[1].hand.map((c) => (c as IngredientCard).ingredient).sort().join();
    // Two different seeds should (almost surely) give different opponent hands.
    expect(h1).not.toBe(h2);
  });
});

describe('heuristicPlayout', () => {
  it('drives an arbitrary mid-game state to completion with plausible scores', () => {
    const s = gameAtFirstTurn(5);
    const result = heuristicPlayout(s);
    const scores = Object.values(result.delivered);
    expect(scores).toHaveLength(4);
    const total = scores.reduce((a, b) => a + b, 0);
    // 3 rounds, 8 orders per colour — realistic totals sit well inside this.
    expect(total).toBeGreaterThan(4);
    expect(total).toBeLessThanOrEqual(32);
    expect(result.winnerIds.length).toBeGreaterThanOrEqual(1);
  });
});

describe('strong choosers return legal moves', () => {
  it('strongChooseIngredients picks cards of a single kind from the acting hand', () => {
    const s = gameAtFirstTurn(6);
    const me = s.players[0];
    const ids = strongChooseIngredients(s, me);
    expect(ids).not.toBeNull();
    const picked = ids!.map((id) => me.hand.find((c) => c.id === id));
    expect(picked.every((c) => c && c.kind === 'ingredient')).toBe(true);
    const kinds = new Set(picked.map((c) => (c as IngredientCard).ingredient));
    expect(kinds.size).toBe(1);
  });

  it('strongChooseOrder returns null or one of the held order ids', () => {
    let s = gameAtFirstTurn(7);
    const ing = s.players[0].hand.find((c): c is IngredientCard => c.kind === 'ingredient')!;
    s = placeIngredients(s, [ing.id]);
    expect(s.phase).toMatchObject({ name: 'turn', step: 'order' });
    const me = s.players[0];
    const id = strongChooseOrder(s, me);
    expect(id === null || me.handOrders.some((o) => o.id === id)).toBe(true);
  });

  it('strongChooseDraw returns an available source', () => {
    // advance P0 through ingredients + order so it's at the draw step
    let s = gameAtFirstTurn(8);
    const me = s.players[0];
    const ing = me.hand.find((c): c is IngredientCard => c.kind === 'ingredient')!;
    s = placeIngredients(s, [ing.id]);
    s = placeOrder(s, null);
    expect(s.phase).toMatchObject({ name: 'turn', step: 'draw' });
    const src = strongChooseDraw(s, s.players[0]);
    expect(src === 'supply' || src === 'waiter').toBe(true);
    // and it must be legal to actually draw from it
    expect(() => drawCards(s, src)).not.toThrow();
  });
});
