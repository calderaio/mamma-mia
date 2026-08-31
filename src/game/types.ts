import type { Ingredient } from './ingredients';
import type { PlayerColor } from './colors';

export type CardId = string;

export interface IngredientCard {
  id: CardId;
  kind: 'ingredient';
  ingredient: Ingredient;
}

export interface MammaMiaCard {
  id: CardId;
  kind: 'mammamia';
}

/** A card that can live in the hand, supply, or waiter draw pile. */
export type SupplyCard = IngredientCard | MammaMiaCard;

export type OrderRequirement =
  | { kind: 'normal'; requirements: Partial<Record<Ingredient, number>> }
  | { kind: 'bombastica' }
  | { kind: 'monotoni'; jokerCount: number }
  | { kind: 'minimale'; otherCount: number };

export interface OrderCard {
  id: CardId;
  kind: 'order';
  color: PlayerColor;
  name: string;
  requirement: OrderRequirement;
}

/** The oven discard stack can hold ingredient cards or order cards (the Mamma Mia! card never enters it). */
export type OvenCard = IngredientCard | OrderCard;

export interface Player {
  id: string;
  name: string;
  color: PlayerColor;
  hand: SupplyCard[];
  /** Face-down personal order draw pile ("Kellner-Stapel"). Index 0 = top. */
  waiter: OrderCard[];
  /** Order cards this player currently holds in hand, drawn from the waiter. */
  handOrders: OrderCard[];
  /** Successfully delivered pizzas. */
  delivered: OrderCard[];
  /** Mamma Mia! card, once drawn, sits face up next to this player's waiter. */
  hasMammaMia: boolean;
  /** If true, this player's turns and decisions are driven by simple bot heuristics. */
  isBot: boolean;
  /** Only meaningful when isBot is true: use the self-play-trained RL policy for order-timing/draw-source decisions instead of the fixed heuristic. */
  learns?: boolean;
  /** Only meaningful when isBot is true: use determinized Monte-Carlo rollouts for turn decisions (the "strong" bot). Takes precedence over `learns`. */
  strong?: boolean;
}

export type TurnStep = 'ingredients' | 'order' | 'draw';

export type Phase =
  | { name: 'passDevice'; nextPlayerIndex: number }
  | { name: 'turn'; step: TurnStep }
  | { name: 'roundEnd' }
  | { name: 'gameEnd' };

export interface LogEntry {
  id: number;
  round: number;
  message: string;
}

export interface GameState {
  players: Player[];
  currentPlayerIndex: number;
  /** Face-down shared draw pile ("Nachziehstapel"). */
  supply: SupplyCard[];
  /** Face-up shared discard stack ("Ofen"). Index 0 = bottom, last = top. */
  oven: OvenCard[];
  round: number;
  maxRounds: number;
  phase: Phase;
  log: LogEntry[];
  nextLogId: number;
  /** True once at least one ingredient has been placed this turn. */
  hasPlayedIngredientThisTurn: boolean;
  /**
   * Exact running count of each ingredient currently somewhere in the
   * (physically hidden) oven pile. This is legitimate public knowledge, not
   * a peek: per the rules, a player placing ingredients "announces the
   * number and kind" aloud, and nothing is removed from the oven again
   * until round-end scoring — so anyone with perfect memory (i.e. a bot)
   * can track exact oven contents without ever looking at the pile itself.
   */
  ovenIngredientTally: Record<Ingredient, number>;
  /** Present only while phase.name === 'roundEnd'. */
  roundEnd?: RoundEndState;
  winnerIds?: string[];
}

export type PendingResolution =
  | { type: 'awaitingJokerChoice'; order: OrderCard }
  | { type: 'awaitingMinimaleChoice'; order: OrderCard; candidates: Ingredient[] }
  | {
      type: 'awaitingHandTopUp';
      order: OrderCard;
      required: Partial<Record<Ingredient, number>>;
      shortfall: Partial<Record<Ingredient, number>>;
    };

export interface RoundEndState {
  holderId: string;
  /** Remaining cards to reveal, top of physical stack first. */
  queue: OvenCard[];
  /** Ingredient cards currently sorted face-up on the table, by kind. */
  sortedIngredients: Record<Ingredient, IngredientCard[]>;
  /** Ingredient cards consumed by completed orders this round-end. */
  usedIngredients: IngredientCard[];
  pending: PendingResolution | null;
  /** The most recently flipped card, kept visible until the next reveal (so order/recipe cards are seen, not just their ingredient effects). */
  lastRevealed: OvenCard | null;
}
