// Goal archetypes. The athlete's own Ironman plan is the untouched default (planSource 'default');
// these only apply when planSource === 'goal'. Each archetype = fixed week template + peak parameters
// that the shared workout builders scale towards.
import { clamp } from './util.js';

export const TRI = {
  sprint:  { label: 'Sprint', swim: 750, bike: 20, run: 5, trans: 4 },
  olympic: { label: 'Olympic', swim: 1500, bike: 40, run: 10, trans: 6 },
  '70.3':  { label: 'Middle / 70.3', swim: 1900, bike: 90, run: 21.1, trans: 8 },
  full:    { label: 'Full / Long distance', swim: 3800, bike: 180, run: 42.2, trans: 12 },
};

const TRI_TEMPLATE = [
  { dow: 1, role: 'swim-technique' }, { dow: 2, role: 'run-intervals' }, { dow: 3, role: 'swim-endurance' },
  { dow: 4, role: 'bike-power' }, { dow: 4, role: 'run-brick' }, { dow: 5, role: 'run-long' }, { dow: 6, role: 'bike-long' },
];

export function goalLabel(g) {
  if (!g) return 'Ironman (default)';
  if (g.type === 'triathlon') return `Triathlon · ${TRI[g.tri || 'full'].label}`;
  if (g.type === 'run') return `Run · ${+g.runKm} km`;
  if (g.type === 'bike') return `Bike · ${+g.bikeKm} km${g.bikeHm ? ` / ${+g.bikeHm} hm` : ''}`;
  if (g.type === 'swim') return `Swim · ${+g.swimM} m`;
  return 'Custom';
}

// Race distances for the predictor: { swim: m, bike: km, run: km, hm, trans: min, fresh: bool (run without bike before) }
export function raceDistances(s) {
  const g = s.planSource === 'goal' || s.planSource === 'custom' ? s.goal : null;
  if (!g || g.type === 'triathlon') { const t = TRI[g?.tri || 'full']; return { swim: t.swim, bike: t.bike, run: t.run, hm: 0, trans: t.trans, tri: true }; }
  if (g.type === 'run') return { swim: 0, bike: 0, run: +g.runKm || 42.195, hm: 0, trans: 0, fresh: true };
  if (g.type === 'bike') return { swim: 0, bike: +g.bikeKm || 100, run: 0, hm: +g.bikeHm || 0, trans: 0 };
  if (g.type === 'swim') return { swim: +g.swimM || 3800, bike: 0, run: 0, hm: 0, trans: 0 };
  return { swim: 3800, bike: 180, run: 42.2, hm: 0, trans: 12, tri: true };
}

// Template + peak parameters for a goal (null = default Ironman plan)
export function goalArchetype(s) {
  if (s.planSource !== 'goal' || !s.goal) return null;
  const g = s.goal;
  if (g.type === 'triathlon') {
    const t = g.tri || 'full';
    if (t === 'full') return { template: TRI_TEMPLATE, pk: {} };
    const P = {
      '70.3':  { swimStart: 1800, swimTechMax: 2800, swimMax: 3000, contStart: 500, swimCont: 2000, intMax: 65, brickStart: 20, brickMax: 40, runLongStart: 70, runLongMax: 120, runWalkFrom: 999, powerMax: 75, bikeLongStart: 90, bikeLongMax: 210 },
      olympic: { swimStart: 1500, swimTechMax: 2500, swimMax: 2500, contStart: 400, swimCont: 1500, intStart: 50, intMax: 60, brickStart: 15, brickMax: 30, runLongStart: 60, runLongMax: 90, runWalkFrom: 999, powerMax: 75, bikeLongStart: 75, bikeLongMax: 150 },
      sprint:  { swimStart: 1200, swimTechMax: 2000, swimMax: 2000, contStart: 300, swimCont: 800, intStart: 45, intMax: 55, brickStart: 15, brickMax: 25, runLongStart: 45, runLongMax: 70, runWalkFrom: 999, powerStart: 50, powerMax: 65, bikeLongStart: 60, bikeLongMax: 105 },
    }[t];
    return { template: TRI_TEMPLATE, pk: P };
  }
  if (g.type === 'run') {
    const km = +g.runKm || 42.195;
    const longMax = km <= 5 ? 60 : km <= 10 ? 80 : km <= 21.1 ? 120 : km <= 42.2 ? 180 : clamp(180 + (km - 42.2) * 2.5, 210, 330);
    const ultra = km > 42.2;
    const template = [
      { dow: 1, role: 'run-intervals' }, { dow: 2, role: 'run-easy' }, { dow: 3, role: 'run-tempo' },
      { dow: 4, role: 'bike-easy' }, ultra ? { dow: 5, role: 'run-long', vol: 0.55 } : { dow: 5, role: 'run-easy' }, { dow: 6, role: 'run-long' },
    ];
    return { template, pk: { runLongStart: Math.min(70, longMax), runLongMax: longMax, runWalkFrom: ultra ? 150 : 999, intMax: 70, tempoMax: km <= 10 ? 55 : 70 } };
  }
  if (g.type === 'bike') {
    const km = +g.bikeKm || 100, hm = +g.bikeHm || 0;
    const climbing = hm / km >= 10;
    const longMax = clamp(Math.round(km / 26 * 60 * 0.8), 120, 360);
    const template = [
      { dow: 1, role: climbing ? 'bike-hills' : 'bike-power' }, { dow: 2, role: 'run-easy' }, { dow: 3, role: 'bike-easy' },
      { dow: 4, role: climbing ? 'bike-power' : 'bike-hills' }, { dow: 5, role: 'bike-long' }, { dow: 6, role: 'bike-easy' },
    ];
    return { template, pk: { bikeLongStart: 90, bikeLongMax: longMax, powerMax: 80, climbing } };
  }
  if (g.type === 'swim') {
    const m = +g.swimM || 3800;
    const template = [{ dow: 0, role: 'swim-technique' }, { dow: 2, role: 'swim-css' }, { dow: 3, role: 'run-easy' }, { dow: 4, role: 'swim-endurance', vol: 0.7 }, { dow: 6, role: 'swim-endurance' }];
    return { template, pk: { swimStart: 1800, swimTechMax: Math.max(2500, m * 0.8), swimMax: Math.max(2500, m * 1.15), contStart: 400, swimCont: m } };
  }
  return null;
}
