import { describe, expect, it } from 'vitest';
import { createGame } from './setup';
import { INGREDIENT_COUNT_PER_KIND, INGREDIENTS } from './ingredients';

function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

describe('createGame', () => {
  it.each([
    [2, 5],
    [3, 3],
    [4, 1],
    [5, 0],
  ])('removes %i cards of each kind for %i players -> %i removed', (playerCount, removed) => {
    const names = Array.from({ length: playerCount }, (_, i) => `P${i}`);
    const state = createGame(names, { random: seededRandom(42), startingPlayerIndex: 0 });

    const ingredientsInPlay =
      state.supply.filter((c) => c.kind === 'ingredient').length +
      state.players.reduce((sum, p) => sum + p.hand.filter((c) => c.kind === 'ingredient').length, 0);

    expect(ingredientsInPlay).toBe(INGREDIENTS.length * (INGREDIENT_COUNT_PER_KIND - removed));
  });

  it('deals 6 ingredient cards to each player and includes the Mamma Mia! card in the supply exactly once', () => {
    const state = createGame(['A', 'B', 'C'], { random: seededRandom(7), startingPlayerIndex: 0 });
    for (const player of state.players) {
      expect(player.hand).toHaveLength(6);
    }
    const mammaMiaCards = state.supply.filter((c) => c.kind === 'mammamia');
    expect(mammaMiaCards).toHaveLength(1);
  });

  it('gives each player a shuffled 8-card order deck, drawing the top card to hand immediately', () => {
    const state = createGame(['A', 'B'], { random: seededRandom(3), startingPlayerIndex: 0 });
    for (const player of state.players) {
      expect(player.waiter).toHaveLength(7);
      expect(player.handOrders).toHaveLength(1);
      expect(player.handOrders[0].color).toBe(player.color);
    }
  });

  it('rejects invalid player counts', () => {
    expect(() => createGame(['A'])).toThrow();
    expect(() => createGame(['A', 'B', 'C', 'D', 'E', 'F'])).toThrow();
  });
});
