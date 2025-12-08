// ===================================
// GHOST AI BOT FUNCTIONS
// ===================================

function addBotLog(message, type = 'info') {
    const logEntry = document.createElement('div');
    const timestamp = new Date().toLocaleTimeString();
    logEntry.innerHTML = `<span>[${timestamp}]</span> ${message}`;
    logEntry.className = `log-${type}`;
    botLogContainer.appendChild(logEntry);
    botLogContainer.scrollTop = botLogContainer.scrollHeight;
}

function addBotTradeHistory(contract, profit) {
    const row = botHistoryTableBody.insertRow(0);
    const profitClass = profit >= 0 ? 'price-up' : 'price-down';

    // Get the last digit from the contract price
    const lastDigit = contract.entry_tick_display_value ? parseInt(contract.entry_tick_display_value.slice(-1)) : '?';

    row.insertCell(0).textContent = new Date().toLocaleTimeString();
    row.insertCell(1).innerHTML = `${contract.symbol} - ${contract.barrier <= 4 ? 'Over' : 'Under'} ${contract.barrier}<br><small>Price: ${contract.entry_tick_display_value} (Last digit: ${lastDigit})</small>`;
    row.cells[1].style.fontWeight = 'bold';
    row.insertCell(2).innerHTML = `<span class="${profitClass}">${profit.toFixed(2)}</span>`;
}

function updateProfitLossDisplay() {
    const displayElement = document.getElementById('botProfitLossDisplay');
    if (!displayElement) return;

    const totalPL = botState.totalPL;
    const plString = totalPL.toFixed(2);

    displayElement.textContent = `${totalPL >= 0 ? '+' : ''}$${plString}`;

    displayElement.classList.remove('pl-win', 'pl-loss');
    if (totalPL > 0) {
        displayElement.classList.add('pl-win');
    } else if (totalPL < 0) {
        displayElement.classList.add('pl-loss');
    }
}

