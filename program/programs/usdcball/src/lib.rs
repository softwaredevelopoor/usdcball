use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

declare_id!("USDCbaf11111111111111111111111111111111111");

#[program]
pub mod usdcball {
    use super::*;

    /// Initialize the treasury with configuration parameters
    pub fn initialize(
        ctx: Context<Initialize>,
        buyback_allocation_bps: u16,
        liquidity_allocation_bps: u16,
        reserve_allocation_bps: u16,
        max_usdc_per_cycle: u64,
        cooldown_seconds: i64,
        slippage_bps: u16,
    ) -> Result<()> {
        require!(
            buyback_allocation_bps + liquidity_allocation_bps + reserve_allocation_bps == 10000,
            ErrorCode::InvalidAllocation
        );
        require!(slippage_bps <= 1000, ErrorCode::SlippageTooHigh); // Max 10%

        let treasury = &mut ctx.accounts.treasury;
        treasury.authority = ctx.accounts.authority.key();
        treasury.buyback_allocation_bps = buyback_allocation_bps;
        treasury.liquidity_allocation_bps = liquidity_allocation_bps;
        treasury.reserve_allocation_bps = reserve_allocation_bps;
        treasury.max_usdc_per_cycle = max_usdc_per_cycle;
        treasury.cooldown_seconds = cooldown_seconds;
        treasury.slippage_bps = slippage_bps;
        treasury.total_sol_collected = 0;
        treasury.total_usdc_converted = 0;
        treasury.total_buybacks_usdc = 0;
        treasury.total_liquidity_usdc = 0;
        treasury.total_tokens_burned = 0;
        treasury.last_operation_timestamp = 0;
        treasury.paused = false;
        treasury.bump = ctx.bumps.treasury;

        emit!(TreasuryInitialized {
            authority: treasury.authority,
            buyback_allocation_bps,
            liquidity_allocation_bps,
            reserve_allocation_bps,
        });

        Ok(())
    }

