# Tech Challenge 5 — Documentação do Sistema

**Projeto:** Resolve Aí — Plataforma de Gestão de Ocorrências
**Nome:** Diogo Santos Oliveira
**Grupo:** Grupo 27

---

## 1. Visão geral

Esta documentação descreve a arquitetura por trás do projeto **Resolve Aí**, uma plataforma
cujo objetivo é possibilitar a abertura e o acompanhamento de ocorrências que acontecem
dentro de um condomínio.

Hoje a comunicação dentro dos condomínios está dividida em vários meios: grupos de WhatsApp,
e-mail e até mesmo conversas informais. Nada disso deixa rastro: não há uma visão geral de
todos os problemas abertos, não há como saber quem ficou responsável por cada um e não há
critério para decidir o que deve ser resolvido primeiro. Quando alguém pergunta "e aquele
vazamento da garagem?", a resposta depende da memória de quem estava na conversa.

O Resolve Aí substitui esse fluxo informal por um registro estruturado. O **solicitante**
abre uma ocorrência com título, descrição, categoria, localização e imagens; acompanha o
andamento, comenta e avalia a resolução no final. O **gestor** enxerga todas as ocorrências,
filtra, prioriza, atribui um responsável, conduz a ocorrência pelo ciclo de vida e acompanha
indicadores em um painel. Toda mudança relevante fica registrada em um histórico que não pode
ser reescrito.

O escopo entregue é um **MVP full stack completo**: domínio, backend, API, banco de dados,
frontend, testes, Docker, deploy em nuvem e documentação.

## 2. Código fonte

O projeto está dividido em dois repositórios:

