const ALARM_NAME = 'zabbixAlertCheck';
let hostNameCache = {};
let consecutiveErrorCount = 0;
const MAX_ERROR_COUNT = 3;

// Mapeamento de Severidade (Zabbix ID para Nome em Português)
const SEVERITY_MAP_PT = {
    0: "NÃO CLASSIFICADA", 1: "INFORMAÇÃO", 2: "ATENÇÃO",
    3: "MÉDIA", 4: "ALTA", 5: "DESASTRE"
};

// --- FUNÇÕES DE UTILIDADE E API ---

function getBaseUrl(apiUrl) {
    let baseUrl = apiUrl.replace('/api_jsonrpc.php', '');
    return baseUrl;
}

// Função para atualizar o Badge (Indicador visual de problemas)
function updateBadge(count, isError = false) {
    const text = isError ? 'ERR' : (count > 0 ? String(count) : '');
    const color = isError ? '#E74C3C' : (count > 0 ? '#E74C3C' : '#2ECC71'); // Vermelho para alerta/erro, Verde para OK

    chrome.action.setBadgeText({ text });
    chrome.action.setBadgeBackgroundColor({ color });
}


// Listener para cliques na notificação (Abre o link do evento no Zabbix)
chrome.notifications.onClicked.addListener((notificationId) => {
    const eventId = notificationId;

    chrome.storage.local.get('zabbixUrl', (data) => {
        if (data.zabbixUrl) {
            const baseUrl = getBaseUrl(data.zabbixUrl);
            const eventUrl = `${baseUrl}/zabbix.php?action=problem.view&eventid=${eventId}`;
            chrome.tabs.create({ url: eventUrl });
        }
    });
});

