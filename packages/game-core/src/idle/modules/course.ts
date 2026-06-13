// course — the journey bookends. It rolls no dice of its own: the transit settle emits
// the 'arrived' fact when the last hop lands, and the server authors 'departed' /
// 'canceled' facts at the course intents. This module just owns their log lines.

import type { IdleModule } from '../types';

export const course: IdleModule = {
  id: 'course',
  line: (f) => {
    switch (f.outcome) {
      case 'departed':
        return `Course laid in for ${f.numbers?.dest} — ${f.numbers?.jumps} jump${f.numbers?.jumps === 1 ? '' : 's'} out.`;
      case 'arrived':
        return `Course complete — ${f.numbers?.jumps} jump${f.numbers?.jumps === 1 ? '' : 's'} behind you.`;
      case 'made-port':
        return 'Made port for a stay.'; // the settled-down line (dock-session debounce)
      case 'docked':
        return `Docked at ${f.numbers?.station}.`;
      case 'undocked':
        return 'Cast off — riding at anchor in orbit.';
      case 'canceled':
        return 'Dropped out of warp and scrubbed the course.';
      default:
        return f.summary;
    }
  },
};
