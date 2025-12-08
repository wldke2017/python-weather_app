// ===================================
// GHOST_E/ODD BOT - PATTERN-BASED EVEN/ODD STRATEGY
// Based on Binary Bot pattern recognition from last 5 digits
// ===================================

// --- GHOST_E/ODD Bot State ---
let evenOddBotState = {
    initialStake: 0.35,
    targetProfit: 1.0,
    stopLoss: 999.0,
    totalProfit: 0.0,
    totalPL: 0.0,
    isTrading: false,
    runId: null,
    winCount: 0,
    lossCount: 0,
    // Track patterns per symbol to avoid duplicate trades on same pattern
    symbolPatterns: {}, // { symbol: { pattern: number, lastTradeTime: timestamp } }
    // Track active contracts with individual martingale states
    activeContracts: {}, // { contractId: { symbol, stake, martingaleStep, recoverySymbol } }
    // Track martingale state per symbol
    symbolMartingale: {} // { symbol: { step: 0, size: 1, accumulatedLoss: 0 } }
};

// Global Money Management System (for overall P/L tracking)
let mm = {
    initStake: 0.35,
    winStake: 0.35,
    totalProfit: 0.0,
    targetProfit: 1.0,
    stopLoss: 999.0,
    martingaleFactor: 2.12,
    martingaleLevel: 7,
    winCount: 0,
    lossCount: 0,
    consecutiveLosses: 0, // Track consecutive losses at initial stake
    isInRecovery: false, // Flag to indicate if we're in recovery mode
    recoveryStartLoss: 0 // Track accumulated loss when recovery starts
};

// Track last digits per symbol for independent pattern analysis (up to 10 digits)
let symbolDigitHistory = {}; // { symbol: { digit1, digit2, ..., digit10 } }

function addEvenOddBotLog(message, type = 'info') {
    const logEntry = document.createElement('div');
    const timestamp = new Date().toLocaleTimeString();
    logEntry.innerHTML = `<span>[${timestamp}]</span> [E/ODD] ${message}`;
    logEntry.className = `log-${type}`;
    const eoddBotLogContainer = document.getElementById('eodd-bot-log-container');
    if (eoddBotLogContainer) {
        eoddBotLogContainer.appendChild(logEntry);
        eoddBotLogContainer.scrollTop = eoddBotLogContainer.scrollHeight;
    }
}

function addEvenOddBotTradeHistory(contract, profit) {
    const eoddBotHistoryTableBody = document.querySelector('#eodd-bot-history-table tbody');
    if (!eoddBotHistoryTableBody) return;

    const row = eoddBotHistoryTableBody.insertRow(0);
    const profitClass = profit >= 0 ? 'price-up' : 'price-down';

    const lastDigit = contract.entry_tick_display_value ? parseInt(contract.entry_tick_display_value.slice(-1)) : '?';
    const prediction = contract.prediction_type || 'EVEN/ODD';

    row.insertCell(0).textContent = new Date().toLocaleTimeString();
    row.insertCell(1).innerHTML = `${contract.symbol} - ${prediction} (Pattern: ${evenOddBotState.pattern})<br><small>Price: ${contract.entry_tick_display_value} (Last digit: ${lastDigit})</small>`;
    row.cells[1].style.fontWeight = 'bold';
    row.insertCell(2).innerHTML = `<span class="${profitClass}">${profit.toFixed(2)}</span>`;
}

function updateEvenOddProfitLossDisplay() {
    const displayElement = document.getElementById('eoddProfitLossDisplay');
    if (!displayElement) return;

    const totalPL = mm.totalProfit;
    const plString = totalPL.toFixed(2);

    displayElement.textContent = `${totalPL >= 0 ? '+' : ''}$${plString}`;

    displayElement.classList.remove('pl-win', 'pl-loss');
    if (totalPL > 0) {
        displayElement.classList.add('pl-win');
    } else if (totalPL < 0) {
        displayElement.classList.add('pl-loss');
    }

    // Update trades count display
    const tradesDisplay = document.getElementById('eoddTradesCountDisplay');
    if (tradesDisplay) {
        const activeCount = Object.keys(evenOddBotState.activeContracts).length;
        const activeText = activeCount > 0 ? ` (${activeCount} active)` : '';
        tradesDisplay.textContent = `${mm.winCount}W/${mm.lossCount}L${activeText}`;
    }
}

