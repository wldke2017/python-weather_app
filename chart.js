// ===================================
// CHART INITIALIZATION
// ===================================

function initializeChart() {
    if (currentChart) return;

    currentChart = LightweightCharts.create(chartContainer, {
        width: chartContainer.clientWidth,
        height: chartContainer.clientHeight,
        layout: {
            backgroundColor: '#ffffff',
            textColor: 'rgba(33, 56, 120, 1)',
        },
        grid: {
            vertLines: { color: '#e0e0e0' },
            horzLines: { color: '#e0e0e0' },
        },
        timeScale: {
            timeVisible: true,
            secondsVisible: false,
        },
    });

    candleSeries = currentChart.addCandlestickSeries({
        upColor: '#26a69a',
        downColor: '#ef5350',
        borderDownColor: '#ef5350',
        borderUpColor: '#26a69a',
        wickDownColor: '#ef5350',
        wickUpColor: '#26a69a',
    });

    new ResizeObserver(() => {
        if (currentChart) {
            currentChart.resize(chartContainer.clientWidth, chartContainer.clientHeight);
        }
    }).observe(chartContainer);

    const loadingMessage = chartContainer.querySelector('p');
    if (loadingMessage) loadingMessage.style.display = 'none';
}

function addMarkerToChart(tradeType, time) {
    if (!candleSeries || !candleSeries.seriesApi) {
        console.warn("Chart not ready, skipping marker.");
        return;
    }

    candleSeries.setData(candleSeries.seriesApi.data());
    const lastCandle = candleSeries.seriesApi.data().slice(-1)[0];
    if (!lastCandle) return;

    candleSeries.seriesApi.createPriceLine({ price: lastCandle.close, color: tradeType === 'CALL' ? '#26a69a' : '#ef5350', lineWidth: 2, lineStyle: LightweightCharts.LineStyle.Dashed, axisLabelVisible: true, title: `Trade @ ${lastCandle.close}` });
}