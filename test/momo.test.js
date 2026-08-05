const { expect } = require('chai');
const { MockMoMoProvider, verifyWebhook, sign, normaliseMsisdn, FRESHNESS_MS } = require('../lib/momo');

const ACCOUNT = '0xA9EFd0C5Ff05246856Cb603CCF5EF4e81411E522';

const build = (over = {}) => {
  const payload = {
    provider: 'mock-momo',
    reference: 'MOMO-DEADBEEF',
    msisdn: '0241112222',
    amount: 2000,
    currency: 'GHS',
    status: 'SUCCESS',
    account: ACCOUNT,
    timestamp: Date.now(),
    ...over,
  };
  const raw = JSON.stringify(payload);
  return { payload, raw, signature: sign(raw) };
};

describe('mobile money webhook', () => {
  describe('phone numbers', () => {
    it('accepts the ways Ghanaians actually write them', () => {
      for (const input of ['0241112222', '024 111 2222', '+233241112222', '233241112222', '024-111-2222']) {
        expect(normaliseMsisdn(input), input).to.equal('0241112222');
      }
    });

    it('rejects anything that is not a Ghana mobile number', () => {
      for (const bad of ['', '12345', '0241112', '024111222233', 'not a phone', null]) {
        expect(normaliseMsisdn(bad)).to.equal(null);
      }
    });
  });

  describe('signature', () => {
    it('accepts a genuine payload', () => {
      const { raw, signature, payload } = build();
      expect(verifyWebhook(raw, signature).reference).to.equal(payload.reference);
    });

    // The whole point: without this, anyone who finds the URL can mint themselves money.
    it('rejects a forged signature', () => {
      const { raw } = build();
      expect(() => verifyWebhook(raw, 'a'.repeat(64))).to.throw(/signature/);
    });

    it('rejects a missing signature', () => {
      const { raw } = build();
      expect(() => verifyWebhook(raw, undefined)).to.throw(/signature/);
    });

    it('rejects a body altered after signing', () => {
      const { raw, signature } = build();
      const tampered = raw.replace('"amount":2000', '"amount":999999');
      expect(() => verifyWebhook(tampered, signature)).to.throw(/signature/);
    });

    it('rejects a signature made with the wrong secret', () => {
      const { raw } = build();
      expect(() => verifyWebhook(raw, sign(raw, 'someone-elses-secret'))).to.throw(/signature/);
    });
  });

  describe('replay and freshness', () => {
    it('rejects a payload older than the window', () => {
      const { raw, signature } = build({ timestamp: Date.now() - FRESHNESS_MS - 1000 });
      expect(() => verifyWebhook(raw, signature)).to.throw(/timestamp/);
    });

    it('rejects a payload dated in the future', () => {
      const { raw, signature } = build({ timestamp: Date.now() + 10 * 60 * 1000 });
      expect(() => verifyWebhook(raw, signature)).to.throw(/timestamp/);
    });

    it('accepts one inside the window', () => {
      const { raw, signature } = build({ timestamp: Date.now() - 60 * 1000 });
      expect(verifyWebhook(raw, signature).status).to.equal('SUCCESS');
    });
  });

  describe('payload rules', () => {
    it('refuses to credit a failed payment', () => {
      const { raw, signature } = build({ status: 'FAILED' });
      expect(() => verifyWebhook(raw, signature)).to.throw(/status/);
    });

    it('refuses a bad amount', () => {
      for (const amount of [0, -500, 'plenty', 12.5]) {
        const { raw, signature } = build({ amount });
        expect(() => verifyWebhook(raw, signature), String(amount)).to.throw(/amount/);
      }
    });

    it('refuses a malformed account', () => {
      const { raw, signature } = build({ account: '0xnope' });
      expect(() => verifyWebhook(raw, signature)).to.throw(/account/);
    });

    it('refuses a payload with no reference to reconcile against', () => {
      const { raw, signature } = build({ reference: '' });
      expect(() => verifyWebhook(raw, signature)).to.throw(/reference/);
    });

    it('refuses a body that is not json', () => {
      expect(() => verifyWebhook('not json at all', sign('not json at all'))).to.throw(/json/);
    });
  });

  describe('the mock provider', () => {
    it('produces a payload that its own verifier accepts', () => {
      const { rawBody, signature, reference } = MockMoMoProvider.requestPayment({
        msisdn: '024 111 2222',
        amount: 5000,
        account: ACCOUNT,
      });
      const payload = verifyWebhook(rawBody, signature);
      expect(payload.reference).to.equal(reference);
      expect(payload.amount).to.equal(5000);
      expect(payload.msisdn).to.equal('0241112222');
    });

    it('gives every payment its own reference', () => {
      const refs = new Set();
      for (let i = 0; i < 50; i++) {
        refs.add(MockMoMoProvider.requestPayment({ msisdn: '0241112222', amount: 100, account: ACCOUNT }).reference);
      }
      expect(refs.size).to.equal(50);
    });

    it('refuses a number that is not a Ghana mobile', () => {
      expect(() => MockMoMoProvider.requestPayment({ msisdn: '12345', amount: 100, account: ACCOUNT })).to.throw(/Ghana/);
    });
  });
});