/**
 * Calculate pattern for a specific symbol with a specific length
 * @param {string} symbol - The market symbol
 * @param {number} length - Number of digits to use (1-10)
 */
function calculatePatternForSymbol(symbol, length = 5) {
    if (!symbolDigitHistory[symbol]) return 0;
    
    const digits = symbolDigitHistory[symbol];
    let pattern = 0;
    let multiplier = 1;

    // Build pattern from digit1 to digit[length]
    for (let i = 1; i <= length; i++) {
        const digitKey = `digit${i}`;
        if (digits[digitKey] === null || digits[digitKey] === undefined) {
            return 0; // Not enough digits yet
        }
        pattern += isEven(digits[digitKey]) ? (2 * multiplier) : (1 * multiplier);
        multiplier *= 10;
    }

    return pattern;
}

/**
 * Get the length of a pattern (number of digits)
 */
function getPatternLength(pattern) {
    return pattern.toString().length;
}

function isEven(digit) {
    return digit % 2 === 0;
}

/**
 * Get current stake for a symbol considering its martingale state
 */
function getStakeForSymbol(symbol) {
    // Initialize martingale state for symbol if not exists
    if (!evenOddBotState.symbolMartingale[symbol]) {
        evenOddBotState.symbolMartingale[symbol] = {
            step: 0,
            size: 1,
            accumulatedLoss: 0
        };
    }

    const martingale = evenOddBotState.symbolMartingale[symbol];
    const stake = parseFloat((martingale.size * mm.initStake).toFixed(2));
    
    return stake;
}

/**
 * Get current stake (GLOBAL martingale - not symbol-specific)
 */
function getCurrentStake() {
    const stake = parseFloat((mm.martingaleSize * mm.initStake).toFixed(2));
    return stake;
}

function getAvailableMarkets() {
    // Return all available volatility markets like Ghost AI
    return Object.keys(marketTickHistory).filter(symbol =>
        symbol.startsWith('R_') ||
        symbol.startsWith('JD') ||
        marketTickHistory[symbol]
    );
}

// Store active patterns configuration
let activePatterns = {
    22222: { action: 'DIGITODD', active: false },
    11111: { action: 'DIGITEVEN', active: false },
    12121: { action: 'DIGITODD', active: false },
    21212: { action: 'DIGITEVEN', active: false },
    22122: { action: 'DIGITODD', active: false },
    11211: { action: 'DIGITODD', active: false },
    11122: { action: 'DIGITEVEN', active: false },
    22211: { action: 'DIGITODD', active: false }
};

function determineTradeFromPattern(symbol) {
    // Check all active patterns
    for (const [patternKey, patternConfig] of Object.entries(activePatterns)) {
        if (!patternConfig.active) continue;
        
        const patternNum = parseInt(patternKey);
        const patternLength = getPatternLength(patternNum);
        
        // Calculate pattern for this specific length
        const calculatedPattern = calculatePatternForSymbol(symbol, patternLength);
        
        if (calculatedPattern === patternNum) {
            const action = patternConfig.action;
            const patternStr = patternNum.toString();
            return { action: action, reason: `Pattern ${patternStr} → ${action === 'DIGITEVEN' ? 'EVEN' : 'ODD'}`, pattern: patternNum };
        }
    }
    
    return null; // No trade for inactive or unrecognized patterns
}

/**
 * Load active patterns from UI checkboxes and dropdowns
 */
function loadActivePatterns() {
    const checkboxes = document.querySelectorAll('.pattern-checkbox');
    checkboxes.forEach(checkbox => {
        const pattern = parseInt(checkbox.value);
        const isActive = checkbox.checked;
        
        // Get action from the corresponding dropdown
        const dropdown = document.querySelector(`.pattern-action-select[data-pattern="${pattern}"]`);
        const action = dropdown ? dropdown.value : checkbox.getAttribute('data-action');
        
        activePatterns[pattern] = {
            action: action,
            active: isActive
        };
    });
    
    addEvenOddBotLog(`📋 Loaded ${Object.values(activePatterns).filter(p => p.active).length} active patterns`, 'info');
}

/**
 * Add custom pattern
 */
