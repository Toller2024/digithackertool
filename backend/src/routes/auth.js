import express from 'express';
import crypto from 'crypto';
import User from '../models/User.js';

const router = express.Router();

const DERIV_AUTH_URL = 'https://auth.deriv.com/oauth2/auth';
const DERIV_TOKEN_URL = 'https://auth.deriv.com/oauth2/token';

const getRedirectUri = () =>
  process.env.DERIV_CALLBACK_URL ||
  'https://digithackertool-backend.onrender.com/api/auth/deriv/callback';

const getFrontendUrl = () =>
  process.env.FRONTEND_URL ||
  'https://digitalhackertool.vercel.app';

// Generate PKCE verifier
function generateCodeVerifier() {
  return crypto.randomBytes(64).toString('base64url');
}

// Generate PKCE challenge
function generateCodeChallenge(verifier) {
  return crypto
    .createHash('sha256')
    .update(verifier)
    .digest('base64url');
}

// Start Deriv OAuth login
router.get('/deriv', (req, res) => {
  try {
    const clientId = process.env.DERIV_CLIENT_ID;

    if (!clientId) {
      console.error('DERIV_CLIENT_ID is missing');
      return res.redirect(
        `${getFrontendUrl()}/?error=missing_client_id`
      );
    }

    const state = crypto.randomBytes(32).toString('hex');
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);

    // Store PKCE values in the server session
    req.session.derivOAuth = {
      state,
      codeVerifier
    };

    const authUrl = new URL(DERIV_AUTH_URL);

    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set(
      'redirect_uri',
      getRedirectUri()
    );
    authUrl.searchParams.set('scope', 'trade');
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set(
      'code_challenge',
      codeChallenge
    );
    authUrl.searchParams.set(
      'code_challenge_method',
      'S256'
    );

    res.redirect(authUrl.toString());
  } catch (error) {
    console.error('Deriv OAuth start error:', error);

    res.redirect(
      `${getFrontendUrl()}/?error=oauth_start_failed`
    );
  }
});

// Deriv OAuth callback
router.get('/deriv/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;

  if (error) {
    console.error(
      'Deriv OAuth error:',
      error,
      error_description || ''
    );

    return res.redirect(
      `${getFrontendUrl()}/?error=deriv_denied`
    );
  }

  if (!code || !state) {
    return res.redirect(
      `${getFrontendUrl()}/?error=missing_oauth_data`
    );
  }

  try {
    const oauthSession = req.session.derivOAuth;

    if (!oauthSession) {
      console.error('OAuth session data missing');
      return res.redirect(
        `${getFrontendUrl()}/?error=session_expired`
      );
    }

    // Verify state
    if (state !== oauthSession.state) {
      console.error('OAuth state mismatch');

      delete req.session.derivOAuth;

      return res.redirect(
        `${getFrontendUrl()}/?error=state_mismatch`
      );
    }

    const clientId = process.env.DERIV_CLIENT_ID;

    if (!clientId) {
      throw new Error('DERIV_CLIENT_ID is missing');
    }

    // Exchange authorization code for access token
    const tokenResponse = await fetch(
      DERIV_TOKEN_URL,
      {
        method: 'POST',
        headers: {
          'Content-Type':
            'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: clientId,
          code,
          redirect_uri: getRedirectUri(),
          code_verifier: oauthSession.codeVerifier
        })
      }
    );

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok || !tokenData.access_token) {
      console.error(
        'Deriv token exchange failed:',
        tokenData
      );

      throw new Error('Token exchange failed');
    }

    const accessToken = tokenData.access_token;

    // Get the authenticated Deriv account
    const accountResponse = await fetch(
      'https://api.derivws.com/trading/v1/options/accounts',
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const accountData = await accountResponse.json();

    if (!accountResponse.ok) {
      console.error(
        'Deriv account request failed:',
        accountData
      );

      throw new Error('Could not retrieve Deriv account');
    }

    console.log(
      'Deriv OAuth successful'
    );

    // Try to determine the primary account
    const accounts =
      accountData.accounts ||
      accountData.data ||
      [];

    const primaryAccount =
      Array.isArray(accounts) && accounts.length > 0
        ? accounts[0]
        : null;

    const loginid =
      primaryAccount?.loginid ||
      primaryAccount?.account_id ||
      'deriv_user';

    const currency =
      primaryAccount?.currency ||
      'USD';

    const email =
      primaryAccount?.email ||
      `deriv_${loginid}@oauth.local`;

    let user = await User.findOne({
      loginid
    });

    if (!user) {
      const uid =
        `user_${loginid}_${Date.now()}`;

      user = new User({
        uid,
        email,
        name: loginid,
        loginid,
        deriv: {
          loginid,
          linkedAt: new Date(),
          currency,
          token: accessToken
        },
        tokens: [
          {
            token: accessToken,
            account: loginid,
            currency
          }
        ],
        lastLogin: new Date()
      });
    } else {
      user.lastLogin = new Date();

      user.deriv = {
        loginid,
        linkedAt:
          user.deriv?.linkedAt || new Date(),
        currency,
        token: accessToken
      };

      user.tokens = [
        {
          token: accessToken,
          account: loginid,
          currency
        }
      ];
    }

    await user.save();

    // Create application session
    req.session.userId = user._id;
    req.session.uid = user.uid;

    // Remove temporary OAuth data
    delete req.session.derivOAuth;

    req.session.save((sessionError) => {
      if (sessionError) {
        console.error(
          'Session save error:',
          sessionError
        );

        return res.redirect(
          `${getFrontendUrl()}/?error=session_save_failed`
        );
      }

      res.redirect(
        `${getFrontendUrl()}/dashboard`
      );
    });
  } catch (error) {
    console.error(
      'Deriv OAuth callback error:',
      error
    );

    delete req.session.derivOAuth;

    res.redirect(
      `${getFrontendUrl()}/?error=auth_failed`
    );
  }
});

// Get current user
router.get('/me', async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({
      error: 'Not authenticated'
    });
  }

  try {
    const user = await User.findById(
      req.session.userId
    ).select('-deriv.token -tokens');

    if (!user) {
      return res.status(401).json({
        error: 'User not found'
      });
    }

    res.json(user);
  } catch (error) {
    console.error(
      'Get user error:',
      error
    );

    res.status(500).json({
      error: 'Server error'
    });
  }
});

// Logout
router.post('/logout', (req, res) => {
  req.session.destroy((error) => {
    if (error) {
      return res.status(500).json({
        error: 'Logout failed'
      });
    }

    res.json({
      success: true
    });
  });
});

export default router;
