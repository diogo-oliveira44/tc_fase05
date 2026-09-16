# Deploy — Azure Container Apps

O Resolve Aí é publicado como dois containers no mesmo Container Apps Environment,
conectado a um PostgreSQL gerenciado e um file share para as imagens das ocorrências.
O navegador conversa **apenas** com o front-end, que repassa `/api/*` para a
API (`tc_fase05_front/src/index.ts`).


## Envs

<SUB_ID> É a id da assinatura na Azure

## Pré-requisitos

`az`, `jq` e `docker`.

```bash
curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash   # Debian/Ubuntu
az login
az account set --subscription "<SUBSCRIPTION_ID>"
```

## Deployar

```bash
./infra/deploy.sh
```

O script é idempotente e faz, nesta ordem:

1. registra os resource providers e cria o resource group;
2. cria o Azure Container Registry;
3. cria o **PostgreSQL Flexible Server 18** (Burstable B1ms) com o banco `tc_db_prod`;
4. **libera as extensões `pgcrypto` e `citext`** — sem isso a primeira migration falha;
5. cria a storage account e o file share `uploads`, e registra o share no environment;
6. constrói as duas imagens com `az acr build` (build na VPS);
7. cria ou atualiza os dois Container Apps, montando o file share em `/api/uploads`;
8. aponta a `API_URL` do front para a API e `CORS_ORIGIN` da API para o front;
9. roda o smoke test em `/health` e imprime as URLs e as credenciais do gestor.

Para apenas reconstruir e publicar uma nova revisão:

```bash
./infra/deploy.sh --deploy-only
```

### Variáveis aceitas

Ver as primeiras linhas do arquivo deploy.sh

## Segredos

`infra/deploy.sh` gera um `JWT_SECRET`, a senha do Postgres e `MANAGER_PASSWORD` na primeira
execução e grava em `infra/.azure-secrets.env` (permissão `600`, **fora do git**). No Azure
eles viram *secrets* do Container App e são referenciados por `secretref:`, nunca por
`--env-vars` em texto puro — variáveis comuns aparecem em `az containerapp show`.

| Segredo | Runtime | Local |
| --- | --- | --- |
| `POSTGRES_PASSWORD` | secret do Container App | `.env` |
| `JWT_SECRET` | secret do Container App | `.env` |
| `MANAGER_PASSWORD` | secret do Container App | `.env` |

## Migrations

`scripts/start.sh` é o entrypoint da imagem e aplica as migrations **antes** de o servidor
aceitar tráfego. `migrate()` é idempotente: controla o que já rodou na tabela
`schema_migrations` e serializa execuções concorrentes com `pg_advisory_lock`. O seed do
gestor só roda quando `MANAGER_PASSWORD` está definido e usa `ON CONFLICT DO UPDATE`.

## Problemas que ocorreram conhecidas

| Sintoma | Causa |
| --- | --- |
| `permission denied to create extension "pgcrypto"` | falta `azure.extensions=PGCRYPTO,CITEXT` |
| `no pg_hba.conf entry ... no encryption` | falta `POSTGRES_SSL=true` (o `pg` só negocia TLS quando `ssl` é definido) |
| API sobe com schema vazio | `NODE_ENV` ≠ `production`, então `createPool()` escolhe `tc_db_dev` |
| `/openapi.json` e `/docs` retornam 500 | `openapi.json` foi excluído da imagem — ele é servido a partir do working directory |
| `The location is restricted from performing this operation` | a região não oferece o SKU `Standard_B1ms` nesta assinatura |
| Container Apps sem cota | troque `LOCATION` por outra região da lista abaixo |
| `TasksOperationsNotAllowed` | a assinatura não permite ACR Tasks; o script cai sozinho para build local |
| `ContainerAppSecretInvalid` ao montar o volume | `az containerapp show` devolve os secrets sem valor; o script remove a lista antes de reenviar |
| `ResourceNotFound` no workspace ao criar o environment | criar o Log Analytics junto do environment corre com a propagação do ARM; o script o cria antes |
