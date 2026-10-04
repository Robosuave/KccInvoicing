/**
 * Constrained template system (spec §8/§9).
 * Exactly three templates. The choice is stored on the invoice at issuance
 * (snapshot.template_id) and never reinterprets an issued invoice.
 */

export type TemplateId = 'classic' | 'modern' | 'compact';

export interface TemplateDef {
  id: TemplateId;
  name: string;
  description: string;
}

export const TEMPLATES: TemplateDef[] = [
  {
    id: 'classic',
    name: 'Classic',
    description: 'Traditional centered layout with bordered tables. Closest to the legacy format.',
  },
  {
    id: 'modern',
    name: 'Modern',
    description: 'Clean layout with an accent bar and minimal tables.',
  },
  {
    id: 'compact',
    name: 'Compact',
    description: 'Tighter spacing and smaller type for long invoices.',
  },
];

export function templateName(id: string): string {
  return TEMPLATES.find((t) => t.id === id)?.name ?? 'Classic';
}

export function isTemplateId(id: string): id is TemplateId {
  return (['classic', 'modern', 'compact'] as string[]).includes(id);
}
