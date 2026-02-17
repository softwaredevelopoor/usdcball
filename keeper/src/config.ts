import * as fs from 'fs';
import * as path from 'path';

export interface KeeperConfig {
  rpcUrl: string;
  wsUrl: string;
  programId: string;
  treasuryAddress: string;
  treasuryUsdcAccount: string;
  usdcMint: string;
  tokenMint: string;
  jupiterApiUrl: string;
  dryRun: boolean;
  allocations: {
    buyback: number;
    liquidity: number;
    reserve: number;
  };
  limits: {
    maxUsdcPerCycle: number;
    cooldownMinutes: number;
    slippageBps: number;
    minSolToSwap: number;
  };
  monitoring: {
    checkIntervalSeconds: number;
    logLevel: string;
  };
}

export function loadConfig(): KeeperConfig {
  const configPath =
    process.env.CONFIG_PATH || path.join(__dirname, '../config/config.json');

  if (!fs.existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }

  const rawConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

  // Override with environment variables
  const config: KeeperConfig = {
    ...rawConfig,
    dryRun: process.env.DRY_RUN === 'true' || rawConfig.dryRun,
    rpcUrl: process.env.RPC_URL || rawConfig.rpcUrl,
    wsUrl: process.env.WS_URL || rawConfig.wsUrl,
  };

  // Validate allocations
  const totalAllocation =
    config.allocations.buyback +
    config.allocations.liquidity +
    config.allocations.reserve;

  if (Math.abs(totalAllocation - 1.0) > 0.001) {
    throw new Error(`Allocations must sum to 1.0, got ${totalAllocation}`);
  }

  return config;
}
