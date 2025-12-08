// ===================================
// WEBSOCKET CONNECTION MANAGEMENT
// ===================================

function connectToDeriv() {
    if (connection && (connection.readyState === WebSocket.OPEN || connection.readyState === WebSocket.CONNECTING)) {
        return;
    }

    try {
        connection = new WebSocket(WS_URL);
        updateConnectionStatus('connecting');
        statusMessage.textContent = "Establishing connection...";

        connection.onopen = handleConnectionOpen;
        connection.onmessage = handleIncomingMessage;
        connection.onerror = handleConnectionError;
        connection.onclose = handleConnectionClose;

    } catch (error) {
        console.error("Failed to create WebSocket:", error);
        showToast("Failed to establish connection", 'error');
        updateConnectionStatus('error');
        attemptReconnect();
    }
}

/**
 * Establishes WebSocket connection and sends the authorize request.
 * @param {string} token - The access token from OAuth or localStorage.
 */
function connectAndAuthorize(token) {
    // Prevent creating multiple connections if one already exists and is open
    if (connection && connection.readyState === WebSocket.OPEN) {
        // Already connected, just re-authorize (useful for reconnects)
        connection.send(JSON.stringify({ authorize: token }));
        return;
    }

    // 1. Establish the connection using the constant WS_URL
    connection = new WebSocket(WS_URL);

    // 2. Set up event handlers
    connection.onopen = () => {
        updateConnectionStatus('connected');

        // THIS IS THE CRITICAL STEP: Sending the authorization message
        console.log('Connection established. Sending authorization...');
        connection.send(JSON.stringify({ authorize: token }));
    };

    connection.onmessage = (msg) => {
        try {
            const data = JSON.parse(msg.data);
            handleResponse(data); // Call your existing response handler
        } catch (e) {
            console.error('Error parsing WebSocket message:', e);
        }
    };

    connection.onerror = handleConnectionError;
    connection.onclose = handleConnectionClose;
}

function handleConnectionOpen(event) {
    console.log("✅ WebSocket connection established!");
    updateConnectionStatus('connected');
    statusMessage.textContent = "Connected. Enter your API token to continue.";
    reconnectAttempts = 0;

    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
}

function handleConnectionError(error) {
    console.error("❌ WebSocket Error:", error);
    console.error("❌ WebSocket Error details:", {
        code: error.code,
        reason: error.reason,
        wasClean: error.wasClean,
        target: error.target,
        type: error.type
    });
    updateConnectionStatus('error');
    showToast("Connection error occurred - Check network/firewall", 'error');

    // Additional diagnostics
    console.log("🔍 Connection diagnostics:");
    console.log("- WebSocket URL:", WS_URL);
    console.log("- Browser:", navigator.userAgent);
    console.log("- Online status:", navigator.onLine);
    console.log("- Protocol:", window.location.protocol);

    // Try to reconnect after a longer delay
    console.log("🔄 Attempting to reconnect in 10 seconds...");
    setTimeout(() => {
        console.log("🔄 Retrying connection...");
        connectToDeriv();
    }, 10000);
}

function handleConnectionClose(event) {
    console.log("🔌 WebSocket connection closed", event.code, event.reason);
    updateConnectionStatus('disconnected');

    if (!event.wasClean) {
        showToast("Connection lost. Attempting to reconnect...", 'warning');
        attemptReconnect();
    }
}

function attemptReconnect() {
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        showToast("Unable to connect. Please refresh the page.", 'error');
        statusMessage.textContent = "Connection failed. Please refresh the page.";
        return;
    }

    reconnectAttempts++;
    const delay = RECONNECT_DELAY * reconnectAttempts;

    statusMessage.textContent = `Reconnecting in ${delay/1000}s... (Attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`;

    reconnectTimer = setTimeout(() => {
        console.log(`🔄 Reconnect attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}`);
        connectToDeriv();
    }, delay);
}

