# USDCBALL

**$USDCBALL is the first token in the world that automatically uses USDC to marketmake itself.**

---

## Overview

USDCBALL is an autonomous Solana token protocol that fundamentally rethinks treasury management and market making. Instead of accumulating volatile SOL in a treasury, USDCBALL automatically converts all creator fees into USDC and deploys that stable capital to:

- **Market-make its own token** by adding DEX liquidity
- **Execute strategic buybacks** to support price structure
- **Optionally burn tokens** to reduce circulating supply
- **Publish all treasury operations** transparently onchain

The result is a self-reinforcing mechanism where fee accumulation directly translates into deeper liquidity and tighter spreads—without relying on external market makers or multisig interventions.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         USDCBALL                            │
│                                                             │
│  Creator Fees (SOL) → Treasury → Swap to USDC              │
│                                     ↓                       │
│                          ┌──────────┴──────────┐           │
│                          │                     │           │
│                    50% Buybacks          30% LP Adds       │
│                          │                     │           │
│                    Execute via Jupiter   Raydium/Orca      │
│                          │                     │           │
│                    Optional Burn         20% Reserve       │
└─────────────────────────────────────────────────────────────┘
```

---

## Repository Structure

```
usdcball/
├── program/              # Anchor smart contract (Rust)
│   ├── programs/
│   │   └── usdcball/
│   └── tests/
├── keeper/               # Automated bot (TypeScript)
│   ├── src/
│   └── config/
├── dashboard/            # Next.js frontend
│   ├── src/
│   │   ├── app/
│   │   ├── components/
│   │   └── lib/
│   └── public/
├── docs/                 # Documentation
│   ├── overview.md
│   ├── tokenomics.md
│   ├── architecture.md
│   ├── risks.md
│   └── automation-model.md
└── scripts/              # Deployment and simulation
    ├── deploy.md
    ├── config.example.json
    └── local-simulation.md
```

---

## Mechanism

### Fee Collection
All creator fees (default: 2%) are collected in SOL and routed to the protocol treasury account.

### Automatic Conversion
The keeper bot monitors the treasury balance and automatically swaps accumulated SOL into USDC via Jupiter aggregator, minimizing slippage and price impact.

### Capital Deployment
USDC is deployed according to configurable allocation rules:

- **50%** — Buybacks executed at market via Jupiter
- **30%** — Liquidity provision to DEX pools
- **20%** — Strategic reserve for governance or emergency operations

### Safety Controls
- Emergency pause mechanism
- Slippage caps (configurable)
- Per-cycle USDC limits
- Cooldown periods between operations
- Frequency controls to prevent over-trading

---

## Tokenomics

| Parameter | Value |
|-----------|-------|
| Creator Fee | 2% (configurable) |
| Buyback Allocation | 50% of USDC |
| LP Allocation | 30% of USDC |
| Reserve Allocation | 20% of USDC |
| Slippage Cap | 2% (configurable) |
| Min Cooldown | 1 hour (configurable) |
| Max USDC per Cycle | 10,000 USDC (configurable) |

See [docs/tokenomics.md](docs/tokenomics.md) for detailed breakdown.

---

## Components

### 1. Smart Contract (`/program`)

Anchor-based Solana program written in Rust.

**Key Instructions:**
- `initialize` — Set up treasury and configuration
- `record_fee` — Log incoming SOL fees
- `execute_buyback` — Execute USDC → token buyback
- `add_liquidity` — Deploy USDC to LP pools
- `emergency_pause` — Halt all operations

**Accounts:**
- `Treasury` — Holds SOL, USDC, and configuration state
- `OperationLog` — Records all treasury operations onchain

### 2. Keeper Bot (`/keeper`)

Autonomous TypeScript bot that orchestrates treasury operations.

**Capabilities:**
- Monitor treasury balance in real-time
- Swap SOL → USDC via Jupiter
- Execute buybacks when conditions met
- Add liquidity to configured pools
- DRY_RUN simulation mode
- Comprehensive logging and error handling

**Configuration:**
```json
{
  "rpcUrl": "https://api.mainnet-beta.solana.com",
  "treasuryAddress": "...",
  "jupiterApiUrl": "https://quote-api.jup.ag/v6",
  "dryRun": true,
  "allocations": {
    "buyback": 0.5,
    "liquidity": 0.3,
    "reserve": 0.2
  },
  "limits": {
    "maxUsdcPerCycle": 10000,
    "cooldownMinutes": 60,
    "slippageBps": 200
  }
}
```

### 3. Dashboard (`/dashboard`)

Next.js application providing real-time transparency.

**Features:**
- Treasury balance tracking (SOL / USDC)
- Total buybacks executed (USD value)
- Total USDC deployed to liquidity
- Burned supply tracker
- LP depth visualization
- Recent operations feed
- NAV calculation (USDC per circulating token)

Clean, cyber-native DeFi aesthetic with real-time WebSocket updates.

### 4. Documentation (`/docs`)

Comprehensive protocol documentation:
- **overview.md** — High-level mechanism description
- **tokenomics.md** — Economic model and parameters
- **architecture.md** — Technical implementation details
- **risks.md** — Security considerations and attack vectors
- **automation-model.md** — Keeper bot operation and failsafes

### 5. Scripts (`/scripts`)

Deployment and testing utilities:
- **deploy.md** — Step-by-step deployment guide
- **config.example.json** — Template configuration
- **local-simulation.md** — Run local devnet simulations

---

## Getting Started

### Prerequisites

```bash
# Install Rust and Solana CLI
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
sh -c "$(curl -sSfL https://release.solana.com/stable/install)"

