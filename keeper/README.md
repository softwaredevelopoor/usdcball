# USDCBALL Keeper Bot

Autonomous bot that executes treasury operations for the USDCBALL protocol.

## Features

- Monitors treasury SOL balance and swaps to USDC via Jupiter
- Executes buybacks when allocation budget available
- Adds liquidity to DEX pools according to allocation rules
- Respects cooldown periods and per-cycle limits
- DRY_RUN mode for safe testing
- Comprehensive logging and error handling

## Setup

```bash
# Install dependencies
yarn install

# Copy config template
cp config/config.example.json config/config.json

# Edit config.json with your parameters
# Set your wallet path, RPC URL, program addresses, etc.

# Copy environment template
cp .env.example .env

# Build
yarn build
```

## Configuration

Edit `config/config.json`:

```json
{
  "rpcUrl": "https://api.mainnet-beta.solana.com",
  "programId": "YOUR_PROGRAM_ID",
  "treasuryAddress": "YOUR_TREASURY_ADDRESS",
  "dryRun": true,
  ...
}
```

## Running

### Development (with hot reload)
```bash
yarn dev
```

### Production
```bash
yarn start
```

### Simulation Mode
```bash
yarn simulate
# or
DRY_RUN=true yarn dev
```

## How It Works

1. **Monitor**: Checks treasury state every 60 seconds (configurable)
2. **Convert**: Swaps accumulated SOL to USDC when threshold met
3. **Calculate**: Determines buyback and liquidity budgets based on allocations
4. **Execute**: Performs buybacks and LP adds if cooldown and limits allow
5. **Log**: Records all operations with detailed metrics

### Allocation Example

If treasury has converted 1000 USDC total:
- Buyback budget: 500 USDC (50%)
- Liquidity budget: 300 USDC (30%)
- Reserve: 200 USDC (20%)

Bot will execute operations until budgets exhausted, respecting per-cycle limits.

## Safety Features

- **DRY_RUN mode**: Test all logic without executing transactions
- **Cooldown periods**: Prevents over-trading
- **Slippage caps**: Rejects trades with high price impact
- **Per-cycle limits**: Caps maximum USDC per operation
- **Emergency pause**: Respects treasury pause state

## Logging

Logs are written to:
- `logs/combined.log` - All logs
- `logs/error.log` - Errors only
- Console - Real-time output

## Monitoring

The keeper emits structured logs for monitoring:

```json
{
  "level": "info",
  "message": "Buyback executed successfully",
  "signature": "...",
  "usdcSpent": 1000000000,
  "tokensReceived": 1000000000
}
```

Integrate with your monitoring stack (Datadog, Grafana, etc.).

## Testing

```bash
yarn test
```

## Troubleshooting

### "Config file not found"
- Ensure `config/config.json` exists
- Or set `CONFIG_PATH` environment variable

### "Cooldown period active"
- Wait for cooldown to expire
- Or adjust `cooldownMinutes` in config

### "Exceeds allocation budget"
- Check treasury state
- Verify allocations in config match program state

## Production Checklist

- [ ] Set `dryRun: false` in config
- [ ] Configure real wallet path
- [ ] Set production RPC endpoint
- [ ] Configure monitoring/alerting
- [ ] Test emergency procedures
- [ ] Set up log rotation
- [ ] Enable process manager (PM2, systemd)

## License

MIT
