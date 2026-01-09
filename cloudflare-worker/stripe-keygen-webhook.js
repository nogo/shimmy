/**
 * Cloudflare Worker: Stripe → Keygen License Fulfillment
 * 
 * Receives Stripe checkout.session.completed webhooks and creates
 * a license in Keygen for the customer.
 * 
 * Routes:
 *   POST /stripe-webhook  - Stripe webhook handler
 *   GET  /success         - Success page after checkout (displays license key)
 *   GET  /buy             - Create a Checkout Session and redirect (useful for test mode)
 *   GET  /health          - Health check
 * 
 * Environment Variables Required:
 *   STRIPE_WEBHOOK_SECRET - Stripe webhook signing secret (whsec_...)
 *   STRIPE_SECRET_KEY     - Stripe secret key for fetching product/session data
 *   KEYGEN_ACCOUNT_ID     - Your Keygen account ID
 *   KEYGEN_PRODUCT_TOKEN  - Keygen product token (prod-...)
 * 
 * The Keygen policy ID is fetched from Stripe product metadata.keygen_policy_id
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    // Health check endpoint (GET)
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Success page (GET) - displays license key after checkout
    if (url.pathname === '/success' && request.method === 'GET') {
      return handleSuccessPage(url, env);
    }

    // Buy endpoint (GET) - creates a Checkout Session and redirects to Stripe-hosted Checkout
    if (url.pathname === '/buy' && request.method === 'GET') {
      if (env.BUY_ENDPOINT_ENABLED !== '1') {
        return new Response('Not found', { status: 404 });
      }
      return handleBuy(url, env);
    }

    // Cancel page (GET)
    if (url.pathname === '/cancel' && request.method === 'GET') {
      return new Response(renderCancelPage(), {
        status: 200,
        headers: { 'Content-Type': 'text/html' }
      });
    }

    // Portal endpoint (POST) - creates a customer portal session
    if (url.pathname === '/portal' && request.method === 'POST') {
      return handlePortal(url, request, env);
    }

    // License endpoint (POST) - retrieves license key for email
    if (url.pathname === '/license' && request.method === 'POST') {
      return handleLicense(url, request, env);
    }

    // Webhook endpoint requires POST
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    // Main webhook endpoint
    if (url.pathname !== '/stripe-webhook') {
      return new Response('Not found', { status: 404 });
    }

    try {
      // Get the raw body and signature
      const payload = await request.text();
      const signature = request.headers.get('stripe-signature');

      if (!signature) {
        console.error('Missing Stripe signature');
        return new Response('Missing signature', { status: 400 });
      }

      // Verify the webhook signature
      const isValid = await verifyStripeSignature(payload, signature, env.STRIPE_WEBHOOK_SECRET);
      if (!isValid) {
        console.error('Invalid Stripe signature');
        return new Response('Invalid signature', { status: 401 });
      }

      // Parse the event
      const event = JSON.parse(payload);
      console.log(`Received event: ${event.type} (${event.id})`);

      // Only handle checkout.session.completed
      if (event.type !== 'checkout.session.completed') {
        console.log(`Ignoring event type: ${event.type}`);
        return new Response('OK', { status: 200 });
      }

      const session = event.data.object;
      
      // Extract customer info
      let customerEmail = session.customer_details?.email || session.customer_email;
      const customerName = session.customer_details?.name || 'Unknown';
      const stripeCustomerId = session.customer;
      const checkoutSessionId = session.id;
      const stripeLivemode = session.livemode;

      // Fallback: some Checkout flows (e.g., Accounts v2 + existing customer) may not
      // populate customer_details. Fetch customer to obtain email.
      if (!customerEmail && stripeCustomerId) {
        const stripeCustomer = await fetchStripeCustomer(env, stripeCustomerId);
        customerEmail = stripeCustomer?.email || null;
      }

      if (!customerEmail) {
        console.error('No customer email in checkout session');
        return new Response('Missing customer email', { status: 400 });
      }

      // Fetch line items to get the product and its policy mapping
      const lineItems = await fetchStripeLineItems(env, checkoutSessionId);
      if (!lineItems || lineItems.length === 0) {
        console.error('No line items found in checkout session');
        return new Response('No line items', { status: 400 });
      }

      // Get the first product (we assume single product checkout for now)
      const productId = lineItems[0].price?.product;
      if (!productId) {
        console.error('No product ID in line item');
        return new Response('Missing product', { status: 400 });
      }

      // Fetch product to get keygen_policy_id from metadata
      const product = await fetchStripeProduct(env, productId);
      const keygenPolicyId = product.metadata?.keygen_policy_id;
      
      if (!keygenPolicyId) {
        console.error(`Product ${productId} missing keygen_policy_id in metadata`);
        return new Response('Product not configured for licensing', { status: 500 });
      }

      console.log(`Creating license for: ${customerEmail} (tier: ${product.metadata?.tier})`);

      // Create license in Keygen
      const license = await createKeygenLicense(env, {
        email: customerEmail,
        name: customerName,
        stripeCustomerId,
        checkoutSessionId,
        stripeLivemode,
        policyId: keygenPolicyId,
        tier: product.metadata?.tier || 'unknown',
      });

      console.log(`License created: ${license.data.attributes.key}`);

      // License key will be displayed on the success page
      // Customer is redirected there after checkout with session_id in URL

      return new Response(JSON.stringify({
        success: true,
        licenseKey: license.data.attributes.key,
        customerId: license.data.id,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });

    } catch (error) {
      console.error('Webhook error:', error.message, error.stack);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
};

/**
 * Handle success page - displays license key after checkout
 * URL: /success?session_id={CHECKOUT_SESSION_ID}
 */
