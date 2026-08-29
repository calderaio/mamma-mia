import { describe, expect, it } from 'vitest';
import { applyEpisodeReturn, createEmptyQTable, selectAction, type EpisodeStep } from './rl';

describe('applyEpisodeReturn', () => {
  it('incrementally averages returns for a repeated (state, action) pair', () => {
    const table = createEmptyQTable();
    const step: EpisodeStep = { decision: 'playOrder', stateKey: 's1', action: 'yes' };
    applyEpisodeReturn(table, [step], 4);
    applyEpisodeReturn(table, [step], 2);
    // average of 4 and 2 = 3
    expect(table.playOrder.s1.yes.value).toBeCloseTo(3);
    expect(table.playOrder.s1.yes.count).toBe(2);
  });

  it('keeps separate stats for different actions in the same state', () => {
    const table = createEmptyQTable();
    applyEpisodeReturn(table, [{ decision: 'playOrder', stateKey: 's1', action: 'yes' }], 5);
    applyEpisodeReturn(table, [{ decision: 'playOrder', stateKey: 's1', action: 'no' }], 1);
    expect(table.playOrder.s1.yes.value).toBeCloseTo(5);
    expect(table.playOrder.s1.no.value).toBeCloseTo(1);
  });

  it('credits every step in a trajectory, not just the last one', () => {
    const table = createEmptyQTable();
    const trajectory: EpisodeStep[] = [
      { decision: 'drawSource', stateKey: 'a', action: 'supply' },
      { decision: 'drawSource', stateKey: 'b', action: 'waiter' },
    ];
    applyEpisodeReturn(table, trajectory, 7);
    expect(table.drawSource.a.supply.value).toBeCloseTo(7);
    expect(table.drawSource.b.waiter.value).toBeCloseTo(7);
  });
});

describe('selectAction', () => {
  it('always explores randomly when epsilon is 1', () => {
    const table = createEmptyQTable();
    applyEpisodeReturn(table, [{ decision: 'playOrder', stateKey: 's', action: 'yes' }], 100);
    let sawNo = false;
    for (let i = 0; i < 50; i += 1) {
      const action = selectAction(table, 'playOrder', 's', ['yes', 'no'] as const, 1, () => (i % 2 === 0 ? 0.9 : 0.1));
      if (action === 'no') sawNo = true;
    }
    expect(sawNo).toBe(true);
  });

  it('picks the highest-value action when epsilon is 0', () => {
    const table = createEmptyQTable();
    applyEpisodeReturn(table, [{ decision: 'playOrder', stateKey: 's', action: 'yes' }], 10);
    applyEpisodeReturn(table, [{ decision: 'playOrder', stateKey: 's', action: 'no' }], 1);
    const action = selectAction(table, 'playOrder', 's', ['yes', 'no'] as const, 0, () => 0.99);
    expect(action).toBe('yes');
  });
});
