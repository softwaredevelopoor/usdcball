import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Usdcball } from "../target/types/usdcball";
import { expect } from "chai";

describe("usdcball", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Usdcball as Program<Usdcball>;

  let treasuryPda: anchor.web3.PublicKey;
  let treasuryBump: number;

  before(async () => {
    [treasuryPda, treasuryBump] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("treasury")],
      program.programId
    );
  });

  it("Initializes the treasury", async () => {
    const tx = await program.methods
      .initialize(
        5000, // 50% buybacks
        3000, // 30% liquidity
        2000, // 20% reserve
        new anchor.BN(10_000_000_000), // 10,000 USDC max per cycle (6 decimals)
        new anchor.BN(3600), // 1 hour cooldown
        200 // 2% slippage
      )
      .accounts({
        treasury: treasuryPda,
        authority: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const treasury = await program.account.treasury.fetch(treasuryPda);

    expect(treasury.authority.toString()).to.equal(
      provider.wallet.publicKey.toString()
    );
    expect(treasury.buybackAllocationBps).to.equal(5000);
    expect(treasury.liquidityAllocationBps).to.equal(3000);
    expect(treasury.reserveAllocationBps).to.equal(2000);
    expect(treasury.slippageBps).to.equal(200);
    expect(treasury.paused).to.equal(false);
  });

  it("Records SOL fees", async () => {
    const feeAmount = new anchor.BN(1_000_000_000); // 1 SOL

    await program.methods
      .recordFee(feeAmount)
      .accounts({
        treasury: treasuryPda,
      })
      .rpc();

    const treasury = await program.account.treasury.fetch(treasuryPda);
    expect(treasury.totalSolCollected.toString()).to.equal(
      feeAmount.toString()
    );
  });

  it("Records USDC conversion", async () => {
    const usdcAmount = new anchor.BN(100_000_000); // 100 USDC

    await program.methods
      .recordUsdcConversion(usdcAmount)
      .accounts({
        treasury: treasuryPda,
        authority: provider.wallet.publicKey,
      })
      .rpc();

    const treasury = await program.account.treasury.fetch(treasuryPda);
    expect(treasury.totalUsdcConverted.toString()).to.equal(
      usdcAmount.toString()
    );
  });

  it("Emergency pause works", async () => {
    await program.methods
      .emergencyPause()
      .accounts({
        treasury: treasuryPda,
        authority: provider.wallet.publicKey,
      })
      .rpc();

    const treasury = await program.account.treasury.fetch(treasuryPda);
    expect(treasury.paused).to.equal(true);
  });

  it("Resume works", async () => {
    await program.methods
      .resume()
      .accounts({
        treasury: treasuryPda,
        authority: provider.wallet.publicKey,
      })
      .rpc();

    const treasury = await program.account.treasury.fetch(treasuryPda);
    expect(treasury.paused).to.equal(false);
  });

  it("Config update works", async () => {
    const newMaxUsdc = new anchor.BN(20_000_000_000); // 20,000 USDC

    await program.methods
      .updateConfig(newMaxUsdc, null, null)
      .accounts({
        treasury: treasuryPda,
        authority: provider.wallet.publicKey,
      })
      .rpc();

    const treasury = await program.account.treasury.fetch(treasuryPda);
    expect(treasury.maxUsdcPerCycle.toString()).to.equal(
      newMaxUsdc.toString()
    );
  });

  it("Rejects invalid allocations", async () => {
    const [invalidTreasuryPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("treasury2")],
      program.programId
    );

    try {
      await program.methods
        .initialize(
          6000, // 60% - invalid
          3000, // 30%
          2000, // 20%
          new anchor.BN(10_000_000_000),
          new anchor.BN(3600),
          200
        )
        .accounts({
          treasury: invalidTreasuryPda,
          authority: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
      expect.fail("Should have thrown error");
    } catch (err) {
      expect(err.toString()).to.include("InvalidAllocation");
    }
  });
});