async function handleSuccessPage(url, env) {
  const sessionId = url.searchParams.get('session_id');
  
  if (!sessionId) {
    return new Response(renderErrorPage('Missing session ID', 'No checkout session was provided.'), {
      status: 400,
      headers: { 'Content-Type': 'text/html' }
    });
  }

  try {
    // Fetch the checkout session from Stripe
    const session = await fetchStripeSession(env, sessionId);
    
    if (!session || session.payment_status !== 'paid') {
      return new Response(renderErrorPage('Payment not completed', 'Your payment has not been confirmed yet. Please try again in a moment.'), {
        status: 400,
        headers: { 'Content-Type': 'text/html' }
      });
    }

    let customerEmail = session.customer_details?.email || session.customer_email;
    if (!customerEmail && session.customer) {
      const stripeCustomer = await fetchStripeCustomer(env, session.customer);
      customerEmail = stripeCustomer?.email || null;
    }
    
    // Look up the license in Keygen by the checkout session ID stored in metadata
    const license = await findLicenseByCheckoutSession(env, sessionId);
    
    if (!license) {
      // License might not be created yet (webhook race condition)
      // Show a "processing" page that auto-refreshes
      return new Response(renderProcessingPage(customerEmail), {
        status: 200,
        headers: { 'Content-Type': 'text/html' }
      });
    }

    // Success! Show the license key
    return new Response(renderSuccessPage(license, customerEmail, session), {
      status: 200,
      headers: { 'Content-Type': 'text/html' }
    });

  } catch (error) {
    console.error('Success page error:', error.message);
    return new Response(renderErrorPage('Something went wrong', error.message), {
      status: 500,
      headers: { 'Content-Type': 'text/html' }
    });
  }
}

/**
 * Handle buy endpoint - creates a Checkout Session and redirects to Stripe.
 * URL: /buy?tier=developer|professional|startup|enterprise|lifetime
 */
async function handleBuy(url, env) {
  const tier = (url.searchParams.get('tier') || '').toLowerCase();
  const origin = url.origin;
  const emailParam = url.searchParams.get('email');

  const tierConfig = {
    developer: { priceEnv: 'STRIPE_PRICE_DEVELOPER', mode: 'subscription' },
    professional: { priceEnv: 'STRIPE_PRICE_PROFESSIONAL', mode: 'subscription' },
    startup: { priceEnv: 'STRIPE_PRICE_STARTUP', mode: 'subscription' },
    enterprise: { priceEnv: 'STRIPE_PRICE_ENTERPRISE', mode: 'subscription' },
    lifetime: { priceEnv: 'STRIPE_PRICE_LIFETIME', mode: 'payment' },
  };

  const config = tierConfig[tier];
  if (!config) {
    return new Response(renderErrorPage('Missing or invalid tier', 'Use /buy?tier=developer|professional|startup|enterprise|lifetime'), {
      status: 400,
      headers: { 'Content-Type': 'text/html' }
    });
  }

  const priceId = env[config.priceEnv];
  if (!priceId) {
    return new Response(renderErrorPage('Server not configured', `Missing Worker secret ${config.priceEnv}`), {
      status: 500,
      headers: { 'Content-Type': 'text/html' }
    });
  }

  const successUrl = `${origin}/success?session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${origin}/cancel`;

  try {
    const requireCustomer = env.STRIPE_REQUIRE_CUSTOMER === '1';
    const email = (emailParam && emailParam.includes('@'))
      ? emailParam
      : `test+${Date.now()}@example.com`;

    const session = await createStripeCheckoutSession(env, {
      mode: config.mode,
      priceId,
      successUrl,
      cancelUrl,
      tier,
      requireCustomer,
      email,
    });

    if (!session?.url) {
      throw new Error('Stripe did not return a Checkout URL');
    }

    return Response.redirect(session.url, 303);
  } catch (error) {
    console.error('Buy endpoint error:', error.message);
    return new Response(renderErrorPage('Unable to start checkout', error.message), {
      status: 502,
      headers: { 'Content-Type': 'text/html' }
    });
  }
}