function sendAPIRequest(request) {
    return new Promise((resolve, reject) => {
        if (!connection || connection.readyState !== WebSocket.OPEN) {
            console.error("❌ Connection not open. Cannot send request:", request);
            showToast("Connection not available. Reconnecting...", 'warning');
            connectToDeriv();
            reject(new Error("Connection not available"));
            return;
        }

        try {
            connection.send(JSON.stringify(request));
            resolve();
        } catch (error) {
            console.error("❌ Failed to send request:", error);
            showToast("Failed to send request", 'error');
            reject(error);
        }
    });
}

// ===================================
// OAUTH INITIALIZATION
// ===================================

// Check if we're returning from OAuth callback (implicit flow uses hash fragment)
if (window.location.hash.includes('token1=') || window.location.hash.includes('acct1=')) {
    handleOAuthCallback();
}

/**
 * Handles the OAuth callback when returning from Deriv OAuth
 */
function handleOAuthCallback() {
    console.log('🔄 OAuth callback detected, processing...');

    // For implicit flow, tokens are in the hash fragment, not query string
    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    console.log('All hash parameters:', Object.fromEntries(hashParams.entries()));

    const code = hashParams.get('code');
    const state = hashParams.get('state');
    const error = hashParams.get('error');

    // Deriv OAuth returns tokens directly in hash fragment
    const token1 = hashParams.get('token1');
    const token2 = hashParams.get('token2');
    const acct1 = hashParams.get('acct1');
    const acct2 = hashParams.get('acct2');

    console.log('OAuth callback params:', {
        code: code ? 'present' : 'missing',
        state: state ? 'present' : 'missing',
        error,
        token1: token1 ? 'present' : 'missing',
        token2: token2 ? 'present' : 'missing',
        acct1: acct1 ? 'present' : 'missing',
        acct2: acct2 ? 'present' : 'missing'
    });

    // Clear the hash fragment
    window.history.replaceState({}, document.title, window.location.pathname);

    // Check for errors
    if (error) {
        console.error('OAuth Error:', error);
        showToast(`OAuth Error: ${error}`, 'error');
        statusMessage.textContent = "OAuth authentication failed. Please try again.";
        return;
    }

    // Validate state parameter (CSRF protection)
    const storedState = sessionStorage.getItem('oauth_state');
    if (!state || state !== storedState) {
        console.error('State parameter mismatch - possible CSRF attack');
        console.error('Stored state:', storedState, 'Received state:', state);
        showToast('Authentication failed - security check failed', 'error');
        statusMessage.textContent = "OAuth security validation failed. Please try again.";
        return;
    }

    // Get account type from session storage
    const accountType = sessionStorage.getItem('oauth_account_type');
    if (!accountType) {
        console.error('No account type in session storage');
        showToast('Session expired. Please try again.', 'error');
        statusMessage.textContent = "Session expired. Please login again.";
        return;
    }

    console.log('✅ OAuth state validated successfully');
    console.log('Account type:', accountType);

    // Clear session storage
    sessionStorage.removeItem('oauth_state');
    sessionStorage.removeItem('oauth_account_type');

    // Handle Deriv OAuth response format (implicit flow returns tokens directly)
    if (token1 && acct1) {
        console.log(`✅ Received Deriv OAuth tokens for ${accountType} account`);
        console.log('Token details:', { 
            acct1: acct1, 
            hasToken1: !!token1, 
            acct2: acct2, 
            hasToken2: !!token2 
        });
        handleDerivOAuthTokens(token1, token2, acct1, acct2, accountType);
    } else if (code) {
        // This shouldn't happen with implicit flow, but handle it anyway
        console.warn('Received authorization code instead of token - this is unexpected with implicit flow');
        showToast('Unexpected OAuth response format. Please try again.', 'error');
        statusMessage.textContent = "OAuth configuration error. Please contact support.";
    } else {
        console.error('❌ No OAuth tokens or authorization code received');
        console.error('URL parameters:', { token1, token2, acct1, acct2, code, state });
        showToast('Authentication failed - no tokens received from Deriv', 'error');
        statusMessage.textContent = "No authentication tokens received. Please try again.";
    }
}

/**
 * Handles Deriv OAuth direct token response format
 */
