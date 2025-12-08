// ===================================
// GHOST_TRADES - ENHANCED TRADING PLATFORM
// Improved Error Handling & Code Organization
// ===================================

// --- Constants ---
const APP_ID = 111038;
const WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;
const RECONNECT_DELAY = 3000;
const MAX_RECONNECT_ATTEMPTS = 5;

// --- Account Types ---
const ACCOUNT_TYPES = {
    DEMO: 'demo',
    REAL: 'real'
};

// --- Deriv OAuth Configuration ---
const OAUTH_CONFIG = {
    app_id: '111038',
    authorization_url: 'https://oauth.deriv.com/oauth2/authorize',
    token_url: 'https://oauth.deriv.com/oauth2/token',
    redirect_uri: window.location.origin + window.location.pathname, // Dynamic redirect URI
    scope: 'read,trade,payments,trading_information,admin',
    brand: 'deriv',
    language: 'EN',
    response_type: 'token' // Using implicit flow for direct token response
};

// --- Core State ---
let connection = null;
let activeSymbols = [];
let lastPrices = {};
let currentContractId = null;
let reconnectAttempts = 0;
let reconnectTimer = null;

// --- Bot Toggle State ---
let isBotRunning = false; // NEW: State for the bot
let botLoopInterval = null; // NEW: To hold the bot's running interval

// --- GLOBAL MARKET DATA STRUCTURE ---
// Stores the last 20 digits for every subscribed volatility index.
let marketTickHistory = {};
// Stores percentage analysis for each digit (0-9) for each market
let marketDigitPercentages = {};
// Stores the last 1000 digits for distribution analysis
let marketFullTickDigits = {};
// ----------------------------------------

// --- Chart Setup ---
let currentChart = null;
let candleSeries = null;
let CHART_MARKET = 'R_100'; // Default market: Volatility 100 Index
const CHART_INTERVAL = '60'; // 1 minute interval

// --- DOM Elements ---
// Authentication & Dashboard
const apiTokenInput = document.getElementById('apiTokenInput');
const authContainer = document.querySelector('.auth-container');
const statusMessage = document.getElementById('statusMessage');
const loginButton = document.getElementById('loginButton');
const dashboard = document.getElementById('dashboard');
const loginIdDisplay = document.getElementById('loginIdDisplay');
const balanceDisplay = document.getElementById('balanceDisplay');
const symbolCountDisplay = document.getElementById('symbolCountDisplay');

// Trading Interface
const tradingInterface = document.getElementById('trading-interface');
const ghostaiInterface = document.getElementById('ghostai-interface');
const ghosteoddInterface = document.getElementById('ghost-eodd-interface');
const chartContainer = document.getElementById('chart-container');
const tradeMessageContainer = document.getElementById('tradeMessageContainer');
const tickerTableBody = document.querySelector('#tickerTable tbody');

// Trading Controls
const marketSelector = document.getElementById('marketSelector');
const stakeInput = document.getElementById('stakeInput');
const durationInput = document.getElementById('durationInput');
const buyButtonUp = document.getElementById('buyButtonUp');
const buyButtonDown = document.getElementById('buyButtonDown');

// Ghost AI Bot Controls
const botInitialStake = document.getElementById('botInitialStake');
const botTargetProfit = document.getElementById('botTargetProfit');
const startBotButton = document.getElementById('startBotButton');
const botPayoutPercentage = document.getElementById('botPayoutPercentage');
const botStopLoss = document.getElementById('botStopLoss');
const botMaxMartingale = document.getElementById('botMaxMartingale');
const stopBotButton = document.getElementById('stopBotButton');
const botLogContainer = document.getElementById('bot-log-container');
const botHistoryTableBody = document.querySelector('#bot-history-table tbody');

// --- Ghost AI Bot State ---
let botState = {
    activeSymbol: null,
    recoverySymbol: null, // Market symbol to stick to during Martingale recovery
    initialStake: 1.0,
    targetProfit: 50.0,
    payoutPercentage: 96,
    stopLoss: 20.0,
    maxMartingaleSteps: 5,
    currentStake: 1.0,
    totalProfit: 0.0,
    totalLoss: 0.0,
    accumulatedStakesLost: 0.0, // Accumulate stake amounts lost for martingale calculation
    activeStrategy: 'S1', // S1 or S2
    martingaleStepCount: 0,
    isTrading: false, // To prevent placing a new trade while one is active
    runId: null,
    winCount: 0, // Number of wins
    lossCount: 0, // Number of losses
    winPercentage: 0, // Win percentage
    s1LossSymbol: null, // Symbol where S1 loss occurred, to avoid in recovery
};