/**
 * Verify Stripe webhook signature
 * Based on Stripe's signature verification algorithm
 */
async function verifyStripeSignature(payload, signature, secret) {
  // Parse the signature header
  const parts = signature.split(',').reduce((acc, part) => {
    const [key, value] = part.split('=');
    acc[key] = value;
    return acc;
  }, {});

  const timestamp = parts['t'];
  const expectedSig = parts['v1'];

  if (!timestamp || !expectedSig) {
    return false;
  }

  // Check timestamp is within tolerance (5 minutes)
  const timestampAge = Math.floor(Date.now() / 1000) - parseInt(timestamp, 10);
  if (timestampAge > 300) {
    console.error(`Timestamp too old: ${timestampAge}s`);
    return false;
  }

  // Compute expected signature
  const signedPayload = `${timestamp}.${payload}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(signedPayload));
  const computedSig = Array.from(new Uint8Array(signatureBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  // Constant-time comparison
  return computedSig === expectedSig;
}

/**
 * Create a license in Keygen
 */
async function createKeygenLicense(env, customer) {
  const response = await fetch(
    `https://api.keygen.sh/v1/accounts/${env.KEYGEN_ACCOUNT_ID}/licenses`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.KEYGEN_PRODUCT_TOKEN}`,
        'Content-Type': 'application/vnd.api+json',
        'Accept': 'application/vnd.api+json',
      },
      body: JSON.stringify({
        data: {
          type: 'licenses',
          attributes: {
            metadata: {
              customerEmail: customer.email,
              customerName: customer.name,
              stripeCustomerId: customer.stripeCustomerId,
              stripeCheckoutSessionId: customer.checkoutSessionId,
              stripeLivemode: customer.stripeLivemode,
              tier: customer.tier,
              source: 'cloudflare-worker',
            },
          },
          relationships: {
            policy: {
              data: { type: 'policies', id: customer.policyId },
            },
          },
        },
      }),
    }
  );

  if (!response.ok) {
    const errorBody = await response.text();
    console.error('Keygen API error:', response.status, errorBody);
    throw new Error(`Keygen API error: ${response.status} - ${errorBody}`);
  }

  return await response.json();
}

/**
 * Fetch checkout session line items from Stripe
 */
async function fetchStripeLineItems(env, sessionId) {
  const response = await fetch(
    `https://api.stripe.com/v1/checkout/sessions/${sessionId}/line_items`,
    {
      headers: {
        'Authorization': `Basic ${btoa(env.STRIPE_SECRET_KEY + ':')}`,
      },
    }
  );

  if (!response.ok) {
    const error = await response.text();
    console.error('Stripe line items error:', response.status, error);
    throw new Error(`Stripe API error: ${response.status}`);
  }

  const data = await response.json();
  return data.data;
}

/**
 * Fetch product from Stripe to get metadata
 */
async function fetchStripeProduct(env, productId) {
  const response = await fetch(
    `https://api.stripe.com/v1/products/${productId}`,
    {
      headers: {
        'Authorization': `Basic ${btoa(env.STRIPE_SECRET_KEY + ':')}`,
      },
    }
  );

  if (!response.ok) {
    const error = await response.text();
    console.error('Stripe product error:', response.status, error);
    throw new Error(`Stripe API error: ${response.status}`);
  }

  return await response.json();
}

/**
 * Fetch checkout session from Stripe
 */
