// PayPal Sandbox smoke test
// Run: npm run paypal:smoke
// Requires valid sandbox credentials in atn/.env

import { SimulatedAdapter, SandboxAdapter, MissingCredentialsError, PaymentProviderError } from '../src/payments/adapter.js';

const REQUIRED_ENV = [
  'PAYPAL_CLIENT_ID',
  'PAYPAL_CLIENT_SECRET',
  'PAYPAL_PAYEE_EMAIL',
  'PAYPAL_BASE_URL',
];

function checkEnv() {
  const missing = REQUIRED_ENV.filter(k => !process.env[k]);
  if (missing.length) {
    console.error('Missing required environment variables:', missing.join(', '));
    console.error('Put your real sandbox Client ID and Secret in atn/.env and rerun.');
    process.exit(1);
  }
}

function printTable(rows) {
  const maxLabel = Math.max(...rows.map(r => r.label.length));
  console.log('+' + '-'.repeat(maxLabel + 2) + '+----------------------+');
  for (const r of rows) {
    console.log('| ' + r.label.padEnd(maxLabel) + ' | ' + r.value.padEnd(20) + ' |');
  }
  console.log('+' + '-'.repeat(maxLabel + 2) + '+----------------------+');
}

async function runSmoke() {
  checkEnv();

  const adapter = new SandboxAdapter();

  console.log('\n=== PayPal Sandbox Smoke Test ===\n');

  // 1. Token request - fetch token directly
  console.log('1. Obtaining access token...');
  try {
    // Test token fetch directly (not through authorize())
    const token = await adapter.getTokenForTest();
    console.log('   Token obtained successfully');
  } catch (e) {
    if (e instanceof PaymentProviderError && e.status === 401) {
      console.error('PayPal rejected the credentials. Put your real sandbox Client ID and Secret in atn/.env and rerun.');
      process.exit(1);
    }
    throw e;
  }

  // 2. Create AUTHORIZE order
  console.log('\n2. Creating AUTHORIZE order for $0.10...');
  const orderResult = await adapter.createAuthorizeOrder({
    amount: 100000, // $0.10 in micro-dollars
    currency: 'USD',
    idempotencyKey: 'smoke-auth-1',
  });
  console.log('   Order ID:', orderResult.orderId);
  console.log('   Approve URL:', orderResult.approveUrl);
  printTable([
    { label: 'Order ID', value: orderResult.orderId },
    { label: 'Approve URL', value: orderResult.approveUrl },
    { label: 'Mode', value: orderResult.mode },
  ]);

  // 3. Wait for buyer approval (in sandbox, we simulate by waiting for Enter)
  console.log('\n3. Waiting for buyer approval...');
  console.log('   In sandbox, the buyer would approve at:', orderResult.approveUrl);
  
  if (!process.stdin.isTTY) {
    console.error('   stdin is not a TTY - aborting (no auto-continue)');
    process.exit(1);
  }
  
  console.log('   Press Enter after approval (no auto-continue)...');
  
  await new Promise((resolve) => {
    process.stdin.once('data', () => {
      resolve();
    });
  });

  // 4. Authorize the order
  console.log('\n4. Authorizing the order...');
  const authResult = await adapter.authorizeOrder({
    orderId: orderResult.orderId,
    idempotencyKey: 'smoke-auth-confirm-1',
  });
  console.log('   Authorization ID:', authResult.ref);
  printTable([
    { label: 'Authorization ID', value: authResult.ref },
    { label: 'Mode', value: authResult.mode },
  ]);

  // 5. Capture $0.10
  console.log('\n5. Capturing $0.10...');
  const captureResult = await adapter.capture({
    authRef: authResult.ref,
    amount: 100000,
    idempotencyKey: 'smoke-capture-1',
  });
  console.log('   Capture ID:', captureResult.ref);
  printTable([
    { label: 'Capture ID', value: captureResult.ref },
    { label: 'Mode', value: captureResult.mode },
  ]);

  // 6. Refund the capture
  console.log('\n6. Refunding the capture...');
  await adapter.refund({
    captureRef: captureResult.ref,
    amount: 100000,
    idempotencyKey: 'smoke-refund-1',
  });
  console.log('   Refund successful');
  printTable([{ label: 'Status', value: 'REFUNDED' }]);

  // 7. Second order: authorize then void
  console.log('\n7. Creating second AUTHORIZE order for $0.10...');
  const orderResult2 = await adapter.createAuthorizeOrder({
    amount: 100000,
    currency: 'USD',
    idempotencyKey: 'smoke-auth-2',
  });
  console.log('   Order ID:', orderResult2.orderId);
  console.log('   Approve URL:', orderResult2.approveUrl);

  console.log('\n8. Waiting for buyer approval...');
  console.log('   In sandbox, the buyer would approve at:', orderResult2.approveUrl);
  
  if (!process.stdin.isTTY) {
    console.error('   stdin is not a TTY - aborting');
    process.exit(1);
  }
  
  console.log('   Press Enter after approval...');
  await new Promise((resolve) => {
    process.stdin.once('data', () => {
      resolve();
    });
  });

  console.log('\n9. Authorizing the second order...');
  const authResult2 = await adapter.authorizeOrder({
    orderId: orderResult2.orderId,
    idempotencyKey: 'smoke-auth-confirm-2',
  });
  console.log('   Authorization ID:', authResult2.ref);

  console.log('\n10. Voiding the authorization...');
  await adapter.voidAuthorization({
    authRef: authResult2.ref,
    idempotencyKey: 'smoke-void-1',
  });
  console.log('   Void successful');
  printTable([{ label: 'Status', value: 'VOIDED' }]);

  // 11. Payout to payee
  console.log('\n11. Creating $0.10 payout to payee...');
  const payoutResult = await adapter.payout({
    amount: 100000,
    currency: 'USD',
    payeeRef: 'smoke-payee',
    idempotencyKey: 'smoke-payout-1',
  });
  console.log('   Payout batch ID:', payoutResult.ref);
  printTable([
    { label: 'Payout Batch ID', value: payoutResult.ref },
    { label: 'Mode', value: payoutResult.mode },
  ]);

  console.log('\n=== All smoke tests passed! ===');
}

runSmoke().catch(e => {
  console.error('\n=== Smoke test failed ===');
  console.error(e.message);
  if (e instanceof PaymentProviderError && e.status === 401) {
    console.error('PayPal rejected the credentials. Put your real sandbox Client ID and Secret in atn/.env and rerun.');
  }
  process.exit(1);
});