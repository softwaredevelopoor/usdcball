import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { AnchorProvider, Program, Wallet } from '@coral-xyz/anchor';
import { Logger } from './logger';
import { JupiterService } from './jupiter';
import { TreasuryMonitor } from './treasury';
import { BuybackExecutor } from './buyback';
import { LiquidityManager } from './liquidity';
import { loadConfig } from './config';
import * as fs from 'fs';

const logger = Logger.getInstance();

class KeeperBot {
  private connection: Connection;
  private provider: AnchorProvider;
  private program: Program;
  private config: any;
  private jupiter: JupiterService;
  private treasuryMonitor: TreasuryMonitor;
  private buybackExecutor: BuybackExecutor;
  private liquidityManager: LiquidityManager;
  private isRunning: boolean = false;

  constructor() {
    this.config = loadConfig();
    this.connection = new Connection(this.config.rpcUrl, 'confirmed');
    
    // Load wallet from environment or filesystem
    const walletPath = process.env.WALLET_PATH || `${process.env.HOME}/.config/solana/id.json`;
    const walletKeypair = Keypair.fromSecretKey(
      Buffer.from(JSON.parse(fs.readFileSync(walletPath, 'utf-8')))
    );
    
    const wallet = new Wallet(walletKeypair);
    this.provider = new AnchorProvider(this.connection, wallet, {
      commitment: 'confirmed',
    });

    // Initialize services
    this.jupiter = new JupiterService(this.config, this.connection);
    this.treasuryMonitor = new TreasuryMonitor(
      this.connection,
      new PublicKey(this.config.treasuryAddress),
      this.config
    );
    this.buybackExecutor = new BuybackExecutor(
      this.provider,
      this.jupiter,
      this.config
    );
    this.liquidityManager = new LiquidityManager(
      this.provider,
      this.config
    );

    logger.info('Keeper bot initialized', {
      dryRun: this.config.dryRun,
      treasury: this.config.treasuryAddress,
    });
  }

  async start(): Promise<void> {
    this.isRunning = true;
    logger.info('Starting keeper bot...');

    while (this.isRunning) {
      try {
        await this.runCycle();
      } catch (error) {
        logger.error('Error in keeper cycle', { error });
      }

      // Wait for next cycle
      await this.sleep(this.config.monitoring.checkIntervalSeconds * 1000);
    }
  }

  private async runCycle(): Promise<void> {
    logger.info('Running keeper cycle...');

    // 1. Check treasury state
    const treasuryState = await this.treasuryMonitor.getTreasuryState();
    
    if (treasuryState.paused) {
      logger.warn('Treasury is paused, skipping cycle');
      return;
    }

    logger.info('Treasury state', {
      solBalance: treasuryState.solBalance,
      usdcBalance: treasuryState.usdcBalance,
      totalSolCollected: treasuryState.totalSolCollected,
      totalUsdcConverted: treasuryState.totalUsdcConverted,
    });

    // 2. Convert SOL to USDC if threshold met
    if (treasuryState.solBalance >= this.config.limits.minSolToSwap) {
      logger.info('SOL threshold met, initiating swap to USDC', {
        solAmount: treasuryState.solBalance,
      });

      const usdcReceived = await this.swapSolToUsdc(treasuryState.solBalance);
      
      if (usdcReceived > 0) {
        logger.info('SOL -> USDC swap successful', { usdcReceived });
        treasuryState.usdcBalance += usdcReceived;
      }
    }

    // 3. Check cooldown
    const timeSinceLastOp = Date.now() / 1000 - treasuryState.lastOperationTimestamp;
    const cooldownSeconds = this.config.limits.cooldownMinutes * 60;

    if (timeSinceLastOp < cooldownSeconds) {
      logger.info('Cooldown period active', {
        timeSinceLastOp,
        cooldownSeconds,
        remainingSeconds: cooldownSeconds - timeSinceLastOp,
      });
      return;
    }

    // 4. Calculate allocation budgets
    const buybackBudget = this.calculateBuybackBudget(treasuryState);
    const liquidityBudget = this.calculateLiquidityBudget(treasuryState);

    logger.info('Operation budgets calculated', {
      buybackBudget,
      liquidityBudget,
    });

    // 5. Execute buyback if budget available
    if (buybackBudget > 0 && treasuryState.usdcBalance > 0) {
      const buybackAmount = Math.min(
        buybackBudget,
        treasuryState.usdcBalance,
        this.config.limits.maxUsdcPerCycle
      );

      if (buybackAmount > 0) {
        logger.info('Executing buyback', { buybackAmount });
        await this.buybackExecutor.executeBuyback(buybackAmount);
      }
    }

    // 6. Add liquidity if budget available
    if (liquidityBudget > 0 && treasuryState.usdcBalance > 0) {
      const liquidityAmount = Math.min(
        liquidityBudget,
        treasuryState.usdcBalance,
        this.config.limits.maxUsdcPerCycle
      );

      if (liquidityAmount > 0) {
        logger.info('Adding liquidity', { liquidityAmount });
        await this.liquidityManager.addLiquidity(liquidityAmount);
      }
    }

    logger.info('Keeper cycle complete');
  }

  private async swapSolToUsdc(solAmount: number): Promise<number> {
    try {
      const quote = await this.jupiter.getQuote(
        'So11111111111111111111111111111111111111112', // SOL mint
        this.config.usdcMint,
        solAmount,
        this.config.limits.slippageBps
      );

      if (this.config.dryRun) {
        logger.info('[DRY RUN] Would swap SOL to USDC', {
          solAmount,
          estimatedUsdc: quote.outAmount,
          priceImpact: quote.priceImpactPct,
        });
        return quote.outAmount;
      }

      const result = await this.jupiter.executeSwap(quote);
      logger.info('SOL -> USDC swap executed', {
        signature: result.signature,
        usdcReceived: result.outputAmount,
      });

      return result.outputAmount;
    } catch (error) {
      logger.error('Failed to swap SOL to USDC', { error });
      return 0;
    }
  }

  private calculateBuybackBudget(treasuryState: any): number {
    const totalBudget =
      treasuryState.totalUsdcConverted * this.config.allocations.buyback;
    const remaining = totalBudget - treasuryState.totalBuybacksUsdc;
    return Math.max(0, remaining);
  }

  private calculateLiquidityBudget(treasuryState: any): number {
    const totalBudget =
      treasuryState.totalUsdcConverted * this.config.allocations.liquidity;
    const remaining = totalBudget - treasuryState.totalLiquidityUsdc;
    return Math.max(0, remaining);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  stop(): void {
    logger.info('Stopping keeper bot...');
    this.isRunning = false;
  }
}

// Main execution
async function main() {
  const keeper = new KeeperBot();

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    logger.info('Received SIGINT, shutting down...');
    keeper.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    logger.info('Received SIGTERM, shutting down...');
    keeper.stop();
    process.exit(0);
  });

  await keeper.start();
}

if (require.main === module) {
  main().catch((error) => {
    logger.error('Fatal error', { error });
    process.exit(1);
  });
}

export { KeeperBot };
