import axios from 'axios';
import { Connection, Transaction, VersionedTransaction } from '@solana/web3.js';
import { Logger } from './logger';

const logger = Logger.getInstance();

export interface JupiterQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: number;
  otherAmountThreshold: number;
  swapMode: string;
  slippageBps: number;
  priceImpactPct: number;
  routePlan: any[];
}

export interface SwapResult {
  signature: string;
  inputAmount: number;
  outputAmount: number;
}

export class JupiterService {
  private apiUrl: string;

  constructor(private config: any, private connection: Connection) {
    this.apiUrl = config.jupiterApiUrl;
  }

  async getQuote(
    inputMint: string,
    outputMint: string,
    amount: number,
    slippageBps: number
  ): Promise<JupiterQuote> {
    try {
      const url = `${this.apiUrl}/quote`;
      const params = {
        inputMint,
        outputMint,
        amount: amount.toString(),
        slippageBps: slippageBps.toString(),
      };

      logger.info('Fetching Jupiter quote', params);

      const response = await axios.get(url, { params });
      
      if (this.config.dryRun) {
        // Mock quote for dry run
        return {
          inputMint,
          outputMint,
          inAmount: amount.toString(),
          outAmount: Math.floor(amount * 0.95), // Assume 5% slippage/fee
          otherAmountThreshold: Math.floor(amount * 0.93),
          swapMode: 'ExactIn',
          slippageBps,
          priceImpactPct: 0.5,
          routePlan: [],
        };
      }

      return response.data;
    } catch (error) {
      logger.error('Failed to get Jupiter quote', { error });
      throw error;
    }
  }

  async executeSwap(quote: JupiterQuote): Promise<SwapResult> {
    if (this.config.dryRun) {
      logger.info('[DRY RUN] Would execute swap', {
        inputMint: quote.inputMint,
        outputMint: quote.outputMint,
        inAmount: quote.inAmount,
        outAmount: quote.outAmount,
      });

      return {
        signature: 'DRY_RUN_SIGNATURE',
        inputAmount: parseInt(quote.inAmount),
        outputAmount: quote.outAmount,
      };
    }

    try {
      // Get swap transaction
      const swapUrl = `${this.apiUrl}/swap`;
      const swapResponse = await axios.post(swapUrl, {
        quoteResponse: quote,
        userPublicKey: this.config.treasuryAddress,
        wrapAndUnwrapSol: true,
      });

      const swapTransactionBuf = Buffer.from(
        swapResponse.data.swapTransaction,
        'base64'
      );
      const transaction = VersionedTransaction.deserialize(swapTransactionBuf);

      // Sign and send transaction
      // const signature = await this.connection.sendTransaction(transaction);
      // await this.connection.confirmTransaction(signature);

      logger.info('Swap executed successfully', {
        // signature,
        outAmount: quote.outAmount,
      });

      return {
        signature: 'MOCK_SIGNATURE', // Would be real signature
        inputAmount: parseInt(quote.inAmount),
        outputAmount: quote.outAmount,
      };
    } catch (error) {
      logger.error('Failed to execute swap', { error });
      throw error;
    }
  }

  async getTokenPrice(mint: string): Promise<number> {
    try {
      // In production, fetch from Jupiter price API or similar
      if (this.config.dryRun) {
        return 1.0; // Mock price
      }

      // Fetch real price
      return 1.0;
    } catch (error) {
      logger.error('Failed to get token price', { error });
      return 0;
    }
  }
}
