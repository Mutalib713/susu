// The relayer. Members sign notes in their browser; this carries them onchain and pays
// the gas, which is what lets a member have no wallet and no ETH.
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { ethers } = require('ethers');
const { MockMoMoProvider, verifyWebhook } = require('./momo');

const deployment = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'build', 'deployment.json'), 'utf8'));
const artifact = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'build', `${deployment.contract}.json`), 'utf8'),
);

const DEMO_TOPUP = 50000; // GHS 500.00 handed to a new member, standing in for a deposit
const MAX_CONTRIBUTION = 50000; // ceiling so a bad actor can't drain the relayer's gas

let RELAYER_KEY = process.env.RELAYER_KEY;
if (!RELAYER_KEY) {
  try {
    RELAYER_KEY = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'build', 'runtime.json'), 'utf8')).relayerKey;
  } catch {
    throw new Error('No relayer key. Set RELAYER_KEY in .env — see README.');
  }
}

// Ghanaian ISPs block or throttle several of the public Sepolia endpoints, and which ones
// varies by network and by hour. Rather than pin one and hope, try them in order and keep
// the first that answers.
const RPC_CANDIDATES = [
  ...(process.env.RPC_URL ? [process.env.RPC_URL] : []),
  ...(process.env.RPC_URLS || '').split(',').map((s) => s.trim()).filter(Boolean),
  'https://1rpc.io/sepolia',
  'https://ethereum-sepolia-rpc.publicnode.com',
  'https://sepolia.drpc.org',
  'https://eth-sepolia.public.blastapi.io',
  'https://rpc.sepolia.org',
].filter((v, i, a) => a.indexOf(v) === i);

