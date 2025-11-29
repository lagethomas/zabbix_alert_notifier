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

// Função para buscar os IDs dos Grupos (groupids) a partir dos Nomes (names)
async function getGroupIdsFromNames(groupNames, zabbixUrl, zabbixToken) {
    if (groupNames.length === 0) return [];

    const apiUrl = zabbixUrl.endsWith('/api_jsonrpc.php') ? zabbixUrl : zabbixUrl.replace(/\/+$/, '') + '/api_jsonrpc.php';

    const requestBody = {
        jsonrpc: '2.0',
        method: 'hostgroup.get',
        params: {
            output: ['groupid'],
            filter: { name: groupNames }, // Filtro exato por array de nomes
        },
        id: 4,
        auth: zabbixToken
    };

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        const data = await response.json();

        if (data.error) {
            console.error('Group Name API Error:', data.error);
            return [];
        }

        if (data.result && data.result.length > 0) {
            return data.result.map(group => group.groupid);
        }

        return [];
    } catch (error) {
        console.error('Error fetching Group IDs:', error);
        return [];
    }
}

// NOVO: Função para filtrar problemas cujas Triggers ou Itens estejam DESABILITADOS
async function filterProblemsByTriggerStatus(problems, zabbixUrl, zabbixToken) {
    if (problems.length === 0) return [];

    const triggerIds = problems.map(p => p.objectid).filter(id => id && id !== '0');
    if (triggerIds.length === 0) return problems;

    const apiUrl = zabbixUrl.endsWith('/api_jsonrpc.php') ? zabbixUrl : zabbixUrl.replace(/\/+$/, '') + '/api_jsonrpc.php';

    // Busca detalhes das Triggers e seus Itens
    const requestBody = {
        jsonrpc: '2.0',
        method: 'trigger.get',
        params: {
            output: ['triggerid', 'status'], // status 0 = Enabled, 1 = Disabled
            triggerids: triggerIds,
            selectItems: ['itemid', 'status'] // status 0 = Enabled, 1 = Disabled
        },
        id: 5,
        auth: zabbixToken
    };

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        const data = await response.json();
        
        if (data.result) {
            // Mapa para acesso rápido
            const triggersMap = {};
            data.result.forEach(t => { triggersMap[t.triggerid] = t; });

            // Filtra os problemas
            const filteredProblems = problems.filter(p => {
                const trigger = triggersMap[p.objectid];
                
                if (!trigger) return true; // Se não achou trigger, mantem (segurança)

                // 1. Verifica se a Trigger está desabilitada
                if (trigger.status === '1') {
                    console.log(`Removed Problem (Trigger Disabled): ${p.name}`);
                    return false;
                }

                // 2. Verifica se algum item da trigger está desabilitado
                // (Se TODOS os itens estiverem OK, ou pelo menos um, depende da lógica. 
                // Normalmente se um item essencial desliga, a trigger pode ficar stale. 
                // Vamos ser estritos: Se o item principal estiver desativado, remove).
                if (trigger.items && trigger.items.length > 0) {
                    const hasDisabledItem = trigger.items.some(item => item.status === '1');
                    if (hasDisabledItem) {
                         console.log(`Removed Problem (Item Disabled): ${p.name}`);
                         return false;
                    }
                }

                return true;
            });

            return filteredProblems;
        }
        
        return problems;
    } catch (e) {
        console.error("Error filtering inactive triggers:", e);
        return problems; // Em caso de erro, retorna lista original
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
            // Inclui 'lastKnownProblemIds' para persistência e 'hostGroups' para o filtro
            chrome.storage.local.get(['zabbixUrl', 'zabbixToken', 'selectedSeverities', 'notificationTimeout', 'customTags', 'lastKnownProblemIds', 'hostGroups'], resolve);
        });

        const { zabbixUrl, zabbixToken, selectedSeverities, notificationTimeout, customTags, hostGroups } = config;

        // Carrega IDs conhecidos da última execução
        let lastKnownProblemIds = config.lastKnownProblemIds || {};
        if (Array.isArray(lastKnownProblemIds)) {
            const tempIds = {};
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
            
        // Processa os NOMES de Grupo de Host
        const hostGroupNames = hostGroups 
            ? hostGroups.split(',').map(name => name.trim()).filter(name => name.length > 0)
            : [];
            
        // 1. Resolve Group Names to IDs
        let hostGroupsToFetch = [];
        if (hostGroupNames.length > 0) {
            hostGroupsToFetch = await getGroupIdsFromNames(hostGroupNames, zabbixUrl, zabbixToken);
            if (hostGroupsToFetch.length === 0) {
                console.warn("Nenhum Host ID encontrado para os grupos especificados. Alerta desconsiderado.");
                if (hostGroupNames.length > 0) return 0;
            }
        }
            
        // Parâmetros base
        const params = {
            output: ['eventid', 'name', 'severity', 'objectid', 'object', 'r_eventid'],
            selectTags: ['tag', 'value'],
            selectHosts: ['hostid', 'name', 'status', 'maintenance_status'], 
            recent: true, // Busca apenas problemas ativos e não reconhecidos
            severities: severitiesToFetch,
            sortfield: 'eventid',
            sortorder: 'DESC',
            limit: 100,
        };

        if (hostGroupsToFetch.length > 0) {
            params.groupids = hostGroupsToFetch;
        }

        // Passo 1: Busca problemas e o ID do objeto (problem.get)
        const problemRequestBody = {
            jsonrpc: '2.0',
            method: 'problem.get',
            params: params,
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
            console.error('API Error Response:', data.error);
            throw new Error(`Erro na API Zabbix: ${data.error.message}. Verifique o Token.`);
        }

        let problems = data.result || [];
        
        consecutiveErrorCount = 0;
        
        // 2. FILTRO CLIENT-SIDE 1: Hosts Inativos/Manutenção
        problems = problems.filter(problem => {
            if (!problem.hosts || problem.hosts.length === 0) return true; 
            const hostStatus = problem.hosts[0].status;
            const maintenanceStatus = problem.hosts[0].maintenance_status;
            // Mantém apenas se Host Ativo E Sem Manutenção
            return (hostStatus === '0' && maintenanceStatus === '0');
        });

        // 3. FILTRO CLIENT-SIDE 2: Item/Trigger Inativo (NOVO)
        // Faz uma chamada extra em lote para verificar o status da trigger/item
        problems = await filterProblemsByTriggerStatus(problems, zabbixUrl, zabbixToken);

        // Passo 4: Processa os Nomes dos Hosts (Otimizado)
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

        if (isTest) {
            return problems.length;
        }

        // --- LÓGICA DE NOTIFICAÇÃO ---
        const nextKnownProblemIds = {};
        const REMINDER_INTERVAL_MS = 20 * 60 * 1000; // 20 minutos
        const now = Date.now();

        problems.forEach(problem => {
            // Se o problema tem r_eventid != 0, ele está RESOLVIDO. Não notificamos push de resolvido neste loop,
            // ou poderíamos notificar "Recuperação". Por padrão, notificamos apenas problemas ativos.
            if (problem.r_eventid !== "0") {
                return; // Pula resolvidos para notificação push (mas eles aparecem na lista)
            }

            const eventId = problem.eventid;

            if (!lastKnownProblemIds.hasOwnProperty(eventId)) {
                sendNotification(problem, notificationTimeout, customTags);
                nextKnownProblemIds[eventId] = now + REMINDER_INTERVAL_MS;
            } else {
                const nextAlertTime = lastKnownProblemIds[eventId];
                if (now >= nextAlertTime) {
                    sendNotification(problem, notificationTimeout, customTags);
                    nextKnownProblemIds[eventId] = now + REMINDER_INTERVAL_MS;
                } else {
                    nextKnownProblemIds[eventId] = nextAlertTime;
                }
            }
        });

        await chrome.storage.local.set({ lastKnownProblemIds: nextKnownProblemIds });
        
        // Atualiza Badge apenas com contagem de problemas ATIVOS (não resolvidos)
        const activeCount = problems.filter(p => p.r_eventid === "0").length;
        updateBadge(activeCount, false);

        return problems.length;

    } catch (error) {
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
        },
        (id) => {
            if (id && timeoutSeconds > 0) {
                setTimeout(() => {
                    chrome.notifications.clear(id, (wasCleared) => {});
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
            chrome.storage.local.set({ isMonitoringActive: true });
        } else {
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
                checkZabbixAlerts(false).catch(error => {});
            }
        });
    }
});

