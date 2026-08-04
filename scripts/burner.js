// Generates the throwaway deployer/relayer key. Testnet only, abandoned after the demo.
// Writes .env (gitignored). Never commit this key, never reuse it for anything real.
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env');

if (fs.existsSync(envPath) && /RELAYER_KEY=0x[0-9a-fA-F]{64}/.test(fs.readFileSync(envPath, 'utf8'))) {
  const existing = fs.readFileSync(envPath, 'utf8').match(/RELAYER_KEY=(0x[0-9a-fA-F]{64})/)[1];
  console.log('Burner already exists.');
  console.log('ADDRESS:', new ethers.Wallet(existing).address);
  process.exit(0);
}

const w = ethers.Wallet.createRandom();
fs.writeFileSync(
  envPath,
  [
    `RELAYER_KEY=${w.privateKey}`,
    `RPC_URL=https://sepolia.base.org`,
    `CHAIN_ID=84532`,
    ``,
  ].join('\n'),
);

console.log('ADDRESS:', w.address);
