import type { EntityType } from '@/types/board'

/*
 * Attribute schemas — one definition per EntityType.
 *
 * Beat, Thought: no attribute fields — name + note only.
 *   These types intentionally have an empty schema. The card renders
 *   only the name and note; no attribute section appears.
 *
 * Theme, Arc: three text fields each.
 *
 * Edit field order in the card UI is: Name → Type → [Attributes] → Note → Placement Note.
 * Attributes with an empty value are NOT rendered on the front face.
 */

export interface AttributeFieldDef {
  key:      string
  label:    string
  type:     'text' | 'textarea' | 'select'
  hint?:    string
  options?: string[]
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
  ],

  Scene: [
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
  ],

  // Beat: name + note only — no attribute fields
  Beat: [],

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
  ],

  // Thought: name + note only — no attribute fields
  Thought: [],
}
