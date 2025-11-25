# 🚨 Zabbix Alert Notifier - Extensão Chrome

### 🌟 Visão Geral

O **Zabbix Alert Notifier** é uma extensão minimalista para o Google Chrome, desenvolvida para proporcionar **notificações *push* instantâneas** e monitoramento contínuo dos problemas ativos do seu ambiente Zabbix. Ele utiliza a API Zabbix para verificar problemas periodicamente, garantindo que alertas críticos (como Desastre e Alta) não sejam perdidos, mesmo quando a interface web não estiver aberta.

---

### ✨ Funcionalidades Principais

* 🔔 **Notificações *Push* Personalizadas:** Recebe alertas de problemas no desktop baseados na severidade e configurações definidas.
* 🔢 **Contador de Alertas Ativos (Badge):** Exibe o número atual de problemas no ícone da extensão.
* 🚫 **Prevenção de Duplicidade:** Armazena localmente os IDs de eventos para notificar apenas problemas novos, evitando alertas repetitivos mesmo após o reinício do navegador.
* 📋 **Lista de 50 Problemas Recentes:** Uma aba de visualização dedicada exibe os 50 problemas ativos mais recentes com severidade e horário, utilizando a **lógica robusta de busca do nome do Host**.
* 🔗 **Deep Linking:** Clicar em uma notificação ou em um item da lista abre o evento/problema diretamente na interface web do Zabbix.
* 🔍 **Filtragem por Severidade:** Permite configurar quais níveis de severidade (Desastre, Alta, Média, etc.) devem gerar notificações *push*.
* 🏷️ **Tags em Notificações:** Exibe valores de tags personalizadas (como `Local` ou `Responsável`) diretamente no corpo da notificação.
* ⏱️ **Intervalo Configurado:** Permite ajustar o intervalo de tempo para verificação periódica de novos alertas.

---

### 🛠️ Tecnologias Utilizadas

| Categoria | Tecnologia |
| :--- | :--- |
| **Plataforma** | Chrome Extension (Manifest V3) |
| **API de Comunicação** | Zabbix API (JSON-RPC) |
| **Linguagem Principal** | JavaScript (Vanilla JS) |
| **Armazenamento Local** | Chrome Storage API |

---

### 📦 Como Instalar e Rodar o Projeto

Como esta é uma extensão em desenvolvimento, a instalação é feita via **Modo Desenvolvedor** no Chrome.

#### Pré-requisitos

Certifique-se de ter instalado e configurado:

* Instalação Ativa do **Zabbix Server**.
* **Token de API Zabbix** com permissões para usar os métodos `problem.get`, `trigger.get` e `host.get`.

#### Instalação

1.  **Download:** Baixe ou clone o repositório completo.
2.  **Abrir Extensões:** No Google Chrome, navegue para `chrome://extensions`.
3.  **Modo Desenvolvedor:** Ative o botão **"Modo Desenvolvedor"** no canto superior direito.
4.  **Carregar Extensão:** Clique em **"Carregar sem compactação"** (Load unpacked).
5.  **Selecionar Pasta:** Selecione a pasta raiz do projeto (`zabbix_alert_notifier`).

A extensão será carregada e o ícone do Zabbix aparecerá na sua barra de extensões.

#### Configurações

1.  Clique no ícone do Zabbix na barra de extensões para abrir o *popup*.
2.  Na aba **"⚙️ Configuração"**, preencha os campos (URL e Token) e ajuste as severidades desejadas.
3.  Clique em **"💾 Salvar Configurações"**.
4.  Acesse a aba **"🚨 Alertas Ativos"** para visualizar os problemas recentes.

---
### 📦 Imagens
<img width="472" height="885" alt="image" src="https://github.com/user-attachments/assets/35aaff3f-98f6-4edb-b93e-65637cfa0d2d" />


<img width="487" height="882" alt="image" src="https://github.com/user-attachments/assets/ea4894b7-2bf3-42cb-854e-b220f644b2bd" />


<img width="583" height="910" alt="image" src="https://github.com/user-attachments/assets/ec16b1d8-b4d1-4598-8af8-4d9ad67e78c0" />


### 🤝 Contribuições

Sua contribuição é muito bem-vinda! Se você tiver sugestões, *bug reports* ou ideias de novas funcionalidades, siga os passos abaixo:

1.  Faça um **Fork** do projeto.
2.  Crie uma nova *branch* para sua funcionalidade:
    `git checkout -b feature/MinhaNovaFeature`
3.  Faça o **commit** das suas alterações:
    `git commit -m 'feat: Adiciona nova funcionalidade X'`
4.  Faça o **push** para a *branch*:
    `git push origin feature/MinhaNovaFeature`
5.  Abra um **Pull Request (PR)** detalhando as alterações.

---

### 📝 Licença

Este projeto está sob a licença **GPL v2 ou posterior**.

---

### 📞 Contato

WP Masters: [https://wpmasters.com.br](https://wpmasters.com.br)

Feito com ❤️ por **Thomas Marcelino**
