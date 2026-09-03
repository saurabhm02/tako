import type { TakoBridge } from "../shared/types";

declare global {
  interface Window {
    tako: TakoBridge;
  }
}

export {};