async function startGhostAiBot() {
    if (isBotRunning) return;
    isBotRunning = true;
    botState.runId = `bot-${Date.now()}`;

    // Reset UI and state
    botHistoryTableBody.innerHTML = '';
    botLogContainer.innerHTML = '';
    
    // Update button states (if updateGhostAIButtonStates function exists)
    if (typeof updateGhostAIButtonStates === 'function') {
        updateGhostAIButtonStates(true);
    }

    // Load parameters from UI (following XML "Starts" procedure structure)
    const initialStake = parseFloat(botInitialStake.value);
    const targetProfit = parseFloat(botTargetProfit.value);
    const payoutPercentage = parseFloat(botPayoutPercentage.value);
    const stopLoss = parseFloat(botStopLoss.value);
    const maxMartingaleSteps = parseInt(botMaxMartingale.value);
    
    // Load new configuration parameters
    const analysisDigits = parseInt(document.getElementById('botAnalysisDigits')?.value || 20);
    const s1UseDigitCheck = document.getElementById('botS1UseDigitCheck')?.checked ?? true;
    const s1CheckDigits = parseInt(document.getElementById('botS1CheckDigits')?.value || 2);
    const s1MaxDigit = parseInt(document.getElementById('botS1MaxDigit')?.value || 2);
    const s1UsePercentage = document.getElementById('botS1UsePercentage')?.checked ?? true;
    const s1Prediction = parseInt(document.getElementById('botS1Prediction')?.value || 2);
    const s1Percentage = parseFloat(document.getElementById('botS1Percentage')?.value || 65);
    const s1MaxLosses = parseInt(document.getElementById('botS1MaxLosses')?.value || 2);
    const s2UseDigitCheck = document.getElementById('botS2UseDigitCheck')?.checked ?? true;
    const s2CheckDigits = parseInt(document.getElementById('botS2CheckDigits')?.value || 5);
    const s2MaxDigit = parseInt(document.getElementById('botS2MaxDigit')?.value || 4);
    const s2UsePercentage = document.getElementById('botS2UsePercentage')?.checked ?? true;
    const s2Prediction = parseInt(document.getElementById('botS2Prediction')?.value || 5);
    const s2ContractType = document.getElementById('botS2ContractType')?.value || 'UNDER';
    const s2Percentage = parseFloat(document.getElementById('botS2Percentage')?.value || 45);

    // Initialize bot state following XML structure
    botState.initialStake = initialStake;
    botState.targetProfit = targetProfit;
    botState.payoutPercentage = payoutPercentage;
    botState.stopLoss = stopLoss;
    botState.maxMartingaleSteps = maxMartingaleSteps;
    botState.analysisDigits = analysisDigits;
    botState.s1UseDigitCheck = s1UseDigitCheck;
    botState.s1CheckDigits = s1CheckDigits;
    botState.s1MaxDigit = s1MaxDigit;
    botState.s1UsePercentage = s1UsePercentage;
    botState.s1Prediction = s1Prediction;
    botState.s1Percentage = s1Percentage;
    botState.s1MaxLosses = s1MaxLosses;
    botState.s1ConsecutiveLosses = 0; // Track consecutive S1 losses
    botState.s1Blocked = false; // Flag to block S1 after max losses
    botState.s2UseDigitCheck = s2UseDigitCheck;
    botState.s2CheckDigits = s2CheckDigits;
    botState.s2MaxDigit = s2MaxDigit;
    botState.s2UsePercentage = s2UsePercentage;
    botState.s2Prediction = s2Prediction;
    botState.s2ContractType = s2ContractType;
    botState.s2Percentage = s2Percentage;
    botState.currentStake = botState.initialStake;
    botState.totalProfit = 0.0;
    botState.totalLoss = 0.0;
    botState.totalPL = 0.0; // Cumulative P/L
    botState.accumulatedStakesLost = 0.0; // Reset accumulated stake losses
    botState.activeStrategy = 'S1';
    botState.isTrading = false;
    botState.martingaleStepCount = 0;
    botState.activeSymbol = null;
    botState.recoverySymbol = null;
    botState.winCount = 0;
    botState.lossCount = 0;
    botState.winPercentage = 0;
    botState.s1LossSymbol = null;

    updateProfitLossDisplay();

    addBotLog(`🤖 Rammy Auto Strategy Started`);
    addBotLog(`📊 Analyzing last ${analysisDigits} digits + percentages + full distribution across ${Object.keys(marketTickHistory).length} markets`);

    // CRITICAL: Check if we have subscribed markets
    if (Object.keys(marketTickHistory).length === 0) {
        addBotLog(`⚠️ WARNING: No markets subscribed! Please visit the Speedbot section first to subscribe to markets.`, 'warning');
        showToast('No markets subscribed! Visit Speedbot section first.', 'warning');
        return; // Don't proceed without markets
    }

    addBotLog(`💰 Initial Stake: $${botState.initialStake.toFixed(2)} | Target: $${botState.targetProfit.toFixed(2)} | Stop Loss: $${botState.stopLoss.toFixed(2)}`);
    
    // Build S1 condition string
    let s1Conditions = [];
    if (s1UseDigitCheck) s1Conditions.push(`Last ${s1CheckDigits} ≤ ${s1MaxDigit}`);
    if (s1UsePercentage) s1Conditions.push(`Over ${s1Prediction}% ≥ ${s1Percentage}%`);
    s1Conditions.push(`Most digit >4 & Least digit <4`);
    addBotLog(`📈 S1: ${s1Conditions.join(' & ')} → OVER ${s1Prediction} | Max Losses: ${s1MaxLosses}`);
    
    // Build S2 condition string
    let s2Conditions = [];
    if (s2UseDigitCheck) s2Conditions.push(`Last ${s2CheckDigits} ≤ ${s2MaxDigit}`);
    if (s2UsePercentage) s2Conditions.push(`Over ${s2Prediction}% ≥ ${s2Percentage}%`);
    s2Conditions.push(`Most digit >4 & Least digit <4`);
    addBotLog(`📉 S2: ${s2Conditions.join(' & ')} → ${s2ContractType} ${s2Prediction}`);
    
    addBotLog(`⏳ Waiting for valid entry conditions...`);

    // Initialize technical indicators
    updateTechnicalIndicators();

    // Debug: Log current market data
    console.log('Bot started - Current market data:', marketTickHistory);
    console.log('Bot state:', botState);
}

