import type { EntityType } from '@/types/board'

/*
 * Attribute schemas — one definition per EntityType.
 *
 * Beat, Thought: no attribute fields — name + note only.
 *   These types intentionally have an empty schema. The card renders
 *   only the name and note; no attribute section appears.
 *
 * Edit field order in the card UI is: Name → Type → [Attributes] → Note → Placement Note.
 * Attributes with an empty value are NOT rendered on the front face.
 *
 * emptyLabel  — custom label for the blank <option value=""> in a select.
 *               When absent, defaults to "—".
 * defaultValue — when set, suppresses the blank option entirely and the
 *               select's effective value falls back to this when the
 *               attribute is unset. Use for fields that should always
 *               have a value (e.g. status).
 * help        — optional explanatory copy (not yet rendered in UI, reserved
 *               for future tooltip / help-text treatment).
 */

export interface AttributeFieldDef {
  key:          string
  label:        string
  type:         'text' | 'textarea' | 'select'
  hint?:        string
  help?:        string
  options?:     string[]
  emptyLabel?:  string    // custom label for the blank option in a select
  defaultValue?: string   // suppresses blank option; fallback value when unset
}

/* Shared status field — appended last to every entity type */
const STATUS_FIELD: AttributeFieldDef = {
  key:          'status',
  label:        'Status',
  type:         'select',
  options:      ['Active', 'Draft', 'Cut'],
  defaultValue: 'Active',
}

export const ATTRIBUTE_SCHEMAS: Record<EntityType, AttributeFieldDef[]> = {

  Character: [
    {
      key:   'pronouns',
      label: 'Pronouns',
      type:  'text',
      hint:  'e.g. she/her, he/him, they/them',
    },
    {
      key:     'role',
      label:   'Role',
      type:    'select',
      options: ['Protagonist', 'Antagonist', 'Supporting', 'Minor', 'Background', 'Narrator'],
    },
    {
      key:   'occupation',
      label: 'Occupation',
      type:  'text',
      hint:  'e.g. Pinkerton agent, cattle rancher',
    },
    {
      key:   'age',
      label: 'Age',
      type:  'text',
      hint:  'e.g. 42, mid-30s',
    },
    {
      key:   'summary',
      label: 'Character Summary',
      type:  'textarea',
      hint:  'Who this person is in the story…',
    },
    STATUS_FIELD,
  ],

  Location: [
    {
      key:     'type',
      label:   'Type',
      type:    'select',
      options: ['Interior', 'Exterior', 'Int/Ext', 'Virtual', 'Abstract'],
    },
    {
      key:   'period',
      label: 'Time Period',
      type:  'text',
      hint:  'e.g. 1870s Oregon',
    },
    {
      key:   'mood',
      label: 'Mood / Atmosphere',
      type:  'text',
      hint:  'e.g. desolate, tense, dreamlike',
    },
    {
      key:   'description',
      label: 'Setting Description',
      type:  'textarea',
      hint:  'Physical description of the space…',
    },
    STATUS_FIELD,
  ],

  /*
   * Scene field order: int_ext → time_of_day → goal → conflict → outcome → status
   * int_ext: blank = inherit from Location entity in this scene.
   * time_of_day: blank = unspecified.
   * Empty values are not rendered on the front face (standard rule).
   */
  Scene: [
    {
      key:        'int_ext',
      label:      'INT/EXT',
      type:       'select',
      options:    ['INT.', 'EXT.', 'INT/EXT.'],
      emptyLabel: '(inherit from Location)',
      help:       'Leave blank to inherit from the Location entity contained in this scene. Override only when the scene moves between interior and exterior, or when the contained Location has an ambiguous type.',
    },
    {
      key:     'time_of_day',
      label:   'Time of Day',
      type:    'select',
      options: [
        'Dawn', 'Morning', 'Day', 'Afternoon', 'Dusk',
        'Night', 'Continuous', 'Later', 'Moments Later',
      ],
    },
    {
      key:   'goal',
      label: 'Goal',
      type:  'textarea',
      hint:  'What must happen / what is at stake…',
    },
    {
      key:   'conflict',
      label: 'Conflict',
      type:  'textarea',
      hint:  'What stands in the way…',
    },
    {
      key:   'outcome',
      label: 'Outcome',
      type:  'textarea',
      hint:  'How it resolves, what changes…',
    },
    STATUS_FIELD,
  ],

  Prop: [
    {
      key:     'story_function',
      label:   'Story Function',
      type:    'select',
      options: ['Practical', 'Symbolic', 'MacGuffin', 'Atmospheric'],
    },
    {
      key:   'description',
      label: 'Description',
      type:  'textarea',
      hint:  'Physical description and context…',
    },
    STATUS_FIELD,
  ],

  // Beat: name + note only — no content attribute fields
  Beat: [STATUS_FIELD],

  Theme: [
    {
      key:   'statement',
      label: 'Statement',
      type:  'text',
      hint:  'The core thematic claim…',
    },
    {
      key:   'expression',
      label: 'Expression',
      type:  'text',
      hint:  'How the theme manifests in the story…',
    },
    {
      key:   'opposition',
      label: 'Opposition',
      type:  'text',
      hint:  'The counter-argument the story explores…',
    },
    STATUS_FIELD,
  ],

  Arc: [
    {
      key:   'subject',
      label: 'Subject',
      type:  'text',
      hint:  'Who or what is changing…',
    },
    {
      key:   'axis',
      label: 'Axis',
      type:  'text',
      hint:  'The dimension of change (e.g. trust → betrayal)…',
    },
    {
      key:   'direction',
      label: 'Direction',
      type:  'text',
      hint:  'Positive, negative, flat, or cyclical…',
    },
    STATUS_FIELD,
  ],

  Shot: [
    {
      key:   'subject',
      label: 'Subject',
      type:  'text',
      hint:  'What or who is the primary subject of the shot…',
    },
    {
      key:   'framing',
      label: 'Framing',
      type:  'text',
      hint:  'e.g. ECU, CU, MS, LS, wide, OTS, POV…',
    },
    {
      key:   'purpose',
      label: 'Purpose',
      type:  'textarea',
      hint:  'What this shot accomplishes narratively or visually…',
    },
    STATUS_FIELD,
  ],

  // Thought: name + note only — no content attribute fields
  Thought: [STATUS_FIELD],
}