function handleDerivOAuthTokens(token1, token2, acct1, acct2, accountType) {
    console.log('🔄 Handling Deriv OAuth tokens directly');
    console.log('Requested account type:', accountType);
    console.log('Available accounts:', { acct1, acct2 });

    try {
        let selectedToken = null;
        let selectedAccount = null;

        // Store tokens based on account type
        if (accountType === 'demo') {
            // For demo, prefer VRTC account (token2/acct2)
            if (token2 && acct2 && acct2.startsWith('VRTC')) {
                selectedToken = token2;
                selectedAccount = acct2;
                console.log('✅ Using demo account (VRTC):', acct2);
            } else if (token1 && acct1 && acct1.startsWith('VRTC')) {
                selectedToken = token1;
                selectedAccount = acct1;
                console.log('✅ Using demo account (VRTC):', acct1);
            } else {
                console.warn('⚠️ No VRTC demo account found, using first available token');
                selectedToken = token2 || token1;
                selectedAccount = acct2 || acct1;
            }
        } else if (accountType === 'real') {
            // For real, prefer CR account (token1/acct1)
            if (token1 && acct1 && acct1.startsWith('CR')) {
                selectedToken = token1;
                selectedAccount = acct1;
                console.log('✅ Using real account (CR):', acct1);
            } else if (token2 && acct2 && acct2.startsWith('CR')) {
                selectedToken = token2;
                selectedAccount = acct2;
                console.log('✅ Using real account (CR):', acct2);
            } else {
                console.warn('⚠️ No CR real account found, using first available token');
                selectedToken = token1 || token2;
                selectedAccount = acct1 || acct2;
            }
        }

        if (!selectedToken) {
            throw new Error('No valid token found for the requested account type');
        }

        oauthState.access_token = selectedToken;
        oauthState.account_type = accountType;
        oauthState.account_id = selectedAccount;

        console.log('✅ Stored OAuth state:', {
            access_token: oauthState.access_token ? 'present' : 'missing',
            account_type: oauthState.account_type,
            account_id: oauthState.account_id
        });

        // Connect to Deriv with OAuth token
        connectToDerivWithOAuth();

    } catch (error) {
        console.error('❌ Error handling Deriv OAuth tokens:', error);
        showToast(`Authentication failed: ${error.message}`, 'error');
        statusMessage.textContent = "OAuth token processing failed. Please try again.";
    }
}

/**
 * Connects to Deriv WebSocket using OAuth access token
 */
async function connectToDerivWithOAuth() {
    try {
        statusMessage.textContent = "Connecting with OAuth token...";

        // Ensure WebSocket connection
        if (!connection || connection.readyState !== WebSocket.OPEN) {
            console.log('Establishing WebSocket connection for OAuth...');
            connectToDeriv();

            // Wait for connection
            await new Promise((resolve, reject) => {
                const checkConnection = setInterval(() => {
                    if (connection && connection.readyState === WebSocket.OPEN) {
                        console.log('WebSocket connection established for OAuth');
                        clearInterval(checkConnection);
                        resolve();
                    }
                }, 100);

                setTimeout(() => {
                    clearInterval(checkConnection);
                    reject(new Error('Connection timeout'));
                }, 15000); // Increased timeout
            });
        }

        // Small delay to ensure connection is stable
        await new Promise(resolve => setTimeout(resolve, 500));

        // Authorize with OAuth token
        console.log('Authorizing with OAuth token...');
        await authorizeWithOAuthToken();
        
        // Authorization successful - the UI should now be updated by app.js message handler
        console.log('✅ OAuth login completed successfully');
        
        // Clean up URL parameters
        const cleanUrl = window.location.origin + window.location.pathname;
        window.history.replaceState({}, document.title, cleanUrl);

    } catch (error) {
        console.error('OAuth connection error:', error);
        showToast(`Connection failed: ${error.message}`, 'error');
        statusMessage.textContent = "OAuth connection failed. Please try again.";
    }
}

/**
 * Authorizes with Deriv using the OAuth access token
 */