async function stopGhostAiBot() {
    if (!isBotRunning) return;
    isBotRunning = false;

    // Also clear the toggle interval if running
    if (botLoopInterval) {
        clearInterval(botLoopInterval);
        botLoopInterval = null;
    }

    // Update button states (if updateGhostAIButtonStates function exists)
    if (typeof updateGhostAIButtonStates === 'function') {
        updateGhostAIButtonStates(false);
    }

    addBotLog("🛑 Bot stopped by user.", 'warning');
    botState.runId = null;
    updateProfitLossDisplay();
}

/**
 * Calculate percentage of each digit (0-9) in the last N ticks
 */
function calculateDigitPercentages(symbol) {
    const allDigits = marketTickHistory[symbol] || [];
    if (allDigits.length === 0) return null;

    // Use configured analysis digits count
    const analysisCount = botState.analysisDigits || 20;
    const digits = allDigits.slice(-analysisCount);
    const percentages = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0 };
    const total = digits.length;

    // Count occurrences of each digit
    digits.forEach(digit => {
        percentages[digit]++;
    });

    // Convert to percentages
    for (let i = 0; i <= 9; i++) {
        percentages[i] = (percentages[i] / total) * 100;
    }

    // Calculate dynamic percentages based on prediction barriers
    for (let barrier = 0; barrier <= 9; barrier++) {
        let overSum = 0;
        for (let d = barrier + 1; d <= 9; d++) {
            overSum += percentages[d];
        }
        percentages[`over${barrier}`] = overSum;
    }

    return percentages;
}

/**
 * Calculate digit distribution from full tick history (last 1000 digits)
 * @param {string} symbol - The symbol to calculate distribution for
 * @returns {object} Distribution analysis with most and least appearing digits
 */
function calculateFullDigitDistribution(symbol) {
    const digits = marketFullTickDigits[symbol] || [];
    if (digits.length === 0) return null;

    const counts = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0 };

    // Count occurrences
    digits.forEach(digit => {
        counts[digit]++;
    });

    // Find most and least appearing digits
    let mostAppearingDigit = 0;
    let leastAppearingDigit = 0;
    let maxCount = counts[0];
    let minCount = counts[0];

    for (let i = 1; i <= 9; i++) {
        if (counts[i] > maxCount) {
            maxCount = counts[i];
            mostAppearingDigit = i;
        }
        if (counts[i] < minCount) {
            minCount = counts[i];
            leastAppearingDigit = i;
        }
    }

    return {
        counts,
        mostAppearingDigit,
        leastAppearingDigit,
        totalTicks: digits.length
    };
}

/**
 * Update and display win percentage
 */
function updateWinPercentage() {
    const totalTrades = botState.winCount + botState.lossCount;
    if (totalTrades > 0) {
        botState.winPercentage = (botState.winCount / totalTrades) * 100;

        // Update the UI displays
        const winRateDisplay = document.getElementById('botWinRateDisplay');
        const tradesCountDisplay = document.getElementById('botTradesCountDisplay');

        if (winRateDisplay) {
            winRateDisplay.textContent = `${botState.winPercentage.toFixed(1)}%`;
        }

        if (tradesCountDisplay) {
            tradesCountDisplay.textContent = `${botState.winCount}W/${botState.lossCount}L`;
        }

        addBotLog(`📊 Win/Loss: ${botState.winCount}W/${botState.lossCount}L | Win Rate: ${botState.winPercentage.toFixed(1)}%`, 'info');
    }
}

// Performance optimization: Track last scan time to avoid excessive scanning
let lastScanTime = 0;
const SCAN_COOLDOWN = 500; // Only scan every 500ms max

// Track active contracts per symbol to support multiple concurrent trades
let activeContracts = {}; // { contractId: { symbol, strategy: 'S1' or 'S2', stake, startTime } }

// Track which symbols have active S1 trades to avoid duplicates
let activeS1Symbols = new Set();

