/**
 * Whether a step's scorers share one judge call: the step's `scorers.batch`, else its workflow's
 * `defaults.scorers.batch`, else the team's `batch` in `scorers/scoring.yaml`, else they do not.
 */
export function batchesScorers(layers: { step?: boolean; workflow?: boolean; team?: boolean }): boolean {
  return layers.step ?? layers.workflow ?? layers.team ?? false;
}
