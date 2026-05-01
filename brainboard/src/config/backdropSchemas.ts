import type { BackdropType } from '@/types/board'

/*
 * emptyLabel  — custom label for the blank <option value=""> in a select.
 *               When absent, defaults to "—".
 * defaultValue — when set, suppresses the blank option and the select falls
 *               back to this value when the attribute is unset.
 */
export interface BackdropFieldDef {
  key:           string
  label:         string
  type:          'text' | 'textarea' | 'select'
  hint?:         string
  options?:      string[]
  emptyLabel?:   string
  defaultValue?: string
}

/* Shared status field — appended last to every backdrop type */
const STATUS_FIELD: BackdropFieldDef = {
  key:          'status',
  label:        'Status',
  type:         'select',
  options:      ['Active', 'Draft', 'Cut'],
  defaultValue: 'Active',
}

export const BACKDROP_SCHEMAS: Record<BackdropType, BackdropFieldDef[]> = {
  Sequence: [
    { key: 'goal',     label: 'Goal',     type: 'textarea', hint: 'What must happen in this sequence…' },
    { key: 'conflict', label: 'Conflict', type: 'textarea', hint: 'What stands in the way…' },
    { key: 'outcome',  label: 'Outcome',  type: 'textarea', hint: 'How it resolves…' },
    STATUS_FIELD,
  ],
  Act: [
    { key: 'function',          label: 'Function',          type: 'textarea', hint: 'Narrative purpose of this act…' },
    { key: 'dramatic_question', label: 'Dramatic Question', type: 'text',     hint: 'The question this act poses…' },
    { key: 'shift',             label: 'Shift',             type: 'textarea', hint: 'What changes by the end…' },
    STATUS_FIELD,
  ],
  Scene: [
    { key: 'goal',     label: 'Goal',     type: 'textarea', hint: 'What must happen in this scene…' },
    { key: 'conflict', label: 'Conflict', type: 'textarea', hint: 'What stands in the way…' },
    { key: 'outcome',  label: 'Outcome',  type: 'textarea', hint: 'How it resolves…' },
    STATUS_FIELD,
  ],
  Beat: [
    { key: 'description', label: 'Description', type: 'textarea', hint: 'What happens in this beat…' },
    STATUS_FIELD,
  ],
  Custom: [
    { key: 'description', label: 'Description', type: 'textarea', hint: 'What this group contains or represents…' },
    STATUS_FIELD,
  ],
}
