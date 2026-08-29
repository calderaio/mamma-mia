import { INGREDIENTS, INGREDIENT_LABEL, type Ingredient } from './ingredients';
import { PLAYER_COLORS, type PlayerColor } from './colors';
import type { IngredientCard, MammaMiaCard, OrderCard, OrderRequirement } from './types';

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

export function resetCardIds(): void {
  idCounter = 0;
}

export function makeIngredientCard(ingredient: Ingredient): IngredientCard {
  return { id: nextId('ing'), kind: 'ingredient', ingredient };
}

export function makeMammaMiaCard(): MammaMiaCard {
  return { id: nextId('mm'), kind: 'mammamia' };
}

/**
 * All 8 order cards per color, confirmed:
 * - 4 orders needing 4x one other ingredient + 1x the color's own personal
 *   ingredient (one per non-personal ingredient). Matches the two worked
 *   examples in the official rulebook verbatim ("4 salami + 1 pepper",
 *   "4 pineapple + 1 pepper" for the green player, whose personal
 *   ingredient is pepper).
 * - 1 "Pizza Tutto Misto" needing exactly 1 of each of the 5 ingredients.
 * - The 3 special orders (Pizza Bombastica, Pizza Monotoni, Pizza Minimale)
 *   are documented precisely in the official Rio Grande Games rulebook and
 *   implemented exactly as specified there.
 */
function buildNormalOrders(color: PlayerColor, personal: Ingredient): OrderCard[] {
  const fourPlusOne = INGREDIENTS.filter((i) => i !== personal).map((other) => {
    const requirement: OrderRequirement = { kind: 'normal', requirements: { [personal]: 1, [other]: 4 } };
    return {
      id: nextId('order'),
      kind: 'order' as const,
      color,
      name: `Pizza ${INGREDIENT_LABEL[other]}`,
      requirement,
    };
  });

  const tuttoMisto: OrderCard = {
    id: nextId('order'),
    kind: 'order',
    color,
    name: 'Pizza Tutto Misto',
    requirement: {
      kind: 'normal',
      requirements: Object.fromEntries(INGREDIENTS.map((i) => [i, 1])),
    },
  };

  return [...fourPlusOne, tuttoMisto];
}

function buildSpecialOrders(color: PlayerColor): OrderCard[] {
  return [
    {
      id: nextId('order'),
      kind: 'order',
      color,
      name: 'Pizza Bombastica',
      requirement: { kind: 'bombastica' },
    },
    {
      id: nextId('order'),
      kind: 'order',
      color,
      name: 'Pizza Monotoni',
      requirement: { kind: 'monotoni', jokerCount: 6 },
    },
    {
      id: nextId('order'),
      kind: 'order',
      color,
      name: 'Pizza Minimale',
      requirement: { kind: 'minimale', otherCount: 3 },
    },
  ];
}

export function buildOrderDeckForColor(color: PlayerColor, personal: Ingredient): OrderCard[] {
  return [...buildNormalOrders(color, personal), ...buildSpecialOrders(color)];
}

export function buildAllOrderDecks(personalIngredientOf: Record<PlayerColor, Ingredient>): Record<PlayerColor, OrderCard[]> {
  const decks = {} as Record<PlayerColor, OrderCard[]>;
  for (const color of PLAYER_COLORS) {
    decks[color] = buildOrderDeckForColor(color, personalIngredientOf[color]);
  }
  return decks;
}