function addCustomPatternToConfig() {
    const patternInput = document.getElementById('customPattern');
    const actionSelect = document.getElementById('customPatternAction');
    
    if (!patternInput || !actionSelect) return;
    
    const patternStr = patternInput.value.trim();
    
    // Validate pattern (1-10 digits)
    if (!/^[12]{1,10}$/.test(patternStr)) {
        showToast('Invalid pattern! Use only 1s and 2s (1-10 digits)', 'error');
        return;
    }
    
    const pattern = parseInt(patternStr);
    const action = actionSelect.value;
    
    // Add to active patterns
    activePatterns[pattern] = {
        action: action,
        active: true
    };
    
    // Add checkbox to UI
    const container = document.querySelector('.pattern-checkboxes');
    if (container) {
        const label = document.createElement('label');
        label.style.display = 'block';
        label.style.margin = '5px 0';
        label.style.color = 'var(--accent-color)';
        label.innerHTML = `
            <input type="checkbox" class="pattern-checkbox" value="${pattern}" data-action="${action}" checked> 
            ${patternStr} → ${action === 'DIGITEVEN' ? 'EVEN' : 'ODD'} (Custom)
        `;
        container.appendChild(label);
    }
    
    showToast(`Custom pattern ${patternStr} → ${action === 'DIGITEVEN' ? 'EVEN' : 'ODD'} added!`, 'success');
    patternInput.value = '';
}

function initializeMoneyManagement() {
    // Read values from UI inputs
    const initialStakeInput = document.getElementById('eoddInitialStake');
    const targetProfitInput = document.getElementById('eoddTargetProfit');
    const stopLossInput = document.getElementById('eoddStopLoss');
    const martingaleFactorInput = document.getElementById('eoddMartingaleFactor');
    const martingaleLevelInput = document.getElementById('eoddMartingaleLevel');
    
    mm.initStake = initialStakeInput ? parseFloat(initialStakeInput.value) : 0.35;
    mm.winStake = mm.initStake;
    mm.totalProfit = 0.0;
    mm.targetProfit = targetProfitInput ? parseFloat(targetProfitInput.value) : 1.0;
    mm.stopLoss = stopLossInput ? parseFloat(stopLossInput.value) : 999.0;
    mm.martingaleFactor = martingaleFactorInput ? parseFloat(martingaleFactorInput.value) : 2.12;
    mm.martingaleLevel = martingaleLevelInput ? parseInt(martingaleLevelInput.value) : 7;
    mm.winCount = 0;
    mm.lossCount = 0;
    mm.lossLevel = 0;
    mm.martingaleSize = 1;
    mm.tradeAgain = false;
    mm.consecutiveLosses = 0;
    mm.isInRecovery = false;
    mm.recoveryStartLoss = 0;
    
    // Log the configuration being used
    addEvenOddBotLog(`⚙️ Configuration loaded: Stake=$${mm.initStake.toFixed(2)}, Target=$${mm.targetProfit.toFixed(2)}, StopLoss=$${mm.stopLoss.toFixed(2)}, Martingale=${mm.martingaleFactor}x (Max Level: ${mm.martingaleLevel})`, 'info');
}

function updateSymbolMartingale(symbol, isWin, profit) {
    // Initialize if not exists
    if (!evenOddBotState.symbolMartingale[symbol]) {
        evenOddBotState.symbolMartingale[symbol] = {
            step: 0,
            size: 1,
            accumulatedLoss: 0
        };
    }

    const martingale = evenOddBotState.symbolMartingale[symbol];

    if (isWin) {
        // Reset martingale for this symbol on win
        martingale.step = 0;
        martingale.size = 1;
        martingale.accumulatedLoss = 0;
        
        addEvenOddBotLog(`✅ ${symbol} WIN! Profit: +$${profit.toFixed(2)} | Martingale reset`, 'win');
    } else {
        // Apply martingale for this symbol on loss
        martingale.step++;
        martingale.accumulatedLoss += Math.abs(profit);
        
        if (mm.martingaleLevel === 0 || martingale.step <= mm.martingaleLevel) {
            martingale.size *= mm.martingaleFactor;
            martingale.size = parseFloat(martingale.size.toFixed(4));
            
            const nextStake = parseFloat((martingale.size * mm.initStake).toFixed(2));
            addEvenOddBotLog(`❌ ${symbol} LOSS! Loss: -$${Math.abs(profit).toFixed(2)} | Step ${martingale.step}/${mm.martingaleLevel} | Next: $${nextStake.toFixed(2)}`, 'loss');
        } else {
            // Max martingale reached for this symbol
            addEvenOddBotLog(`🛑 ${symbol} Max martingale (${mm.martingaleLevel}) reached. Resetting...`, 'info');
            martingale.step = 0;
            martingale.size = 1;
            martingale.accumulatedLoss = 0;
        }
    }
}