| Repositório | Conteúdo |
| --- | --- |
| [`tc_fase05`](https://github.com/diogo-oliveira44/tc_fase05) | Backend — API REST, domínio, banco de dados e infraestrutura |
| [`tc_fase05_front`](https://github.com/diogo-oliveira44/tc_fase05_front) | Frontend — aplicação React servida por Bun |

A separação foi deliberada: são dois artefatos com ciclos de build, imagens Docker e revisões
de deploy independentes. Manter os dois no mesmo repositório obrigaria a publicar o front toda
vez que uma regra do domínio mudasse.

Documentos complementares, no repositório do backend:

- [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) — arquitetura em detalhe e decisões de projeto;
- [`docs/API_PLAN.md`](API_PLAN.md) — plano da API e estrutura-alvo dos módulos;
- [`docs/DEPLOY.md`](DEPLOY.md) — publicação no Azure Container Apps;
- [`openapi.json`](../openapi.json) — contrato completo da API, navegável em `/docs`;
- [`TODO.md`](../TODO.md) — backlog derivado do fluxo de solicitantes e gestores.

## 3. Objetivo

Desenvolver uma aplicação full stack completa, do entendimento do domínio até a publicação em
ambiente cloud, capaz de sustentar o ciclo de vida inteiro de uma ocorrência.

Em termos concretos, o sistema precisa:

1. **Autenticar e separar perfis** — solicitantes se cadastram sozinhos; gestores são criados
   por um administrador. Cada perfil enxerga apenas o que lhe compete.
2. **Registrar ocorrências com contexto** — título, descrição, categoria, endereço,
   coordenadas opcionais e até 5 imagens.
3. **Conduzir a ocorrência por uma máquina de estados explícita** — `aberta`, `em análise`,
   `em atendimento`, `resolvida` e `cancelada`, com transições validadas em um único ponto do
   domínio.
4. **Manter uma trilha de auditoria imutável** — toda mudança de status grava status anterior,
   novo status, data/hora, usuário responsável e observação, na mesma transação da alteração.
5. **Dar visão gerencial** — filtros combináveis, priorização, atribuição de responsável e um
   painel com indicadores.
6. **Rodar igual em qualquer lugar** — Docker localmente, containers na nuvem, sem diferença
   de código entre os dois.

## 4. Arquitetura do sistema

Dois serviços independentes, um banco relacional e um volume para as imagens.

```
┌────────────────────┐     /api/*      ┌──────────────────────┐
│  resolveai-front   │ ──────────────► │    resolveai-api     │
│  React 19 + Bun    │                 │  Express 5 + node-pg │
│  :3001             │ ◄────────────── │  :3000               │
└────────────────────┘                 └───────┬──────────────┘
      (repositório                             │
       tc_fase05_front)                        ├──► PostgreSQL 18
                                               │    (schema, triggers de auditoria)
                                               └──► UPLOAD_DIRECTORY
                                                    (volume local / Azure Files)
```

O ponto não óbvio desse desenho: o servidor Bun do front **serve o bundle React e faz proxy de
`/api/*` para a API**. O navegador fala sempre com uma única origem, então não existe preflight
de CORS no caminho normal — o que evita toda uma classe de problema com `PATCH` e com o header
`X-File-Name` usado no upload. Chamar a API direto de outra origem também funciona: ela libera
esses dois para o domínio configurado em `CORS_ORIGIN`.

### 4.1 Componentes principais

#### Camada de aplicação (frontend — `tc_fase05_front/src`)

- **`index.html`**: a página que é aberta pelo navegador. É o ponto central da aplicação React e
  contém o elemento root onde o app é montado. Vai junto no build — esquecê-la no deploy quebra
  a aplicação inteira.
- **`index.ts`**: o servidor Bun. Serve o `index.html` para qualquer rota não casada (o roteamento
  é do lado do cliente) e repassa `/api/*` para `API_URL`. Quando a API está fora do ar, devolve
  um `502` com o mesmo envelope de erro da API, de modo que o front não precisa tratar dois
  formatos diferentes.
- **`frontend.tsx`**: pega o elemento root do HTML e renderiza o componente `App`.
- **`App.tsx`**: a raiz do projeto React. Decide, a partir do `pathname` e do papel do usuário,
  qual página renderizar. Visitantes não autenticados mantêm a URL que digitaram, e caem nela
  depois do login.
- **`router.tsx`**: um roteador próprio, em ~50 linhas, sobre a History API — `navigate`,
  `useLocation`, `Link` e `Redirect`. O app tem cinco rotas; uma biblioteca de roteamento seria
  mais dependência do que benefício.
- **`index.css`**: os estilos compartilhados da aplicação. Em vez de repetir o código — por
  exemplo, o de um botão em todos os componentes — ele fica centralizado aqui.
- **`components/`**: os componentes renderizados isoladamente na tela. São itens reutilizáveis,
  que existem para resolver um problema isolado: `Layout` (a moldura com cabeçalho e navegação),
  `ui.tsx` (botões, campos, estados de carregamento e vazio), `FileThumbnail` e, em
  `components/incident/`, as seções da página de ocorrência — `Attachments`, `Comments`,
  `History`, `ManagerActions` e `RatingForm`.
- **`pages/`**: são as páginas completas, não reutilizáveis. Cada uma é literalmente uma tela
  renderizada, onde se encontram vários componentes: `LoginPage`, `RegisterPage`,
  `IncidentListPage`, `NewIncidentPage`, `IncidentDetailPage` e `DashboardPage`.
- **`api/`**: o cliente HTTP. `client.ts` concentra o envio, a renovação automática do access
  token pelo refresh token e a tradução dos erros; `endpoints.ts` expõe as chamadas como funções;
  `types.ts` guarda os tipos do contrato.
- **`auth/AuthContext.tsx`**: o contexto de autenticação — usuário corrente, papel, login e
  logout — consumido por `App.tsx` e pelas páginas.
- **`lib/`**: formatação de datas e números, rótulos em pt-BR para status, prioridades e
  categorias, o hook `useAsync` e os utilitários de imagem.

#### Camada de API (backend — `tc_fase05/src`)

```
src/
  server.ts              listen + shutdown gracioso (SIGTERM/SIGINT, pool.end)
  app.ts                 createApp(pool, config) — só fiação: middlewares e montagem
  config.ts              loadConfig(env): porta, TTLs, CORS, limites de upload, SLA
  shared/
    db.ts                Queryable e transaction(pool, work) — BEGIN/COMMIT/ROLLBACK
    errors.ts            AppError, notFound, errorHandler (envelope padrão)
    http.ts              Deps, securityHeaders, cors
    observability.ts     requestLogger: X-Request-Id e log estruturado por requisição
    tokens.ts            JWT HS256 sobre WebCrypto + hash de refresh token
    validation.ts        object/string/uuid/oneOf na borda
  modules/<módulo>/
    routes.ts            create<Módulo>Router(deps): caminhos, status e forma da resposta
    service.ts           regras e transações (só onde há decisão a tomar)
    repository.ts        todo o SQL do módulo
    domain.ts            regras puras (hoje em incidents)
```

Os módulos são `auth`, `users`, `categories`, `incidents`, `comments`, `attachments`, `ratings`,
`dashboard` e `platform` (health, `/openapi.json` e `/docs`). Cada um exporta uma fábrica de
`Router` que recebe `{ pool, config }` e declara o caminho completo da rota — `app.ts` apenas
monta todos no mesmo prefixo. `auth/middleware.ts` concentra `authenticate`, `requireManager` e
`requireAdmin`.

`createApp` recebe `pool` e `config` por parâmetro em vez de importá-los. É isso que permite aos
testes de integração subirem a aplicação real numa porta efêmera contra um banco de teste isolado.

Toda falha sai no mesmo envelope, e o front decide pelo `code`, nunca pela mensagem:

```json
{ "error": { "code": "VERSION_CONFLICT", "message": "…", "details": [], "requestId": "…" } }
```

#### Camada de dados (`tc_fase05/db`)

- **`pool.ts`**: cria o `Pool` conforme o ambiente (`NODE_ENV` escolhe entre `tc_db_dev`,
  `tc_db_test` e `tc_db_prod`), com TLS opcional para o Azure.
- **`migrate.ts`**: migrations versionadas e idempotentes. Controla o que já rodou na tabela
  `schema_migrations` e serializa execuções concorrentes com `pg_advisory_lock` — duas réplicas
  subindo ao mesmo tempo não colidem.
- **`seed.ts`**: cria o gestor e o administrador iniciais, com `ON CONFLICT DO UPDATE`.
- **`migrations/*.sql`**: schema, constraints, triggers e as categorias iniciais.

### 4.2 Rotas

#### Rotas do frontend

| Rota | Quem acessa | O que faz |
| --- | --- | --- |
| `/login` | visitante | Autenticação. |
| `/register` | visitante | Cadastro de solicitante. |
| `/` | ambos | Lista de ocorrências. O solicitante vê as próprias; o gestor vê todas, com filtro "atribuídas a mim". |
| `/incidents/new` | solicitante | Registro de uma nova ocorrência, com categoria, endereço, coordenadas (inclusive pela geolocalização do navegador) e até 5 imagens. |
| `/incidents/:id` | ambos | Detalhe: dados, imagens, comentários, linha do tempo, ações do gestor e avaliação. |
| `/dashboard` | gestor | Painel de indicadores. |

Rotas fora do papel do usuário caem na página "não encontrada" — o front não exibe um caminho
que a API recusaria.

#### Endpoints da API

Prefixo `/api/v1`. Contrato completo em `openapi.json`, navegável em `/docs`.

| Recurso | Endpoints |
| --- | --- |
| Autenticação | `POST /auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `GET /me` |
| Apoio | `GET /categories`, `GET /users?role=manager` (gestor/admin), `POST /users/managers` (admin) |
| Ocorrências | `POST /incidents`, `GET /incidents` (filtros, ordenação e paginação), `GET /incidents/{id}` |
| Acompanhamento | `GET /incidents/{id}/history`, `GET`/`POST /incidents/{id}/comments` |
| Imagens | `GET`/`POST /incidents/{id}/attachments`, `GET /incidents/{id}/attachments/{attachmentId}` |
| Avaliação | `GET`/`POST /incidents/{id}/rating` |
| Gestão | `PATCH /incidents/{id}/priority`, `PATCH /incidents/{id}/assignee`, `POST /incidents/{id}/transitions` |
| Indicadores | `GET /dashboard/summary` |
| Plataforma | `GET /health`, `GET /openapi.json`, `GET /docs` |

`GET /incidents` aceita `status`, `priority`, `categoryId`, `assigneeId`, `createdFrom`,
`createdTo`, `sort`, `page` e `pageSize`. Os filtros são combináveis e a resposta permanece
paginada de forma consistente.

### 4.3 Banco de dados

PostgreSQL 18. O schema não confia apenas na aplicação: as regras que não podem ser violadas
estão no próprio banco.

| Tabela | Papel |
| --- | --- |
| `users` | contas, com `role` (`requester`, `manager`, `admin`) e `active` |
| `refresh_tokens` | refresh tokens em SHA-256, com expiração |
| `categories` | categorias evolutivas, sem alteração de código |
| `incidents` | a ocorrência, com `status`, `priority`, localização, solução e `version` |
| `comments` | comentários vinculados ao autor e à ocorrência |
| `attachments` | imagens, com MIME e tamanho validados |
| `status_history` | transições de status **(append-only)** |
| `priority_history` | mudanças de prioridade **(append-only)** |
| `assignment_history` | atribuições e reatribuições **(append-only)** |
| `ratings` | uma avaliação por ocorrência, só do dono e só se resolvida |

Constraints que valem citar:

- `resolution_fields_match_status` — `resolved` exige `solution`, `resolved_by` e `resolved_at`;
  qualquer outro status exige os três nulos. Não existe ocorrência resolvida sem solução
  documentada, nem por caminho alternativo.
- `enforce_incident_users` — o solicitante precisa ser um `requester` ativo; responsável e
  resolvedor, `manager` ativo.
- `enforce_rating` — só o dono de uma ocorrência resolvida avalia, e `incident_id` é `UNIQUE`.
- `attachments` — MIME na allowlist (`image/jpeg`, `image/png`, `image/webp`) e tamanho ≤ 5 MB.
  O limite de **quantidade** (5 imagens) é aplicado no front, em `src/lib/images.ts`; tipo e
  tamanho são garantidos pelo banco, que é onde não dá para contornar.
- `status_history` — observação obrigatória quando o novo status é `cancelled`.

Há índices para solicitante, status, categoria, prioridade, responsável e data de criação — as
combinações que a listagem e o painel realmente usam.

**Concorrência.** Cada ocorrência tem uma coluna `version`. Prioridade, responsável e transições
exigem a versão lida pelo cliente, travam a linha com `SELECT … FOR UPDATE` e incrementam a
versão. Dois gestores alterando a mesma ocorrência ao mesmo tempo: um vence, o outro recebe
`409 VERSION_CONFLICT` e recarrega — em vez de sobrescrever silenciosamente.

**Autenticação.** Access token JWT HS256 de 15 minutos, assinado com WebCrypto. Refresh token de
30 dias, guardado como SHA-256 e **rotativo**: usar um token o revoga e emite outro; reutilizar o
antigo devolve `401`. Senhas em Argon2id (`Bun.password`). Cada request revalida que o usuário
continua ativo, então desativar uma conta invalida os tokens em circulação.

### 4.4 Infraestrutura

O projeto pode ser executado com **Docker**:

- `api`: container da aplicação Bun + Express;
- `db`: container do PostgreSQL 18, com healthcheck;
- volumes: `pg_data` para o banco e `uploads` para as imagens.

```bash
cp .env.example .env     # defina JWT_SECRET, MANAGER_PASSWORD e ADMIN_PASSWORD
docker compose up --build
```

O container aguarda o PostgreSQL ficar saudável, aplica as migrations, cria o gestor inicial e
sobe na porta `3000`. Para a interface, suba também o `docker compose up` de `tc_fase05_front`.

| | Endereço |
| --- | --- |
| Front-end | http://localhost:3001 |
| API | http://localhost:3000/api/v1 |
| Swagger | http://localhost:3000/docs |
| Health check | http://localhost:3000/health |

Os dois repositórios estão em projetos Compose separados. O front alcança a API pela porta
publicada no host (`host.docker.internal:3000`), o que dispensa criar uma network externa
compartilhada e mantém cada repositório executável sozinho.

As migrations rodam pelo entrypoint da imagem (`scripts/start.sh`), **antes** de o servidor
aceitar tráfego — o mesmo caminho em desenvolvimento e em produção.

## 5. Perfis e responsabilidades

| | Solicitante (`requester`) | Gestor (`manager`) |
| --- | --- | --- |
| Origem da conta | cadastro público | administrador via API ou seed (`db/seed.ts`) |
| Ocorrências | só as próprias | todas |
| Pode | criar conta, autenticar-se, registrar ocorrência (título, descrição, categoria, localização, imagem), acompanhar o andamento, comentar, consultar o histórico e avaliar a resolução | visualizar todas, filtrar por categoria/status/prioridade, alterar prioridade, atribuir responsável, atualizar o status, comentar, registrar a solução aplicada e visualizar o dashboard |

Uma decisão que vale explicitar: quando um solicitante pede uma ocorrência que não é dele, a API
responde **404**, não 403. Um 403 confirmaria que aquele identificador existe.

O **administrador** (`admin`) é provisionado pelo seed com `ADMIN_EMAIL` e `ADMIN_PASSWORD`. Ele
lista usuários e cria gestores por `POST /users/managers`, mas não acessa ocorrências nem herda
as permissões de gestor. Existe porque "quem cria um gestor?" não podia ser respondido com
"qualquer um que se cadastre".

## 6. Ciclo de vida da ocorrência

```
                    ┌──────────────┐
                    │    aberta    │
                    └──────┬───────┘
                           ▼
                    ┌──────────────┐
                    │  em análise  │
                    └──────┬───────┘
                           ▼
                    ┌──────────────┐        ┌──────────────┐
                    │em atendimento│───────►│   resolvida  │  (exige solução)
                    └──────┬───────┘        └──────┬───────┘
                           │                       ▼
                           │                 avaliação do
                           │                  solicitante
                           ▼
                    ┌──────────────┐
                    │  cancelada   │  (exige observação; também a partir de
                    └──────────────┘   "aberta" e "em análise")
```

São **exatamente seis** transições válidas:

| Ação | De | Para | Exige |
| --- | --- | --- | --- |
| Analisar | aberta | em análise | — |
| Iniciar atendimento | em análise | em atendimento | — |
| Concluir | em atendimento | resolvida | solução |
| Cancelar | aberta | cancelada | observação |
| Cancelar | em análise | cancelada | observação |
| Cancelar | em atendimento | cancelada | observação |

`resolvida` e `cancelada` são estados finais. As regras vivem em
`src/modules/incidents/domain.ts`, num único ponto que nenhuma rota contorna: qualquer tentativa
de transição fora dessa tabela devolve `409 INVALID_STATUS_TRANSITION`.

### Fluxo geral

1. O solicitante se cadastra e autentica.
2. Registra a ocorrência — título, descrição, categoria, endereço, coordenadas opcionais e até
   5 imagens. Ela nasce `aberta` com prioridade `média`, e a criação já entra no histórico como
   `null → aberta`.
3. O gestor localiza a ocorrência na listagem, ajusta a prioridade e atribui um responsável,
   ambos com justificativa obrigatória.
4. O gestor conduz a ocorrência: **analisar** → **iniciar atendimento** → **concluir**, ou
   **cancelar** a partir de qualquer estado não final.
5. Solicitante e gestor conversam por comentários ao longo de todo o processo.
6. Concluída a ocorrência com a solução documentada, o solicitante avalia — nota de 1 a 5 e
   comentário opcional, uma única vez.

### Histórico e auditoria

Toda mudança de status grava, **na mesma transação** da alteração, os cinco campos exigidos:

- status anterior;
- novo status;
- data e horário;
- usuário responsável;
- observação da alteração.

Se a gravação do histórico falhar, a mudança de status não acontece — não existe estado alterado
sem rastro.

Prioridade e atribuição têm tabelas equivalentes, com justificativa obrigatória. As três tabelas
de histórico são **append-only**: um trigger `BEFORE UPDATE OR DELETE` levanta exceção. Nem a
aplicação nem uma conexão administrativa conseguem reescrever a trilha.

`GET /incidents/{id}/history` devolve as três em uma linha do tempo única e ordenada, que é o
que a tela de detalhe exibe.

## 7. Testes

| Camada | Onde | O que cobre |
| --- | --- | --- |
| Unidade | `spec/unit/` | máquina de estados e campos obrigatórios |
| Banco | `spec/db/` | schema, triggers append-only, seleção de pool e TLS |
| Integração HTTP | `spec/integration/` | a aplicação real numa porta efêmera: auth, permissões por perfil, isolamento entre solicitantes, as seis transições válidas, os estados finais, a atomicidade do histórico, o bloqueio otimista, upload de imagens, dashboard e hardening |

```bash
bun test                   # unidade + banco + integração HTTP
bun run typecheck          # inclui a suíte de tipos
bun run openapi:validate   # o contrato bate com as rotas registradas
```

Sem Bun instalado, use o container:

```bash
docker compose run --rm api bun test
docker compose run --rm api bun run typecheck
```

Dois detalhes que valem registro:

- Os testes de integração usam `createApp()` com um pool próprio e limpam o estado com
  `TRUNCATE` entre casos. `BEGIN/ROLLBACK` não serve aqui, porque a aplicação abre as próprias
  conexões. Por sorte, `TRUNCATE` não dispara os triggers de linha — então a limpeza convive com
  as tabelas append-only.
- `bun run openapi:validate` compara o `openapi.json` com as rotas realmente registradas no
  Express e falha se alguma operação estiver indocumentada ou obsoleta. A documentação não
  envelhece em silêncio.

A pipeline (`.github/workflows/ci.yml`) roda formatação, typecheck, validação de contrato,
a suíte inteira contra um PostgreSQL real e o build da imagem de produção.

## 8. Deploy em cloud

O Resolve Aí é publicado como dois containers no mesmo **Azure Container Apps Environment**,
apoiados por um PostgreSQL gerenciado e um file share para as imagens.

```
  navegador ──► resolveai-front (:3001)  ──► resolveai-api (:3000) ──► PostgreSQL Flexible Server
                 React + servidor Bun         Express + pg                 (TLS obrigatório)
                 proxy de /api/*                    │
                                                    └──► Azure Files montado em /api/uploads
```

**Por que Container Apps.** Dois containers independentes, cada um com FQDN e TLS próprios;
segredos nativos referenciados por `secretref:` (nunca em `--env-vars`, que aparecem em
`az containerapp show`); volume persistente via Azure Files no environment; revisões imutáveis,
o que torna o rollback trivial; e franquia mensal gratuita. AKS exigiria uma orquestração que o
projeto não precisa; App Service não separa os dois serviços tão bem.

```bash
./infra/deploy.sh              # provisiona tudo, idempotente
./infra/deploy.sh --deploy-only # apenas reconstrói e publica nova revisão
```

O script registra os resource providers, cria o resource group, o ACR, o PostgreSQL Flexible
Server 18, libera as extensões `pgcrypto` e `citext`, cria o file share, constrói as duas
imagens com `az acr build` (com queda automática para build local quando a assinatura bloqueia
ACR Tasks), cria ou atualiza os dois Container Apps montando o file share em `/api/uploads`,
cruza `API_URL` e `CORS_ORIGIN` entre eles e roda um smoke test em `/health`.

Os segredos (`JWT_SECRET`, senha do Postgres, `MANAGER_PASSWORD`) são gerados na primeira
execução e gravados em `infra/.azure-secrets.env`, com permissão `600` e fora do git.

O deploy contínuo está em `.github/workflows/deploy.yml`, nos dois repositórios: cada push na
`main` reconstrói a imagem no registry e faz roll out de uma nova revisão.

As armadilhas encontradas nesse caminho — e o sintoma de cada uma — estão catalogadas em
[`docs/DEPLOY.md`](DEPLOY.md).

## 9. Experiências e desafios enfrentados

Durante o desenvolvimento, alguns pontos exigiram mais atenção:

- **Onde colocar as regras que não podem ser violadas.** A primeira versão validava a transição
  de status no service e seguia adiante. Bastava uma rota nova esquecer a chamada para abrir um
  buraco. A resposta foi dupla: centralizar as regras em `domain.ts`, num ponto que nenhuma rota
  contorna, e repetir as invariantes mais caras como constraints no banco. A
  `resolution_fields_match_status` é o melhor exemplo — ela torna impossível existir uma
  ocorrência resolvida sem solução, mesmo que o código erre.

- **Histórico que realmente não pode ser reescrito.** Uma tabela de histórico onde a aplicação
  tem `UPDATE` e `DELETE` não é auditoria, é um registro por convenção. Os triggers
  `BEFORE UPDATE OR DELETE` resolveram isso, mas criaram um problema nos testes: não dava para
  limpar as tabelas entre casos. `TRUNCATE` não dispara triggers de linha — descobrir isso foi
  o que destravou a suíte.

- **CORS no upload.** Enviar imagem com `X-File-Name` e usar `PATCH` fazia o navegador disparar
  preflight, e configurar CORS para todos os casos ficou repetitivo. Colocar o proxy no servidor
  Bun do front eliminou o problema na raiz: o navegador passou a falar com uma única origem.
  A API continua liberando os dois headers, para quem quiser chamá-la direto.

- **Bloqueio otimista.** Dois gestores mexendo na mesma ocorrência ao mesmo tempo sobrescreviam
  um ao outro sem aviso. A coluna `version` com `SELECT … FOR UPDATE` resolveu, mas exigiu que o
  front carregasse e reenviasse a versão em toda ação de gestão — e tratasse o `409` recarregando
  a tela, em vez de mostrar um erro genérico.

- **JWT sem biblioteca.** Implementar HS256 sobre WebCrypto evitou uma dependência, mas custou
  recursos que uma biblioteca madura entrega de graça. Foi uma troca consciente para um MVP;
  em um sistema maior, a decisão seria outra.

- **Deploy no Azure.** A maior parte do tempo de infraestrutura não foi escrever o script, e sim
  descobrir por que ele falhava: o SKU `Standard_B1ms` não existe em toda região; `pgcrypto` e
  `citext` precisam ser liberadas antes da primeira migration; o `pg` só negocia TLS quando `ssl`
  é definido explicitamente; `az containerapp show` devolve os secrets sem valor, então reenviar
  a definição quebra o app. Cada uma delas virou uma linha na tabela de armadilhas do
  `DEPLOY.md`, para não custar o mesmo tempo duas vezes.

---

## Anexo — Requisitos do Hackathon e onde estão atendidos

| Requisito | Onde |
| --- | --- |
| Arquitetura de software | §4, §4.1 e [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) |
| Backend | §4.1 (camada de API) — Bun + Express 5 + node-pg |
| APIs | §4.2 e [`openapi.json`](../openapi.json), navegável em `/docs` |
| Banco de dados | §4.3 — PostgreSQL 18, constraints e triggers |
| Frontend | §4.1 (camada de aplicação) e §4.2 — React 19 servido por Bun |
| Testes | §7 — unidade, banco e integração HTTP |
| Docker | §4.4 — Dockerfile multi-stage e Compose nos dois repositórios |
| Deploy em Cloud | §8 — Azure Container Apps, com CD por push na `main` |
| Documentação | este documento, `README.md` e os arquivos de `docs/` |
| Perfis e responsabilidades | §5 |
| Ciclo de vida da ocorrência | §6 |
| Fluxo geral | §6 (fluxo geral) |
| Histórico de mudança de status (5 campos) | §6 (histórico e auditoria) |
| Solicitante: conta, autenticação, registro, título/descrição/categoria, localização, imagem, acompanhamento, comentários, histórico, avaliação | §5 e §6 |
| Gestor: visualizar todas, filtrar, priorizar, atribuir, atualizar status, comentar, registrar solução, dashboard | §5, §4.2 e §6 |