async function testZabbixSimpleConnect() {
    const config = await new Promise(resolve => {
        chrome.storage.local.get(['zabbixUrl'], resolve);
    });

    const { zabbixUrl } = config;

    if (!zabbixUrl) {
        throw new Error('URL do Zabbix não configurada na storage.');
    }

    const apiUrl = zabbixUrl.endsWith('/api_jsonrpc.php') ? zabbixUrl : zabbixUrl.replace(/\/+$/, '') + '/api_jsonrpc.php';

    const requestBody = {
        jsonrpc: '2.0',
        method: 'apiinfo.version',
        params: {},
        id: 1
    };

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            throw new Error(`Erro HTTP: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();

        if (data.error) {
            throw new Error(`Erro de Rota/Servidor: ${data.error.message}.`);
        }

        consecutiveErrorCount = 0;
        updateBadge(0);

        return data.result;

    } catch (error) {
        throw error;
    }
}

// Função para buscar o ID do Host (hostid) a partir do ID do Trigger (objectid)
async function getHostIdFromTriggerId(triggerId, zabbixUrl, zabbixToken) {
    const apiUrl = zabbixUrl.endsWith('/api_jsonrpc.php') ? zabbixUrl : zabbixUrl.replace(/\/+$/, '') + '/api_jsonrpc.php';

    const requestBody = {
        jsonrpc: '2.0',
        method: 'trigger.get',
        params: {
            output: ['triggerid'],
            triggerids: [triggerId],
            selectHosts: ['hostid']
        },
        id: 3,
        auth: zabbixToken
    };

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        const data = await response.json();

        if (data.result && data.result.length > 0 && data.result[0].hosts && data.result[0].hosts.length > 0) {
            return data.result[0].hosts[0].hostid;
        }

        return null;
    } catch (error) {
        return null;
    }
}


// Função para buscar o Host Name usando o ID do Host
async function getHostNameFromId(hostId, zabbixUrl, zabbixToken) {
    if (hostNameCache[hostId]) {
        return hostNameCache[hostId];
    }

    const apiUrl = zabbixUrl.endsWith('/api_jsonrpc.php') ? zabbixUrl : zabbixUrl.replace(/\/+$/, '') + '/api_jsonrpc.php';

    const requestBody = {
        jsonrpc: '2.0',
        method: 'host.get',
        params: {
            output: ['name'],
            hostids: [hostId]
        },
        id: 2,
        auth: zabbixToken
    };

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        const data = await response.json();

        if (data.result && data.result.length > 0) {
            const hostName = data.result[0].name;
            hostNameCache[hostId] = hostName;
            return hostName;
        }

        return 'Host ID ' + hostId + ' (Host.Get Falhou)';
    } catch (error) {
        return 'Erro na Busca Host';
    }
}


// --- FUNÇÕES PRINCIPAIS ---

// 1. Abre o popup.html (mantida)
chrome.action.onClicked.addListener(() => {
    chrome.windows.create({
        url: 'popup.html', type: 'popup', width: 380, height: 600
    });
});

// 2. FUNÇÃO PRINCIPAL: Verificação de Alertas (com persistência)
async function checkZabbixAlerts(isTest = false) {
    // console.log(`Verificando alertas do Zabbix (Modo Teste: ${isTest})...`);

    try {
        const config = await new Promise(resolve => {
            // Inclui 'lastKnownProblemIds' para persistência
            chrome.storage.local.get(['zabbixUrl', 'zabbixToken', 'selectedSeverities', 'notificationTimeout', 'customTags', 'lastKnownProblemIds'], resolve);
        });

        const { zabbixUrl, zabbixToken, selectedSeverities, notificationTimeout, customTags } = config;

        // Carrega IDs conhecidos da última execução
        // MIGRACAO: Se for array (versão antiga), converte para objeto. Se for objeto, usa direto.
        let lastKnownProblemIds = config.lastKnownProblemIds || {};
        if (Array.isArray(lastKnownProblemIds)) {
            const tempIds = {};
            // Se era array, assume que já foi notificado recentemente, então define o próximo alerta para daqui a 20min
            const now = Date.now();
            lastKnownProblemIds.forEach(id => {
                tempIds[id] = now + (20 * 60 * 1000);
            });
            lastKnownProblemIds = tempIds;
        }

        if (!zabbixUrl || !zabbixToken) {
            if (!isTest) updateBadge(0, false);
            throw new Error('URL ou Token do Zabbix não configurados.');
        }

        const apiUrl = zabbixUrl.endsWith('/api_jsonrpc.php') ? zabbixUrl : zabbixUrl.replace(/\/+$/, '') + '/api_jsonrpc.php';

        const severitiesToFetch = selectedSeverities && selectedSeverities.length > 0
            ? selectedSeverities.map(id => parseInt(id))
            : [4, 5];

        // Passo 1: Busca problemas e o ID do objeto (problem.get)
        const problemRequestBody = {
            jsonrpc: '2.0',
            method: 'problem.get',
            params: {
                output: ['eventid', 'name', 'severity', 'objectid', 'object', 'r_eventid'],
                selectTags: ['tag', 'value'],
                selectHosts: ['hostid', 'name'],
                recent: false,
                severities: severitiesToFetch,
                sortfield: 'eventid',
                sortorder: 'DESC',
                limit: 100, // Aumentado para 100 para segurança na persistência
            },
            id: 1,
            auth: zabbixToken
        };

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(problemRequestBody)
        });

        if (!response.ok) {
            throw new Error(`Erro HTTP ao chamar a API: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();

        if (data.error) {
            throw new Error(`Erro na API Zabbix: ${data.error.message}. Verifique o Token.`);
        }

        let problems = data.result || [];

        consecutiveErrorCount = 0;

        // Passo 2: Processa os Hosts (Otimizado)
        problems = await Promise.all(problems.map(async problem => {
            let hostId = null;
            let hostName = null;

            if (problem.hosts && problem.hosts.length > 0) {
                hostId = problem.hosts[0].hostid;
                hostName = problem.hosts[0].name;
            }

            if (!hostId && problem.object === '0' && problem.objectid) {
                hostId = await getHostIdFromTriggerId(problem.objectid, zabbixUrl, zabbixToken);
            }

            if (hostId && !hostName) {
                hostName = await getHostNameFromId(hostId, zabbixUrl, zabbixToken);
            }

            problem.fetchedHostName = hostName;
            return problem;
        }));

        // Final da lógica (notificação/contagem)
        if (isTest) {
            return problems.length;
        }

        // --- LÓGICA DE PREVENÇÃO DE DUPLICAÇÃO PERSISTENTE E RE-ALERTA (20min) ---
        const nextKnownProblemIds = {};
        const REMINDER_INTERVAL_MS = 20 * 60 * 1000; // 20 minutos
        const now = Date.now();

        problems.forEach(problem => {
            const eventId = problem.eventid;

            if (!lastKnownProblemIds.hasOwnProperty(eventId)) {
                // NOVO PROBLEMA: Notifica e agenda próximo alerta para daqui a 20min
                sendNotification(problem, notificationTimeout, customTags);
                nextKnownProblemIds[eventId] = now + REMINDER_INTERVAL_MS;
            } else {
                // PROBLEMA JÁ CONHECIDO: Verifica se já passou o tempo de silêncio (20min)
                const nextAlertTime = lastKnownProblemIds[eventId];

                if (now >= nextAlertTime) {
                    // Passaram-se 20min (ou mais) desde a última notificação/registro
                    sendNotification(problem, notificationTimeout, customTags);
                    // Reagenda para daqui a mais 20min
                    nextKnownProblemIds[eventId] = now + REMINDER_INTERVAL_MS;
                } else {
                    // Ainda está no período de silêncio (dentro dos 20min)
                    // Mantém o horário agendado original
                    nextKnownProblemIds[eventId] = nextAlertTime;
                }
            }
        });

        // Salva o objeto atualizado (apenas problemas que ainda estão ativos persistem)
        await chrome.storage.local.set({ lastKnownProblemIds: nextKnownProblemIds });
        // FIM DA LÓGICA DE PREVENÇÃO PERSISTENTE

        updateBadge(problems.length, false);

        return problems.length;

    } catch (error) {
        // console.error("Erro na verificação de alertas Zabbix:", error.message);

        if (!isTest) {
            consecutiveErrorCount++;
            if (consecutiveErrorCount >= MAX_ERROR_COUNT) {
                updateBadge(0, true);
            }
        }

        throw error;
    }
}


