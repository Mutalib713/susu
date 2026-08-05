// End-to-end run against the LIVE contract on Sepolia, driving the relayer exactly the way
// the browser does. Members are throwaway keys created here, and they sign — they never
// hold ETH and never send a transaction, same as a real member.
//
//   npm run e2e
const { ethers } = require('ethers');
const { handle, deployment } = require('../lib/handler');

const GHS = (c) => Math.round(c * 100);
const money = (p) => `GHS ${(p / 100).toFixed(2)}`;
const code = 'E2E' + Math.random().toString(36).slice(2, 8).toUpperCase();

const TYPES = {
  Contribute: [
    { name: 'circleId', type: 'uint256' },
    { name: 'member', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'round', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
  ],
};

const step = (n, msg) => console.log(`\n[${n}] ${msg}`);

(async () => {
  console.log('contract :', deployment.address);
  console.log('chain    :', deployment.chainId);
  console.log('join code:', code);

  const people = [
    { name: 'Ama Serwaa · 024•••1122', w: ethers.Wallet.createRandom() },
    { name: 'Kofi Mensah · 055•••3344', w: ethers.Wallet.createRandom() },
    { name: 'Yaa Boateng · 020•••5566', w: ethers.Wallet.createRandom() },
  ];

  step(1, 'Creating a circle');
  const created = await handle('createCircle', {
    label: 'E2E Traders',
    code,
    owner: people[0].w.address,
    amount: GHS(20),
    roundLength: 120,
    size: 3,
  });
  const circleId = created.circleId;
  console.log('    circle', circleId, '->', created.explorer);

  step(2, 'Three members join');
  for (const p of people) {
    await handle('joinCircle', { code, address: p.w.address, handle: p.name });
    console.log('    joined:', p.name);
  }

  step(3, 'Owner starts it, locking the order');
  const started = await handle('startCircle', { circleId });
  console.log('   ', started.explorer);

  const state = await handle('circleState', { circleId, me: people[0].w.address });
  console.log('    order:', state.members.map((m, i) => `${i + 1}. ${m.handle.split(' · ')[0]}`).join('  '));

  const pay = async (person, round) => {
    const { nonce } = await handle('nonceFor', { address: person.w.address });
    const signature = await person.w.signTypedData(state.domain, TYPES, {
      circleId,
      member: person.w.address,
      amount: state.contributionAmount,
      round,
      nonce,
    });
    // The member signed. The relayer pays the gas.
    return handle('contribute', {
      circleId,
      member: person.w.address,
      amount: state.contributionAmount,
      round,
      signature,
    });
  };

  step(4, 'Round 1 — everybody pays, then settle');
  for (const p of people) {
    await pay(p, 0);
    console.log('    paid:', p.name.split(' · ')[0]);
  }
  let settled = await handle('settleRound', { circleId });
  console.log(`    -> ${settled.paidTo.split(' · ')[0]} took ${money(settled.amount)}`);
  console.log('   ', settled.explorer);

  step(5, 'Round 2 — Ama skips on purpose, so the default rule fires');
  await pay(people[1], 1);
  await pay(people[2], 1);
  console.log('    Ama did not pay. Waiting for the round to close…');
  await new Promise((r) => setTimeout(r, 125000));

  settled = await handle('settleRound', { circleId });
  if (settled.stalled) {
    console.log('    -> pot rolled over, nobody was eligible');
  } else {
    console.log(`    -> ${settled.paidTo.split(' · ')[0]} took ${money(settled.amount)}`);
    if (settled.missed.length) console.log('    skipped for being behind:', settled.missed.map((h) => h.split(' · ')[0]).join(', '));
  }

  const after = await handle('circleState', { circleId, me: people[0].w.address });
  console.log('\n--- final ---');
  console.log('round     :', after.currentRound + 1, 'of', after.members.length);
  console.log('pot       :', money(after.pot));
  for (const m of after.members) {
    console.log(
      `  ${m.position + 1}. ${m.handle.split(' · ')[0].padEnd(14)} paid ${String(m.paidRounds).padEnd(2)} rounds` +
        `  ${m.received ? 'TOOK THE POT' : ''}`,
    );
  }
  console.log('\nAma arrears:', after.members[0].paidRounds, 'rounds paid of', after.currentRound + 1, 'due');
  console.log('\nPASS — the full flow ran onchain.');
})().catch((e) => {
  console.error('\nFAILED:', e.shortMessage || e.message);
  process.exit(1);
});
