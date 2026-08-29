import { INGREDIENTS, type Ingredient } from './ingredients';
import { PERSONAL_INGREDIENT } from './colors';
import type { CardId, GameState, IngredientCard, Player } from './types';

/**
 * All bot decisions are made from information a real attentive player
 * would also have: their own hand, the running tally of publicly announced
 * oven placements (`state.ovenIngredientTally` — see its doc comment), and
 * the sorted face-up ingredients during round-end reveal. Bots never peek
 * at genuinely hidden state (other players' hands, supply/waiter order).
 */

function ingredientCardsInHand(player: Player): IngredientCard[] {
  return player.hand.filter((c): c is IngredientCard => c.kind === 'ingredient');
}

/** Which ingredient cards to place this turn, or null if the bot has none and must pass. */
export function chooseIngredientsToPlay(player: Player): CardId[] | null {
  const cards = ingredientCardsInHand(player);
  if (cards.length === 0) return null;
  const byKind = new Map<Ingredient, CardId[]>();
  for (const card of cards) {
    const list = byKind.get(card.ingredient) ?? [];
    list.push(card.id);
    byKind.set(card.ingredient, list);
  }
  let best: CardId[] = [];
  for (const ids of byKind.values()) {
    if (ids.length > best.length) best = ids;
  }
  return best;
}

/**
 * Whether to play the held order card this turn. The bot can't see the
 * physical oven pile, but it CAN track exactly what's in it: every
 * ingredient placement is publicly announced ("3x Salami!") and nothing
 * leaves the oven until round-end, so `state.ovenIngredientTally` is an
 * exact — not estimated — count of what's currently sitting in there.
 * The bot plays as soon as its own order looks satisfiable from that tally.
 */
export function choosePlaceOrder(state: GameState, player: Player): CardId | null {
  const order = player.handOrders[0];
  if (!order) return null;
  const tally = state.ovenIngredientTally;
  const personal = botPersonalIngredient(player);

  const satisfiable = (): boolean => {
    switch (order.requirement.kind) {
      case 'normal':
        return Object.entries(order.requirement.requirements).every(
          ([ingredient, count]) => tally[ingredient as Ingredient] >= (count ?? 0),
        );
      case 'bombastica':
        return INGREDIENTS.reduce((sum, i) => sum + tally[i], 0) >= 15;
      case 'monotoni': {
        const requirement = order.requirement;
        return tally[personal] >= 1 && INGREDIENTS.some((i) => i !== personal && tally[i] >= requirement.jokerCount);
      }
      case 'minimale': {
        const requirement = order.requirement;
        return tally[personal] >= 1 && INGREDIENTS.some((i) => i !== personal && tally[i] >= requirement.otherCount);
      }
    }
  };

  return satisfiable() ? order.id : null;
}

/** Which pile to draw from: refresh the order hand when empty, otherwise take ingredients. */
export function chooseDrawSource(player: Player): 'supply' | 'waiter' {
  if (player.handOrders.length === 0 && player.waiter.length > 0) return 'waiter';
  return 'supply';
}

/** Joker ingredient for Pizza Monotoni: pick whichever non-personal ingredient is currently most plentiful on the table. */
export function chooseJokerIngredient(
  sortedIngredients: Record<Ingredient, IngredientCard[]>,
  personal: Ingredient,
): Ingredient {
  const candidates = INGREDIENTS.filter((i) => i !== personal);
  return candidates.reduce((best, i) => (sortedIngredients[i].length > sortedIngredients[best].length ? i : best));
}

/** Minimale tie-break: any of the tied candidates works equally well, so just take the first. */
export function chooseMinimaleTieBreak(candidates: Ingredient[]): Ingredient {
  return candidates[0];
}

/** Cards to add from hand to exactly cover a normal/Monotoni/Minimale shortfall, or null if the bot can't. */
export function chooseHandTopUp(owner: Player, shortfall: Partial<Record<Ingredient, number>>): CardId[] | null {
  const cards = ingredientCardsInHand(owner);
  const picked: CardId[] = [];
  for (const [ingredient, count] of Object.entries(shortfall) as [Ingredient, number][]) {
    const matching = cards.filter((c) => c.ingredient === ingredient && !picked.includes(c.id));
    if (matching.length < count) return null;
    picked.push(...matching.slice(0, count).map((c) => c.id));
  }
  return picked;
}

export function botPersonalIngredient(player: Player): Ingredient {
  return PERSONAL_INGREDIENT[player.color];
}