const NETWORK = ethers.Network.from(deployment.chainId);
const timeout = (p, ms, what) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} timed out`)), ms))]);

let connection = null;

async function connect() {
  const tried = [];
  for (const url of RPC_CANDIDATES) {
    // batchMaxCount:1 because several free endpoints reject batched JSON-RPC and fail with
    // "could not coalesce error" the moment the app makes concurrent calls.
    const provider = new ethers.JsonRpcProvider(url, NETWORK, {
      staticNetwork: NETWORK,
      batchMaxCount: 1,
    });
    try {
      const head = await timeout(provider.getBlockNumber(), 8000, url);

      // Probe what we actually depend on, over the range we actually ask for. Several free
      // endpoints answer eth_blockNumber happily, then cap eth_getLogs to a short window —
      // 1rpc.io allows 50 blocks — so a short probe passes and the real query fails.
      await timeout(
        provider.getLogs({
          address: deployment.address,
          fromBlock: deployment.deployBlock || Math.max(0, head - 5000),
          toBlock: head,
        }),
        12000,
        `${url} getLogs`,
      );

      const relayer = new ethers.Wallet(RELAYER_KEY, provider);
      console.log('rpc:', url);
      return { provider, relayer, susu: new ethers.Contract(deployment.address, artifact.abi, relayer) };
    } catch (e) {
      tried.push(`${url} (${(e.shortMessage || e.message).slice(0, 30)})`);
      provider.destroy();
    }
  }
  throw new Error(`No Sepolia node reachable. Tried: ${tried.join(', ')}`);
}

// Memoised, but a failure clears it so the next request retries rather than staying wedged.
function conn() {
  if (!connection) connection = connect().catch((e) => { connection = null; throw e; });
  return connection;
}

const explorerTx = (h) => `${deployment.explorer}/tx/${h}`;
const normaliseCode = (code) => String(code || '').trim().toUpperCase();
const hashCode = (code) => ethers.keccak256(ethers.toUtf8Bytes(normaliseCode(code)));
const num = (x) => Number(x);

const requireAddress = (a) => {
  if (!ethers.isAddress(a)) throw new Error('bad address');
  return a;
};

const parseLogs = (susu, receipt) =>
  receipt.logs
    .map((l) => {
      try {
        return susu.interface.parseLog(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

// ------------------------------------------------------------------ circles

async function createCircle({ label, code, owner, amount, roundLength, size }) {
  const { susu } = await conn();
  requireAddress(owner);

  const clean = String(label || '').trim().slice(0, 40) || 'Our circle';
  const c = normaliseCode(code);
  if (!/^[A-Z0-9]{4,16}$/.test(c)) throw new Error('code must be 4-16 letters or numbers');

  const amt = Math.round(Number(amount));
  if (!Number.isInteger(amt) || amt <= 0 || amt > MAX_CONTRIBUTION) throw new Error('bad contribution amount');

  const n = Math.round(Number(size));
  if (!Number.isInteger(n) || n < 2 || n > 20) throw new Error('a circle holds between 2 and 20 people');

  const secs = Math.round(Number(roundLength));
  if (!Number.isInteger(secs) || secs < 60) throw new Error('rounds must be at least a minute long');

  const [exists] = await susu.circleByCode(hashCode(c));
  if (exists) throw new Error('that code is already taken');

  const tx = await susu.createCircle(clean, hashCode(c), owner, amt, secs, n);
  const receipt = await tx.wait();
  const ev = parseLogs(susu, receipt).find((e) => e.name === 'CircleCreated');

  return { ok: true, circleId: num(ev.args[0]), code: c, txHash: tx.hash, explorer: explorerTx(tx.hash) };
}

async function joinCircle({ code, address, handle: name }) {
  const { susu } = await conn();
  requireAddress(address);
  const c = normaliseCode(code);

  const [exists, circleId] = await susu.circleByCode(hashCode(c));
  if (!exists) throw new Error('no circle with that code');
  if (await susu.isMemberOf(circleId, address)) return { ok: true, circleId: num(circleId), already: true };

  const clean = String(name || '').slice(0, 40).trim() || 'member';
  const tx = await susu.joinCircle(hashCode(c), address, clean);
  await tx.wait();

  // Stand-in for a confirmed mobile money deposit so a new member can actually take part.
  if ((await susu.balanceOf(address)) === 0n) {
    await (await susu.credit(address, DEMO_TOPUP, 'DEMO-WELCOME')).wait();
  }

  return { ok: true, circleId: num(circleId), txHash: tx.hash, explorer: explorerTx(tx.hash) };
}

async function startCircle({ circleId }) {
  const { susu } = await conn();
  const tx = await susu.startCircle(circleId);
  await tx.wait();
  return { ok: true, txHash: tx.hash, explorer: explorerTx(tx.hash) };
}

async function contribute({ circleId, member, amount, round, signature }) {
  const { susu } = await conn();
  requireAddress(member);

  const amt = Math.round(Number(amount));
  if (!Number.isInteger(amt) || amt <= 0 || amt > MAX_CONTRIBUTION) throw new Error('bad amount');

  const { v, r, s } = ethers.Signature.from(signature);
  const tx = await susu.contributeWithSig(circleId, member, amt, round, v, r, s);
  await tx.wait();
  return { ok: true, txHash: tx.hash, explorer: explorerTx(tx.hash) };
}

async function settleRound({ circleId }) {
  const { susu } = await conn();
  const tx = await susu.settleRound(circleId);
  const events = parseLogs(susu, await tx.wait());

  const settled = events.find((e) => e.name === 'RoundSettled');
  const stalled = events.find((e) => e.name === 'RoundStalled');

  return {
    ok: true,
    txHash: tx.hash,
    explorer: explorerTx(tx.hash),
    paidTo: settled ? settled.args[3] : null,
    amount: settled ? num(settled.args[4]) : 0,
    stalled: Boolean(stalled),
    missed: events.filter((e) => e.name === 'TurnMissed').map((e) => e.args[3]),
  };
}

// ------------------------------------------------------------- mobile money

// Guards against the same payment being credited twice inside one process. The chain check
// below covers restarts; this covers a provider retrying within seconds.
const seenRefs = new Set();

/// Called by the payment provider when a customer approves the PIN prompt. Public on purpose:
/// the HMAC signature is what authenticates it, not who is calling.
async function momoWebhook(body, ctx = {}) {
  const raw = ctx.raw || JSON.stringify(body || {});
  const signature = ctx.signature || (ctx.headers || {})['x-momo-signature'];

  let payload;
  try {
    payload = verifyWebhook(raw, signature);
  } catch (e) {
    // Deliberately vague to the caller; the detail goes to our logs, not to whoever is probing.
    console.warn('momo webhook rejected:', e.message);
    throw new Error('webhook rejected');
  }

  const ref = String(payload.reference);
  if (seenRefs.has(ref)) return { ok: true, duplicate: true, reference: ref };

  const { susu } = await conn();
  const alreadyOnChain = (await allEvents()).some((e) => e.name === 'Credited' && String(e.args[2]) === ref);
  if (alreadyOnChain) {
    seenRefs.add(ref);
    return { ok: true, duplicate: true, reference: ref };
  }

  seenRefs.add(ref);
  try {
    const tx = await susu.credit(payload.account, payload.amount, ref.slice(0, 32));
    await tx.wait();
    logCache = { at: 0, rows: [] }; // the credit we just made must be visible to the next check
    return { ok: true, reference: ref, amount: payload.amount, txHash: tx.hash, explorer: explorerTx(tx.hash) };
  } catch (e) {
    seenRefs.delete(ref); // it never landed, so let a retry through
    throw e;
  }
}

/// Starts a top-up. A real provider would push a PIN prompt to the phone and call our webhook
/// when the customer approves. The mock builds and delivers that same signed webhook, so the
/// verification path below is exercised for real — only the network hop is skipped.
async function momoTopUp({ msisdn, amount, account }) {
  requireAddress(account);

  const amt = Math.round(Number(amount));
  if (!Number.isInteger(amt) || amt <= 0 || amt > 100000) throw new Error('enter an amount up to GHS 1,000');

  const { reference, rawBody, signature } = MockMoMoProvider.requestPayment({ msisdn, amount: amt, account });
  const result = await momoWebhook(null, { raw: rawBody, signature });

  return { ...result, reference, simulated: true };
}

/// Stand-in for a confirmed mobile money deposit.
async function topUp({ member, amount, providerRef }) {
  const { susu } = await conn();
  requireAddress(member);

  const amt = Math.round(Number(amount));
  if (!Number.isInteger(amt) || amt <= 0 || amt > 100000) throw new Error('bad amount');

  const tx = await susu.credit(member, amt, String(providerRef || 'MANUAL').slice(0, 32));
  await tx.wait();
  return { ok: true, txHash: tx.hash, explorer: explorerTx(tx.hash) };
}

// -------------------------------------------------------------------- views

// One eth_getLogs for the whole contract, parsed and filtered here. Free endpoints are slow
// enough that three separate filtered queries time out, and this needs one round trip instead.
let logCache = { at: 0, rows: [] };

async function allEvents() {
  if (Date.now() - logCache.at < 4000) return logCache.rows;
  const { susu, provider } = await conn();

  const head = await provider.getBlockNumber();
  const raw = await timeout(
    provider.getLogs({ address: deployment.address, fromBlock: deployment.deployBlock || 0, toBlock: head }),
    25000,
    'reading the book',
  );

  const rows = raw
    .map((l) => {
      try {
        const p = susu.interface.parseLog(l);
        return { name: p.name, args: p.args, blockNumber: l.blockNumber, txHash: l.transactionHash };
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  logCache = { at: Date.now(), rows };
  return rows;
}

async function myCircles({ address }) {
  const { susu } = await conn();
  requireAddress(address);

  const lower = address.toLowerCase();
  const joined = (await allEvents()).filter(
    (e) => e.name === 'Joined' && String(e.args[1]).toLowerCase() === lower,
  );
  const ids = [...new Set(joined.map((e) => num(e.args[0])))];

  const circles = await Promise.all(
    ids.map(async (id) => {
      const [circle, joinedCount] = await susu.circleInfo(id);
      return {
        circleId: id,
        label: circle.label,
        owner: circle.owner,
        contributionAmount: num(circle.contributionAmount),
        size: num(circle.size),
        joined: num(joinedCount),
        currentRound: num(circle.currentRound),
        pot: num(circle.pot),
        started: circle.started,
        finished: circle.finished,
        isOwner: circle.owner.toLowerCase() === address.toLowerCase(),
      };
    }),
  );

  return { circles, balance: num(await susu.balanceOf(address)) };
}

async function circleState({ circleId, me }) {
  const { susu } = await conn();

  const [circle, joined, roundEndsAt] = await susu.circleInfo(circleId);
  const [addrs, handles, balances, paid, received, paidThisRound] = await susu.membersOf(circleId);
  const [nextWho, nextEligible] = await susu.nextInLine(circleId);

  const members = addrs.map((a, i) => ({
    address: a,
    handle: handles[i],
    balance: num(balances[i]),
    paidRounds: num(paid[i]),
    received: received[i],
    paidThisRound: paidThisRound[i],
    position: i,
    isNext: a.toLowerCase() === nextWho.toLowerCase(),
  }));

  const mine = me ? members.find((m) => m.address.toLowerCase() === String(me).toLowerCase()) : null;

  return {
    contract: deployment.address,
    explorer: deployment.explorer,
    contractUrl: `${deployment.explorer}/address/${deployment.address}`,
    domain: {
      name: 'SusuCircles',
      version: '1',
      chainId: deployment.chainId,
      verifyingContract: deployment.address,
    },
    circleId: Number(circleId),
    label: circle.label,
    owner: circle.owner,
    contributionAmount: num(circle.contributionAmount),
    roundLength: num(circle.roundLength),
    size: num(circle.size),
    joined: num(joined),
    currentRound: num(circle.currentRound),
    roundEndsAt: num(roundEndsAt) * 1000,
    pot: num(circle.pot),
    started: circle.started,
    finished: circle.finished,
    everyonePaid: members.length > 0 && members.every((m) => m.paidThisRound),
    nextInLine: nextWho === ethers.ZeroAddress ? null : { address: nextWho, eligible: nextEligible },
    members,
    me: mine
      ? {
          ...mine,
          arrears: num(await susu.arrearsOf(circleId, me)),
          nonce: num(await susu.nonces(me)),
          isOwner: circle.owner.toLowerCase() === String(me).toLowerCase(),
        }
      : null,
    now: Date.now(),
  };
}

const blockTimes = new Map();
async function blockTime(provider, n) {
  if (!blockTimes.has(n)) blockTimes.set(n, (await provider.getBlock(n)).timestamp);
  return blockTimes.get(n);
}

async function activity({ circleId }) {
  const { provider } = await conn();
  const id = Number(circleId);

  const shape = (e) => {
    if (e.name === 'Contributed') return { kind: 'in', who: e.args[2], amount: num(e.args[3]), round: num(e.args[4]) };
    if (e.name === 'RoundSettled') return { kind: 'out', who: e.args[3], amount: num(e.args[4]), round: num(e.args[1]) };
    return { kind: 'missed', who: e.args[3], amount: 0, round: num(e.args[1]) };
  };

  const mine = (await allEvents()).filter(
    (e) => ['Contributed', 'RoundSettled', 'TurnMissed'].includes(e.name) && num(e.args[0]) === id,
  );

  // Newest first, and only date the ones we actually show — a block lookup each is expensive.
  mine.sort((a, b) => b.blockNumber - a.blockNumber || b.txHash.localeCompare(a.txHash));
  const shown = mine.slice(0, 30);

  const rows = [];
  for (const e of shown) {
    rows.push({
      ...shape(e),
      at: (await blockTime(provider, e.blockNumber)) * 1000,
      txHash: e.txHash,
      explorer: explorerTx(e.txHash),
    });
  }

  return { rows, now: Date.now() };
}

async function nonceFor({ address }) {
  const { susu } = await conn();
  return { nonce: num(await susu.nonces(requireAddress(address))) };
}

const routes = {
  createCircle,
  joinCircle,
  startCircle,
  contribute,
  settleRound,
  topUp,
  momoTopUp,
  momoWebhook,
  myCircles,
  circleState,
  activity,
  nonceFor,
};

async function handle(action, body, ctx) {
  const fn = routes[action];
  if (!fn) throw new Error(`unknown action: ${action}`);
  return fn(body || {}, ctx || {});
}

module.exports = { handle, deployment };
