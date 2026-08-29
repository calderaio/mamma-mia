import type { WarmupProgress } from '../game/useGame';

export function WarmupScreen({ progress }: { progress: WarmupProgress }) {
  const pct = Math.round((progress.done / progress.total) * 100);
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 p-8 text-center">
      <h2 className="font-script text-3xl text-[var(--tomato)]">🎓 Bot wird trainiert…</h2>
      <p className="text-sm opacity-75">Kurzes Selbstspiel-Training, bevor der Lernende Bot zum ersten Mal antritt.</p>
      <div className="h-3 w-full overflow-hidden rounded-full border" style={{ borderColor: 'var(--crust-border)' }}>
        <div className="h-full bg-[var(--tomato)] transition-all" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-xs opacity-60">{progress.done} / {progress.total} Spiele</p>
    </div>
  );
}
