# OficinaPro

CRM MVP para oficinas mecânicas, com interface React e API REST em Express.

## Como executar

Abra dois terminais na pasta do projeto e execute:

```powershell
npm.cmd run server
npm.cmd run dev
```

- Frontend: `http://localhost:5173`
- API: `http://localhost:3001/api/health`

## Backend

O backend usa SQLite e cria automaticamente o banco em `data/oficina.db`. Já inclui um registro demonstrativo para uso imediato.

Rotas principais:

- `GET, POST /api/clients`
- `GET, POST /api/vehicles`
- `GET, POST /api/orders`
- `GET, PATCH /api/orders/:id`
- `POST /api/orders/:id/items`
- `POST /api/orders/:id/history`
- `GET, POST /api/reminders`
- `PATCH /api/reminders/:id/send`
- `POST /api/reminders/oil` — cria o lembrete inteligente de troca de óleo
- `GET /api/notifications/pending` — lista alertas vencidos por data ou km
- `POST /api/notifications/process` — cria a fila de envios
- `GET /api/notifications` e `POST /api/notifications/:id/send`
- `GET /api/dashboard`

As relações são garantidas por chaves estrangeiras: cliente → veículos → ordens de serviço → itens e histórico.

## WhatsApp e Instagram

O projeto já contém um gateway de mensagens em [server/messaging.js](server/messaging.js). Por padrão ele usa `MESSAGING_PROVIDER=mock`: registra as mensagens no CRM sem enviá-las para fora.

1. Copie `.env.example` para `.env` e preencha as credenciais da Meta.
2. Defina `MESSAGING_PROVIDER=whatsapp` para WhatsApp Cloud API ou `MESSAGING_PROVIDER=instagram` para Instagram Messaging API.
3. Cadastre no painel da Meta o endpoint `GET/POST /webhooks/meta` e use o mesmo `META_WEBHOOK_VERIFY_TOKEN`.

Rotas de mensageria:

- `POST /api/messages` — envia ou coloca uma mensagem na fila;
- `GET /api/messages?client_id=1` — histórico de conversa;
- `POST /api/messages/:id/retry` — reenvia mensagens com erro;
- `GET/POST /webhooks/meta` — valida e recebe webhooks da Meta.

WhatsApp usa o telefone do cliente. No Instagram, o destinatário é o ID de escopo do usuário fornecido pelo webhook/Graph API; não é possível iniciar mensagens arbitrárias a usuários do Instagram sem respeitar as regras da Meta.

## Lembretes de troca de óleo

Ao concluir uma troca de óleo, envie a quilometragem atual para `POST /api/reminders/oil`. A API calcula a próxima troca com os padrões de 10.000 km ou 180 dias, monta a mensagem com os dados do cliente e cria o lembrete. O processo de notificações identifica alertas vencidos por data **ou** quilometragem e os coloca numa fila auditável.

O canal WhatsApp está preparado como fila, mas o envio real exige credenciais de um provedor (WhatsApp Business API, Twilio ou Z-API). Nenhuma mensagem é enviada automaticamente para clientes sem essa integração.
