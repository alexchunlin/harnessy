import { ID_ALPHABET, type IdPrefix } from "./schema";

export type RandomSource = () => number;

let source: RandomSource = Math.random;

/** Swap the random source, for deterministic ids in tests. */
export function setIdSource(next: RandomSource): void {
  source = next;
}

export function generateId(prefix: IdPrefix, taken?: { has(id: string): boolean }): string {
  for (;;) {
    let body = "";
    for (let i = 0; i < 6; i++) body += ID_ALPHABET[Math.floor(source() * ID_ALPHABET.length)];
    const id = `${prefix}-${body}`;
    if (!taken || !taken.has(id)) return id;
  }
}

/** A counter-based source: ids come out as aaaaab, aaaaac, ... Useful for fixtures. */
export function sequentialIdSource(): RandomSource {
  let n = 0;
  let digits: number[] = [];
  return () => {
    if (digits.length === 0) {
      n += 1;
      let v = n;
      digits = [];
      for (let i = 0; i < 6; i++) {
        digits.unshift(v % ID_ALPHABET.length);
        v = Math.floor(v / ID_ALPHABET.length);
      }
    }
    return digits.shift()! / ID_ALPHABET.length + 1e-9;
  };
}