async function fetchStripeSession(env, sessionId) {
  const response = await fetch(
    `https://api.stripe.com/v1/checkout/sessions/${sessionId}`,
    {
      headers: {
        'Authorization': `Basic ${btoa(env.STRIPE_SECRET_KEY + ':')}`,
      },
    }
  );

  if (!response.ok) {
    const error = await response.text();
    console.error('Stripe session error:', response.status, error);
    throw new Error(`Stripe API error: ${response.status}`);
  }

  return await response.json();
}

/**
 * Fetch a Stripe customer.
 */
async function fetchStripeCustomer(env, customerId) {
  const response = await fetch(
    `https://api.stripe.com/v1/customers/${customerId}`,
    {
      headers: {
        'Authorization': `Basic ${btoa(env.STRIPE_SECRET_KEY + ':')}`,
      },
    }
  );

  if (!response.ok) {
    const error = await response.text();
    console.error('Stripe customer error:', response.status, error);
    throw new Error(`Stripe API error: ${response.status}`);
  }

  return await response.json();
}

/**
 * Create a Stripe customer.
 */
async function createStripeCustomer(env, email) {
  const body = new URLSearchParams();
  body.set('email', email);

  const response = await fetch('https://api.stripe.com/v1/customers', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('Stripe create customer error:', response.status, error);
    throw new Error(`Stripe API error: ${response.status}`);
  }

  return await response.json();
}

/**
 * Find license in Keygen by Stripe checkout session ID (stored in metadata)
 */
async function findLicenseByCheckoutSession(env, checkoutSessionId) {
  // Query Keygen for licenses with this checkout session ID in metadata
  const response = await fetch(
    `https://api.keygen.sh/v1/accounts/${env.KEYGEN_ACCOUNT_ID}/licenses?metadata[stripeCheckoutSessionId]=${encodeURIComponent(checkoutSessionId)}`,
    {
      headers: {
        'Authorization': `Bearer ${env.KEYGEN_PRODUCT_TOKEN}`,
        'Accept': 'application/vnd.api+json',
      },
    }
  );

  if (!response.ok) {
    const error = await response.text();
    console.error('Keygen license lookup error:', response.status, error);
    throw new Error(`Keygen API error: ${response.status}`);
  }

  const data = await response.json();
  
  // Return the first matching license, or null if none found
  return data.data && data.data.length > 0 ? data.data[0] : null;
}

/**
 * Render the success page HTML with the license key
 */
