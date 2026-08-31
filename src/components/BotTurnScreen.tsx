import { PLAYER_COLOR_CLASS, playerBadge } from '../game/colors';
import type { BotStep } from '../game/useGame';
import { FaceDownStack, IngredientCardView, OrderCardView } from './Card';

function BotStepVisual({ visual }: { visual: NonNullable<BotStep['visual']> }) {
  switch (visual.kind) {
    case 'ingredient':
      return (
        <div className="flex justify-center gap-2">
          {Array.from({ length: visual.count }, (_, i) => (
            <IngredientCardView key={i} ingredient={visual.ingredient} />
          ))}
        </div>
      );
    case 'order':
      return <OrderCardView color={visual.order.color} name={visual.order.name} requirement={visual.order.requirement} />;
    case 'facedown':
      return <FaceDownStack count={1} label={visual.label} />;
  }
}

export function BotTurnScreen({ step }: { step: BotStep }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-6 p-8 text-center">
      <div className={`rounded-full border-4 px-6 py-2 text-lg font-bold ${PLAYER_COLOR_CLASS[step.player.color]}`}>
        {playerBadge(step.player)}{step.player.name}
      </div>
      {step.visual && <BotStepVisual visual={step.visual} />}
      <p className="text-xl">{step.message}</p>
      <button type="button" onClick={step.run} className="btn-primary px-6 py-3">
        Weiter
      </button>
    </div>
  );
}
