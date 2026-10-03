/// <reference types="vite/client" />
import type { PbApi } from '@photobeaver/shared';

declare global {
  interface Window {
    pb: PbApi;
  }
}
