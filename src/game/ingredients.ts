export const INGREDIENTS = ['salami', 'pineapple', 'mushroom', 'pepper', 'olive'] as const;

export type Ingredient = (typeof INGREDIENTS)[number];

export const INGREDIENT_LABEL: Record<Ingredient, string> = {
  salami: 'Salami',
  pineapple: 'Ananas',
  mushroom: 'Champignon',
  pepper: 'Paprika',
  olive: 'Olive',
};

// Tailwind color classes used for card faces / badges, keyed by ingredient.
export const INGREDIENT_COLOR: Record<Ingredient, string> = {
  salami: 'bg-red-600 text-white',
  pineapple: 'bg-yellow-400 text-yellow-950',
  mushroom: 'bg-amber-800 text-white',
  pepper: 'bg-green-600 text-white',
  olive: 'bg-purple-700 text-white',
};

export const INGREDIENT_COUNT_PER_KIND = 13;

export function zeroIngredientRecord(): Record<Ingredient, number> {
  const record = {} as Record<Ingredient, number>;
  for (const ingredient of INGREDIENTS) record[ingredient] = 0;
  return record;
}