function handleBotTick(tick) {
    if (!isBotRunning) {
        return;
    }

    const symbol = tick.symbol;
    const price = tick.quote.toString();
    const lastDigit = parseInt(price.slice(-1));

    // Reduce logging frequency (only 5% of ticks)
    if (Math.random() < 0.05) {
        console.log(`Bot tick received: ${symbol} = ${price} (digit: ${lastDigit})`);
    }

    // 1. Update Global Tick History for this symbol
    if (marketTickHistory[symbol]) {
        marketTickHistory[symbol].push(lastDigit);
        if (marketTickHistory[symbol].length > 20) {
            marketTickHistory[symbol].shift();
        }

        // 2. Calculate and store digit percentages (only if we have enough data)
        if (marketTickHistory[symbol].length >= 20) {
            marketDigitPercentages[symbol] = calculateDigitPercentages(symbol);
            
            // Reduce logging frequency
            if (Math.random() < 0.02) {
                const last7Digits = marketTickHistory[symbol].slice(-7).join(', ');
                console.log(`📊 ${symbol} Last 7: [${last7Digits}] | OVER 2%: ${marketDigitPercentages[symbol].over2?.toFixed(1)}%, OVER 4%: ${marketDigitPercentages[symbol].over4?.toFixed(1)}%`);
            }
        }
    }

    // 3. Update technical indicators (throttled - only once per second)
    const now = Date.now();
    if (now - lastScanTime > 1000) {
        updateTechnicalIndicators();
    }

    // 4. Scan and place trades with cooldown to prevent excessive scanning
    // NOTE: We can now have multiple active trades simultaneously
    if (now - lastScanTime > SCAN_COOLDOWN) {
        lastScanTime = now;
        scanAndPlaceMultipleTrades();
    }
}

/**
 * CORE LOGIC: Scans all markets (or the recovery market) and places a trade.
 * Implements Rammy Auto Strategy with percentage analysis and third condition.
 */
