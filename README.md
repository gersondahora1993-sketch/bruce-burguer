# 👗 Nyellen Fashion — Sistema de Gestão

Sistema completo de gestão para loja de roupas: produtos, variações (cor + tamanho com estoque individual), estoque com movimentações, vendas com baixa automática, clientes, relatórios, dashboard e WhatsApp.

## Stack

| Camada | Tecnologia |
|---|---|
| Frontend | React 18 + TypeScript + Vite + Tailwind CSS 4 + Recharts |
| API | Node + Express + TypeScript (tsx) |
| Banco de dados | SQLite (`better-sqlite3`, arquivo em `server/data/nyellen.db`) |
| Autenticação | JWT (senhas com bcrypt) |

> **Sobre o Supabase:** a arquitetura é toda separada entre camada de API (`server/src/routes`) e UI (`web/src`). Para migrar ao Supabase, basta trocar os `db.prepare(...)` do servidor por queries do Supabase — nenhuma credencial está embutida no frontend. Onde as credenciais seriam adicionadas: `server/.env` (substituindo o SQLite) e `web/.env` apenas para itens públicos (como `VITE_SUPABASE_URL`).

> **Ambiente:** o servidor lê toda a configuração de `server/.env` (copie `server/.env.example`); segredos nunca ficam no código nem são gerados em arquivos. Produção: veja **[`docs/PRODUCAO.md`](docs/PRODUCAO.md)**.

## Como rodar

Pré-requisito: Node.js 20+.

```bash
# 1. Instalar dependências (web + server + raiz)
npm run setup

# 2. Preparar o ambiente (gera o secret se não existir)
#    Copie server/.env.example para server/.env e preencha JWT_SECRET
#    (gerar: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")

# 3. Subir API e frontend juntos (ou em terminais separados)
npm run dev
```

- Frontend: http://localhost:5173
- API: http://localhost:3001 (health em `/api/health`)

Separados:

```bash
npm run dev:api   # API na porta 3001
npm run dev:web   # Frontend na porta 5173 (com proxy para a API)
```

## Acesso inicial

| Campo | Valor |
|---|---|
| E-mail | `admin@nyellen.com` |
| Senha | `admin123` |

O banco `server/data/nyellen.db` é o **banco DEMO**, criado automaticamente na primeira
execução **em desenvolvimento** (`DB_INIT=demo`). Em produção o seed de demonstração é
**sempre bloqueado**; o banco de produção é criado com `npm run db:init`
(detalhes em `docs/PRODUCAO.md`). Para recomeçar a demo do zero, apague a pasta
`server/data` e reinicie a API — confirme antes se não há dados que queira manter.

## Funcionalidades

- **Autenticação** com proteção de rotas e controle de acesso (papéis preparados para admin, gerente e vendedor)
- **Dashboard** com indicadores e gráficos (vendas por período, mais vendidos, estoque por categoria)
- **Produtos** com pesquisa, filtros (categoria, cor, tamanho), ordenação, ativar/desativar e exclusão protegida
- **Variações**: grade de cor × tamanho com estoque individual por combinação
- **Estoque**: estoque atual, entrada, saída, ajuste manual, histórico de movimentações e alertas visuais (sem estoque / baixo)
- **Vendas**: carrinho completo, seleção de cliente, 4 formas de pagamento, baixa automática do estoque da variação exata e botão **"Enviar pedido pelo WhatsApp"** com mensagem montada automaticamente
- **Clientes** com cadastro completo e busca
- **Relatórios** com filtros por período, categoria, produto e pagamento + exportação CSV
- **Categorias, Cores e Tamanhos** (CRUD completo com ativar/desativar)
- **Configurações**: dados da loja (nome, logo, telefone, WhatsApp, Instagram, endereço, cidade, estado, CEP e horário de funcionamento), perfil do usuário e troca de senha
- **Responsivo**: menu lateral no desktop, bottom nav + menu drawer no celular

## Estrutura

```
nyellen-fashion/
├─ server/            # API Express + SQLite
│  └─ src/
│     ├─ index.ts     # bootstrap
│     ├─ db.ts        # schema + seed de demonstração
│     ├─ auth.ts      # JWT + middleware de proteção
│     └─ routes/      # uma rota por recurso
└─ web/               # Frontend React + Vite + Tailwind
   └─ src/
      ├─ api/         # client HTTP (token, erros amigáveis)
      ├─ components/  # UI reutilizável + layout + editor de variações
      ├─ context/     # Auth e Toasts
      ├─ lib/         # formatação e integração WhatsApp
      └─ pages/       # uma página por módulo
```

## Segurança

- Senhas com bcrypt e token JWT com expiração (12h)
- Nenhuma senha/chave no frontend
- Validação de formulários no cliente e no servidor
- Transações no banco para vendas e estoque (integridade)
- Exclusões protegidas quando há vendas registradas

## Integração futura (WhatsApp / Supabase)

- **WhatsApp**: em `web/src/lib/whatsapp.ts`, troque a função `sendOrderWhatsApp` (hoje usa o link oficial `wa.me`, sem API inventada) pela API oficial do WhatsApp Business ou provedor. As credenciais devem ir para `server/.env`. O número usado é o cadastrado em **Configurações → Dados da loja → WhatsApp**.
- **Supabase**: estrutura pronta; as credenciais iriam em `server/.env` (service role) e nunca no código do frontend.

## Produção

Guia completo (banco de produção, `.env`, build, HTTPS, domínio): **[`docs/PRODUCAO.md`](docs/PRODUCAO.md)**.