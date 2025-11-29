document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('zabbix-config-form');
    const urlInput = document.getElementById('zabbix-url');
    const tokenInput = document.getElementById('zabbix-token');
    const intervalInput = document.getElementById('check-interval');
    const customTagsInput = document.getElementById('custom-tags');
    const hostGroupsInput = document.getElementById('host-groups'); // Campo de grupos
    const statusMessage = document.getElementById('status-message');
    const testNotificationBtn = document.getElementById('test-notification-btn');
    const testSimpleBtn = document.getElementById('test-simple-btn');
    const resetBtn = document.getElementById('reset-btn');
    const toggleMonitoringBtn = document.getElementById('toggle-monitoring-btn');
    const severityCheckboxes = document.querySelectorAll('.severity-options input[type="checkbox"]');
    const tokenStatus = document.getElementById('token-status');
    const notificationTimeoutInput = document.getElementById('notification-timeout');
    const countdownBar = document.getElementById('countdown-bar');

    // NOVAS VARIÁVEIS PARA ABAS E ALERTA
    const tabButtons = document.querySelectorAll('.tab-button');
    const tabContents = document.querySelectorAll('.tab-content');
    const refreshAlertsBtn = document.getElementById('refresh-alerts-btn');
    const alertsListDiv = document.getElementById('alerts-list');
    const alertsListStatus = document.getElementById('alerts-list-status');
    // FIM NOVAS VARIÁVEIS

    let countdownTimeoutId = null;
    let isMonitoringActive = true;

    // Mapeamento de Severidade (Zabbix ID para Nome em Português)
    const SEVERITY_MAP_PT = {
        0: "NÃO CLASSIFICADA", 1: "INFORMAÇÃO", 2: "ATENÇÃO",
        3: "MÉDIA", 4: "ALTA", 5: "DESASTRE"
    };

    // Funções de feedback unificadas
    const displayStatus = (message, className, duration = 4000) => {
        statusMessage.textContent = message;
        statusMessage.className = className;
        if (duration > 0) {
            setTimeout(() => statusMessage.textContent = '', duration);
        }
    };

    // Função para atualizar o estado visual do botão Toggle (Minimalista)
    const updateToggleButton = () => {
        if (isMonitoringActive) {
            toggleMonitoringBtn.textContent = 'Monitoramento: ✅ ATIVO';
            toggleMonitoringBtn.classList.remove('toggle-inactive');
            toggleMonitoringBtn.classList.add('toggle-active');
            displayStatus('Monitoramento ativado.', 'status-success', 2000);
        } else {
            toggleMonitoringBtn.textContent = 'Monitoramento: 🚫 INATIVO';
            toggleMonitoringBtn.classList.remove('toggle-active');
            toggleMonitoringBtn.classList.add('toggle-inactive');
            displayStatus('Monitoramento desativado.', 'status-error', 3000);
        }
    };

    // Função para iniciar a animação da barra (mantida)
    const startCountdownAnimation = (timeoutSeconds) => {
        if (countdownTimeoutId) {
            clearTimeout(countdownTimeoutId);
            countdownBar.style.width = '0%';
            countdownBar.style.transitionDuration = '0s';
        }

        if (timeoutSeconds > 0) {
            countdownBar.style.width = '100%';
            countdownBar.style.transitionDuration = `${timeoutSeconds}s`;

            countdownTimeoutId = setTimeout(() => {
                countdownBar.style.width = '0%';
                countdownBar.style.transitionDuration = '0s';
            }, timeoutSeconds * 1000);
        } else {
            countdownBar.style.width = '0%';
            countdownBar.style.transitionDuration = '0s';
        }
    };

    // Função para renderizar a tabela de alertas
    const renderAlertsTable = (alerts) => {
        alertsListDiv.innerHTML = '';
        if (alerts.length === 0) {
            alertsListStatus.textContent = '✅ Nenhum problema ativo encontrado nos 50 mais recentes (respeitando filtros).';
            alertsListStatus.className = 'status-success';
            return;
        }

        const table = document.createElement('table');
        table.className = 'alert-table';

        alerts.forEach(alert => {
            const row = table.insertRow(); 

            // Determina se é RESOLVIDO ou PROBLEMA
            // Se r_eventid existe e não é "0", é resolvido.
            const isResolved = (alert.r_eventid && alert.r_eventid !== "0");
            const statusLabel = isResolved ? "RESOLVIDO" : "PROBLEMA";
            const statusClass = isResolved ? "status-resolved" : "status-problem";
            
            // Usa o relógio de recuperação se resolvido, senão o de criação
            const timeToDisplay = isResolved && alert.r_clock 
                ? new Date(parseInt(alert.r_clock) * 1000).toLocaleString('pt-BR')
                : new Date(parseInt(alert.clock) * 1000).toLocaleString('pt-BR');

            // Coluna 1: Severidade e Host (USANDO hostDisplayName)
            const cell1 = row.insertCell();
            cell1.style.width = '35%';
            cell1.innerHTML = `
            <span class="alert-severity sev-${alert.severity}">${SEVERITY_MAP_PT[alert.severity] || 'INDET.'}</span>
            <div class="alert-host">${alert.hostDisplayName}</div>
            `;

            // Coluna 2: Problema e Tempo
            const cell2 = row.insertCell();
            cell2.innerHTML = `
            <div>
                <span class="status-badge ${statusClass}">${statusLabel}</span>
            </div>
            <div class="alert-problem">${alert.name}</div>
            <div class="alert-time">${timeToDisplay}</div>
            `;

            // Torna a linha clicável
            row.onclick = () => {
                const zabbixUrl = urlInput.value.trim();
                const baseUrl = zabbixUrl.replace('/api_jsonrpc.php', '').replace(/\/+$/, '');
                const eventUrl = `${baseUrl}/zabbix.php?action=problem.view&eventid=${alert.eventid}`;
                chrome.tabs.create({ url: eventUrl });
            };
        });

        alertsListDiv.appendChild(table);
        alertsListStatus.textContent = `Mostrando ${alerts.length} eventos recentes (filtrados).`;
        alertsListStatus.className = 'status-loading'; // Manter cor neutra após o carregamento
    };

    // Função para buscar alertas (chamada do background)
    const fetchAndRenderAlerts = () => {
        // Esta função sempre renderiza dados FILTRADOS, pois o background.js usa os filtros salvos.
        if (document.getElementById('alerts').classList.contains('active')) {
            alertsListStatus.textContent = 'Carregando alertas...';
            alertsListStatus.className = 'status-loading';
            alertsListDiv.innerHTML = '';
        } else {
            displayStatus('Carregando alertas...', 'status-loading', 0);
        }


        chrome.runtime.sendMessage({ action: 'fetchPopupAlerts' }, (response) => {
            if (chrome.runtime.lastError) {
                alertsListStatus.textContent = '❌ Erro interno ao buscar alertas.';
                alertsListStatus.className = 'status-error';
                return;
            }

            if (response.status === 'success') {
                renderAlertsTable(response.alerts);
            } else if (response.status === 'error') {
                alertsListStatus.textContent = `❌ ERRO: ${response.message}`;
                alertsListStatus.className = 'status-error';
            }
        });
    };

    // 1. Carregar configurações salvas
    chrome.storage.local.get(['zabbixUrl', 'checkInterval', 'selectedSeverities', 'zabbixToken', 'notificationTimeout', 'customTags', 'isMonitoringActive', 'hostGroups'], (data) => {
        if (data.zabbixUrl) urlInput.value = data.zabbixUrl;
        if (data.checkInterval) intervalInput.value = data.checkInterval;
        if (data.customTags) customTagsInput.value = data.customTags;
        if (data.hostGroups) hostGroupsInput.value = data.hostGroups;


        isMonitoringActive = data.isMonitoringActive !== false;
        updateToggleButton();

        const timeout = data.notificationTimeout !== undefined ? data.notificationTimeout : 0;
        notificationTimeoutInput.value = timeout;

        if (data.zabbixToken && data.zabbixToken.length > 0) {
            tokenInput.value = '********';
            tokenStatus.textContent = "Token salvo. Vazio para manter.";
            tokenInput.removeAttribute('required');
        } else {
            tokenInput.setAttribute('required', 'true');
            tokenStatus.textContent = "";
        }

        const defaultSeverities = ['4', '5'];
        const severitiesToLoad = data.selectedSeverities || defaultSeverities;

        severityCheckboxes.forEach(checkbox => {
            checkbox.checked = severitiesToLoad.includes(checkbox.dataset.severityId);
        });

        // Se a aba de Alertas for a inicial, carrega a lista
        if (document.getElementById('alerts').classList.contains('active')) {
            fetchAndRenderAlerts();
        }
    });

    // 2. Salvar configurações e agendar
    form.addEventListener('submit', (e) => {
        e.preventDefault();

        const zabbixUrl = urlInput.value.trim();
        const rawToken = tokenInput.value;
        const checkInterval = parseInt(intervalInput.value, 10);
        const timeoutValue = parseInt(notificationTimeoutInput.value, 10);
        const customTags = customTagsInput.value.trim();
        const hostGroups = hostGroupsInput.value.trim();


        const selectedSeverities = Array.from(severityCheckboxes)
        .filter(cb => cb.checked)
        .map(cb => cb.dataset.severityId);

        if (selectedSeverities.length === 0) {
            displayStatus('Selecione uma severidade.', 'status-error');
            return;
        }

        if (checkInterval < 1) {
            displayStatus('Intervalo minímo: 1 minuto.', 'status-error');
            return;
        }

        chrome.storage.local.get('zabbixToken', (data) => {
            let tokenToSave = data.zabbixToken || '';

            if (rawToken && rawToken !== '********') {
                tokenToSave = rawToken;
            } else if (rawToken === '********' && data.zabbixToken) {
                tokenToSave = data.zabbixToken;
            }

            if (!tokenToSave) {
                displayStatus('Token de acesso obrigatório.', 'status-error');
                tokenInput.setAttribute('required', 'true');
                return;
            }

            // SALVA TODAS AS CONFIGURAÇÕES (incluindo hostGroups)
            chrome.storage.local.set({ zabbixUrl, zabbixToken: tokenToSave, checkInterval, selectedSeverities, notificationTimeout: timeoutValue, customTags, hostGroups }, () => {
                tokenInput.value = '********';
                tokenInput.removeAttribute('required');
                tokenStatus.textContent = "Token salvo. Vazio para manter.";

                if (isMonitoringActive) {
                    chrome.runtime.sendMessage({ action: 'scheduleAlarm', interval: checkInterval }, () => {
                        displayStatus(`Salvo e agendado a cada ${checkInterval} min.`, 'status-success', 4000);
                        startCountdownAnimation(timeoutValue);
                    });
                } else {
                    displayStatus(`Salvo. Monitoramento INATIVO.`, 'status-error', 6000);
                }
            });
        });
    });

    // 3. Função de TOGGLE
    toggleMonitoringBtn.addEventListener('click', () => {
        isMonitoringActive = !isMonitoringActive;
        const newInterval = parseInt(intervalInput.value, 10);

        chrome.storage.local.set({ isMonitoringActive }, () => {

            if (isMonitoringActive) {
                chrome.runtime.sendMessage({ action: 'scheduleAlarm', interval: newInterval }, () => {
                    updateToggleButton();
                });
            } else {
                // Desativa o alarme (intervalo 0) e limpa o badge
                chrome.runtime.sendMessage({ action: 'scheduleAlarm', interval: 0 }, () => {
                    updateToggleButton();
                });
            }
        });
    });

    // 6. Lógica de Alternância de Abas
    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const targetTab = button.dataset.tab;

            tabButtons.forEach(btn => btn.classList.remove('active'));
            tabContents.forEach(content => content.classList.remove('active'));

            button.classList.add('active');
            document.getElementById(targetTab).classList.add('active');

            // Se for para a aba de alertas, carrega a lista
            if (targetTab === 'alerts') {
                fetchAndRenderAlerts();
            }
        });
    });

    // 7. Botão de Atualização na Aba Alertas
    refreshAlertsBtn.addEventListener('click', fetchAndRenderAlerts);


    // 4. Testes (Apenas mostra o status, NÃO renderiza a lista de alertas)
    testSimpleBtn.addEventListener('click', () => {
        displayStatus('Testando conectividade...', 'status-loading', 0);

        chrome.runtime.sendMessage({ action: 'testSimpleConnect' }, (response) => {
            if (chrome.runtime.lastError) {
                displayStatus('Erro interno.', 'status-error', 10000);
                return;
            }

            if (response.status === 'success') {
                displayStatus(`✅ Conexão OK! Zabbix ${response.version}`, 'status-success', 7000);
                const timeoutValue = parseInt(notificationTimeoutInput.value, 10);
                startCountdownAnimation(timeoutValue);

            } else if (response.status === 'error') {
                displayStatus(`❌ ERRO: ${response.message}`, 'status-error', 15000);
            }
        });
    });

    testNotificationBtn.addEventListener('click', () => {
        const selectedSeverities = Array.from(severityCheckboxes)
        .filter(cb => cb.checked)
        .map(cb => cb.dataset.severityId);

        if (selectedSeverities.length === 0) {
            displayStatus('Selecione uma severidade antes de testar.', 'status-error', 7000);
            return;
        }

        displayStatus('Buscando alertas...', 'status-loading', 0);

        // O background.js executa a verificação com filtros, mas não notifica nem atualiza o badge.
        chrome.runtime.sendMessage({ action: 'testCheck' }, (response) => {
            if (chrome.runtime.lastError) {
                displayStatus('Erro interno.', 'status-error', 10000);
                return;
            }

            if (response.status === 'success') {
                const count = response.count;
                let message;
                if (count > 0) {
                    // Mensagem clara sobre o resultado do teste.
                    message = `✅ Teste OK! ${count} problemas encontrados (com filtros).`;
                    displayStatus(message, 'status-error', 7000);
                } else {
                    message = '✅ Teste OK! Nenhum alerta encontrado (com filtros).';
                    displayStatus(message, 'status-success', 7000);
                }
                const timeoutValue = parseInt(notificationTimeoutInput.value, 10);
                startCountdownAnimation(timeoutValue);

            } else if (response.status === 'error') {
                displayStatus(`❌ ERRO: ${response.message}`, 'status-error', 15000);
            }
        });
    });

    // 5. Reset (mantido)
    resetBtn.addEventListener('click', () => {
        if (confirm('Limpar TODAS as configurações?')) {
            chrome.storage.local.clear(() => {
                if (chrome.runtime.lastError) {
                    displayStatus('Erro ao limpar o storage.', 'status-error', 5000);
                    return;
                }

                chrome.runtime.sendMessage({ action: 'scheduleAlarm', interval: 0 });
                chrome.runtime.sendMessage({ action: 'clearBadge' });

                isMonitoringActive = true;

                displayStatus('✅ Limpo! Recarregue a página.', 'status-success', 5000);
                setTimeout(() => window.location.reload(), 1000);
            });
        }
    });

    window.addEventListener('unload', () => {
        if (countdownTimeoutId) {
            clearTimeout(countdownTimeoutId);
        }
    });
});