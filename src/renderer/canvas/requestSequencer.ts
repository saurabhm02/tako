// The whole "stale async result" guard, extracted so it's testable without
// spinning up a real component: start() marks a new request as the only
// one whose result should ever be applied; isCurrent() tells a request
// that finished later whether it's still the one that matters. Generic on
// purpose — not command-bar-specific — but small enough that this is a
// naming exercise, not new infrastructure.
export function createRequestSequencer() {
  let current = 0;
  return {
    start: (): number => ++current,
    isCurrent: (seq: number): boolean => seq === current,
  };
}