// 3. Função para enviar a notificação push (REMOVIDO BOTÃO Acknowledge)
function sendNotification(problem, timeoutSeconds = 0, customTagsString = 'Planta') {
    const severityName = SEVERITY_MAP_PT[problem.severity] || "INDETERMINADA";

    let hostName;

    if (problem.fetchedHostName && problem.fetchedHostName !== 'Erro na Busca Host' && problem.fetchedHostName !== 'Host ID Desconhecido' && problem.fetchedHostName !== null) {
        hostName = problem.fetchedHostName;
    } else {
        const nameParts = problem.name.split(':');
        hostName = (nameParts.length > 1) ? nameParts[0].trim() : 'Host Não Encontrado';
    }

    const tagsToExtract = customTagsString.split(',').map(t => t.trim()).filter(t => t.length > 0);
    let tagsDisplay = [];

    tagsToExtract.forEach(tagKey => {
        const foundTag = problem.tags ? problem.tags.find(tag => tag.tag === tagKey) : null;
        const tagValue = foundTag ? foundTag.value : 'N/A';
        tagsDisplay.push(`${tagKey}: ${tagValue}`);
    });

    if (tagsDisplay.length === 0) {
        tagsDisplay.push('Tags: N/A');
    }

    const tagsLine = tagsDisplay.join(' | ');

    let cleanMessageBody = problem.name;

    if (hostName !== 'Host Não Encontrado' && problem.name.startsWith(hostName + ':')) {
        cleanMessageBody = problem.name.substring(hostName.length + 1).trim();
    }

    const notificationId = problem.eventid;

    chrome.notifications.create(
        notificationId,
        {
            type: 'basic',
            iconUrl: chrome.runtime.getURL('icons/icon128.png'),
            title: `ZABBIX ALERTA: ${severityName} (${hostName})`,
            message: `${tagsLine}\n${cleanMessageBody}`,
            priority: 2,
            // REMOVIDO: buttons: [{ title: "Reconhecer (Acknowledge)" }]
        },
        (id) => {
            if (id && timeoutSeconds > 0) {
                setTimeout(() => {
                    chrome.notifications.clear(id, (wasCleared) => {
                        // if (wasCleared) {
                        // console.log(`Notificação ${id} fechada após ${timeoutSeconds} segundos.`);
                        // }
                    });
                }, timeoutSeconds * 1000);
            }
        }
    );
}

// 4. Lógica de Agendamento (mantida)
function setupAlarm(intervalInMinutes) {
    chrome.alarms.clear(ALARM_NAME, () => {
        if (intervalInMinutes >= 1) {
            chrome.alarms.create(ALARM_NAME, {
                delayInMinutes: 0.1,
                periodInMinutes: intervalInMinutes
            });
            // console.log(`Novo alarme agendado: a cada ${intervalInMinutes} minutos.`);
            chrome.storage.local.set({ isMonitoringActive: true });
        } else {
            // console.log(`Alarme desativado.`);
            updateBadge(0);
            chrome.storage.local.set({ isMonitoringActive: false });
        }
    });
}

// 5. Listener para o Alarme (mantido)
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_NAME) {
        chrome.storage.local.get('isMonitoringActive', (data) => {
            if (data.isMonitoringActive !== false) {
                checkZabbixAlerts(false).catch(error => { /* console.error("Falha na verificação periódica do Zabbix:", error.message) */ });
            } else {
                // console.log("Verificação periódica ignorada: Monitoramento está INATIVO.");
            }
        });
    }
});

