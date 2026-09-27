// Must match EVENT_CATEGORIES in apps/api/src/lib/events.ts — the API refuses
// any other value.
export const EVENT_CATEGORIES = [
  'Music',
  'Comedy',
  'Nightlife',
  'Sports',
  'Conference',
  'Arts & Theatre',
  'Festival',
  'Faith',
  'Food & Drink',
  'Other',
] as const;
