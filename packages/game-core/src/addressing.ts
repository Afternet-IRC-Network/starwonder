// A sector's address is just its cell id #d — the thing you travel between. There is no
// higher "region" grouping in the UI; the Hilbert layout is an implementation detail.
export function addr(d: number): string {
  return `Sector #${d}`;
}

export function addrShort(d: number): string {
  return `#${d}`;
}
