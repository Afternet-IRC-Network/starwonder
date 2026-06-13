// trade — the order bookends and fills. Like `course`, it rolls no dice of its own: the
// order settle (idle/order.ts) emits fill / no-deal / closing facts, and the server
// authors 'placed' / 'canceled' at the order intents. This module just owns the lines.

import type { IdleModule } from '../types';
import { commodityName } from './util';

const goods = (f: { numbers?: Record<string, number | string> }): string =>
  commodityName(String(f.numbers?.commodity)).toLowerCase();

export const trade: IdleModule = {
  id: 'trade',
  line: (f) => {
    const n = f.numbers ?? {};
    switch (f.outcome) {
      case 'placed':
        return `Order working: ${n.side} ${n.qty}t of ${goods(f)}${n.limit ? ` (limit ${n.limit} cr)` : ''}.`;
      case 'fill':
        return n.side === 'buy'
          ? `Took on ${n.units}t of ${goods(f)} at ${n.price} cr — ${n.filled}/${n.qty}t.`
          : `Moved ${n.units}t of ${goods(f)} at ${n.price} cr — ${n.filled}/${n.qty}t.`;
      case 'no-deal':
        return `No deal on ${goods(f)} — best offer ${n.price} cr, ${n.side === 'buy' ? 'over' : 'under'} your ${n.limit} cr limit.`;
      case 'filled':
        return `Order complete: ${n.qty}t of ${goods(f)} at ~${n.avg} cr a ton.`;
      case 'closed': {
        const why =
          n.reason === 'hold-full'
            ? 'hold full'
            : n.reason === 'broke'
              ? 'out of credits'
              : 'nothing left to sell';
        return `Order closed short at ${n.filled}/${n.qty}t of ${goods(f)} — ${why}.`;
      }
      case 'canceled':
        return `Scrubbed the ${n.side} order at ${n.filled}/${n.qty}t of ${goods(f)}.`;
      default:
        return f.summary;
    }
  },
};
