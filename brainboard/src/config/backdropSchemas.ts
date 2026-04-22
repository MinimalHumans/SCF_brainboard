import type { BackdropType } from '@/types/board'

export interface BackdropFieldDef {
  key:   string
  label: string
  type:  'text' | 'textarea'
  hint?: string
}

export const BACKDROP_SCHEMAS: Record<BackdropType, BackdropFieldDef[]> = {
  Sequence: [
    { key: 'goal',     label: 'Goal',     type: 'textarea', hint: 'What must happen in this sequence…' },
    { key: 'conflict', label: 'Conflict', type: 'textarea', hint: 'What stands in the way…' },
    { key: 'outcome',  label: 'Outcome',  type: 'textarea', hint: 'How it resolves…' },
  ],
  Act: [
    { key: 'function',          label: 'Function',          type: 'textarea', hint: 'Narrative purpose of this act…' },
    { key: 'dramatic_question', label: 'Dramatic Question', type: 'text',     hint: 'The question this act poses…' },
    { key: 'shift',             label: 'Shift',             type: 'textarea', hint: 'What changes by the end…' },
  ],
  // Beat as backdrop: name + description only
  Beat: [
    { key: 'description', label: 'Description', type: 'textarea', hint: 'What happens in this beat…' },
  ],
}
