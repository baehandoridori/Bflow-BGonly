import type { ArcadePreviewGateway } from './previewGateway.ts';
import type {
  ArcadeExecuteCommand,
  ArcadeExecuteResult,
  ArcadeSnapshot,
  ArcadeWalletPush,
} from './types';

export interface ArcadeElectronApi {
  arcadeRead(): Promise<ArcadeSnapshot>;
  arcadeExecute(command: ArcadeExecuteCommand): Promise<ArcadeExecuteResult>;
  onArcadeWalletUpdated(callback: (update: ArcadeWalletPush) => void): () => void;
}

export function createElectronArcadeGateway(api: ArcadeElectronApi): ArcadePreviewGateway {
  return {
    async read() {
      return structuredClone(await api.arcadeRead());
    },
    async execute(command) {
      return structuredClone(await api.arcadeExecute(command));
    },
  };
}
