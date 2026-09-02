# 🚀 Nyellen Fashion — Guia de Produção

Este documento explica exatamente como levar o sistema da demonstração para produção:

variáveis de ambiente, criação segura do banco, build, execução e publicação online.

---

## 1. Conceitos importantes

- **`server/data/nyellen.db` é o banco DEMO** (desenvolvimento). Ele é criado automaticamente
  na primeira execução em modo demo, com produtos, clientes e vendas de exemplo.
- **Em produção o sistema NUNCA cria dados de demonstração**, mesmo que o banco esteja vazio.
- **O banco demo não deve ser usado em produção**: crie um banco de produção separado
  (seção 3) e aponte o ambiente para ele com `DB_PATH`.
- Todos os segredos vêm **do ambiente** (`server/.env` em dev ou variáveis do provedor em produção).
  Nada é gerado nem salvo em arquivos pelo servidor.

## 2. Variáveis de ambiente

Modelo: `server/.env.example` (copie para `server/.env`).

| Variável | Obrigatória | Descrição |
|---|---|---|
| `NODE_ENV` | sim | `development` ou `production` |
| `PORT` | não | Porta da API (padrão 3001) |
| `HOST` | não | Host (padrão `0.0.0.0`) |
| `JWT_SECRET` | **sim** | Assina os tokens (mín. 32 caracteres). Gerar: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `DB_PATH` | não | Caminho do banco SQLite. Vazio = `server/data/nyellen.db` (demo) |
| `DB_INIT` | não | `demo` (dev) ou `schema` (produção) |
| `CORS_ORIGIN` | sim* | Domínio(s) do frontend em produção, separados por vírgula (*em produção) |
| `PUBLIC_URL` | não | URL pública do sistema (links externos futuros) |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | só p/ `db:init` | Criação do usuário administrador do banco de produção |

> Em produção você pode usar um arquivo `server/.env.production` (ignorado pelo git);
> variáveis já definidas pelo provedor têm prioridade sobre o arquivo.
> O seed de demonstração é bloqueado sempre que `NODE_ENV=production`.

## 3. Criar o banco de produção (rotina segura)

Passo a passo de dentro da pasta do servidor:

```bash
# 1. Definir as credenciais do administrador (só para o primeiro uso)
#    em server/.env (ou variáveis do provedor):
#    ADMIN_EMAIL=admin@minhaloja.com
#    ADMIN_PASSWORD=uma-senha-forte

# 2. Apontar DB_PATH para um banco NOVO (nunca o demo):
#    DB_PATH=C:/dados/nyellen-producao.db      (Windows)
#    DB_PATH=/var/lib/nyellen/nyellen.db       (Linux)

# 3. Criar o banco (schema + usuário admin)
npm run db:init

# Saída esperada:
#   [db:init] Banco: <caminho-do-banco>
#   [db:init] Schema verificado/criado (idempotente).
#   [db:init] Usuário administrador criado: admin@minhaloja.com
#   [db:init] Banco de produção pronto.
```

Comportamentos de segurança do `db:init`:

- **nunca** executa seed demo em produção (`NODE_ENV=production` → aborta);
- se já existir usuário, não faz nada (idempotente);
- recusa `ADMIN_EMAIL` inválido ou `ADMIN_PASSWORD` com menos de 6 caracteres;
- a senha é gravada apenas como hash bcrypt (nunca em texto puro).

Desenvolvimento (recriar demo):

```bash
npm run db:init:demo       # cria schema + dados demo (só quando não houver usuários)
```

Recomendação: na primeira inicialização em produção, rode o servidor uma vez com o banco
vazio **sem** `db:init` — ele avisará no log que não há usuário; aí execute `db:init`
com o `.env` correto. Backup do arquivo do banco = backup de todos os dados.

## 4. Build de produção

```bash
# Da raiz do projeto (web + api)
npm run build

# Ou separado
npm run build:web     # web/dist (React, pronto para servir como estático)
npm run build:api     # server/dist (API compilada)
```

O build da API gera `server/dist/` (Node 20+). Não é necessário instalar dependências no servidor
a partir do dist: basta rodar `npm install` no servidor com o código completo.

## 5. Como iniciar

**Desenvolvimento** (raiz):

```bash
npm install            # dependências
npm run dev            # API :3001 + front :5173 (Vite com proxy)
```

**Produção** (servidor Linux — ex.: Ubuntu + Node 20):

