const { expect } = require('chai');
const { ethers } = require('hardhat');
const fs = require('fs');
const path = require('path');

const artifact = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'build', 'SusuCircles.json'), 'utf8'));
const factory = (signer) => new ethers.ContractFactory(artifact.abi, artifact.bytecode, signer);

const GHS = (cedis) => Math.round(cedis * 100);
const WEEK = 7 * 24 * 60 * 60;
const codeHash = (code) => ethers.keccak256(ethers.toUtf8Bytes(code));

const TYPES = {
  Contribute: [
    { name: 'circleId', type: 'uint256' },
    { name: 'member', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'round', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
  ],
};

const jump = async (seconds) => {
  await ethers.provider.send('evm_increaseTime', [seconds]);
  await ethers.provider.send('evm_mine', []);
};

describe('SusuCircles', () => {
  let susu, operator, ama, kofi, yaa, stranger, domain;
  const CODE = 'KEJETIA24';
  const AMOUNT = GHS(20);

  const members = () => [ama, kofi, yaa];

  const sign = async (signer, circleId, amount, round) => {
    const nonce = await susu.nonces(signer.address);
    return signer.signTypedData(domain, TYPES, {
      circleId,
      member: signer.address,
      amount,
      round,
      nonce,
    });
  };

  const contribute = async (sender, signer, circleId, amount = AMOUNT, round) => {
    const r = round ?? Number((await susu.circleInfo(circleId)).circle.currentRound);
    const sig = await sign(signer, circleId, amount, r);
    const { v, r: sr, s } = ethers.Signature.from(sig);
    return susu.connect(sender).contributeWithSig(circleId, signer.address, amount, r, v, sr, s);
  };

  const everyonePays = async (circleId, who = members()) => {
    for (const m of who) await contribute(operator, m, circleId);
  };

  beforeEach(async () => {
    [operator, ama, kofi, yaa, stranger] = await ethers.getSigners();
    susu = await factory(operator).deploy();
    await susu.waitForDeployment();

    domain = {
      name: 'SusuCircles',
      version: '1',
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: await susu.getAddress(),
    };

    await susu.createCircle('Kejetia Traders', codeHash(CODE), ama.address, AMOUNT, WEEK, 3);
    for (const [m, h] of [
      [ama, 'Ama · 024•••4567'],
      [kofi, 'Kofi · 055•••1122'],
      [yaa, 'Yaa · 020•••7788'],
    ]) {
      await susu.joinCircle(codeHash(CODE), m.address, h);
      await susu.credit(m.address, GHS(500), 'MOMO-SEED');
    }
  });

  describe('creating and joining', () => {
    it('locks the join code to one circle', async () => {
      await expect(
        susu.createCircle('Copycat', codeHash(CODE), ama.address, AMOUNT, WEEK, 3),
      ).to.be.revertedWithCustomError(susu, 'CodeTaken');
    });

    it('refuses a circle of fewer than two', async () => {
      await expect(
        susu.createCircle('Lonely', codeHash('SOLO'), ama.address, AMOUNT, WEEK, 1),
      ).to.be.revertedWithCustomError(susu, 'TooFewMembers');
    });

    it('records members in join order', async () => {
      expect(await susu.orderOf(0)).to.deep.equal([ama.address, kofi.address, yaa.address]);
    });

    it('refuses an unknown code', async () => {
      await expect(
        susu.joinCircle(codeHash('NOPE'), stranger.address, 'nobody'),
      ).to.be.revertedWithCustomError(susu, 'UnknownCircle');
    });

    it('refuses the same member twice', async () => {
      await expect(
        susu.joinCircle(codeHash(CODE), ama.address, 'Ama again'),
      ).to.be.revertedWithCustomError(susu, 'AlreadyMember');
    });

    it('refuses to overfill the circle', async () => {
      await expect(
        susu.joinCircle(codeHash(CODE), stranger.address, 'late'),
      ).to.be.revertedWithCustomError(susu, 'CircleFull');
    });

    it('refuses new members once it has started', async () => {
      await susu.startCircle(0);
      await expect(
        susu.joinCircle(codeHash(CODE), stranger.address, 'late'),
      ).to.be.revertedWithCustomError(susu, 'AlreadyStarted');
    });

    it('lets the owner start it, but not a stranger', async () => {
      await expect(susu.connect(stranger).startCircle(0)).to.be.revertedWithCustomError(susu, 'NotOwner');
      await expect(susu.connect(ama).startCircle(0)).to.emit(susu, 'Started');
    });
  });

  describe('contributing', () => {
    beforeEach(async () => susu.startCircle(0));

    it('takes the fixed amount and records the round', async () => {
      await expect(contribute(operator, ama, 0))
        .to.emit(susu, 'Contributed')
        .withArgs(0, ama.address, 'Ama · 024•••4567', AMOUNT, 0);

      expect(await susu.paidInRound(0, 0, ama.address)).to.equal(true);
      expect(await susu.paidCount(0, ama.address)).to.equal(1);
      expect(await susu.balanceOf(ama.address)).to.equal(GHS(480));
    });

    it('refuses the wrong amount', async () => {
      await expect(contribute(operator, ama, 0, GHS(35))).to.be.revertedWithCustomError(susu, 'WrongAmount');
    });

    it('refuses paying twice in one round', async () => {
      await contribute(operator, ama, 0);
      await expect(contribute(operator, ama, 0)).to.be.revertedWithCustomError(susu, 'AlreadyPaidThisRound');
    });

    it('refuses somebody who is not in the circle', async () => {
      await susu.credit(stranger.address, GHS(500), 'MOMO-X');
      await expect(contribute(operator, stranger, 0)).to.be.revertedWithCustomError(susu, 'NotAMember');
    });

    it('refuses a forged signature', async () => {
      const nonce = await susu.nonces(ama.address);
      const forged = await kofi.signTypedData(domain, TYPES, {
        circleId: 0,
        member: ama.address,
        amount: AMOUNT,
        round: 0,
        nonce,
      });
      const { v, r, s } = ethers.Signature.from(forged);
      await expect(susu.contributeWithSig(0, ama.address, AMOUNT, 0, v, r, s)).to.be.revertedWithCustomError(
        susu,
        'BadSignature',
      );
    });

    it('refuses a signature whose round does not match the one submitted', async () => {
      const sig = await sign(ama, 0, AMOUNT, 1); // signed for round 1
      const { v, r, s } = ethers.Signature.from(sig);
      await expect(susu.contributeWithSig(0, ama.address, AMOUNT, 0, v, r, s)).to.be.revertedWithCustomError(
        susu,
        'BadSignature',
      );
    });

    it('refuses paying for a round that has not happened yet', async () => {
      const sig = await sign(ama, 0, AMOUNT, 5);
      const { v, r, s } = ethers.Signature.from(sig);
      await expect(susu.contributeWithSig(0, ama.address, AMOUNT, 5, v, r, s)).to.be.revertedWithCustomError(
        susu,
        'UnknownRound',
      );
    });

    it('still lets anyone relay, so the member never needs gas', async () => {
      const before = await ethers.provider.getBalance(ama.address);
      await contribute(stranger, ama, 0);
      expect(await ethers.provider.getBalance(ama.address)).to.equal(before);
    });
  });

  describe('rotation', () => {
    beforeEach(async () => susu.startCircle(0));

    it('says who is next before anyone has paid', async () => {
      const [who, eligible] = await susu.nextInLine(0);
      expect(who).to.equal(ama.address);
      expect(eligible).to.equal(false); // has not paid this round yet
    });

    it('pays the first person in the order, not whoever asks', async () => {
      await everyonePays(0);
      await expect(susu.connect(stranger).settleRound(0))
        .to.emit(susu, 'RoundSettled')
        .withArgs(0, 0, ama.address, 'Ama · 024•••4567', GHS(60));

      expect(await susu.hasReceived(0, ama.address)).to.equal(true);
      expect(await susu.hasReceived(0, kofi.address)).to.equal(false);
    });

    it('walks down the order round by round', async () => {
      await everyonePays(0);
      await susu.settleRound(0);
      await everyonePays(0);
      await expect(susu.settleRound(0)).to.emit(susu, 'RoundSettled').withArgs(0, 1, kofi.address, 'Kofi · 055•••1122', GHS(60));
      await everyonePays(0);
      await expect(susu.settleRound(0)).to.emit(susu, 'RoundSettled').withArgs(0, 2, yaa.address, 'Yaa · 020•••7788', GHS(60));
    });

    it('will not settle while the round is open and somebody has not paid', async () => {
      await contribute(operator, ama, 0);
      await expect(susu.settleRound(0)).to.be.revertedWithCustomError(susu, 'RoundStillOpen');
    });

    it('settles once the deadline passes even if somebody has not paid', async () => {
      await contribute(operator, ama, 0);
      await contribute(operator, kofi, 0);
      await jump(WEEK + 1);
      await expect(susu.settleRound(0)).to.emit(susu, 'RoundSettled');
    });

    it('finishes after everybody has had a turn', async () => {
      for (let i = 0; i < 3; i++) {
        await everyonePays(0);
        await susu.settleRound(0);
      }
      const { circle } = await susu.circleInfo(0);
      expect(circle.finished).to.equal(true);
      await expect(susu.settleRound(0)).to.be.revertedWithCustomError(susu, 'AlreadyFinished');
    });
  });

  // The rule Mutalib chose: you cannot take a pot unless you have kept up every round.
  describe('the default rule', () => {
    beforeEach(async () => susu.startCircle(0));

    it('skips whoever is behind and gives the pot to the next one who kept up', async () => {
      // Ama is first in the order but does not pay round 0.
      await contribute(operator, kofi, 0);
      await contribute(operator, yaa, 0);
      await jump(WEEK + 1);

      await expect(susu.settleRound(0))
        .to.emit(susu, 'TurnMissed')
        .withArgs(0, 0, ama.address, 'Ama · 024•••4567');

      // Kofi was second, kept up, and takes it instead.
      expect(await susu.hasReceived(0, kofi.address)).to.equal(true);
      expect(await susu.hasReceived(0, ama.address)).to.equal(false);
      expect(await susu.missedTurns(0, ama.address)).to.equal(1);
      expect(await susu.balanceOf(kofi.address)).to.equal(GHS(500) - AMOUNT + GHS(40));
    });

    it('counts what a member is behind by', async () => {
      await contribute(operator, kofi, 0);
      await contribute(operator, yaa, 0);
      await jump(WEEK + 1);
      await susu.settleRound(0); // Ama skipped, Kofi paid

      expect(await susu.arrearsOf(0, ama.address)).to.equal(2); // owes round 0 and round 1
      expect(await susu.arrearsOf(0, kofi.address)).to.equal(1); // only the new round
    });

    it('lets a member pay arrears and become eligible again', async () => {
      await contribute(operator, kofi, 0);
      await contribute(operator, yaa, 0);
      await jump(WEEK + 1);
      await susu.settleRound(0); // Ama skipped, Kofi took round 0

      // Ama settles the round she missed AND the current one.
      await contribute(operator, ama, 0, AMOUNT, 0);
      await contribute(operator, ama, 0, AMOUNT, 1);
      expect(await susu.arrearsOf(0, ama.address)).to.equal(0);

      await contribute(operator, kofi, 0);
      await contribute(operator, yaa, 0);

      // Cursor sits on Yaa, who is also eligible, so Yaa takes round 1...
      await susu.settleRound(0);
      expect(await susu.hasReceived(0, yaa.address)).to.equal(true);

      // ...and Ama, now caught up, takes the final round.
      await contribute(operator, ama, 0);
      await contribute(operator, kofi, 0);
      await contribute(operator, yaa, 0);
      await expect(susu.settleRound(0))
        .to.emit(susu, 'RoundSettled')
        .withArgs(0, 2, ama.address, 'Ama · 024•••4567', GHS(60));
    });

    it('rolls the pot over when nobody is eligible', async () => {
      await jump(WEEK + 1); // nobody paid at all
      await expect(susu.settleRound(0)).to.emit(susu, 'RoundStalled').withArgs(0, 0, 0);

      const { circle } = await susu.circleInfo(0);
      expect(circle.currentRound).to.equal(1);
    });
  });

  describe('crediting money in', () => {
    it('records the provider reference so deposits can be reconciled', async () => {
      await expect(susu.credit(ama.address, GHS(50), 'MTN-778812'))
        .to.emit(susu, 'Credited')
        .withArgs(ama.address, GHS(50), 'MTN-778812');
      expect(await susu.balanceOf(ama.address)).to.equal(GHS(550));
    });

    it('refuses anyone but the operator', async () => {
      await expect(
        susu.connect(stranger).credit(stranger.address, GHS(9999), 'FAKE'),
      ).to.be.revertedWithCustomError(susu, 'NotOperator');
    });
  });
});
