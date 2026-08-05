// Mobile money on-ramp.
//
// The VERIFICATION here is real and production-shaped: HMAC-SHA256 over the exact raw body,
// timing-safe comparison, freshness window, and replay protection. The PROVIDER is a mock —
// MTN, Hubtel and Paystack all require a licence or a partner agreement before they will send
// you a live webhook, which is weeks of paperwork rather than hours of code.
//
// Swapping in a real provider means replacing `MockMoMoProvider.requestPayment` and setting
// MOMO_WEBHOOK_SECRET to theirs. `verifyWebhook` does not change.
const crypto = require('crypto');

const SECRET = process.env.MOMO_WEBHOOK_SECRET || 'dev-secret-not-for-production';
const FRESHNESS_MS = 5 * 60 * 1000;

/// Ghana mobile number -> 0XXXXXXXXX, or null.
function normaliseMsisdn(raw) {
  const d = String(raw || '').replace(/[^\d+]/g, '').replace(/^\+?233/, '0');
  return /^0\d{9}$/.test(d) ? d : null;
}

function sign(rawBody, secret = SECRET) {
  return crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
}

/// Constant-time compare so a wrong signature can't be guessed a byte at a time.
function signaturesMatch(a, b) {
  const x = Buffer.from(String(a || ''), 'utf8');
  const y = Buffer.from(String(b || ''), 'utf8');
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

class BadWebhook extends Error {}

/// Throws BadWebhook unless the body is genuinely from the provider, fresh, and a success.
function verifyWebhook(rawBody, signature, { secret = SECRET, now = Date.now() } = {}) {
  if (!rawBody) throw new BadWebhook('empty body');
  if (!signaturesMatch(signature, sign(rawBody, secret))) throw new BadWebhook('signature does not match');

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    throw new BadWebhook('body is not json');
  }

  const age = now - Number(payload.timestamp || 0);
  if (!Number.isFinite(age) || age > FRESHNESS_MS || age < -60000) {
    throw new BadWebhook('timestamp outside the accepted window');
  }
  if (payload.status !== 'SUCCESS') throw new BadWebhook(`payment status was ${payload.status}`);

  const amount = Number(payload.amount);
  if (!Number.isInteger(amount) || amount <= 0) throw new BadWebhook('bad amount');
  if (!/^0x[0-9a-fA-F]{40}$/.test(String(payload.account || ''))) throw new BadWebhook('bad account');
  if (!payload.reference) throw new BadWebhook('missing reference');

  return payload;
}

/// Stands in for MTN MoMo. A real provider would push a PIN prompt to the phone and call our
/// webhook when the customer approves; this builds the same signed payload directly.
const MockMoMoProvider = {
  name: 'mock-momo',

  requestPayment({ msisdn, amount, account }) {
    const phone = normaliseMsisdn(msisdn);
    if (!phone) throw new Error('that does not look like a Ghana mobile number');

    const amt = Math.round(Number(amount));
    if (!Number.isInteger(amt) || amt <= 0) throw new Error('bad amount');

    const reference = `MOMO-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const payload = {
      provider: 'mock-momo',
      reference,
      msisdn: phone,
      amount: amt,
      currency: 'GHS',
      status: 'SUCCESS',
      account,
      timestamp: Date.now(),
    };

    const rawBody = JSON.stringify(payload);
    return { reference, rawBody, signature: sign(rawBody) };
  },
};

module.exports = { MockMoMoProvider, verifyWebhook, sign, signaturesMatch, normaliseMsisdn, BadWebhook, FRESHNESS_MS };