/**
 * Update GLOBAL martingale (can recover on ANY volatility market)
 * Modified to only trigger recovery after 2 consecutive losses
 */
function updateGlobalMartingale(symbol, isWin, profit) {
    if (isWin) {
        if (mm.isInRecovery) {
            // Win during recovery mode - check if we recovered the losses
            const totalRecovered = mm.recoveryStartLoss + mm.totalProfit;
            if (totalRecovered >= 0) {
                addEvenOddBotLog(`✅ ${symbol} WIN! Profit: +$${profit.toFixed(2)} | 🎉 RECOVERY COMPLETE! Total recovered: $${totalRecovered.toFixed(2)}`, 'win');
                // Reset everything
                mm.martingaleSize = 1;
                mm.lossLevel = 0;
                mm.consecutiveLosses = 0;
                mm.isInRecovery = false;
                mm.recoveryStartLoss = 0;
            } else {
                addEvenOddBotLog(`✅ ${symbol} WIN! Profit: +$${profit.toFixed(2)} | 🔄 Recovery in progress... Still need: $${Math.abs(totalRecovered).toFixed(2)}`, 'win');
                // Continue recovery with same stake
            }
        } else {
            // Win at initial stake - reset consecutive losses
            mm.consecutiveLosses = 0;
            mm.martingaleSize = 1;
            mm.lossLevel = 0;
            addEvenOddBotLog(`✅ ${symbol} WIN! Profit: +$${profit.toFixed(2)} | Consecutive losses reset`, 'win');
        }
    } else {
        // Loss occurred
        if (!mm.isInRecovery) {
            // Not in recovery mode yet - count consecutive losses
            mm.consecutiveLosses++;
            addEvenOddBotLog(`❌ ${symbol} LOSS! Loss: -$${Math.abs(profit).toFixed(2)} | Consecutive losses: ${mm.consecutiveLosses}`, 'loss');
            
            if (mm.consecutiveLosses >= 1) {
                // Trigger recovery mode after 1 loss
                mm.isInRecovery = true;
                mm.recoveryStartLoss = mm.totalProfit; // Remember total P/L when recovery starts
                mm.lossLevel = 0;
                mm.martingaleSize = mm.martingaleFactor; // Start with first martingale step
                
                const nextStake = parseFloat((mm.martingaleSize * mm.initStake).toFixed(2));
                addEvenOddBotLog(`🔥 RECOVERY MODE ACTIVATED! Loss detected. Starting martingale recovery...`, 'warning');
                addEvenOddBotLog(`💪 Recovery target: $${Math.abs(mm.recoveryStartLoss).toFixed(2)} | Next stake: $${nextStake.toFixed(2)}`, 'info');
            }
        } else {
            // Already in recovery mode - continue martingale
            mm.lossLevel++;
            
            if (mm.martingaleLevel === 0 || mm.lossLevel < mm.martingaleLevel) {
                mm.martingaleSize *= mm.martingaleFactor;
                mm.martingaleSize = parseFloat(mm.martingaleSize.toFixed(4));
                
                const nextStake = parseFloat((mm.martingaleSize * mm.initStake).toFixed(2));
                addEvenOddBotLog(`❌ ${symbol} LOSS! Loss: -$${Math.abs(profit).toFixed(2)} | Recovery Step ${mm.lossLevel + 1}/${mm.martingaleLevel} | Next: $${nextStake.toFixed(2)}`, 'loss');
            } else {
                // Max martingale reached - reset and start over
                addEvenOddBotLog(`🛑 Max martingale (${mm.martingaleLevel}) reached during recovery. Resetting to initial stake...`, 'warning');
                mm.martingaleSize = 1;
                mm.lossLevel = 0;
                mm.consecutiveLosses = 0;
                mm.isInRecovery = false;
                mm.recoveryStartLoss = 0;
            }
        }
    }
}