function scanAndPlaceMultipleTrades() {
    const symbolsToScan = Object.keys(marketTickHistory);
    let validS1Markets = [];
    let validS2Markets = [];

    // ALWAYS scan for both S1 and S2 conditions simultaneously
    for (const symbol of symbolsToScan) {
        const lastDigits = marketTickHistory[symbol] || [];
        const percentages = marketDigitPercentages[symbol];
        
        // Skip if not enough data
        if (lastDigits.length < 20 || !percentages) continue;

        // Check S1 conditions (only if not blocked)
        // Skip if this symbol already has an active S1 trade or if S1 is blocked
        if (!activeS1Symbols.has(symbol) && !botState.s1Blocked) {
            const checkCount = botState.s1CheckDigits || 2;
            const maxDigit = botState.s1MaxDigit || 2;
            const prediction = botState.s1Prediction || 2;
            const minPercentage = botState.s1Percentage || 65;
            const useDigitCheck = botState.s1UseDigitCheck ?? true;
            const usePercentage = botState.s1UsePercentage ?? true;
            
            // Check conditions based on toggles
            let digitCheckPassed = true;
            let percentageCheckPassed = true;
            
            const lastN = lastDigits.slice(-checkCount);
            
            // Only check digit condition if enabled
            if (useDigitCheck) {
                digitCheckPassed = lastN.every(d => d <= maxDigit);
            }
            
            // Only check percentage condition if enabled
            if (usePercentage) {
                const overPercentage = percentages[`over${prediction}`] || 0;
                percentageCheckPassed = overPercentage >= minPercentage;
            }

            // Both conditions must pass (or be disabled)
            if (digitCheckPassed && percentageCheckPassed) {
                const fullDistribution = calculateFullDigitDistribution(symbol);
                if (fullDistribution) {
                    const thirdCondition = fullDistribution.mostAppearingDigit > 4 && fullDistribution.leastAppearingDigit < 4;

                    if (thirdCondition) {
                        const overPercentage = percentages[`over${prediction}`] || 0;
                        validS1Markets.push({
                            symbol,
                            mode: 'S1',
                            lastN,
                            overPercentage,
                            mostDigit: fullDistribution.mostAppearingDigit,
                            leastDigit: fullDistribution.leastAppearingDigit,
                            prediction: prediction,
                            stake: botState.initialStake
                        });
                    }
                }
            }
        }

        // Check S2 conditions (only if in recovery mode)
        if (botState.martingaleStepCount > 0) {
            const checkCount = botState.s2CheckDigits || 5;
            const maxDigit = botState.s2MaxDigit || 4;
            const prediction = botState.s2Prediction || 5;
            const minPercentage = botState.s2Percentage || 45;
            const contractType = botState.s2ContractType || 'UNDER';
            const useDigitCheck = botState.s2UseDigitCheck ?? true;
            const usePercentage = botState.s2UsePercentage ?? true;
            
            // Check conditions based on toggles
            let digitCheckPassed = true;
            let percentageCheckPassed = true;
            
            const lastN = lastDigits.slice(-checkCount);
            
            // Only check digit condition if enabled
            if (useDigitCheck) {
                digitCheckPassed = lastN.every(d => d <= maxDigit);
            }
            
            // Only check percentage condition if enabled
            if (usePercentage) {
                const overPercentage = percentages[`over${prediction}`] || 0;
                percentageCheckPassed = overPercentage >= minPercentage;
            }

            // Both conditions must pass (or be disabled)
            if (digitCheckPassed && percentageCheckPassed) {
                const fullDistribution = calculateFullDigitDistribution(symbol);
                if (fullDistribution) {
                    const thirdCondition = fullDistribution.mostAppearingDigit > 4 && fullDistribution.leastAppearingDigit < 4;

                    if (thirdCondition) {
                        const overPercentage = percentages[`over${prediction}`] || 0;
                        validS2Markets.push({
                            symbol,
                            mode: 'S2',
                            lastN,
                            overPercentage,
                            mostDigit: fullDistribution.mostAppearingDigit,
                            leastDigit: fullDistribution.leastAppearingDigit,
                            prediction: prediction,
                            contractType: contractType,
                            stake: 0 // Will be calculated below
                        });
                    }
                }
            }
        }
    }

    // Execute ALL valid S1 trades (no limit, no selection)
    if (validS1Markets.length > 0) {
        addBotLog(`🎯 Found ${validS1Markets.length} valid S1 market(s): ${validS1Markets.map(m => m.symbol).join(', ')} | Executing ALL`, 'info');
        
        for (const market of validS1Markets) {
            const lastNStr = market.lastN.join(', ');
            addBotLog(`✓ S1 Entry: ${market.symbol} | Last ${market.lastN.length}: [${lastNStr}] ≤ ${botState.s1MaxDigit} | Over ${market.prediction}%: ${market.overPercentage.toFixed(1)}% ≥ ${botState.s1Percentage}% | Most: ${market.mostDigit} (>4) | Least: ${market.leastDigit} (<4) | Stake: $${market.stake.toFixed(2)}`, 'info');
            
            executeTradeWithTracking(market);
        }
    } else if (botState.s1Blocked && botState.martingaleStepCount === 0) {
        // Log reminder that S1 is blocked when not in recovery
        if (Math.random() < 0.01) { // Log occasionally to avoid spam
            addBotLog(`⚠️ S1 is currently BLOCKED (${botState.s1ConsecutiveLosses} consecutive losses). Waiting for S2 recovery...`, 'warning');
        }
    }

    // Execute best S2 recovery trade (if in recovery mode)
    if (validS2Markets.length > 0) {
        // Pick the market with the highest over 4 percentage
        validS2Markets.sort((a, b) => b.over4Percentage - a.over4Percentage);
        const selected = validS2Markets[0];

        // Calculate martingale stake for S2
        const accumulatedLosses = botState.accumulatedStakesLost;
        const recoveryMultiplier = 100 / botState.payoutPercentage;
        selected.stake = parseFloat((accumulatedLosses * recoveryMultiplier).toFixed(2));
        botState.currentStake = selected.stake;
        botState.recoverySymbol = selected.symbol;

        const lastNStr = selected.lastN.join(', ');
        addBotLog(`✓ S2 Recovery: ${validS2Markets.length} market(s) valid | Trading ${selected.symbol} | Last ${selected.lastN.length}: [${lastNStr}] ≤ ${botState.s2MaxDigit} | Over ${selected.prediction}%: ${selected.overPercentage.toFixed(1)}% ≥ ${botState.s2Percentage}% | Most: ${selected.mostDigit} (>4) | Least: ${selected.leastDigit} (<4) | ${selected.contractType} ${selected.prediction} | Stake: $${selected.stake.toFixed(2)}`, 'warning');
        
        executeTradeWithTracking(selected);
    }
}

