import { INGREDIENTS, INGREDIENT_COUNT_PER_KIND, zeroIngredientRecord } from './ingredients';
import { PERSONAL_INGREDIENT, PLAYER_COLORS } from './colors';
import { buildAllOrderDecks, makeIngredientCard, makeMammaMiaCard } from './cards';
import { shuffle, type RandomFn } from './random';
import type { GameState, Player } from './types';

const STARTING_HAND_SIZE = 6;

/** Ingredient cards of each kind removed from the deck before shuffling, by player count. */
export const REMOVAL_PER_KIND_BY_PLAYER_COUNT: Record<number, number> = {
  2: 5,
  3: 3,
  4: 1,
  5: 0,
};

export interface CreateGameOptions {
  random?: RandomFn;
  startingPlayerIndex?: number;
}

export interface PlayerSetup {
  name: string;
  isBot?: boolean;
  learns?: boolean;
  strong?: boolean;
}

export function createGame(playerSetups: (string | PlayerSetup)[], options: CreateGameOptions = {}): GameState {
  const normalized = playerSetups.map((p) =>
    typeof p === 'string'
      ? { name: p, isBot: false, learns: false, strong: false }
      : { name: p.name, isBot: p.isBot ?? false, learns: p.learns ?? false, strong: p.strong ?? false },
  );
  const playerCount = normalized.length;
  if (playerCount < 2 || playerCount > 5) {
    throw new Error('Mamma Mia! requires 2 to 5 players');
  }
  const random = options.random ?? Math.random;
  const removalPerKind = REMOVAL_PER_KIND_BY_PLAYER_COUNT[playerCount];

  let ingredientDeck = INGREDIENTS.flatMap((ingredient) =>
    Array.from({ length: INGREDIENT_COUNT_PER_KIND - removalPerKind }, () => makeIngredientCard(ingredient)),
  );
  ingredientDeck = shuffle(ingredientDeck, random);

  const colors = PLAYER_COLORS.slice(0, playerCount);
  const orderDecks = buildAllOrderDecks(PERSONAL_INGREDIENT);

  const players: Player[] = normalized.map(({ name, isBot, learns, strong }, index) => {
    const color = colors[index];
    const hand = ingredientDeck.splice(0, STARTING_HAND_SIZE);
    const waiter = shuffle(orderDecks[color], random);
    const handOrders = waiter.splice(0, 1);
    return {
      id: `player-${index}`,
      name,
      color,
      hand,
      waiter,
      handOrders,
      delivered: [],
      hasMammaMia: false,
      isBot,
      learns,
      strong,
    };
  });

  const supply = shuffle([...ingredientDeck, makeMammaMiaCard()], random);

  const startingPlayerIndex = options.startingPlayerIndex ?? Math.floor(random() * playerCount);

  return {
    players,
    currentPlayerIndex: startingPlayerIndex,
    supply,
    oven: [],
    round: 1,
    maxRounds: 3,
    phase: { name: 'passDevice', nextPlayerIndex: startingPlayerIndex },
    log: [
      {
        id: 0,
        round: 1,
        message: `${players[startingPlayerIndex].name} beginnt Runde 1.`,
      },
    ],
    nextLogId: 1,
    hasPlayedIngredientThisTurn: false,
    ovenIngredientTally: zeroIngredientRecord(),
  };
}
