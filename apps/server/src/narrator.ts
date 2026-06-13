// The narrative layer — AI as a skin, never an authority (idle-narrative.md §5).
// The mechanics have already decided everything; this module only turns accumulated
// facts into prose. NO API KEY YET: we build the exact prompt that WOULD be sent and
// return it alongside a templated fallback, so the dock screen can show both.
//
// TODO(llm): when env.ANTHROPIC_API_KEY is set, send `prompt` to the Messages API via
// @anthropic-ai/sdk and return the completion as `text` (templated stays the fallback):
//   - model: cheap-and-ambient is the design goal — `claude-haiku-4-5` (per the design
//     doc) or `claude-sonnet-4-6` if the prose deserves an upgrade; this is flavour
//     text, not Opus work. Decide when the key lands.
//   - max_tokens ~300, streaming unnecessary at this size.
//   - prompt-cache the static preamble (rules + persona + station) with cache_control;
//     only "story so far" + new facts vary per call.
//   - on any API error: fall back to the templated text and advance nothing extra —
//     the one-way ratchet on narrated_through is handled by the caller.

import { factLine, type EventFact, type Goal, type Persona } from '@starwonder/game-core';

export interface NarrateInput {
  persona: Persona;
  /** where this chapter is set — "Foshay Docks Station" / "the run out to Vesta" */
  place: string;
  /** one line of atmosphere — the station's vibe blurb, or the open-space line in transit */
  setting: string;
  goal: Goal | null;
  previousNarrative: string;
  facts: EventFact[];
}

export function buildNarrativePrompt(n: NarrateInput): string {
  const traits = n.persona.tags.length ? ` (traits: ${n.persona.tags.join(', ')})` : '';
  const trader = (n.persona.blurb || 'a freelance trader of few words') + traits;
  const goal = n.goal ? (n.goal.blurb || `${n.goal.kind}${n.goal.target ? ` (${n.goal.target})` : ''}`) : 'none — just passing the time';
  const facts = n.facts.map((f) => `- ${JSON.stringify(f)}`).join('\n');
  return [
    "You narrate a space-trading game. Continue a SHORT, evolving log of a trader's downtime.",
    'Rules: describe ONLY what the facts state. Invent incidental colour (names, smells, small',
    'talk), NEVER consequences — no money, arrests, injuries, or price changes that are not in',
    'the facts. 2-4 sentences. Second person, past tense. Match the tone of the story so far.',
    '',
    `Trader: ${trader}.`,
    `Setting: ${n.place} — ${n.setting}.`,
    `Goal: ${goal}.`,
    '',
    'Story so far:',
    n.previousNarrative || '(this chapter has just begun)',
    '',
    'What just happened (facts):',
    facts || '(a quiet stretch — nothing notable)',
  ].join('\n');
}

/** The AI-down / no-key fallback: the facts' templated lines, stitched into a paragraph. */
export function templatedNarrative(previous: string, facts: EventFact[]): string {
  const fresh = facts.map((f) => factLine(f)).join(' ');
  const joined = [previous, fresh].filter(Boolean).join(' ');
  // Bounded prose: keep roughly the last three paragraphs' worth.
  return joined.length > 1200 ? `…${joined.slice(-1200)}` : joined;
}