// Nova função para buscar alertas SÓ para o popup (COM LÓGICA ROBUSTA DE HOST)
async function fetchZabbixAlertsForPopup() {
    try {
        const config = await new Promise(resolve => {
            // Inclui 'hostGroups' para o filtro.
            chrome.storage.local.get(['zabbixUrl', 'zabbixToken', 'selectedSeverities', 'hostGroups'], resolve);
        });

        const { zabbixUrl, zabbixToken, hostGroups } = config;

        if (!zabbixUrl || !zabbixToken) {
            throw new Error('URL ou Token do Zabbix não configurados.');
        }

        const apiUrl = zabbixUrl.endsWith('/api_jsonrpc.php') ? zabbixUrl : zabbixUrl.replace(/\/+$/, '') + '/api_jsonrpc.php';

        const severitiesToFetch = [0, 1, 2, 3, 4, 5];
        
        const hostGroupNames = hostGroups 
            ? hostGroups.split(',').map(name => name.trim()).filter(name => name.length > 0)
            : [];
            
        let hostGroupsToFetch = [];
        if (hostGroupNames.length > 0) {
            hostGroupsToFetch = await getGroupIdsFromNames(hostGroupNames, zabbixUrl, zabbixToken);
            if (hostGroupsToFetch.length === 0) {
                console.warn("Nenhum Host ID encontrado para os grupos especificados. Alerta desconsiderado.");
                return [];
            }
        }

        console.log('--- POPUP FETCH DEBUG ---');
        console.log('Host Group Names:', hostGroupNames);
            
        const params = {
            output: ['eventid', 'name', 'severity', 'objectid', 'object', 'clock', 'r_eventid', 'r_clock'], // r_eventid adicionado
            selectHosts: ['hostid', 'name', 'status', 'maintenance_status'], 
            recent: true, 
            severities: severitiesToFetch,
            sortfield: 'eventid',
            sortorder: 'DESC',
            limit: 50,
        };

        if (hostGroupsToFetch.length > 0) {
            params.groupids = hostGroupsToFetch;
        }

        const problemRequestBody = {
            jsonrpc: '2.0',
            method: 'problem.get',
            params: params,
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
            console.error('API Error Response:', data.error);
            throw new Error(`Erro na API Zabbix: ${data.error.message}. Verifique o Token.`);
        }
        
        let problems = data.result || [];
        
        // FILTRO 1: Hosts Inativos
        problems = problems.filter(problem => {
            if (!problem.hosts || problem.hosts.length === 0) return true; 
            const hostStatus = problem.hosts[0].status;
            const maintenanceStatus = problem.hosts[0].maintenance_status;
            // AQUI GARANTIMOS QUE SÓ SERÃO MANTIDOS HOSTS ATIVOS ('0') E FORA DE MANUTENÇÃO ('0')
            return (hostStatus === '0' && maintenanceStatus === '0'); 
        });

        // FILTRO 2: Item/Trigger Inativo (NOVO)
        problems = await filterProblemsByTriggerStatus(problems, zabbixUrl, zabbixToken);


        // PASSO 3: Processa os Hosts
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
            
            let displayName = hostName;
            if (!displayName || displayName === 'Erro na Busca Host' || displayName.startsWith('Host ID ')) {
                const nameParts = problem.name.split(':');
                displayName = (nameParts.length > 1) ? nameParts[0].trim() : 'Host Desconhecido';
            }

            problem.hostDisplayName = displayName; 

            return problem;
        }));
        
        // A lista 'problems' aqui contém apenas hosts/itens ativos e será enviada para o popup.
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
                sendResponse({ status: 'success', count: problemCount });
            })
            .catch(error => {
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

    if (request.action === 'fetchPopupAlerts') {
        // Quando o popup pede a lista, ele recebe a lista JÁ FILTRADA por esta função.
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

// 7. Configuração inicial
chrome.storage.local.get(['checkInterval', 'isMonitoringActive'], (data) => {
    const isInitiallyActive = data.isMonitoringActive !== false; 

    if (isInitiallyActive && data.checkInterval) {
        setupAlarm(data.checkInterval);
        checkZabbixAlerts(false).catch(error => {});
    } else if (!isInitiallyActive) {
        setupAlarm(0);
    } else {
        updateBadge(0);
    }
});