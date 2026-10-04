# Arquitetura — Resolve Aí

## Visão geral

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

O servidor Bun do front serve o bundle React **e** faz proxy de `/api/*` para a API. O
navegador fala sempre com uma única origem, então não há preflight de CORS no caminho normal.

## Backend

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
db/
  pool.ts                Pool por ambiente (NODE_ENV escolhe o banco), TLS opcional
  migrate.ts             migrations versionadas, idempotentes, com advisory lock
  seed.ts                gestor inicial (upsert por e-mail)
  migrations/*.sql       schema, constraints, triggers e categorias iniciais
```

Os módulos são `auth`, `users`, `categories`, `incidents`, `comments`, `attachments`,
`ratings`, `dashboard` e `platform` (health, `/openapi.json` e `/docs`). Cada um exporta
uma fábrica de `Router` que recebe `{ pool, config }` e declara o caminho completo da
rota, então `app.ts` monta todos no mesmo prefixo e o template logado não muda.
`auth/middleware.ts` concentra `authenticate`, `requireManager` e `requireAdmin`, usados
pelos demais módulos.

`createApp` recebe `pool` e `config` por parâmetro. É isso que permite aos testes de
integração subir a aplicação real numa porta efêmera contra um banco de teste.

### Formato de erro

Toda falha sai no mesmo envelope, e o front decide pelo `code`, nunca pela mensagem:

```json
{ "error": { "code": "VERSION_CONFLICT", "message": "…", "details": [], "requestId": "…" } }
```

## Perfis

| | Solicitante (`requester`) | Gestor (`manager`) |
| --- | --- | --- |
| Origem da conta | cadastro público | administrador via API ou seed (`db/seed.ts`) |
| Ocorrências | só as próprias (as demais respondem **404**, não 403) | todas |
| Pode | registrar, anexar imagem, comentar, consultar histórico, avaliar | filtrar, priorizar, atribuir, transicionar, comentar, dashboard |

O administrador (`admin`) é provisionado pelo seed com `ADMIN_EMAIL` e
`ADMIN_PASSWORD`. Pode listar usuários e criar gestores por
`POST /users/managers`, mas não acessa ocorrências nem herda permissões de gestor.

## Ciclo de vida da ocorrência

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

São **exatamente seis** transições válidas. `resolvida` e `cancelada` são finais. As regras
vivem em `src/modules/incidents/domain.ts`, num único ponto que nenhuma rota contorna.

## Auditoria

Toda mudança de status grava, **na mesma transação**, status anterior, novo status, data/hora,
usuário responsável e observação — os cinco campos exigidos pelo PDF. Prioridade e atribuição
têm tabelas equivalentes, com justificativa obrigatória.

| Tabela | Registra |
| --- | --- |
| `status_history` | transições de status (a criação entra como `null → open`, por trigger) |
| `priority_history` | mudanças de prioridade |
| `assignment_history` | atribuições e reatribuições |

As três são **append-only**: um trigger `BEFORE UPDATE OR DELETE` levanta exceção. Nem a
aplicação nem uma conexão administrativa conseguem reescrever a trilha.

`GET /incidents/:id/history` devolve as três em uma linha do tempo única, ordenada.

## Integridade garantida pelo banco

O schema não confia apenas na aplicação:

- `resolution_fields_match_status` — `resolved` exige `solution`, `resolved_by` e `resolved_at`; qualquer outro status exige os três nulos;
- `enforce_incident_users` — o solicitante precisa ser um `requester` ativo; responsável e resolvedor, `manager` ativo;
- `enforce_rating` — só o dono de uma ocorrência resolvida avalia, e `incident_id` é `UNIQUE`;
- `attachments` — MIME na allowlist e tamanho ≤ 5 MB;
- `status_history` — observação obrigatória quando o novo status é `cancelled`.

## Concorrência

Cada ocorrência tem uma coluna `version`. Prioridade, responsável e transições exigem a versão
lida pelo cliente, travam a linha com `SELECT … FOR UPDATE` e incrementam a versão. Duas
alterações simultâneas: uma vence, a outra recebe `409 VERSION_CONFLICT`.

## Autenticação

- Access token JWT HS256 de 15 minutos, assinado com WebCrypto (`src/shared/tokens.ts`).
- Refresh token de 30 dias, guardado como SHA-256, **rotativo**: usar um token o revoga e emite outro. Reutilizar o antigo devolve 401.
- Senhas em Argon2id (`Bun.password`).
- Cada request revalida que o usuário continua ativo — desativar uma conta invalida os tokens em circulação.

## Testes

| Camada | Onde | O que cobre |
| --- | --- | --- |
| Unidade | `spec/unit/` | máquina de estados e campos obrigatórios |
| Banco | `spec/db/` | schema, triggers append-only, seleção de pool e TLS |
| Integração HTTP | `spec/integration/` | a aplicação real numa porta efêmera: auth, permissões, jornadas, upload, concorrência e dashboard |

Os testes de integração usam `createApp()` com um pool próprio e limpam o estado com
`TRUNCATE` entre casos — `BEGIN/ROLLBACK` não serve aqui, porque a aplicação abre as próprias
conexões. Detalhe relevante: `TRUNCATE` não dispara os triggers de linha, então a limpeza
convive com as tabelas append-only.

`bun run openapi:validate` compara o `openapi.json` com as rotas realmente registradas no
Express e falha se alguma operação estiver indocumentada ou obsoleta.

## Decisões e seus custos

| Decisão | Motivo | Custo aceito |
| --- | --- | --- |
| SQL direto, sem ORM | controle das transações e do bloqueio otimista | consultas escritas à mão |
| JWT implementado sobre WebCrypto | sem dependência extra | menos recursos que uma biblioteca madura |
| Responsável precisa ser `manager` | o MVP não tem perfil de técnico | administradores não são responsáveis elegíveis |
| Imagens em disco/volume | nenhuma mudança de código entre local e Azure Files | Blob Storage escalaria melhor |
| Módulos por domínio, em três camadas | rota, regra e SQL separados; o SQL de cada domínio vive em um lugar só | mais arquivos para navegar |
| Repositórios como funções sobre `Queryable` | o mesmo código serve ao pool e a um cliente em transação | sem as garantias que uma classe injetada daria |
