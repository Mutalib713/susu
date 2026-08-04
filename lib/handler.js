// Core relayer logic, shared by the local server and the Vercel function.
// This is the piece that makes the wallet invisible: the member signs a note in their
// browser, this carries it onchain and pays the gas out of the relayer's own balance.
const fs = require('fs');
const path = require('path');
// Explicit path: the server may be launched from a parent directory.
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { ethers } = require('ethers');

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

// Dated history, read straight from the chain's own event log. A susu book is a dated
// record first and a total second, so this is the part that makes it a book.
let fromBlock = null;
const blockTimes = new Map();

async function blockTime(n) {
  if (!blockTimes.has(n)) blockTimes.set(n, (await provider.getBlock(n)).timestamp);
  return blockTimes.get(n);
}

async function activity() {
  if (fromBlock === null) {
    const r = await provider.getTransactionReceipt(deployment.deployTx);
    fromBlock = r ? r.blockNumber : 0;
  }

  const [gaveIn, paidOut] = await Promise.all([
    susu.queryFilter(susu.filters.Contributed(), fromBlock, 'latest'),
    susu.queryFilter(susu.filters.PaidOut(), fromBlock, 'latest'),
  ]);

  const rows = await Promise.all(
    [...gaveIn, ...paidOut].map(async (e) => ({
      kind: e.fragment.name === 'PaidOut' ? 'out' : 'in',
      who: e.args[1],
      amount: Number(e.args[2]),
      at: (await blockTime(e.blockNumber)) * 1000,
      txHash: e.transactionHash,
      explorer: explorerTx(e.transactionHash),
    })),
  );

  rows.sort((a, b) => b.at - a.at || b.txHash.localeCompare(a.txHash));
  return { rows: rows.slice(0, 30), now: Date.now() };
}

async function nonceFor({ address }) {
  if (!ethers.isAddress(address)) throw new Error('bad address');
  return { nonce: Number(await susu.nonces(address)) };
}

const routes = { join, contribute, payout, state, nonceFor, activity };

async function handle(action, body) {
  const fn = routes[action];
  if (!fn) throw new Error(`unknown action: ${action}`);
  return fn(body || {});
}

module.exports = { handle, deployment };