function updateMoneyManagement(isWin, profit) {
    // Update global profit tracking
    mm.totalProfit = parseFloat((mm.totalProfit + profit).toFixed(2));

    if (isWin) {
        mm.winCount++;
    } else {
        mm.lossCount++;
    }

    // Check stop conditions immediately
    if (mm.totalProfit >= mm.targetProfit) {
        addEvenOddBotLog(`🎉 Target profit reached: $${mm.totalProfit.toFixed(2)} / $${mm.targetProfit.toFixed(2)}`, 'win');
        addEvenOddBotLog(`🛑 Bot stopping automatically...`, 'info');
        evenOddBotState.isTrading = false;
        
        // Stop immediately
        setTimeout(() => {
            stopEvenOddBot();
        }, 100);
        
        return; // Exit immediately
    } else if (Math.abs(mm.totalProfit) >= mm.stopLoss && mm.totalProfit < 0) {
        addEvenOddBotLog(`🛑 Stop loss hit: -$${Math.abs(mm.totalProfit).toFixed(2)} / $${mm.stopLoss.toFixed(2)}`, 'error');
        addEvenOddBotLog(`🛑 Bot stopping automatically...`, 'info');
        evenOddBotState.isTrading = false;
        
        // Stop immediately
        setTimeout(() => {
            stopEvenOddBot();
        }, 100);
        
        return; // Exit immediately
    }
}

async function startEvenOddBot() {
    if (evenOddBotState.isTrading) return;

    evenOddBotState.isTrading = true;
    evenOddBotState.runId = `even-odd-${Date.now()}`;
    
    // Update all button states
    updateEvenOddButtonStates(true);

    // Load active patterns from UI
    loadActivePatterns();

    // Initialize money management
    initializeMoneyManagement();

    // Reset UI and state - Clear trade history table
    const eoddBotHistoryTableBody = document.querySelector('#eodd-bot-history-table tbody');
    if (eoddBotHistoryTableBody) {
        eoddBotHistoryTableBody.innerHTML = '';
    }
    
    // Clear log container
    const eoddBotLogContainer = document.getElementById('eodd-bot-log-container');
    if (eoddBotLogContainer) {
        eoddBotLogContainer.innerHTML = '';
    }

    const activeCount = Object.values(activePatterns).filter(p => p.active).length;
    addEvenOddBotLog(`🤖 GHOST_E/ODD Pattern Bot Started`);
    addEvenOddBotLog(`📊 Pattern-based EVEN/ODD analysis using last 5 digits`);
    addEvenOddBotLog(`🎯 Active Patterns: ${activeCount} patterns enabled`);
    addEvenOddBotLog(`💰 Initial Stake: $${mm.initStake.toFixed(2)} | Target: $${mm.targetProfit.toFixed(2)}`);
    addEvenOddBotLog(`🛡️ Recovery Strategy: Martingale activates after 1 loss`, 'info');

    // Check if we have subscribed markets (like Ghost AI)
    const availableMarkets = getAvailableMarkets();
    if (availableMarkets.length === 0) {
        addEvenOddBotLog(`⚠️ No volatility markets subscribed! Please visit the Speedbot section first to subscribe to markets.`, 'warning');
        showToast('No markets subscribed! Visit Speedbot section first.', 'warning');
        return;
    }

    addEvenOddBotLog(`📊 Monitoring ${availableMarkets.length} volatility markets: ${availableMarkets.join(', ')}`);
    addEvenOddBotLog(`⏳ Analyzing patterns independently for each market...`);
    addEvenOddBotLog(`🔄 Multi-contract mode: Can open multiple trades simultaneously`);
    addEvenOddBotLog(`🎯 Global martingale: Recovery can happen on ANY volatility`);

    // Reset tracking objects
    evenOddBotState.symbolPatterns = {};
    evenOddBotState.activeContracts = {};
    evenOddBotState.martingaleStep = 0;
    evenOddBotState.martingaleSize = 1;
    evenOddBotState.accumulatedLoss = 0;
    symbolDigitHistory = {};
}

