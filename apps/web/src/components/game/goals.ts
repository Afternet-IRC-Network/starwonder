/**
 * Display strings for the trader-level downtime goals — shared by the full editor
 * (GoalEditor, in the Log / WhileAway) and the one-tap activity chips on the dock tab,
 * so the same goal reads the same everywhere.
 */
export const GOAL_LABELS: Record<string, string> = {
  idle: 'Just pass the time',
  'bargain-hunt': 'Hunt for a bargain',
  network: 'Work the room',
  'lay-low': 'Lay low',
  hustle: 'Hustle',
};

/** Chip glyphs — same minimal geometric style as Buy & Sell's ⇄. */
export const GOAL_ICONS: Record<string, string> = {
  idle: '◷',
  'bargain-hunt': '⌖',
  network: '☍',
  'lay-low': '⊘',
  hustle: '⚂',
};

/** Present-progressive status line for the activity card. */
export const GOAL_DOING: Record<string, string> = {
  idle: 'Passing the time',
  'bargain-hunt': 'Hunting for a bargain',
  network: 'Working the room',
  'lay-low': 'Laying low',
  hustle: 'Hustling',
};