    /// Record incoming SOL fees to the treasury
    pub fn record_fee(ctx: Context<RecordFee>, amount: u64) -> Result<()> {
        let treasury = &mut ctx.accounts.treasury;
        require!(!treasury.paused, ErrorCode::Paused);

        treasury.total_sol_collected = treasury
            .total_sol_collected
            .checked_add(amount)
            .ok_or(ErrorCode::Overflow)?;

        emit!(FeeRecorded {
            amount,
            total_collected: treasury.total_sol_collected,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    /// Execute a buyback operation (USDC -> USDCBALL token)
    pub fn execute_buyback(
        ctx: Context<ExecuteBuyback>,
        usdc_amount: u64,
        min_tokens_out: u64,
    ) -> Result<()> {
        let treasury = &mut ctx.accounts.treasury;
        require!(!treasury.paused, ErrorCode::Paused);

        // Check cooldown
        let clock = Clock::get()?;
        let time_since_last = clock.unix_timestamp - treasury.last_operation_timestamp;
        require!(
            time_since_last >= treasury.cooldown_seconds,
            ErrorCode::CooldownNotMet
        );

        // Check per-cycle limit
        require!(
            usdc_amount <= treasury.max_usdc_per_cycle,
            ErrorCode::ExceedsMaxPerCycle
        );

        // Verify allocation
        let max_buyback = (treasury.total_usdc_converted as u128)
            .checked_mul(treasury.buyback_allocation_bps as u128)
            .ok_or(ErrorCode::Overflow)?
            .checked_div(10000)
            .ok_or(ErrorCode::Overflow)? as u64;

        require!(
            treasury.total_buybacks_usdc + usdc_amount <= max_buyback,
            ErrorCode::ExceedsAllocation
        );

        // Transfer USDC from treasury to Jupiter/DEX for swap
        let seeds = &[
            b"treasury".as_ref(),
            &[treasury.bump],
        ];
        let signer = &[&seeds[..]];

        let cpi_accounts = Transfer {
            from: ctx.accounts.treasury_usdc.to_account_info(),
            to: ctx.accounts.destination_usdc.to_account_info(),
            authority: ctx.accounts.treasury.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::transfer(cpi_ctx, usdc_amount)?;

        // Update state
        treasury.total_buybacks_usdc = treasury
            .total_buybacks_usdc
            .checked_add(usdc_amount)
            .ok_or(ErrorCode::Overflow)?;
        treasury.last_operation_timestamp = clock.unix_timestamp;

        emit!(BuybackExecuted {
            usdc_amount,
            min_tokens_out,
            timestamp: clock.unix_timestamp,
        });

        Ok(())
    }

    /// Add liquidity to DEX pool
    pub fn add_liquidity(
        ctx: Context<AddLiquidity>,
        usdc_amount: u64,
        token_amount: u64,
    ) -> Result<()> {
        let treasury = &mut ctx.accounts.treasury;
        require!(!treasury.paused, ErrorCode::Paused);

        let clock = Clock::get()?;
        let time_since_last = clock.unix_timestamp - treasury.last_operation_timestamp;
        require!(
            time_since_last >= treasury.cooldown_seconds,
            ErrorCode::CooldownNotMet
        );

        require!(
            usdc_amount <= treasury.max_usdc_per_cycle,
            ErrorCode::ExceedsMaxPerCycle
        );

        // Verify allocation
        let max_liquidity = (treasury.total_usdc_converted as u128)
            .checked_mul(treasury.liquidity_allocation_bps as u128)
            .ok_or(ErrorCode::Overflow)?
            .checked_div(10000)
            .ok_or(ErrorCode::Overflow)? as u64;

        require!(
            treasury.total_liquidity_usdc + usdc_amount <= max_liquidity,
            ErrorCode::ExceedsAllocation
        );

        // Transfer USDC to LP pool
        let seeds = &[
            b"treasury".as_ref(),
            &[treasury.bump],
        ];
        let signer = &[&seeds[..]];

        let cpi_accounts = Transfer {
            from: ctx.accounts.treasury_usdc.to_account_info(),
            to: ctx.accounts.pool_usdc.to_account_info(),
            authority: ctx.accounts.treasury.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::transfer(cpi_ctx, usdc_amount)?;

        // Update state
        treasury.total_liquidity_usdc = treasury
            .total_liquidity_usdc
            .checked_add(usdc_amount)
            .ok_or(ErrorCode::Overflow)?;
        treasury.last_operation_timestamp = clock.unix_timestamp;

        emit!(LiquidityAdded {
            usdc_amount,
            token_amount,
            timestamp: clock.unix_timestamp,
        });

        Ok(())
    }

    /// Record USDC conversion from SOL
    pub fn record_usdc_conversion(ctx: Context<RecordConversion>, usdc_amount: u64) -> Result<()> {
        let treasury = &mut ctx.accounts.treasury;
        require!(!treasury.paused, ErrorCode::Paused);

        treasury.total_usdc_converted = treasury
            .total_usdc_converted
            .checked_add(usdc_amount)
            .ok_or(ErrorCode::Overflow)?;

        emit!(UsdcConverted {
            amount: usdc_amount,
            total_converted: treasury.total_usdc_converted,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    /// Emergency pause all operations
    pub fn emergency_pause(ctx: Context<EmergencyAction>) -> Result<()> {
        let treasury = &mut ctx.accounts.treasury;
        treasury.paused = true;

        emit!(EmergencyPaused {
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    /// Resume operations after pause
    pub fn resume(ctx: Context<EmergencyAction>) -> Result<()> {
        let treasury = &mut ctx.accounts.treasury;
        treasury.paused = false;

        emit!(OperationsResumed {
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    /// Update treasury configuration
    pub fn update_config(
        ctx: Context<UpdateConfig>,
        max_usdc_per_cycle: Option<u64>,
        cooldown_seconds: Option<i64>,
        slippage_bps: Option<u16>,
    ) -> Result<()> {
        let treasury = &mut ctx.accounts.treasury;

        if let Some(max_cycle) = max_usdc_per_cycle {
            treasury.max_usdc_per_cycle = max_cycle;
        }

        if let Some(cooldown) = cooldown_seconds {
            treasury.cooldown_seconds = cooldown;
        }

        if let Some(slippage) = slippage_bps {
            require!(slippage <= 1000, ErrorCode::SlippageTooHigh);
            treasury.slippage_bps = slippage;
        }

        emit!(ConfigUpdated {
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }
}

// ============================================================================
// Accounts
// ============================================================================

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + Treasury::INIT_SPACE,
        seeds = [b"treasury"],
        bump
    )]
    pub treasury: Account<'info, Treasury>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RecordFee<'info> {
    #[account(
        mut,
        seeds = [b"treasury"],
        bump = treasury.bump,
    )]
    pub treasury: Account<'info, Treasury>,
}

#[derive(Accounts)]
pub struct ExecuteBuyback<'info> {
    #[account(
        mut,
        seeds = [b"treasury"],
        bump = treasury.bump,
    )]
    pub treasury: Account<'info, Treasury>,

    #[account(mut)]
    pub treasury_usdc: Account<'info, TokenAccount>,

    #[account(mut)]
    pub destination_usdc: Account<'info, TokenAccount>,

    #[account(
        constraint = authority.key() == treasury.authority
    )]
    pub authority: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct AddLiquidity<'info> {
    #[account(
        mut,
        seeds = [b"treasury"],
        bump = treasury.bump,
    )]
    pub treasury: Account<'info, Treasury>,

    #[account(mut)]
    pub treasury_usdc: Account<'info, TokenAccount>,

    #[account(mut)]
    pub pool_usdc: Account<'info, TokenAccount>,

    #[account(
        constraint = authority.key() == treasury.authority
    )]
    pub authority: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct RecordConversion<'info> {
    #[account(
        mut,
        seeds = [b"treasury"],
        bump = treasury.bump,
    )]
    pub treasury: Account<'info, Treasury>,

    #[account(
        constraint = authority.key() == treasury.authority
    )]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct EmergencyAction<'info> {
    #[account(
        mut,
        seeds = [b"treasury"],
        bump = treasury.bump,
    )]
    pub treasury: Account<'info, Treasury>,

    #[account(
        constraint = authority.key() == treasury.authority
    )]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    #[account(
        mut,
        seeds = [b"treasury"],
        bump = treasury.bump,
    )]
    pub treasury: Account<'info, Treasury>,

    #[account(
        constraint = authority.key() == treasury.authority
    )]
    pub authority: Signer<'info>,
}