// --- Additional Bot State for Missing Elements ---
let emaValue = null;
let smaValue = null;

// --- OAuth State ---
let oauthState = {
    access_token: null,
    refresh_token: null,
    account_type: ACCOUNT_TYPES.DEMO, // Default to demo
    login_id: null
};

// Navigation
const dashboardNav = document.getElementById('dashboard-nav');
const speedbotNav = document.getElementById('speedbot-nav');
const ghostaiNav = document.getElementById('ghostai-nav');
const ghosteoddNav = document.getElementById('ghost-eodd-nav');

// ===================================
// MESSAGE ROUTER
// ===================================

function handleIncomingMessage(msg) {
    let data;

    try {
        data = JSON.parse(msg.data);
        console.log('📨 Received WebSocket message:', data.msg_type);
    } catch (error) {
        console.error("❌ Failed to parse message:", error);
        return;
    }

    // Handle API Errors
    if (data.error) {
        console.error("❌ API Error:", data.error.message);

        const errorMessages = {
            'InvalidToken': 'Invalid API Token. Please check and try again.',
            'AuthorizationRequired': 'Authorization required. Please login.',
            'RateLimit': 'Too many requests. Please wait a moment.',
            'DisabledClient': 'Your account is disabled. Please contact support.',
            'InputValidationFailed': 'Invalid input parameters.',
        };

        const userMessage = errorMessages[data.error.code] || data.error.message;

        showToast(userMessage, 'error');
        statusMessage.textContent = `❌ ${userMessage}`;

        // Re-enable buttons
        setButtonLoading(loginButton, false);
        buyButtonUp.disabled = false;
        buyButtonDown.disabled = false;

        // Update trade message if it's a purchase error
        if (data.msg_type === 'buy') {
            tradeMessageContainer.innerHTML = `
                <svg class="message-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
                    <line x1="15" y1="9" x2="9" y2="15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                    <line x1="9" y1="9" x2="15" y2="15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                </svg>
                <span>❌ ${userMessage}</span>
            `;
        }

        return;
    }

    switch (data.msg_type) {
        case 'authorize':
            // Data Request (Good! This fetches the balance and markets)
            console.log('🔄 Authorization successful, requesting balance and symbols...');
            connection.send(JSON.stringify({ 'balance': 1, 'subscribe': 1 }));
            connection.send(JSON.stringify({ active_symbols: 'brief', product_type: 'basic' }));

            // ------------------------------------------------------------------
            // ⚠️ THE MISSING STEP: SHOW THE DASHBOARD AND HIDE LOGIN UI
            // ------------------------------------------------------------------

            // 1. Hide the login form/area
            const loginInterface = document.querySelector('.auth-container');
            if (loginInterface) {
                loginInterface.style.display = 'none';
            }

            // 2. Show the main dashboard section (This is the critical line)
            showSection('dashboard');

            // You should also update the connection status to show success
            updateConnectionStatus('connected');

            if (data.authorize) {
                console.log("✅ Authorization successful:", data.authorize.loginid);
                showToast(`Welcome! Logged in as ${data.authorize.loginid}`, 'success');

                loginIdDisplay.textContent = data.authorize.loginid;

                setButtonLoading(loginButton, false);

                // Store login ID in oauthState
                oauthState.login_id = data.authorize.loginid;

                // Check if it's OAuth authorization
                const isOAuth = data.echo_req && data.echo_req.passthrough && data.echo_req.passthrough.purpose === 'oauth_login';

                // Resolve OAuth promise if it exists
                if (window.oauthResolve) {
                    console.log('OAuth authorization completed successfully');
                    window.oauthResolve();
                    delete window.oauthResolve;
                    delete window.oauthReject;
                }

                // For OAuth logins, set loading state
                if (isOAuth) {
                    statusMessage.textContent = "Loading your account data...";
                }
            }
            break;

        case 'balance':
            if (data.balance) {
                const balance = parseFloat(data.balance.balance).toFixed(2);
                const currency = data.balance.currency;

                balanceDisplay.textContent = formatCurrency(balance, currency);

                const headerBalance = document.getElementById('headerBalance');
                const headerBalanceAmount = document.getElementById('headerBalanceAmount');
                if (headerBalance && headerBalanceAmount) {
                    headerBalance.style.display = 'flex';
                    headerBalanceAmount.textContent = formatCurrency(balance, currency);
                }
            }
            break;

        case 'active_symbols':
            if (data.active_symbols) {
                activeSymbols = data.active_symbols;
                const count = activeSymbols.length;
                symbolCountDisplay.textContent = `${count} markets`;

                console.log(`✅ Loaded ${count} active symbols`);
                console.log('📋 First 10 symbols for debugging:', activeSymbols.slice(0, 10));
                showToast(`${count} markets loaded successfully`, 'success');

                populateMarketSelector();
                subscribeToAllVolatilities();
            } else {
                console.error('❌ No active_symbols data received from Deriv API');
                showToast('Failed to load markets from Deriv', 'error');
            }
            break;

        case 'history':
            if (data.history && data.history.candles) {
                const historyData = data.history.candles.map(c => ({
                    time: parseInt(c.epoch),
                    open: parseFloat(c.open),
                    high: parseFloat(c.high),
                    low: parseFloat(c.low),
                    close: parseFloat(c.close),
                })).reverse();

                candleSeries.setData(historyData);
                tradeMessageContainer.textContent = `Chart loaded for ${data.echo_req.ticks_history}. Ready to trade.`;
            } else if (data.history && data.history.times) {
                // Handle tick history for distribution analysis
                const symbol = data.echo_req.ticks_history;
                const quotes = data.history.quotes || [];
                const digits = quotes.map(quote => parseInt(quote.toString().slice(-1)));
                marketFullTickDigits[symbol] = digits.slice(-1000); // Keep last 1000
                console.log(`✅ Loaded ${digits.length} historical ticks for ${symbol} distribution analysis`);
            }
            break;

        case 'tick':
            if (data.tick) {
                const symbol = data.tick.symbol;
                const price = parseFloat(data.tick.quote);

                // 1. Update Chart (only if it's the market being tracked by the chart)
                if (symbol === CHART_MARKET) {
                    if (candleSeries) {
                        const newCandle = {
                            time: parseInt(data.tick.epoch),
                            open: parseFloat(data.tick.open),
                            high: parseFloat(data.tick.high),
                            low: parseFloat(data.tick.low),
                            close: price,
                        };
                        candleSeries.update(newCandle);
                    }
                }

                // 2. Update Full Tick Digits for distribution analysis (keep last 1000)
                if (marketFullTickDigits[symbol]) {
                    const digit = parseInt(price.toString().slice(-1));
                    marketFullTickDigits[symbol].push(digit);
                    if (marketFullTickDigits[symbol].length > 1000) {
                        marketFullTickDigits[symbol].shift();
                    }
                }

                // 3. Update Ticker Watch Table
                const row = document.getElementById(`row-${symbol}`);
                if (row) {
                    // --- BOT TICK HANDLING ---
                    if (isBotRunning) {
                        handleBotTick(data.tick);
                    }
                    // --- GHOST_E/ODD BOT TICK HANDLING ---
                    if (evenOddBotState.isTrading) {
                        handleEvenOddTick(data.tick);
                    }
                    // --- END BOT ---

                    const priceCell = row.cells[1];
                    const changeCell = row.cells[2];

                    if (lastPrices[symbol]) {
                        const lastPrice = lastPrices[symbol];

                        priceCell.classList.remove('price-up', 'price-down');
                        if (price > lastPrice) {
                            priceCell.classList.add('price-up');
                        } else if (price < lastPrice) {
                            priceCell.classList.add('price-down');
                        }

                        const percentageChange = ((price - lastPrice) / lastPrice) * 100;
                        changeCell.textContent = `${percentageChange.toFixed(2)}%`;

                        row.style.backgroundColor = (price > lastPrice) ? '#e6ffe6' : '#ffe6e6';
                        setTimeout(() => {
                            row.style.backgroundColor = '';
                        }, 500);
                    }

                    priceCell.textContent = price.toFixed(5);
                    lastPrices[symbol] = price;
                }
            }
            break;

        case 'buy':
            buyButtonUp.disabled = false;
            buyButtonDown.disabled = false;

            const contractInfo = data.buy;
            const passthrough = data.echo_req.passthrough;

            // Check if this is a Ghost AI bot trade
            if (passthrough && passthrough.purpose === 'ghost_ai_trade' && passthrough.run_id === botState.runId) {
                if (contractInfo) {
                    const strategy = passthrough.strategy || 'S1';
                    const strategyLabel = strategy === 'S1' ? 'S1 Entry' : 'S2 Recovery';
                    
                    // Track this contract
                    activeContracts[contractInfo.contract_id] = {
                        symbol: passthrough.symbol,
                        strategy: strategy,
                        stake: passthrough.stake,
                        startTime: Date.now()
                    };
                    
                    addBotLog(`✅ ${strategyLabel} contract opened: ${contractInfo.contract_id} | ${passthrough.symbol} | Stake: $${passthrough.stake.toFixed(2)}`);

                    sendAPIRequest({
                        "proposal_open_contract": 1,
                        "contract_id": contractInfo.contract_id,
                        "subscribe": 1,
                        "passthrough": { 
                            "purpose": "ghost_ai_trade", 
                            "run_id": botState.runId, 
                            "symbol": passthrough.symbol, 
                            "barrier": passthrough.barrier,
                            "strategy": strategy,
                            "stake": passthrough.stake
                        }
                    });
                }
            }
            // Check if this is a GHOST_E/ODD bot trade
            else if (passthrough && passthrough.purpose === 'ghost_even_odd_trade' && passthrough.run_id === evenOddBotState.runId) {
                if (contractInfo) {
                    // Track this contract for the Even/Odd bot
                    evenOddBotState.activeContracts[contractInfo.contract_id] = {
                        symbol: passthrough.symbol,
                        stake: passthrough.stake,
                        pattern: passthrough.pattern,
                        prediction_type: passthrough.prediction_type
                    };

                    addEvenOddBotLog(`✅ ${passthrough.symbol} contract opened: ${contractInfo.contract_id} | ${passthrough.prediction_type} | Pattern: ${passthrough.pattern}`, 'info');

                    sendAPIRequest({
                        "proposal_open_contract": 1,
                        "contract_id": contractInfo.contract_id,
                        "subscribe": 1,
                        "passthrough": { 
                            "purpose": "ghost_even_odd_trade", 
                            "run_id": evenOddBotState.runId, 
                            "symbol": passthrough.symbol, 
                            "prediction_type": passthrough.prediction_type,
                            "pattern": passthrough.pattern,
                            "stake": passthrough.stake
                        }
                    });
                }
            }
            else if (contractInfo) {
                currentContractId = contractInfo.contract_id;
                const payout = parseFloat(contractInfo.payout).toFixed(2);

                showToast(`Trade placed successfully! Contract ID: ${contractInfo.contract_id}`, 'success');

                tradeMessageContainer.innerHTML = `
                    <svg class="message-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                        <polyline points="22 4 12 14.01 9 11.01" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                    <span>✅ Trade placed! Contract: ${contractInfo.contract_id} | Payout: ${payout} ${contractInfo.currency}</span>
                `;

                sendAPIRequest({ "proposal_open_contract": 1, "contract_id": currentContractId, "subscribe": 1 });
            }
            break;

        case 'proposal_open_contract':
            const contract = data.proposal_open_contract;

            if (contract.is_expired) {
                const passthrough = data.echo_req.passthrough;

                // Check if it's a Ghost AI bot trade that we need to process
                if (passthrough && passthrough.purpose === 'ghost_ai_trade' && passthrough.run_id === botState.runId) {

                    // Add symbol and barrier info to the contract for history logging
                    contract.symbol = passthrough.symbol;
                    contract.barrier = passthrough.barrier;
                    contract.strategy = passthrough.strategy || 'S1';

                    // Remove from active contracts tracking
                    if (activeContracts[contract.contract_id]) {
                        const contractInfo = activeContracts[contract.contract_id];
                        
                        // Remove from S1 symbols tracking if it was an S1 trade
                        if (contractInfo.strategy === 'S1') {
                            activeS1Symbols.delete(contractInfo.symbol);
                        }
                        
                        delete activeContracts[contract.contract_id];
                    }

                    addBotTradeHistory(contract, contract.profit);

                    sendAPIRequest({ "forget": contract.id }); // Unsubscribe

                    // Notification on win
                    if (contract.profit > 0) {
                        const strategyLabel = contract.strategy === 'S1' ? 'S1' : 'S2';
                        showToast(`🎉 ${strategyLabel} Win: +$${contract.profit.toFixed(2)} on ${contract.symbol}`, 'success', 10000);
                    }

                    // --- Strategy-Specific Logic ---
                    if (contract.strategy === 'S1') {
                        if (contract.profit < 0) {
                            // S1 Loss - Track consecutive losses
                            botState.totalPL += contract.profit;
                            botState.lossCount++;
                            botState.accumulatedStakesLost += passthrough.stake;
                            botState.martingaleStepCount = 1; // Activate S2 recovery
                            botState.s1LossSymbol = contract.symbol;
                            botState.s1ConsecutiveLosses++;
                            
                            addBotLog(`❌ S1 Loss #${botState.s1ConsecutiveLosses}: $${contract.profit.toFixed(2)} on ${contract.symbol} | Total P/L: $${botState.totalPL.toFixed(2)}`, 'loss');
                            
                            // Check if we should block S1
                            if (botState.s1ConsecutiveLosses >= botState.s1MaxLosses) {
                                botState.s1Blocked = true;
                                addBotLog(`🚫 S1 BLOCKED after ${botState.s1ConsecutiveLosses} consecutive losses! Only S2 recovery trades allowed until losses recovered.`, 'error');
                            }
                            
                            addBotLog(`🔄 S2 Recovery Mode Activated | Accumulated Loss: $${botState.accumulatedStakesLost.toFixed(2)}`, 'warning');
                        } else {
                            // S1 Win - Reset consecutive loss counter
                            botState.totalPL += contract.profit;
                            botState.winCount++;
                            botState.s1ConsecutiveLosses = 0; // Reset on win
                            addBotLog(`✅ S1 Win: +$${contract.profit.toFixed(2)} on ${contract.symbol} | Total P/L: $${botState.totalPL.toFixed(2)} | Consecutive losses reset`, 'win');
                        }
                    } else {
                        // S2 Recovery trades handle martingale
                        if (contract.profit < 0) {
                            botState.totalPL += contract.profit;
                            botState.martingaleStepCount++;
                            botState.lossCount++;

                            addBotLog(`❌ S2 Loss: $${contract.profit.toFixed(2)} on ${contract.symbol} | Total P/L: $${botState.totalPL.toFixed(2)} | Martingale Step ${botState.martingaleStepCount}`, 'loss');

                            // Check for Stop-Loss
                            if (Math.abs(botState.totalPL) >= botState.stopLoss) {
                                addBotLog(`🛑 Stop-Loss Hit: -$${Math.abs(botState.totalPL).toFixed(2)} / $${botState.stopLoss.toFixed(2)} | Bot Stopped`, 'error');
                                stopGhostAiBot();
                                return;
                            }

                            // Accumulate stake amounts lost for martingale calculation
                            botState.accumulatedStakesLost += passthrough.stake;
                        const accumulatedLosses = botState.accumulatedStakesLost;
                        const recoveryMultiplier = 100 / botState.payoutPercentage;
                        const nextStake = accumulatedLosses * recoveryMultiplier;

                        botState.currentStake = parseFloat(nextStake.toFixed(2));
                        addBotLog(`📊 Accumulated Stakes Lost: $${botState.accumulatedStakesLost.toFixed(2)} | Next Stake: $${botState.currentStake.toFixed(2)}`, 'info');

                        // Check for Max Martingale Steps after calculating stake
                        if (botState.martingaleStepCount > botState.maxMartingaleSteps) {
                            addBotLog(`🛑 Max Martingale Steps (${botState.maxMartingaleSteps}) Reached | Bot Stopped`, 'error');
                            stopGhostAiBot();
                            return;
                        }

                        addBotLog(`⚠️ Recovery Mode: Stake → $${botState.currentStake.toFixed(2)} | Locked on ${botState.recoverySymbol}`, 'warning');
                        } else {
                            // S2 Win - Reset martingale
                            botState.totalPL += contract.profit;
                            botState.winCount++;
                            addBotLog(`✅ S2 Win: +$${contract.profit.toFixed(2)} on ${contract.symbol} | Total P/L: $${botState.totalPL.toFixed(2)} | Martingale reset`, 'win');

                            // Update win percentage
                            updateWinPercentage();

                            // Reset martingale state and unblock S1
                            botState.currentStake = botState.initialStake;
                            botState.activeStrategy = 'S1';
                            botState.martingaleStepCount = 0;
                            botState.recoverySymbol = null;
                            botState.s1LossSymbol = null;
                            botState.accumulatedStakesLost = 0.0;
                            botState.s1ConsecutiveLosses = 0; // Reset consecutive losses
                            
                            if (botState.s1Blocked) {
                                botState.s1Blocked = false;
                                addBotLog(`✅ S1 UNBLOCKED! Losses recovered. S1 trades now allowed again.`, 'win');
                            }
                            
                            addBotLog(`🔄 S2 Recovery Successful! Martingale reset | Back to base stake: $${botState.currentStake.toFixed(2)}`, 'info');
                        }
                    }

                    // Check for target profit
                    if (botState.totalPL >= botState.targetProfit) {
                        addBotLog(`🎉 Target Profit Reached: $${botState.totalPL.toFixed(2)} / $${botState.targetProfit.toFixed(2)}`, 'win');
                        stopGhostAiBot();
                    }
                    
                    updateProfitLossDisplay();
                }
                // Check if it's a GHOST_E/ODD bot trade
                else if (passthrough && passthrough.purpose === 'ghost_even_odd_trade' && passthrough.run_id === evenOddBotState.runId) {

                    // Add symbol and prediction info to the contract for history logging
                    contract.symbol = passthrough.symbol;
                    contract.prediction_type = passthrough.prediction_type;
                    contract.pattern = passthrough.pattern;

                    addEvenOddBotTradeHistory(contract, contract.profit);

                    sendAPIRequest({ "forget": contract.id }); // Unsubscribe

                    // Remove from active contracts
                    if (evenOddBotState.activeContracts[contract.contract_id]) {
                        delete evenOddBotState.activeContracts[contract.contract_id];
                    }

                    // Notification on win
                    if (contract.profit > 0) {
                        showToast(`🎉 E/ODD Bot Win: +$${contract.profit.toFixed(2)} on ${contract.symbol}`, 'success', 10000);
                    }

                    // Update GLOBAL martingale (not symbol-specific)
                    const isWin = contract.profit > 0;
                    updateGlobalMartingale(contract.symbol, isWin, contract.profit);
                    
                    // Update global money management
                    updateMoneyManagement(isWin, contract.profit);
                    
                    evenOddBotState.totalPL = mm.totalProfit;
                    evenOddBotState.winCount = mm.winCount;
                    evenOddBotState.lossCount = mm.lossCount;

                    // Check for target profit or stop loss
                    if (mm.totalProfit >= mm.targetProfit) {
                        addEvenOddBotLog(`🎉 Target profit reached: $${mm.totalProfit.toFixed(2)} / $${mm.targetProfit.toFixed(2)}`, 'win');
                        stopEvenOddBot();
                    } else if (Math.abs(mm.totalProfit) >= mm.stopLoss && mm.totalProfit < 0) {
                        addEvenOddBotLog(`🛑 Stop loss hit: -$${Math.abs(mm.totalProfit).toFixed(2)} / $${mm.stopLoss.toFixed(2)}`, 'error');
                        stopEvenOddBot();
                    }

                    updateEvenOddProfitLossDisplay();
                }
                else if (contract.contract_id === currentContractId) {
                    const status = contract.is_sold ? 'SOLD' : 'EXPIRED';
                    const profit = parseFloat(contract.profit).toFixed(2);
                    const classColor = profit >= 0 ? 'price-up' : 'price-down';

                    tradeMessageContainer.innerHTML = `<span class="${classColor}">💵 ${status}! P/L: ${profit} ${contract.currency}</span>`;
                    sendAPIRequest({ "forget": contract.id });
                    currentContractId = null;
                }
            } else if (contract.contract_id === currentContractId) {
                const pnl = parseFloat(contract.profit).toFixed(2);
                const pnlClass = pnl >= 0 ? 'price-up' : 'price-down';

                // Show real-time technical indicators during trade
                let techIndicatorText = '';
                if (emaValue !== null || smaValue !== null) {
                    techIndicatorText = ` | EMA: ${emaValue ? emaValue.toFixed(2) : 'N/A'} SMA: ${smaValue ? smaValue.toFixed(2) : 'N/A'}`;
                }

                tradeMessageContainer.innerHTML = `
                    Contract Open: Running P/L: <span class="${pnlClass}">${pnl} ${contract.currency}</span>
                    (Entry: ${contract.entry_tick_display_value})${techIndicatorText}
                `;
            }
            break;

        default:
            // console.log("Unhandled message type:", data.msg_type, data);
            break;
    }
}