function executeTradeWithTracking(marketData) {
    // Track this as an active contract
    const contractId = `pending_${marketData.symbol}_${Date.now()}`;
    activeContracts[contractId] = {
        symbol: marketData.symbol,
        strategy: marketData.mode,
        stake: marketData.stake,
        startTime: Date.now()
    };

    // Track S1 symbols to avoid duplicates
    if (marketData.mode === 'S1') {
        activeS1Symbols.add(marketData.symbol);
    }

    // Show comprehensive digit analysis before purchase
    showComprehensiveDigitAnalysis(marketData.symbol, marketData.prediction);

    // Send purchase request with strategy info in passthrough
    sendBotPurchaseWithStrategy(marketData.prediction, marketData.stake, marketData.symbol, marketData.mode, marketData.contractType);
}

// Function to show comprehensive digit analysis (matching XML before_purchase logic)
function showComprehensiveDigitAnalysis(symbol, prediction) {
    const lastDigits = marketTickHistory[symbol] || [];
    const percentages = marketDigitPercentages[symbol] || {};

    if (lastDigits.length >= 20) {
        const last6Digits = lastDigits.slice(-6);

        // Show analysis notification (similar to XML before_purchase)
        showToast(`Analysis for ${symbol}: Last 6 digits [${last6Digits.join(', ')}] | Prediction: OVER ${prediction}`, 'info', 5000);

        // Log detailed analysis
        let analysisText = `📊 Digit Analysis for ${symbol} (Last 20 ticks):\n`;
        for (let digit = 0; digit <= 9; digit++) {
            const percentage = percentages[digit] || 0;
            analysisText += `#${digit}: ${percentage.toFixed(1)}% | `;
        }

        addBotLog(analysisText.slice(0, -3), 'info'); // Remove last " | "

        // Show technical indicators if available
        if (emaValue !== null || smaValue !== null) {
            addBotLog(`📈 Technical Indicators: EMA(100): ${emaValue ? emaValue.toFixed(4) : 'N/A'} | SMA(50): ${smaValue ? smaValue.toFixed(4) : 'N/A'}`, 'info');
        }
    }
}

function sendBotPurchase(prediction, stake, symbol) {
    sendBotPurchaseWithStrategy(prediction, stake, symbol, 'S1');
}

function sendBotPurchaseWithStrategy(prediction, stake, symbol, strategy, contractType = null) {
    console.log('sendBotPurchase: Preparing to send purchase for', symbol, 'prediction', prediction, 'stake', stake, 'strategy', strategy);

    // Determine contract type
    let finalContractType;
    if (contractType) {
        finalContractType = contractType === 'OVER' ? 'DIGITOVER' : 'DIGITUNDER';
    } else {
        finalContractType = prediction <= 4 ? "DIGITOVER" : "DIGITUNDER";
    }

    const purchaseRequest = {
        "buy": 1,
        "price": stake,
        // Pass the symbol, barrier, and strategy so we know where the result came from
        "passthrough": { 
            "purpose": "ghost_ai_trade", 
            "run_id": botState.runId, 
            "symbol": symbol, 
            "barrier": prediction,
            "strategy": strategy,
            "stake": stake
        },
        "parameters": {
            "amount": stake,
            "basis": "stake",
            "contract_type": finalContractType,
            "currency": "USD",
            "duration": 1,
            "duration_unit": "t",
            "symbol": symbol,
            "barrier": prediction,
        }
    };

    console.log('sendBotPurchase: Sending request:', purchaseRequest);

    const strategyLabel = strategy === 'S1' ? 'S1 Entry' : 'S2 Recovery';
    addBotLog(`Executing ${strategyLabel} on ${symbol}: ${prediction <= 4 ? 'OVER' : 'UNDER'} ${prediction} with stake $${parseFloat(stake).toFixed(2)}`, 'trade');

    sendAPIRequest(purchaseRequest).then(() => {
        console.log('sendBotPurchase: Request sent successfully');
    }).catch(error => {
        console.error('sendBotPurchase: Request failed:', error);
        botState.isTrading = false; // Reset trading flag on failure
    });
}

/**
 * Toggle function for bot start/stop buttons (works for both Speedbot and Ghost AI sections)
 */
function toggleBot() {
    if (isBotRunning) {
        stopGhostAiBot();
    } else {
        startGhostAiBot();
    }
}