// ============================================================================
// State
// ============================================================================

#[account]
#[derive(InitSpace)]
pub struct Treasury {
    pub authority: Pubkey,
    pub buyback_allocation_bps: u16,
    pub liquidity_allocation_bps: u16,
    pub reserve_allocation_bps: u16,
    pub max_usdc_per_cycle: u64,
    pub cooldown_seconds: i64,
    pub slippage_bps: u16,
    pub total_sol_collected: u64,
    pub total_usdc_converted: u64,
    pub total_buybacks_usdc: u64,
    pub total_liquidity_usdc: u64,
    pub total_tokens_burned: u64,
    pub last_operation_timestamp: i64,
    pub paused: bool,
    pub bump: u8,
}

// ============================================================================
// Events
// ============================================================================

#[event]
pub struct TreasuryInitialized {
    pub authority: Pubkey,
    pub buyback_allocation_bps: u16,
    pub liquidity_allocation_bps: u16,
    pub reserve_allocation_bps: u16,
}

#[event]
pub struct FeeRecorded {
    pub amount: u64,
    pub total_collected: u64,
    pub timestamp: i64,
}

#[event]
pub struct UsdcConverted {
    pub amount: u64,
    pub total_converted: u64,
    pub timestamp: i64,
}

#[event]
pub struct BuybackExecuted {
    pub usdc_amount: u64,
    pub min_tokens_out: u64,
    pub timestamp: i64,
}

#[event]
pub struct LiquidityAdded {
    pub usdc_amount: u64,
    pub token_amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct EmergencyPaused {
    pub timestamp: i64,
}

#[event]
pub struct OperationsResumed {
    pub timestamp: i64,
}

#[event]
pub struct ConfigUpdated {
    pub timestamp: i64,
}

// ============================================================================
// Errors
// ============================================================================

#[error_code]
pub enum ErrorCode {
    #[msg("Allocations must sum to 100% (10000 bps)")]
    InvalidAllocation,
    #[msg("Slippage tolerance too high (max 10%)")]
    SlippageTooHigh,
    #[msg("Operations are paused")]
    Paused,
    #[msg("Cooldown period not met")]
    CooldownNotMet,
    #[msg("Exceeds maximum USDC per cycle")]
    ExceedsMaxPerCycle,
    #[msg("Exceeds allocation budget")]
    ExceedsAllocation,
    #[msg("Arithmetic overflow")]
    Overflow,
}
