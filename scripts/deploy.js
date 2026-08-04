require('dotenv').config();
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

(async () => {
  const artifact = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'build', 'Susu.json'), 'utf8'));
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const wallet = new ethers.Wallet(process.env.RELAYER_KEY, provider);

  const bal = await provider.getBalance(wallet.address);
  console.log('relayer :', wallet.address);
  console.log('balance :', ethers.formatEther(bal), 'ETH');
  if (bal === 0n) {
    console.log('\nNo funds yet. Fund the address above, then run this again.');
    process.exit(1);
  }

  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  const c = await factory.deploy();
  console.log('deploying, tx:', c.deploymentTransaction().hash);
  await c.waitForDeployment();

  const address = await c.getAddress();
  console.log('SUSU DEPLOYED:', address);
  console.log('explorer     :', `${process.env.EXPLORER}/address/${address}`);

  fs.writeFileSync(
    path.join(__dirname, '..', 'build', 'deployment.json'),
    JSON.stringify(
      {
        address,
        chainId: Number(process.env.CHAIN_ID),
        explorer: process.env.EXPLORER,
        deployTx: c.deploymentTransaction().hash,
        deployedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
})().catch((e) => {
  console.error('FAILED:', e.shortMessage || e.message);
  process.exit(1);
});