async function stopEvenOddBot() {
    if (!evenOddBotState.isTrading) return;

    evenOddBotState.isTrading = false;
    
    // Update all button states
    updateEvenOddButtonStates(false);
    
    const activeCount = Object.keys(evenOddBotState.activeContracts).length;
    addEvenOddBotLog("🛑 GHOST_E/ODD Bot stopped by user.", 'warning');
    
    if (activeCount > 0) {
        addEvenOddBotLog(`⏳ Waiting for ${activeCount} active contract(s) to complete...`, 'info');
    }
    
    addEvenOddBotLog(`📊 Final Stats: ${mm.winCount}W/${mm.lossCount}L | Total P/L: $${mm.totalProfit.toFixed(2)}`, 'info');
    evenOddBotState.runId = null;
    updateEvenOddProfitLossDisplay();
}

// Performance optimization: Track last pattern check time per symbol
let lastPatternCheckTime = {};
const PATTERN_CHECK_COOLDOWN = 100; // Reduced from 1000ms to 100ms for faster response

/**
 * Handle incoming tick data for Even/Odd bot
 * This function is called from app.js when a tick is received
 */
function handleEvenOddTick(tick) {
    // Double check if bot is still trading (in case stop was triggered)
    if (!evenOddBotState.isTrading) {
        return;
    }

    const symbol = tick.symbol;
    const price = tick.quote.toString();
    const lastDigit = parseInt(price.slice(-1));

    // Initialize symbol history if not exists (up to 10 digits)
    if (!symbolDigitHistory[symbol]) {
        symbolDigitHistory[symbol] = {
            digit1: null,
            digit2: null,
            digit3: null,
            digit4: null,
            digit5: null,
            digit6: null,
            digit7: null,
            digit8: null,
            digit9: null,
            digit10: null
        };
    }

    // Update the last digits for this specific symbol (shift all digits)
    const digits = symbolDigitHistory[symbol];
    digits.digit10 = digits.digit9;
    digits.digit9 = digits.digit8;
    digits.digit8 = digits.digit7;
    digits.digit7 = digits.digit6;
    digits.digit6 = digits.digit5;
    digits.digit5 = digits.digit4;
    digits.digit4 = digits.digit3;
    digits.digit3 = digits.digit2;
    digits.digit2 = digits.digit1;
    digits.digit1 = lastDigit;

    // Check if we already traded this pattern recently
    if (!evenOddBotState.symbolPatterns[symbol]) {
        evenOddBotState.symbolPatterns[symbol] = { pattern: 0, lastTradeTime: 0 };
    }

    const lastPattern = evenOddBotState.symbolPatterns[symbol];
    const now = Date.now();
    const timeSinceLastTrade = now - lastPattern.lastTradeTime;

    // Check if we should trade based on pattern (pass symbol to check all pattern lengths)
    const tradeDecision = determineTradeFromPattern(symbol);

    if (tradeDecision) {
        // Check if this is a new pattern or enough time has passed since last trade
        const isNewPattern = tradeDecision.pattern !== lastPattern.pattern;
        const enoughTimePassed = timeSinceLastTrade > 1000; // Reduced from 3000ms to 1000ms

        if (isNewPattern || enoughTimePassed) {
            // Get current GLOBAL stake (can recover on ANY volatility)
            const stake = getCurrentStake();
            
            addEvenOddBotLog(`🎯 ${symbol}: ${tradeDecision.reason} | Stake: $${stake.toFixed(2)}`, 'trade');
            
            // Update pattern tracking
            evenOddBotState.symbolPatterns[symbol] = {
                pattern: tradeDecision.pattern,
                lastTradeTime: now
            };
            
            // Execute trade for this symbol
            executePatternTrade(tradeDecision.action, symbol, tradeDecision.pattern, stake);
        }
    }
}

function monitorTicks() {
    // This function is now deprecated - tick handling is done via handleEvenOddTick
    // Keeping it for backward compatibility but it's not actively used
    if (!evenOddBotState.isTrading) return;

    addEvenOddBotLog(`⏳ Monitoring ticks via WebSocket...`, 'info');
}

