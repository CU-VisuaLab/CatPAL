// Runs fn with Math.random replaced by a fixed, repeatable sequence.
import { SeededRng } from "../dist/index.mjs";

export function withFixedRandom(fn) {
  const real = Math.random;
  const rng = new SeededRng(20260811);
  Math.random = () => rng.nextFloat();
  try { return fn(); } finally { Math.random = real; }
}