// Nova função para buscar alertas SÓ para o popup (COM LÓGICA ROBUSTA DE HOST)
async function fetchZabbixAlertsForPopup() {
    try {
        const config = await new Promise(resolve => {
            chrome.storage.local.get(['zabbixUrl', 'zabbixToken', 'selectedSeverities'], resolve);
        });

        const { zabbixUrl, zabbixToken } = config;

        if (!zabbixUrl || !zabbixToken) {
            throw new Error('URL ou Token do Zabbix não configurados.');
        }

        const apiUrl = zabbixUrl.endsWith('/api_jsonrpc.php') ? zabbixUrl : zabbixUrl.replace(/\/+$/, '') + '/api_jsonrpc.php';

        // Busca todas as severidades para a lista do popup
        const severitiesToFetch = [0, 1, 2, 3, 4, 5];

        // Passo 1: Busca problemas (limitado a 50)
        const problemRequestBody = {
            jsonrpc: '2.0',
            method: 'problem.get',
            params: {
                output: ['eventid', 'name', 'severity', 'objectid', 'object', 'clock'],
                selectHosts: ['hostid', 'name'],
                recent: false,
                severities: severitiesToFetch,
                sortfield: 'eventid',
                sortorder: 'DESC',
                limit: 50, // Limite para os 50 mais recentes
            },
            id: 1,
            auth: zabbixToken
        };

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(problemRequestBody)
        });

        if (!response.ok) {
            throw new Error(`Erro HTTP ao chamar a API: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();

        if (data.error) {
            throw new Error(`Erro na API Zabbix: ${data.error.message}. Verifique o Token.`);
        }

        let problems = data.result || [];

        // PASSO 2: Processa os Hosts (Robusto)
        problems = await Promise.all(problems.map(async problem => {
            let hostId = null;
            let hostName = null;

            // 1. Tenta obter o host diretamente do evento do problema
            if (problem.hosts && problem.hosts.length > 0) {
                hostId = problem.hosts[0].hostid;
                hostName = problem.hosts[0].name;
            }

            // 2. Se for um trigger (object=0) e o hostid estiver ausente, faz o lookup
            if (!hostId && problem.object === '0' && problem.objectid) {
                hostId = await getHostIdFromTriggerId(problem.objectid, zabbixUrl, zabbixToken);
            }

            // 3. Se encontrou o ID do host mas o nome está faltando, busca o nome
            if (hostId && !hostName) {
                hostName = await getHostNameFromId(hostId, zabbixUrl, zabbixToken);
            }

            problem.fetchedHostName = hostName; // Host name ou null/erro string

            // Define o nome de exibição: usa o nome buscado ou tenta extrair do problema
            let displayName = hostName;

            // Tenta extrair o nome do host do problema como fallback se a busca falhar ou retornar null/erro
            if (!displayName || displayName === 'Erro na Busca Host' || displayName.startsWith('Host ID ')) {
                const nameParts = problem.name.split(':');
                // Assume que a primeira parte é o host se houver dois pontos. Senão, usa 'Host Desconhecido'.
                displayName = (nameParts.length > 1) ? nameParts[0].trim() : 'Host Desconhecido';
            }

            problem.hostDisplayName = displayName; // Propriedade final para o popup

            return problem;
        }));

        return problems;

    } catch (error) {
        throw error;
    }
}


// 6. Listener para Mensagens do Popup (Handlers)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

    if (request.action === 'scheduleAlarm') {
        setupAlarm(request.interval);
        sendResponse({ status: 'scheduled' });
        return true;
    }

    if (request.action === 'testCheck') {
        consecutiveErrorCount = 0;
        checkZabbixAlerts(true)
            .then(problemCount => {
                updateBadge(problemCount, false);
                sendResponse({ status: 'success', count: problemCount });
            })
            .catch(error => {
                updateBadge(0, true);
                sendResponse({ status: 'error', message: error.message });
            });
        return true;
    }

    if (request.action === 'testSimpleConnect') {
        testZabbixSimpleConnect()
            .then(version => { sendResponse({ status: 'success', version: version }); })
            .catch(error => { sendResponse({ status: 'error', message: error.message }); });
        return true;
    }

    // HANDLER PARA BUSCAR ALERTAS PARA O POPUP
    if (request.action === 'fetchPopupAlerts') {
        fetchZabbixAlertsForPopup()
            .then(alerts => {
                sendResponse({ status: 'success', alerts: alerts });
            })
            .catch(error => {
                sendResponse({ status: 'error', message: error.message });
            });
        return true;
    }

    if (request.action === 'clearBadge') {
        updateBadge(0, false);
        sendResponse({ status: 'cleared' });
        return true;
    }
});

// 7. Configuração inicial (mantida)
chrome.storage.local.get(['checkInterval', 'isMonitoringActive'], (data) => {
    const isInitiallyActive = data.isMonitoringActive !== false; // Padrão é ativo

    if (isInitiallyActive && data.checkInterval) {
        setupAlarm(data.checkInterval);
        // Garante que a primeira checagem ocorre imediatamente, carregando os problemas atuais
        checkZabbixAlerts(false).catch(error => { /* console.error("Falha na checagem inicial do Zabbix:", error.message) */ });
    } else if (!isInitiallyActive) {
        setupAlarm(0);
    } else {
        updateBadge(0);
    }
});
