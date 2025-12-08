// ===================================
// NAVIGATION HANDLING
// ===================================

function setupNavigation() {
    dashboardNav.addEventListener('click', (e) => {
        e.preventDefault();
        showSection('dashboard');
    });

    speedbotNav.addEventListener('click', (e) => {
        e.preventDefault();
        showSection('speedbot');
    });

    ghostaiNav.addEventListener('click', (e) => {
        e.preventDefault();
        showSection('ghostai');
    });

    ghosteoddNav.addEventListener('click', (e) => {
        e.preventDefault();
        showSection('ghost-eodd');
    });
}

function showSection(sectionName) {
    // Hide auth container when showing any authenticated section
    if (authContainer) {
        authContainer.style.display = 'none';
    }

    dashboard.style.display = (sectionName === 'dashboard') ? 'flex' : 'none';
    tradingInterface.style.display = (sectionName === 'speedbot') ? 'flex' : 'none';
    ghostaiInterface.style.display = (sectionName === 'ghostai') ? 'flex' : 'none';
    ghosteoddInterface.style.display = (sectionName === 'ghost-eodd') ? 'flex' : 'none';

    dashboardNav.classList.toggle('active', sectionName === 'dashboard');
    speedbotNav.classList.toggle('active', sectionName === 'speedbot');
    ghostaiNav.classList.toggle('active', sectionName === 'ghostai');
    ghosteoddNav.classList.toggle('active', sectionName === 'ghost-eodd');

    // Initialize chart only when speedbot is shown
    if (sectionName === 'speedbot' && !currentChart) {
        initializeChart();
        requestMarketData(CHART_MARKET);
    }
}