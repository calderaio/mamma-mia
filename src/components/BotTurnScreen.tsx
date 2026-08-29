import { PLAYER_COLOR_CLASS, playerBadge } from '../game/colors';
import type { BotStep } from '../game/useGame';

export function BotTurnScreen({ step }: { step: BotStep }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-6 p-8 text-center">
      <div className={`rounded-full border-4 px-6 py-2 text-lg font-bold ${PLAYER_COLOR_CLASS[step.player.color]}`}>
        {playerBadge(step.player)}{step.player.name}
      </div>
      <p className="text-xl">{step.message}</p>
      <button type="button" onClick={step.run} className="btn-primary px-6 py-3">
        Weiter
      </button>
    </div>
  );
}