function executePatternTrade(action, symbol, pattern, stake) {
    // Validate bot is still trading (check again in case of race condition)
    if (!evenOddBotState.isTrading) {
        addEvenOddBotLog(`⚠️ Bot stopped, skipping trade execution`, 'warning');
        return;
    }
    
    // Double check target/stop loss hasn't been hit
    if (mm.totalProfit >= mm.targetProfit) {
        addEvenOddBotLog(`⚠️ Target profit already reached, skipping trade`, 'warning');
        return;
    }
    
    if (Math.abs(mm.totalProfit) >= mm.stopLoss && mm.totalProfit < 0) {
        addEvenOddBotLog(`⚠️ Stop loss already hit, skipping trade`, 'warning');
        return;
    }
    
    // Validate stake amount
    if (stake < 0.35) {
        addEvenOddBotLog(`❌ ${symbol} Stake too low: $${stake.toFixed(2)} (minimum: $0.35)`, 'error');
        return;
    }
    
    if (stake > 2000) {
        addEvenOddBotLog(`❌ ${symbol} Stake too high: $${stake.toFixed(2)} (maximum: $2000)`, 'error');
        return;
    }

    const contractType = action === 'DIGITEVEN' ? 'DIGITEVEN' : 'DIGITODD';
    const predictionType = action === 'DIGITEVEN' ? 'EVEN' : 'ODD';
    
    // Generate unique request ID for tracking
    const requestId = `${symbol}_${Date.now()}`;

    const purchaseRequest = {
        "buy": 1,
        "price": stake,
        "passthrough": {
            "purpose": "ghost_even_odd_trade",
            "run_id": evenOddBotState.runId,
            "symbol": symbol,
            "prediction_type": predictionType,
            "pattern": pattern,
            "request_id": requestId,
            "stake": stake
        },
        "parameters": {
            "amount": stake,
            "basis": "stake",
            "contract_type": contractType,
            "currency": "USD",
            "duration": 1,
            "duration_unit": "t",
            "symbol": symbol
        }
    };

    addEvenOddBotLog(`💰 ${symbol}: ${action} | Stake: $${stake.toFixed(2)} | Pattern: ${pattern}`, 'trade');

    sendAPIRequest(purchaseRequest).then(() => {
        console.log(`executePatternTrade: ${symbol} request sent successfully`);
    }).catch(error => {
        console.error(`executePatternTrade: ${symbol} request failed:`, error);
        addEvenOddBotLog(`❌ ${symbol} Trade request failed: ${error.message}`, 'error');
    });
}

/**
 * Toggle function for Ghost E/ODD bot (works for all three buttons)
 */
function toggleEvenOddBot() {
    if (evenOddBotState.isTrading) {
        stopEvenOddBot();
    } else {
        startEvenOddBot();
    }
}

/**
 * Update all Ghost E/ODD button states
 */
function updateEvenOddButtonStates(isRunning) {
    const buttons = [
        document.getElementById('even-odd-toggle-button-top'),
        document.getElementById('even-odd-toggle-button-bottom'),
        document.getElementById('even-odd-toggle-button-history')
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

// Initialize even/odd bot controls
document.addEventListener('DOMContentLoaded', () => {
    // Add event listeners for all three even/odd bot buttons
    const buttonIds = ['even-odd-toggle-button-top', 'even-odd-toggle-button-bottom', 'even-odd-toggle-button-history'];
    
    buttonIds.forEach(buttonId => {
        const button = document.getElementById(buttonId);
        if (button) {
            button.addEventListener('click', toggleEvenOddBot);
        }
    });
    
    // Add event listener for custom pattern button
    const addCustomPatternBtn = document.getElementById('addCustomPattern');
    if (addCustomPatternBtn) {
        addCustomPatternBtn.addEventListener('click', addCustomPatternToConfig);
    }
    
    // Add event listeners for pattern action dropdowns
    const patternDropdowns = document.querySelectorAll('.pattern-action-select');
    patternDropdowns.forEach(dropdown => {
        dropdown.addEventListener('change', function() {
            const pattern = this.getAttribute('data-pattern');
            const newAction = this.value;
            const checkbox = document.querySelector(`.pattern-checkbox[value="${pattern}"]`);
            
            if (checkbox) {
                // Update the checkbox data-action attribute
                checkbox.setAttribute('data-action', newAction);
                
                // Update activePatterns if bot is running
                if (activePatterns[pattern]) {
                    activePatterns[pattern].action = newAction;
                    addEvenOddBotLog(`🔄 Pattern ${pattern} action changed to ${newAction === 'DIGITEVEN' ? 'EVEN' : 'ODD'}`, 'info');
                }
            }
        });
    });
});