```bash
cd /opt/nyellen
npm ci                    # instala as versões exatas
npm run build             # web/dist + server/dist

# Definir ambiente
cp server/.env.example server/.env   # e preencha os valores (seção 2)
# (ou exporte como variáveis reais / .env.production)

# Criar banco de produção (seção 3)
npm run db:init

# Iniciar a API (compilada)
npm run start:api:prod
```

Servir o frontend com qualquer servidor estático apontando para `web/dist`
(ex.: Nginx — seção 6).

## 6. Como colocar online (domínio próprio + HTTPS)

Arquitetura recomendada:

```
Internet → DNS (domínio) → Nginx/Caddy (HTTPS) → front estático (web/dist)
                                                → API (node :3001, via proxy reverso /api)
```

1. **Domínio**: registre/aponte o DNS (ex.: `loja.seudominio.com`) para o IP do servidor.
2. **HTTPS**: use Certbot (Let's Encrypt) com Nginx ou Caddy (HTTPS automático).
3. **Nginx** (exemplo):

```nginx
server {
  listen 80;
  server_name loja.seudominio.com;

  root /opt/nyellen/web/dist;
  index index.html;

  # SPA: repassa as rotas do frontend para o index
  location / {
    try_files $uri $uri/ /index.html;
  }

  # API: proxy reverso
  location /api/ {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Real-IP $remote_addr;
  }
}
```

4. **Supervisão**: `pm2 start server/dist/index.js --name nyellen-api` (ou systemd).
5. **CORS**: defina `CORS_ORIGIN=https://loja.seudominio.com` no `.env` da produção.
6. **Firewall/hosting**: libere apenas 80/443 para o público; a API fica interna.

> Como o front (à frente do Nginx) e a API ficam no mesmo domínio, as requisições
> `/api` são same-origin e o CORS nem chega a ser exigido pelo navegador — mesmo assim,
> defina `CORS_ORIGIN` como defensa em profundidade.

## 7. Próximos passos preparados (ainda NÃO ativos)

O código já está arquitetado para, sem reescrita:

- **PostgreSQL/Supabase**: toda consulta vive em `server/src/db.ts` e nas rotas; troque o
  `better-sqlite3` por um cliente `pg`/Supabase e aponte `DATABASE_URL` (variáveis reservadas
  no `.env.example`).
- **Armazenamento de imagens**: produtos e logo já guardam **URLs externas**; basta hospedar
  as imagens (ex.: Supabase Storage) e colar a URL. Diretório `server/uploads/` já está
  reservado no `.gitignore` para futuros uploads locais.
- **WhatsApp API**: o botão usa `wa.me` (link oficial); o ponto de troca para a API oficial
  está isolado em `web/src/lib/whatsapp.ts` — credenciais iriam para `server/.env`.

## 8. Checklist final antes de publicar

- [ ] `JWT_SECRET` forte e único (nunca o do demo)
- [ ] `DB_PATH` apontando para banco de produção (não o demo)
- [ ] Admin criado com `npm run db:init` (senha forte)
- [ ] `CORS_ORIGIN` definido em produção
- [ ] `npm run build` sem erros
- [ ] `npm run start:api:prod` subindo; `GET /api/health` → `{"ok":true,...}`
- [ ] HTTPS ativo; front + API no mesmo domínio (ou CORS configurado)
- [ ] Backups programados do arquivo do banco

## 9. Railway (publicação guiada)

O sistema foi verificado para o Railway. Pré-requisitos técnicos já atendidos pelo código:

- o servidor escuta em **0.0.0.0** (variável `HOST`, padrão `0.0.0.0`);
- usa a variável **`PORT`** fornecida pelo Railway automaticamente (padrão 3001 se ausente);
- `npm run build` compila web (`web/dist`) + API (`server/dist`);
- `npm run start:api:prod` roda a API compilada (`node dist/index.js`).

### Arquitetura recomendada (2 serviços + 1 volume)

```
Frontend (Railway static)  ──VITE_API_URL──▶  Backend (Railway web, Node)
   web/dist                                     server/dist (API :3001)
                                                        │ DB_PATH
                                                        ▼
                                               Volume persistente /data
                                                 (arquivo nyellen.db)
```

O frontend acessa a API por **URL configurável** (`VITE_API_URL`, compilada no bundle;
vazia = mesmo domínio). Como os nomes dos domínios `.up.railway.app` só existem após o
deploy, o fluxo recomendado é: criar o backend primeiro, copiar a URL dele para o frontend.

### Passo a passo

**Serviço 1 — Backend (API)**

1. Novo projeto Railway → novo serviço → **Deploy do repositório** (pasta raiz, Node 20+).
2. **Start Command**: `npm run start:api:prod`
3. **Health Check Path**: `/api/health` (o sistema já responde `{"ok":true,...}`).
4. **Variáveis** (Settings → Variables):

   | Variável | Valor |
   |---|---|
   | `NODE_ENV` | `production` |
   | `JWT_SECRET` | valor forte (≥32 caracteres) — NUNCA o do desenvolvimento |
   | `DB_PATH` | `/data/nyellen.db` |
   | `CORS_ORIGIN` | URL do frontend (passo 2, ex.: `https://seu-front.up.railway.app`) |
   | `ADMIN_EMAIL` | e-mail do administrador (usada só no primeiro `db:init`) |
   | `ADMIN_PASSWORD` | senha forte do administrador (usada só no primeiro `db:init`) |

   > `PORT` e `HOST` não precisam ser definidas: o Railway injeta `PORT` e o padrão já é `0.0.0.0`.

5. **Volume persistente**: no serviço, `Volumes > Mount` → path **`/data`**.
   É o único jeito de o SQLite sobreviver a redeploys. O banco demo (`server/data/nyellen.db`)
   **não** é usado: com `DB_PATH=/data/nyellen.db` o sistema abre um arquivo novo e vazio na
   primeira execução (schema criado automaticamente, **sem** dados de demonstração).
6. Deploy → depois, no terminal do serviço (Railway shell) ou via CLI, crie o administrador:
   ```bash
   npm run db:init
   # saída esperada:
   # [db:init] Banco: /data/nyellen.db
   # [db:init] Usuário administrador criado: <ADMIN_EMAIL>
   # [db:init] Banco de produção pronto.
   ```
   (Esse comando usa `ADMIN_EMAIL`/`ADMIN_PASSWORD` do ambiente do serviço e é idempotente.)
   Se o deploy anterior já tiver sido feito sem o admin, o log mostrará o aviso de usuário
   ausente — rode `db:init` e reinicie o serviço.

   > **Se o `db:init` reclamar que `DB_PATH` não está definido**: as variáveis do serviço não
   > chegaram ao processo (ex.: o comando foi rodado em outro serviço/shell, ou as variáveis
   > foram criadas depois do deploy). O sistema **aborta** nesse caso em vez de criar o banco
   > no caminho padrão efêmero (`/app/server/data/nyellen.db`), que se perderia no redeploy.
   > Verifique o início do log — `[db:init] DB_PATH do ambiente: ...` e o status de
   > `ADMIN_EMAIL`/`ADMIN_PASSWORD` — e rode o comando no **Railway shell do próprio serviço**
   > (Settings → shell), que herda as variáveis do ambiente do deploy atual.

   > O mesmo vale para a API: a partir desta mudança, `NODE_ENV=production` **sem** `DB_PATH`
   > faz o servidor abortar na inicialização com instruções claras — nenhum deploy vai mais
   > criar silenciosamente um banco invisível dentro do container.

**Serviço 2 — Frontend (estático)**

1. Novo serviço → **Static** (ou web service com a pasta `web`).
2. **Build Command**: `npm run build`  →  **Output Directory**: `dist`
   (a configuração do Vite já gera `web/dist`; aponte para essa pasta).
3. **Variável**:

   | Variável | Valor |
   |---|---|
   | `VITE_API_URL` | URL pública do backend (passo 1, ex.: `https://seu-backend.up.railway.app`) |

   > `VITE_*` é compilada no bundle (é pública por natureza — não coloque segredos aí).

3. Após o deploy, atualize `CORS_ORIGIN` no backend com a URL final do frontend e reinicie
   o serviço de backend.

### Observações Railway

- **Sessões**: trocar `JWT_SECRET` invalida os logins de todos (comportamento esperado).
- **Backups**: faça backup do volume `/data/nyellen.db` (conteúdo = todos os dados).
- **Domínio próprio**: aponte um domínio customizado nos dois serviços (ou só no frontend,
  mantendo `VITE_API_URL` e `CORS_ORIGIN` atualizadas com o domínio final).
- **Banco demo**: o arquivo `server/data/nyellen.db` do repositório é usado apenas em
  desenvolvimento (`DB_INIT=demo`). Em `NODE_ENV=production` o seed de demonstração é
  bloqueado pelo código e a execução **aborta sem `DB_PATH`** (nunca usa o caminho padrão).