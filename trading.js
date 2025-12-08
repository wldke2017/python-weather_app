// ===================================
// TRADING INTERFACE FUNCTIONS
// ===================================

function requestBalance() {
    const balanceRequest = { "balance": 1, "subscribe": 1 };
    sendAPIRequest(balanceRequest);
}

function requestActiveSymbols() {
    const symbolsRequest = { "active_symbols": "brief", "product_type": "basic" };
    sendAPIRequest(symbolsRequest);
}

function subscribeToAllVolatilities() {
    console.log('🔍 Debugging activeSymbols array:', activeSymbols);
    console.log('🔍 Total symbols received:', activeSymbols.length);

    // Debug: Show all markets available
    const markets = [...new Set(activeSymbols.map(s => s.market))];
    console.log('🔍 Available markets:', markets);

    // Debug: Show ALL symbols and their markets
    console.log('🔍 All available symbols:');
    activeSymbols.forEach(symbol => {
        console.log(`  - ${symbol.symbol} (${symbol.market})`);
    });

    // Debug: Show synthetic indices specifically
    const syntheticSymbols = activeSymbols.filter(s => s.market === 'synthetic_index');
    console.log('🔍 Synthetic indices found:', syntheticSymbols.length);
    syntheticSymbols.forEach(symbol => {
        console.log(`  - ${symbol.symbol} (${symbol.market})`);
    });

    // Try different market name variations
    const alternativeSynthetic = activeSymbols.filter(s =>
        s.market === 'synthetic_index' ||
        s.market === 'synthetic' ||
        s.market === 'volatility' ||
        s.market === 'derived'
    );
    console.log('🔍 Alternative synthetic market names:', alternativeSynthetic.length);

    // Filter for ALL volatility indices including 1s versions
    const volatilitySymbols = activeSymbols
        .filter(symbol => {
            // Check if it's a synthetic index
            if (symbol.market !== 'synthetic_index') return false;
            
            // Include all R_ (Volatility) and 1HZ (1s) indices
            const isVolatility = symbol.symbol.startsWith('R_') || 
                                 symbol.symbol.startsWith('1HZ') ||
                                 symbol.symbol.includes('1s');
            
            // Also include Jump indices
            const isJump = symbol.symbol.startsWith('JD');
            
            return isVolatility || isJump;
        })
        .map(symbol => symbol.symbol);

    // List of expected volatility symbols to verify subscription
    const expectedVolatilities = [
        'R_10', '1HZ10V',      // Volatility 10 and 10 (1s)
        'R_25', '1HZ25V',      // Volatility 25 and 25 (1s)
        'R_50', '1HZ50V',      // Volatility 50 and 50 (1s)
        'R_75', '1HZ75V',      // Volatility 75 and 75 (1s)
        'R_100', '1HZ100V',    // Volatility 100 and 100 (1s)
        '1HZ150V',             // Volatility 150 (1s)
        '1HZ200V',             // Volatility 200 (1s)
        '1HZ250V',             // Volatility 250 (1s)
        '1HZ300V'              // Volatility 300 (1s)
    ];

    console.log(`✅ Subscribing to ${volatilitySymbols.length} synthetic indices:`, volatilitySymbols);
    console.log('📋 Expected volatilities:', expectedVolatilities);
    
    // Check which expected symbols are missing
    const missingSymbols = expectedVolatilities.filter(exp => !volatilitySymbols.includes(exp));
    if (missingSymbols.length > 0) {
        console.warn('⚠️ Some expected volatility symbols not found:', missingSymbols);
        console.warn('⚠️ This might be normal if they are not available in your region/account');
    }

    if (volatilitySymbols.length === 0) {
        console.warn("⚠️ No synthetic indices found! This will prevent the bot from working.");
        console.warn("⚠️ Check if active_symbols request succeeded and contains synthetic_index market symbols.");

        // Try subscribing to ALL symbols as fallback
        const allSymbols = activeSymbols.map(s => s.symbol);
        console.log('🔄 Fallback: Subscribing to ALL available symbols:', allSymbols);

        volatilitySymbols.push(...allSymbols);
    }

    sendAPIRequest({ "forget_all": "ticks" });

    volatilitySymbols.forEach(symbol => {
        sendAPIRequest({ "ticks_history": symbol, "adjust_start_time": 1, "count": 1, "end": "latest", "start": 1, "style": "ticks", "subscribe": 1 });

        // Initialize market tick history
        marketTickHistory[symbol] = [];
        marketDigitPercentages[symbol] = {
            0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0
        };
        marketFullTickDigits[symbol] = [];

        // Fetch historical tick data for distribution analysis
        fetchTickHistory(symbol);

        if (!document.getElementById(`row-${symbol}`)) {
            const row = tickerTableBody.insertRow();
            row.id = `row-${symbol}`;

            const symbolCell = row.insertCell(0);
            // Better display names for volatility indices
            let displayName = symbol
                .replace('R_', 'V')
                .replace('1HZ', 'V')
                .replace('V', 'Vol ')
                .replace('JD', 'Jump ');
            
            // Add (1s) suffix for 1-second indices
            if (symbol.startsWith('1HZ') || symbol.includes('1s')) {
                displayName += ' (1s)';
            }
            
            symbolCell.textContent = displayName;

            row.insertCell(1).textContent = '--';
            row.insertCell(2).textContent = '--';
        }
    });

    // Hide skeleton and show table after a delay to simulate loading
    setTimeout(() => {
        const skeleton = document.getElementById('marketWatchSkeleton');
        const table = document.getElementById('tickerTable');
        if (skeleton && table) {
            skeleton.style.display = 'none';
            table.style.display = 'table';
        }
    }, 2000);
}

