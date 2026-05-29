// Address = Region (1-16, the nested 8x8 squares) + the cell id #d itself, which is
// the Sector you travel between. region = (d >> 6) + 1; the old intermediate level
// folded into the region.
export function regionOf(d: number): number {
  return (d >> 6) + 1;
}

export function addr(d: number): string {
  return `Region ${regionOf(d)} · Sector #${d}`;
}

export function addrShort(d: number): string {
  return `R${regionOf(d)}·#${d}`;
}