function renderSuccessPage(license, customerEmail, session) {
  const licenseKey = license.attributes.key;
  const tier = license.attributes.metadata?.tier || 'License';
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your Shimmy Vision License</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      color: #fff;
    }
    .container {
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 16px;
      padding: 40px;
      max-width: 600px;
      width: 100%;
      text-align: center;
      backdrop-filter: blur(10px);
    }
    .success-icon {
      font-size: 64px;
      margin-bottom: 20px;
    }
    h1 {
      font-size: 28px;
      margin-bottom: 10px;
      color: #4ade80;
    }
    .subtitle {
      color: rgba(255,255,255,0.7);
      margin-bottom: 30px;
    }
    .license-box {
      background: #0f0f1a;
      border: 2px solid #4ade80;
      border-radius: 12px;
      padding: 20px;
      margin: 20px 0;
    }
    .license-label {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: rgba(255,255,255,0.5);
      margin-bottom: 10px;
    }
    .license-key {
      font-family: 'SF Mono', Monaco, 'Courier New', monospace;
      font-size: 18px;
      word-break: break-all;
      color: #4ade80;
      user-select: all;
      padding: 10px;
      background: rgba(74, 222, 128, 0.1);
      border-radius: 8px;
    }
    .copy-btn {
      background: #4ade80;
      color: #000;
      border: none;
      padding: 12px 24px;
      font-size: 16px;
      font-weight: 600;
      border-radius: 8px;
      cursor: pointer;
      margin-top: 15px;
      transition: all 0.2s;
    }
    .copy-btn:hover {
      background: #22c55e;
      transform: scale(1.02);
    }
    .copy-btn.copied {
      background: #059669;
    }
    .warning {
      background: rgba(251, 191, 36, 0.1);
      border: 1px solid rgba(251, 191, 36, 0.3);
      border-radius: 8px;
      padding: 15px;
      margin-top: 25px;
      font-size: 14px;
      color: #fbbf24;
    }
    .warning-icon { margin-right: 8px; }
    .instructions {
      margin-top: 30px;
      text-align: left;
      background: rgba(255,255,255,0.03);
      border-radius: 8px;
      padding: 20px;
    }
    .instructions h3 {
      font-size: 14px;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 15px;
      color: rgba(255,255,255,0.7);
    }
    .instructions code {
      background: #0f0f1a;
      padding: 10px 15px;
      border-radius: 6px;
      display: block;
      font-family: 'SF Mono', Monaco, 'Courier New', monospace;
      font-size: 14px;
      color: #4ade80;
      overflow-x: auto;
    }
    .tier-badge {
      display: inline-block;
      background: rgba(74, 222, 128, 0.2);
      color: #4ade80;
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      margin-bottom: 20px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="success-icon">🎉</div>
    <h1>Payment Successful!</h1>
    <p class="subtitle">Thank you for purchasing Shimmy Vision</p>
    <div class="tier-badge">${escapeHtml(tier)}</div>
    
    <div class="license-box">
      <div class="license-label">Your License Key</div>
      <div class="license-key" id="license-key">${escapeHtml(licenseKey)}</div>
      <button class="copy-btn" onclick="copyKey()">📋 Copy License Key</button>
    </div>
    
    <div class="warning">
      <span class="warning-icon">⚠️</span>
      <strong>Important:</strong> Copy this license key now. We do not send it by email.
      Store it somewhere safe - you'll need it to activate Shimmy Vision.
    </div>
    
    <div class="instructions">
      <h3>How to use your license</h3>
      <code>shimmy vision --license YOUR_KEY --image photo.png</code>
      <p style="margin-top: 15px; font-size: 13px; color: rgba(255,255,255,0.5);">
        Or set the environment variable: <code style="display: inline; padding: 2px 6px;">SHIMMY_LICENSE_KEY</code>
      </p>
    </div>
  </div>
  
  <script>
    function copyKey() {
      const key = document.getElementById('license-key').textContent;
      navigator.clipboard.writeText(key).then(() => {
        const btn = document.querySelector('.copy-btn');
        btn.textContent = '✓ Copied!';
        btn.classList.add('copied');
        setTimeout(() => {
          btn.textContent = '📋 Copy License Key';
          btn.classList.remove('copied');
        }, 2000);
      });
    }
  </script>
</body>
</html>`;
}

/**
 * Render processing page (when license hasn't been created yet)
 */
function renderProcessingPage(customerEmail) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="refresh" content="3">
  <title>Processing Your License...</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      color: #fff;
    }
    .container {
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 16px;
      padding: 40px;
      max-width: 500px;
      width: 100%;
      text-align: center;
    }
    .spinner {
      width: 60px;
      height: 60px;
      border: 4px solid rgba(255,255,255,0.1);
      border-top-color: #4ade80;
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin: 0 auto 25px;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    h1 { font-size: 24px; margin-bottom: 10px; }
    p { color: rgba(255,255,255,0.7); }
  </style>
</head>
<body>
  <div class="container">
    <div class="spinner"></div>
    <h1>Creating Your License...</h1>
    <p>This page will automatically refresh. Please wait a moment.</p>
    ${customerEmail ? `<p style="margin-top: 15px; font-size: 14px;">Email: ${escapeHtml(customerEmail)}</p>` : ''}
  </div>
</body>
</html>`;
}

/**
 * Render error page
 */