// ===================================
// INITIALIZATION (Place this at the very end of app.js)
// ===================================

function handleOAuthRedirectAndInit() {
    console.log('🔄 Checking for OAuth redirect...');
    const hash = window.location.hash;

    // 1. Check if we're returning from OAuth callback (Deriv uses token1/acct1 format)
    if (hash && (hash.includes('token1=') || hash.includes('acct1='))) {
        console.log('✅ OAuth callback detected - connection.js will handle it');
        // Don't do anything here - connection.js handleOAuthCallback() will process this
        return;
    }

    // 2. Check for old-style access_token format (fallback)
    if (hash.includes('access_token')) {
        // Token found in URL fragment (after a successful OAuth redirect)
        const params = new URLSearchParams(hash.substring(1));
        const token = params.get('access_token');

        if (token) {
            console.log('✅ OAuth access_token found in URL');
            // Save the token for future sessions
            localStorage.setItem('deriv_token', token);

            // Clean the URL fragment (highly recommended for security)
            window.location.hash = '';

            // Connect and start the authorized session
            connectAndAuthorize(token);
            return;
        }
    }

    // 3. No token in URL, check if one is saved from a previous successful login
    const storedToken = localStorage.getItem('deriv_token');

    if (storedToken) {
        console.log('✅ Using stored token from previous session');
        connectAndAuthorize(storedToken);
    } else {
        // 4. No token found. User needs to login.
        console.log('ℹ️ No token found. User needs to initiate login via OAuth buttons.');
        // Just establish a basic connection for manual API token login
        connectToDeriv();
    }
}

