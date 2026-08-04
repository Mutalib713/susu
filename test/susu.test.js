const { expect } = require('chai');
const { ethers } = require('hardhat');
const fs = require('fs');
const path = require('path');

// Deploy from the artifact `npm run compile` produces, which is the exact bytecode
// running on Sepolia. Hardhat's own compiler download is not used.
const artifact = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'build', 'Susu.json'), 'utf8'));
const factory = (signer) => new ethers.ContractFactory(artifact.abi, artifact.bytecode, signer);

const GHS = (cedis) => Math.round(cedis * 100); // contract works in pesewas
const START = GHS(500);

const TYPES = {
  Contribute: [
    { name: 'member', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
  ],
};

describe('Susu', () => {
  let susu, operator, ama, kofi, stranger, domain;

  const signContribution = async (signer, amount, nonceOverride) => {
    const nonce = nonceOverride ?? (await susu.nonces(signer.address));
    return signer.signTypedData(domain, TYPES, { member: signer.address, amount, nonce });
  };

  const submit = async (sender, member, amount, signature) => {
    const { v, r, s } = ethers.Signature.from(signature);
    return susu.connect(sender).contributeWithSig(member, amount, v, r, s);
  };

  beforeEach(async () => {
    [operator, ama, kofi, stranger] = await ethers.getSigners();
    susu = await factory(operator).deploy();
    await susu.waitForDeployment();

    domain = {
      name: 'Susu',
      version: '1',
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: await susu.getAddress(),
    };

    await susu.join(ama.address, 'Ama · 024•••4567', START);
    await susu.join(kofi.address, 'Kofi · 055•••1122', START);
  });

  describe('joining', () => {
    it('credits a new member and records them once', async () => {
      expect(await susu.balanceOf(ama.address)).to.equal(START);
      expect(await susu.isMember(ama.address)).to.equal(true);
      expect(await susu.memberCount()).to.equal(2);
    });

    it('does not add a returning member twice', async () => {
      await susu.join(ama.address, 'Ama · 024•••4567', 0);
      expect(await susu.memberCount()).to.equal(2);
      expect(await susu.balanceOf(ama.address)).to.equal(START);
    });

    it('refuses anyone but the operator', async () => {
      await expect(susu.connect(stranger).join(stranger.address, 'sneaky', START))
        .to.be.revertedWithCustomError(susu, 'NotOperator');
    });
  });

  describe('contributing by signature', () => {
    it('moves the money and emits the event', async () => {
      const amount = GHS(20);
      const sig = await signContribution(ama, amount);

      await expect(submit(operator, ama.address, amount, sig))
        .to.emit(susu, 'Contributed')
        .withArgs(ama.address, 'Ama · 024•••4567', amount, amount);

      expect(await susu.balanceOf(ama.address)).to.equal(START - amount);
      expect(await susu.contributed(ama.address)).to.equal(amount);
      expect(await susu.pot()).to.equal(amount);
    });

    // This is the property that makes the wallet invisible. If this test ever fails,
    // the member would need their own ETH and the whole design is gone.
    it('lets ANYONE submit a valid signature, so the member never needs gas', async () => {
      const amount = GHS(20);
      const sig = await signContribution(ama, amount);

      const before = await ethers.provider.getBalance(ama.address);
      await submit(stranger, ama.address, amount, sig);
      const after = await ethers.provider.getBalance(ama.address);

      expect(after).to.equal(before); // the member spent nothing
      expect(await susu.pot()).to.equal(amount);
    });

    it('rejects a signature from somebody else', async () => {
      const amount = GHS(20);
      const nonce = await susu.nonces(ama.address);
      // Kofi signs a note that claims to be Ama's.
      const forged = await kofi.signTypedData(domain, TYPES, { member: ama.address, amount, nonce });

      await expect(submit(operator, ama.address, amount, forged))
        .to.be.revertedWithCustomError(susu, 'BadSignature');
    });

    it('rejects a replay of a used signature', async () => {
      const amount = GHS(20);
      const sig = await signContribution(ama, amount);

      await submit(operator, ama.address, amount, sig);
      await expect(submit(operator, ama.address, amount, sig))
        .to.be.revertedWithCustomError(susu, 'BadSignature');
    });

    it('rejects a signature reused for a different amount', async () => {
      const sig = await signContribution(ama, GHS(20));
      await expect(submit(operator, ama.address, GHS(200), sig))
        .to.be.revertedWithCustomError(susu, 'BadSignature');
    });

    it('rejects contributing more than the member holds', async () => {
      const amount = GHS(900);
      const sig = await signContribution(ama, amount);
      await expect(submit(operator, ama.address, amount, sig))
        .to.be.revertedWithCustomError(susu, 'InsufficientBalance');
    });

    it('will not accept a signature bound to another contract', async () => {
      const other = await factory(operator).deploy();
      await other.waitForDeployment();

      const amount = GHS(20);
      const sig = await ama.signTypedData(
        { ...domain, verifyingContract: await other.getAddress() },
        TYPES,
        { member: ama.address, amount, nonce: 0 },
      );

      await expect(submit(operator, ama.address, amount, sig))
        .to.be.revertedWithCustomError(susu, 'BadSignature');
    });

    it('will not accept a signature bound to another chain', async () => {
      const amount = GHS(20);
      const sig = await ama.signTypedData({ ...domain, chainId: 1 }, TYPES, {
        member: ama.address,
        amount,
        nonce: 0,
      });

      await expect(submit(operator, ama.address, amount, sig))
        .to.be.revertedWithCustomError(susu, 'BadSignature');
    });

    it('counts several contributions from several members', async () => {
      await submit(operator, ama.address, GHS(20), await signContribution(ama, GHS(20)));
      await submit(operator, kofi.address, GHS(50), await signContribution(kofi, GHS(50)));
      await submit(operator, ama.address, GHS(30), await signContribution(ama, GHS(30)));

      expect(await susu.pot()).to.equal(GHS(100));
      expect(await susu.contributed(ama.address)).to.equal(GHS(50));
      expect(await susu.nonces(ama.address)).to.equal(2);
    });
  });

  describe('payout', () => {
    beforeEach(async () => {
      await submit(operator, ama.address, GHS(20), await signContribution(ama, GHS(20)));
      await submit(operator, kofi.address, GHS(50), await signContribution(kofi, GHS(50)));
    });

    it('hands the whole pot over and counts the round', async () => {
      const before = await susu.balanceOf(kofi.address);

      await expect(susu.payout(kofi.address))
        .to.emit(susu, 'PaidOut')
        .withArgs(kofi.address, 'Kofi · 055•••1122', GHS(70), 1);

      expect(await susu.balanceOf(kofi.address)).to.equal(before + BigInt(GHS(70)));
      expect(await susu.pot()).to.equal(0);
      expect(await susu.roundsPaid()).to.equal(1);
    });

    it('refuses anyone but the operator', async () => {
      await expect(susu.connect(stranger).payout(stranger.address))
        .to.be.revertedWithCustomError(susu, 'NotOperator');
    });

    it('refuses to pay out an empty pot', async () => {
      await susu.payout(kofi.address);
      await expect(susu.payout(ama.address)).to.be.revertedWithCustomError(susu, 'EmptyPot');
    });
  });

  describe('snapshot', () => {
    it('returns every member with their handle, balance and total given', async () => {
      await submit(operator, ama.address, GHS(20), await signContribution(ama, GHS(20)));

      const [addrs, handles, balances, gave] = await susu.snapshot();

      expect(addrs).to.deep.equal([ama.address, kofi.address]);
      expect(handles[0]).to.equal('Ama · 024•••4567');
      expect(balances[0]).to.equal(START - GHS(20));
      expect(gave[0]).to.equal(GHS(20));
      expect(gave[1]).to.equal(0);
    });
  });
});