function renderErrorPage(title, message) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Error - Shimmy Vision</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      color: #fff;
    }
    .container {
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(239,68,68,0.3);
      border-radius: 16px;
      padding: 40px;
      max-width: 500px;
      width: 100%;
      text-align: center;
    }
    .error-icon { font-size: 48px; margin-bottom: 20px; }
    h1 { font-size: 24px; margin-bottom: 10px; color: #ef4444; }
    p { color: rgba(255,255,255,0.7); }
    .support {
      margin-top: 25px;
      padding-top: 20px;
      border-top: 1px solid rgba(255,255,255,0.1);
      font-size: 14px;
    }
    a { color: #4ade80; }
  </style>
</head>
<body>
  <div class="container">
    <div class="error-icon">😕</div>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
    <div class="support">
      Need help? Contact <a href="mailto:support@shimmyai.dev">support@shimmyai.dev</a>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Create a Stripe Checkout Session.
 * Uses STRIPE_SECRET_KEY (server-side) and returns the session object.
 */
async function createStripeCheckoutSession(env, params) {
  const body = new URLSearchParams();
  body.set('mode', params.mode);
  body.set('success_url', params.successUrl);
  body.set('cancel_url', params.cancelUrl);
  body.set('line_items[0][price]', params.priceId);
  body.set('line_items[0][quantity]', '1');
  body.set('metadata[tier]', params.tier);

  // For lifetime (one-time payment), prioritize WeChat Pay and Alipay at top
  if (params.tier === 'lifetime') {
    body.set('payment_method_types[0]', 'wechat_pay');
    body.set('payment_method_types[1]', 'alipay');
    body.set('payment_method_types[2]', 'card');
    body.set('payment_method_types[3]', 'link');
    // WeChat Pay requires payment_method_options
    body.set('payment_method_options[wechat_pay][client]', 'web');
  }

  // Stripe Accounts v2 (test mode) may require an existing customer.
  if (params.requireCustomer) {
    const customer = await createStripeCustomer(env, params.email);
    body.set('customer', customer.id);
  }

  const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('Stripe create session error:', response.status, error);
    throw new Error(`Stripe API error: ${response.status}`);
  }

  return await response.json();
}

function renderCancelPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Checkout canceled</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      color: #fff;
    }
    .container {
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 16px;
      padding: 40px;
      max-width: 520px;
      width: 100%;
      text-align: center;
    }
    h1 { font-size: 24px; margin-bottom: 10px; }
    p { color: rgba(255,255,255,0.7); }
    a { color: #4ade80; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Checkout canceled</h1>
    <p>No worries. You can close this tab or try again.</p>
  </div>
</body>
</html>`;
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Handle portal endpoint - creates a customer portal session
 */
async function handlePortal(url, request, env) {
  try {
    const formData = await request.formData();
    const email = formData.get('email');

    if (!email || !email.includes('@')) {
      return new Response(JSON.stringify({ error: 'Valid email required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Find customer by email
    const customer = await findStripeCustomerByEmail(env, email);
    if (!customer) {
      return new Response(JSON.stringify({ error: 'Customer not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Create portal session
    const portalSession = await createStripePortalSession(env, customer.id, url.origin);

    return new Response(JSON.stringify({ portal_url: portalSession.url }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Portal endpoint error:', error.message);
    return new Response(JSON.stringify({ error: 'Unable to create portal session' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Handle license endpoint - retrieves license key for email
 */
async function handleLicense(url, request, env) {
  try {
    const formData = await request.formData();
    const email = formData.get('email');

    if (!email || !email.includes('@')) {
      return new Response(JSON.stringify({ error: 'Valid email required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Find license by email
    const license = await findLicenseByEmail(env, email);
    if (!license) {
      return new Response(JSON.stringify({ error: 'License not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ license_key: license.attributes.key }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('License endpoint error:', error.message);
    return new Response(JSON.stringify({ error: 'Unable to retrieve license' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Find Stripe customer by email
 */
async function findStripeCustomerByEmail(env, email) {
  const response = await fetch(`https://api.stripe.com/v1/customers?email=${encodeURIComponent(email)}`, {
    headers: {
      'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  });

  if (!response.ok) {
    throw new Error(`Stripe API error: ${response.status}`);
  }

  const data = await response.json();
  return data.data && data.data.length > 0 ? data.data[0] : null;
}

/**
 * Create Stripe customer portal session
 */
async function createStripePortalSession(env, customerId, returnUrl) {
  const response = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      customer: customerId,
      return_url: returnUrl
    })
  });

  if (!response.ok) {
    throw new Error(`Stripe portal session error: ${response.status}`);
  }

  return await response.json();
}

/**
 * Find license by email in Keygen
 */
async function findLicenseByEmail(env, email) {
  const response = await fetch(`https://api.keygen.sh/v1/accounts/${env.KEYGEN_ACCOUNT_ID}/licenses?filter[email]=${encodeURIComponent(email)}&limit=1`, {
    headers: {
      'Authorization': `Bearer ${env.KEYGEN_ADMIN_TOKEN}`,
      'Accept': 'application/vnd.api+json'
    }
  });

  if (!response.ok) {
    throw new Error(`Keygen API error: ${response.status}`);
  }

  const data = await response.json();
  return data.data && data.data.length > 0 ? data.data[0] : null;
}