/**
 * Update Ghost AI button states (all three buttons)
 */
function updateGhostAIButtonStates(isRunning) {
    const buttons = [
        document.getElementById('ghost-ai-toggle-button'),
        document.getElementById('ghost-ai-toggle-button-bottom'),
        document.getElementById('ghost-ai-toggle-button-history')
    ];
    
    buttons.forEach(button => {
        if (button) {
            if (isRunning) {
                button.innerHTML = `
                    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect x="6" y="6" width="12" height="12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                    <span>Stop Bot</span>
                `;
                button.classList.remove('btn-start', 'primary-button');
                button.classList.add('btn-stop', 'stop-button');
            } else {
                button.innerHTML = `
                    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <polygon points="5 3 19 12 5 21 5 3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                    <span>Start Bot</span>
                `;
                button.classList.remove('btn-stop', 'stop-button');
                button.classList.add('btn-start', 'primary-button');
            }
        }
    });
}

// Add this line where you set up other event listeners in app.js
document.addEventListener('DOMContentLoaded', () => {
    // Ghost AI toggle buttons (all three)
    const ghostAIButtonIds = ['ghost-ai-toggle-button', 'ghost-ai-toggle-button-bottom', 'ghost-ai-toggle-button-history'];
    
    ghostAIButtonIds.forEach(buttonId => {
        const button = document.getElementById(buttonId);
        if (button) {
            button.addEventListener('click', toggleBot);
        }
    });
});

// Final Step: Call the functions to start the application when the script loads
handleOAuthRedirectAndInit();
setupNavigation();