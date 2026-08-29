import type { Ingredient } from './ingredients';

export const PLAYER_COLORS = ['yellow', 'green', 'brown', 'purple', 'red'] as const;

export type PlayerColor = (typeof PLAYER_COLORS)[number];

export const PLAYER_LABEL: Record<PlayerColor, string> = {
  yellow: 'Gelb',
  green: 'Grün',
  brown: 'Braun',
  purple: 'Lila',
  red: 'Rot',
};

// Each player color has a "personal" ingredient used by their special orders.
export const PERSONAL_INGREDIENT: Record<PlayerColor, Ingredient> = {
  yellow: 'pineapple',
  green: 'pepper',
  brown: 'mushroom',
  purple: 'olive',
  red: 'salami',
};

export const PLAYER_COLOR_CLASS: Record<PlayerColor, string> = {
  yellow: 'bg-yellow-400 text-yellow-950 border-yellow-600',
  green: 'bg-green-600 text-white border-green-800',
  brown: 'bg-amber-800 text-white border-amber-950',
  purple: 'bg-purple-700 text-white border-purple-900',
  red: 'bg-red-600 text-white border-red-800',
};

/** Prefix for player names in the UI: 🎓 for the learning bot, 🤖 for a fixed-heuristic bot, nothing for a human. */
export function playerBadge(player: { isBot: boolean; learns?: boolean }): string {
  if (player.learns) return '🎓 ';
  if (player.isBot) return '🤖 ';
  return '';
}
