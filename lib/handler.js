// Core relayer logic, shared by the local server and the Vercel function.
// This is the piece that makes the wallet invisible: the member signs a note in their
// browser, this carries it onchain and pays the gas out of the relayer's own balance.
require('dotenv').config();
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

const artifact = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'build', 'Susu.json'), 'utf8'));
const deployment = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'build', 'deployment.json'), 'utf8'));

const STARTING_BALANCE = 50000; // GHS 500.00, in pesewas
const MAX_CONTRIBUTION = 20000; // GHS 200.00 ceiling, so a bad actor can't drain the relayer

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const relayer = new ethers.Wallet(process.env.RELAYER_KEY, provider);
const susu = new ethers.Contract(deployment.address, artifact.abi, relayer);

const explorerTx = (hash) => `${deployment.explorer}/tx/${hash}`;

async function join({ address, handle }) {
  if (!ethers.isAddress(address)) throw new Error('bad address');
  const clean = String(handle || '').slice(0, 32).trim() || 'member';

  const already = await susu.isMember(address);
  const tx = await susu.join(address, clean, already ? 0 : STARTING_BALANCE);
  await tx.wait();

  return { ok: true, txHash: tx.hash, explorer: explorerTx(tx.hash), returning: already };
}

async function contribute({ member, amount, signature }) {
  if (!ethers.isAddress(member)) throw new Error('bad address');

  const amt = Number(amount);
  if (!Number.isInteger(amt) || amt <= 0) throw new Error('bad amount');
  if (amt > MAX_CONTRIBUTION) throw new Error('over the GHS 200.00 limit');

  const { v, r, s } = ethers.Signature.from(signature);
  const tx = await susu.contributeWithSig(member, amt, v, r, s);
  await tx.wait();

  return { ok: true, txHash: tx.hash, explorer: explorerTx(tx.hash) };
}

async function payout({ to }) {
  if (!ethers.isAddress(to)) throw new Error('bad address');
  const tx = await susu.payout(to);
  await tx.wait();
  return { ok: true, txHash: tx.hash, explorer: explorerTx(tx.hash) };
}

async function state() {
  const [addrs, handles, balances, gave] = await susu.snapshot();
  const pot = await susu.pot();
  const rounds = await susu.roundsPaid();

  return {
    contract: deployment.address,
    chainId: deployment.chainId,
    explorer: deployment.explorer,
    contractUrl: `${deployment.explorer}/address/${deployment.address}`,
    domain: { name: 'Susu', version: '1', chainId: deployment.chainId, verifyingContract: deployment.address },
    pot: Number(pot),
    rounds: Number(rounds),
    maxContribution: MAX_CONTRIBUTION,
    members: addrs.map((a, i) => ({
      address: a,
      handle: handles[i],
      balance: Number(balances[i]),
      contributed: Number(gave[i]),
    })),
  };
}

async function nonceFor(address) {
  return { nonce: Number(await susu.nonces(address)) };
}

const routes = { join, contribute, payout, state, nonceFor };

async function handle(action, body) {
  const fn = routes[action];
  if (!fn) throw new Error(`unknown action: ${action}`);
  return fn(body || {});
}

module.exports = { handle, deployment };