function requestMarketData(symbol) {
    if (!currentChart) initializeChart();
    CHART_MARKET = symbol;

    const historyRequest = {
        "ticks_history": symbol,
        "end": "latest",
        "count": 400,
        "adjust_start_time": 1,
        "style": "candles",
        "granularity": CHART_INTERVAL,
        "subscribe": 0
    };
    sendAPIRequest(historyRequest);

    tradeMessageContainer.textContent = `Loading data for ${symbol}...`;
}

/**
 * Fetches historical tick data for a symbol to build full digit distribution
 * @param {string} symbol - The symbol to fetch tick history for
 */
function fetchTickHistory(symbol) {
    const tickHistoryRequest = {
        "ticks_history": symbol,
        "end": "latest",
        "count": 1000,
        "style": "ticks",
        "subscribe": 0
    };
    sendAPIRequest(tickHistoryRequest);
}

function handleMarketChange() {
    const newSymbol = marketSelector.value;
    requestMarketData(newSymbol);
}

/**
 * Sends a buy request to the Deriv API.
 * @param {string} action - 'CALL' for Up or 'PUT' for Down.
 */
function sendPurchaseRequest(action) {
    const symbol = marketSelector.value;
    const stake = parseFloat(stakeInput.value);
    const duration = parseInt(durationInput.value);

    // Validation
    if (!symbol) {
        showToast("Please select a market", 'warning');
        return;
    }

    if (isNaN(stake) || stake < 0.35) {
        showToast("Minimum stake is 0.35 USD", 'warning');
        stakeInput.focus();
        return;
    }

    if (isNaN(duration) || duration < 1) {
        showToast("Minimum duration is 1 tick", 'warning');
        durationInput.focus();
        return;
    }

    // Disable buttons to prevent double-submission
    buyButtonUp.disabled = true;
    buyButtonDown.disabled = true;

    const actionText = action === 'CALL' ? 'UP' : 'DOWN';
    tradeMessageContainer.innerHTML = `
        <svg class="message-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
            <path d="M12 6V12L16 14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
        <span>Placing ${actionText} trade on ${symbol}...</span>
    `;

    const purchaseRequest = {
        "buy": 1,
        "price": stake,
        "parameters": {
            "amount": stake,
            "basis": "stake",
            "contract_type": (action === 'CALL' ? "CALL" : "PUT"),
            "currency": "USD",
            "duration": duration,
            "duration_unit": "t",
            "symbol": symbol,
        }
    };

    sendAPIRequest(purchaseRequest)
        .catch(error => {
            buyButtonUp.disabled = false;
            buyButtonDown.disabled = false;
            showToast("Failed to place trade", 'error');
        });
}

// ----------------------------------------------------
// 2. Authorization and Primary Flow
// ----------------------------------------------------

function authorizeAndProceed(apiToken) {
    const authRequest = {
        "authorize": apiToken,
        "passthrough": { "purpose": "initial_login" }
    };
    sendAPIRequest(authRequest);
}

function handleLogin() {
    const apiToken = apiTokenInput.value.trim();

    if (!apiToken) {
        statusMessage.textContent = "⚠️ Please enter a valid API Token.";
        showToast("API Token is required", 'warning');
        apiTokenInput.focus();
        return;
    }

    // Validate token format (basic check)
    if (apiToken.length < 10) {
        statusMessage.textContent = "⚠️ Invalid API Token format.";
        showToast("API Token appears to be invalid", 'error');
        return;
    }

    setButtonLoading(loginButton, true);
    statusMessage.textContent = "Authorizing your account...";

    if (connection && connection.readyState === WebSocket.OPEN) {
        authorizeAndProceed(apiToken);
    } else {
        connectToDeriv();
        const checkConnection = setInterval(() => {
            if (connection && connection.readyState === WebSocket.OPEN) {
                clearInterval(checkConnection);
                authorizeAndProceed(apiToken);
            }
        }, 100);

        // Timeout after 10 seconds
        setTimeout(() => {
            clearInterval(checkConnection);
            if (!connection || connection.readyState !== WebSocket.OPEN) {
                setButtonLoading(loginButton, false);
                showToast("Connection timeout. Please try again.", 'error');
            }
        }, 10000);
    }
}

// ----------------------------------------------------
// 3. Symbol Population
// ----------------------------------------------------

function populateMarketSelector() {
    marketSelector.innerHTML = '';
    console.log('📊 Populating market selector with symbols...');

    const volatilitySymbols = activeSymbols
        .filter(symbol => symbol.market === 'synthetic_index')
        .sort((a, b) => a.symbol.localeCompare(b.symbol));

    console.log(`📊 Found ${volatilitySymbols.length} symbols for market selector`);

    volatilitySymbols.forEach(symbolData => {
        const option = document.createElement('option');
        option.value = symbolData.symbol;
        option.textContent = `${symbolData.symbol.replace('R_', 'V-')} (${symbolData.display_name})`;
        marketSelector.appendChild(option);
    });

    // Ensure the default market is selected
    if (marketSelector.querySelector(`option[value="${CHART_MARKET}"]`)) {
        marketSelector.value = CHART_MARKET;
    } else if (volatilitySymbols.length > 0) {
        CHART_MARKET = volatilitySymbols[0].symbol;
        marketSelector.value = CHART_MARKET;
    }

    console.log('📊 Market selector populated with options:', marketSelector.options.length);
}