function authorizeWithOAuthToken() {
    return new Promise((resolve, reject) => {
        if (!oauthState.access_token) {
            reject(new Error('No access token available'));
            return;
        }

        console.log('Authorizing with OAuth token...');

        const authRequest = {
            "authorize": oauthState.access_token,
            "passthrough": { "purpose": "oauth_login", "account_type": oauthState.account_type }
        };

        // Set up promise handlers that will be called from app.js message handler
        window.oauthResolve = resolve;
        window.oauthReject = reject;

        // Send authorization request
        const checkAuth = setTimeout(() => {
            if (window.oauthReject) {
                window.oauthReject(new Error('Authorization timeout'));
                delete window.oauthResolve;
                delete window.oauthReject;
            }
        }, 10000);

        // We'll handle the response in the message handler (app.js)
        sendAPIRequest(authRequest)
            .then(() => {
                console.log('OAuth authorization request sent, waiting for response...');
            })
            .catch(error => {
                clearTimeout(checkAuth);
                if (window.oauthReject) {
                    window.oauthReject(error);
                    delete window.oauthResolve;
                    delete window.oauthReject;
                }
            });
    });
}

// ===================================
// OAUTH FUNCTIONS
// ===================================

/**
 * Starts the OAuth login flow for the specified account type
 * @param {string} accountType - 'demo' or 'real'
 */
function startOAuthLogin(accountType) {
    console.log(`Starting OAuth login for ${accountType} account`);

    // Validate account type
    if (!ACCOUNT_TYPES[accountType.toUpperCase()]) {
        showToast('Invalid account type', 'error');
        return;
    }

    // Generate a random state parameter for CSRF protection
    const state = crypto.randomUUID();
    sessionStorage.setItem('oauth_state', state);
    sessionStorage.setItem('oauth_account_type', accountType);

    // Build the authorization URL using implicit flow (token response)
    const authUrl = new URL(OAUTH_CONFIG.authorization_url);
    authUrl.searchParams.set('app_id', OAUTH_CONFIG.app_id);
    authUrl.searchParams.set('l', OAUTH_CONFIG.language);
    authUrl.searchParams.set('brand', OAUTH_CONFIG.brand);
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('response_type', OAUTH_CONFIG.response_type); // Use 'token' for implicit flow
    
    console.log('Redirecting to OAuth URL:', authUrl.toString());
    console.log('Redirect URI will be:', OAUTH_CONFIG.redirect_uri);

    // Redirect to Deriv OAuth
    window.location.href = authUrl.toString();
}

/**
 * Initiates OAuth login to Deriv for the specified account type
 * @param {string} accountType - 'demo' or 'real'
 */
function loginToDerivAccount(accountType) {
    console.log(`Starting OAuth login for ${accountType} account`);

    // Validate account type
    if (!ACCOUNT_TYPES[accountType.toUpperCase()]) {
        showToast('Invalid account type', 'error');
        return;
    }

    // Start the OAuth flow
    startOAuthLogin(accountType);
}

// ===================================
// WEBSOCKET TESTING FUNCTION
// ===================================

function testWebSocketConnection() {
    console.log('🧪 Testing WebSocket connection...');

    // Clear any existing connection
    if (connection && connection.readyState === WebSocket.OPEN) {
        connection.close();
    }

    // Reset connection attempts
    reconnectAttempts = 0;

    // Try to connect
    console.log('🔄 Initiating test connection...');
    connectToDeriv();

    // Set a timeout to check the result
    setTimeout(() => {
        const status = connection ? connection.readyState : 'no connection';
        const statusText = {
            0: 'CONNECTING',
            1: 'OPEN',
            2: 'CLOSING',
            3: 'CLOSED'
        }[status] || 'UNKNOWN';

        console.log('📊 Connection test result:', statusText);

        if (connection && connection.readyState === WebSocket.OPEN) {
            showToast('✅ WebSocket connection successful!', 'success');
        } else {
            showToast('❌ WebSocket connection failed - check console for details', 'error');
        }
    }, 5000);
}