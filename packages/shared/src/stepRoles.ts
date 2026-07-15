/**
 * Script-step role classification — shared single source for the web frontend
 * and the VS Code extension (display semantics: view-mode filtering, step
 * color classes, margin bar).
 *
 * Keyed by the locale- and spelling-independent FileMaker step ID
 * (`StepsForScripts.Step_ID` in the catalog, `script_steps.step_id` in
 * fm_spec) as delivered per line by the tokens API (`lines[].stepId`).
 * Never match on step names here: canonical names and DDR/SaXML emission
 * spellings diverge (see fm_spec `xml_name` contract).
 *
 * IDs verified against fm_spec 1.10.0 (canonical names in comments).
 */

export type StepRole =
  | 'control-structure'
  | 'subscript-call'
  | 'variable-assignment'
  | 'field-assignment'
  | 'script-return'
  | 'navigation'
  | 'other';

/** Step IDs referenced individually by consumers (e.g. parameter heuristics). */
export const STEP_IDS = {
  PERFORM_SCRIPT: 1,
  SET_VARIABLE: 141,
  EXIT_SCRIPT: 103,
} as const;

export const STEP_ROLE_BY_ID: Readonly<Record<number, Exclude<StepRole, 'other'>>> = {
  // control-structure
  68: 'control-structure', // If
  69: 'control-structure', // Else
  125: 'control-structure', // Else If
  70: 'control-structure', // End If
  71: 'control-structure', // Loop
  73: 'control-structure', // End Loop
  72: 'control-structure', // Exit Loop If
  205: 'control-structure', // Open Transaction
  206: 'control-structure', // Commit Transaction
  207: 'control-structure', // Revert Transaction

  // subscript-call
  1: 'subscript-call', // Perform Script
  164: 'subscript-call', // Perform Script On Server
  210: 'subscript-call', // Perform Script On Server with Callback

  // variable-assignment
  141: 'variable-assignment', // Set Variable

  // field-assignment
  76: 'field-assignment', // Set Field
  147: 'field-assignment', // Set Field By Name
  77: 'field-assignment', // Insert Calculated Result
  11: 'field-assignment', // Insert from Index
  12: 'field-assignment', // Insert from Last Visited
  91: 'field-assignment', // Replace Field Contents

  // script-return
  103: 'script-return', // Exit Script
  90: 'script-return', // Halt Script

  // navigation
  6: 'navigation', // Go to Layout
  74: 'navigation', // Go to Related Record
  16: 'navigation', // Go to Record/Request/Page
  17: 'navigation', // Go to Field
  145: 'navigation', // Go to Object
  99: 'navigation', // Go to Portal Row
};

export function getStepRoleById(stepId: number | null | undefined): StepRole {
  if (stepId == null) return 'other';
  return STEP_ROLE_BY_ID[stepId] ?? 'other';
}