# Install Anchor
cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
avm install latest
avm use latest

# Install Node.js dependencies
npm install -g yarn
```

### Build Smart Contract

```bash
cd program
anchor build
anchor test
```

### Run Keeper (Simulation Mode)

```bash
cd keeper
yarn install
cp config/config.example.json config/config.json
# Edit config.json and set "dryRun": true
yarn dev
```

### Run Dashboard

```bash
cd dashboard
yarn install
yarn dev
# Open http://localhost:3000
```

---

## Deployment

See [scripts/deploy.md](scripts/deploy.md) for complete deployment instructions.

**Quick Deploy:**

```bash
# 1. Deploy program
cd program
anchor build
anchor deploy

# 2. Initialize treasury
anchor run initialize

# 3. Configure keeper
cd ../keeper
cp config/config.example.json config/config.json
# Update config with deployed program ID and treasury address

# 4. Start keeper
yarn start

# 5. Deploy dashboard
cd ../dashboard
yarn build
# Deploy to Vercel or similar
```

---

## Simulation

The keeper supports `DRY_RUN` mode for testing without executing real transactions:

```bash
cd keeper
export DRY_RUN=true
yarn dev
```

This will:
- Mock all swap and buyback operations
- Simulate treasury state changes
- Log all intended operations to console
- Allow testing of logic without onchain cost

See [scripts/local-simulation.md](scripts/local-simulation.md) for detailed simulation scenarios.

---

## Security

**Audited Components:**
- Treasury account logic
- Fee collection mechanism
- Slippage controls

**Known Considerations:**
- Keeper bot is permissioned (requires trusted operator or decentralized governance)
- Oracle dependency for price feeds (Jupiter TWAP)
- DEX dependency for liquidity operations
- Emergency pause does not affect existing LP positions

See [docs/risks.md](docs/risks.md) for comprehensive risk analysis.

---

## Transparency

All treasury operations are recorded onchain in the `OperationLog` account.

Each log entry includes:
- Timestamp
- Operation type (swap, buyback, LP add)
- Input amount and token
- Output amount and token
- Execution price
- Slippage incurred

The dashboard surfaces this data in real-time, providing complete transparency into protocol operations.

---

## Contributing

This is an experimental protocol. Contributions welcome via:

1. Fork the repository
2. Create a feature branch
3. Submit a pull request with detailed description

**Areas for contribution:**
- Additional DEX integrations
- Governance mechanisms
- Enhanced keeper strategies
- Dashboard improvements
- Security testing

---

## License

MIT License - see LICENSE file for details.

---

## Disclaimer

This is experimental software. Use at your own risk. No guarantees of performance, security, or suitability for any purpose. Conduct your own research and audit before deploying with real capital.

---

**Built with:**
- Solana & Anchor
- Jupiter Aggregator
- Next.js & React
- TypeScript

**Follow development:**
- Documentation: [/docs](docs/)
- Issues: [GitHub Issues](https://github.com/softwaredevelopoor/usdcball/issues)

---

*USDCBALL — Autonomous market making through stable treasury management.*