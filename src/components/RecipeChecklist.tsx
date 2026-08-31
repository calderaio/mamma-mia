import { buildOrderDeckForColor } from '../game/cards';
import { PERSONAL_INGREDIENT } from '../game/colors';
import type { OrderCard, OvenCard, Player } from '../game/types';
import { OrderCardView } from './Card';

/**
 * Every player works through a fixed personal deck of 8 recipe cards. This
 * shows all 8 for the given player, crossing out the ones already delivered
 * and flagging where each of the rest currently sits (hand / oven / waiter
 * pile). A player legitimately knows the full set of their own 8 recipes,
 * so nothing here is hidden information.
 */

const RECIPE_ORDER: Record<OrderCard['requirement']['kind'], number> = {
  normal: 0,
  bombastica: 1,
  monotoni: 2,
  minimale: 3,
};

function recipeSortKey(order: OrderCard): string {
  const isTuttoMisto =
    order.requirement.kind === 'normal' && Object.keys(order.requirement.requirements).length >= 5;
  return `${RECIPE_ORDER[order.requirement.kind]}${isTuttoMisto ? 1 : 0}-${order.name}`;
}

export function RecipeChecklist({ player, oven }: { player: Player; oven: OvenCard[] }) {
  const recipes = [...buildOrderDeckForColor(player.color, PERSONAL_INGREDIENT[player.color])].sort((a, b) =>
    recipeSortKey(a).localeCompare(recipeSortKey(b)),
  );

  const deliveredNames = new Set(player.delivered.map((o) => o.name));
  const handNames = new Set(player.handOrders.map((o) => o.name));
  const ovenNames = new Set(
    oven.filter((c): c is OrderCard => c.kind === 'order' && c.color === player.color).map((c) => c.name),
  );

  const noteFor = (name: string): string => {
    if (deliveredNames.has(name)) return '✓ geliefert';
    if (handNames.has(name)) return 'auf der Hand';
    if (ovenNames.has(name)) return 'im Ofen';
    return 'im Kellner-Stapel';
  };

  return (
    <details className="pizzeria-panel p-3">
      <summary className="cursor-pointer text-sm font-semibold">
        🧾 Meine Rezepte – {player.delivered.length}/8 geliefert
      </summary>
      <div className="mt-3 flex flex-wrap justify-center gap-2">
        {recipes.map((recipe) => (
          <OrderCardView
            key={recipe.name}
            color={player.color}
            name={recipe.name}
            requirement={recipe.requirement}
            struck={deliveredNames.has(recipe.name)}
            note={noteFor(recipe.name)}
          />
        ))}
      </div>
    </details>
  );
}
