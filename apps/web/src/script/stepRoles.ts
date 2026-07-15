// Step-Rollen-Klassifizierung — gemeinsame Quelle @packages/shared/stepRoles
// (stepId-basiert, entkoppelt von Namens-/Locale-/Emissions-Schreibweisen).
// Wird clientseitig genutzt für View-Mode-Filterung und Step-Color-Klassen.

import { getStepRoleById, type StepRole } from '@packages/shared/stepRoles';

export type { StepRole };

export function getStepRole(stepId: number | null | undefined): StepRole {
  return getStepRoleById(stepId);
}

// CSS-sicherer Klassen-Suffix für Step-Namen (z.B. "Set Variable" → "set-variable")
// — bewusst weiterhin namensbasiert: reiner Styling-Hook, keine Klassifizierung.
export function stepNameClass(stepName: string | undefined): string {
  if (!stepName) return 'unknown';
  return stepName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
