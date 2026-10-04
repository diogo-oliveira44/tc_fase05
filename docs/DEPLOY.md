# Deploy — Azure Container Apps

O Resolve Aí é publicado como dois containers no mesmo Container Apps Environment,
apoiados por um PostgreSQL gerenciado e um file share para as imagens das ocorrências.

```
  navegador ──► resolveai-front (:3001)  ──► resolveai-api (:3000) ──► PostgreSQL Flexible Server
                 React + servidor Bun         Express + pg                 (TLS obrigatório)
                 proxy de /api/*                    │
                                                    └──► Azure Files montado em /api/uploads
```

O navegador conversa **apenas** com a origem do front-end, que repassa `/api/*` para a
API (`tc_fase05_front/src/index.ts`). Não há preflight de CORS no caminho normal.


## Envs citadas

<SUB_ID> É a id da assinatura na Azure

## Por que Container Apps

| | Container Apps | App Service | AKS |
| --- | --- | --- | --- |
| Dois containers independentes | dois apps, cada um com FQDN e TLS | dois Web Apps | sim, com cluster |
| Comandos até o primeiro deploy | ~8 | ~7 | dezenas |
| Segredos | nativos (`secretref:`) | app settings | Secrets/Key Vault |
| Volume persistente | Azure Files no environment | `/home` já persiste | PVC |
| Rollback | revisões imutáveis | slots | manual |

Container Apps vence pelo conjunto: revisões imutáveis, segredos nativos e custo de MVP.
AKS exigiria orquestração que o projeto não precisa.

## Pré-requisitos

`az`, `jq` e — só quando a assinatura bloqueia ACR Tasks — `docker`.

```bash
curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash   # Debian/Ubuntu
# ou, no Arch: yay -S azure-cli jq

az login
az account set --subscription "<SUBSCRIPTION_ID>"
```

## Publicar

```bash
./infra/deploy.sh
```

O script é idempotente e faz, nesta ordem:

1. registra os resource providers e cria o resource group;
2. cria o Azure Container Registry;
3. cria o **PostgreSQL Flexible Server 18** (Burstable B1ms) com o banco `tc_db_prod`;
4. **libera as extensões `pgcrypto` e `citext`** — sem isso a primeira migration falha,
   porque `db/migrations/001_initial_schema.sql` começa com `CREATE EXTENSION`;
5. cria a storage account e o file share `uploads`, e registra o share no environment;
6. constrói as duas imagens com `az acr build` (build no próprio registry, sem precisar de
   Docker nem Bun na máquina). Quando a assinatura bloqueia ACR Tasks
   (`TasksOperationsNotAllowed`), cai automaticamente para build local com `docker push`;
   `BUILD_MODE=local` pula a tentativa e vai direto ao build local;
7. cria ou atualiza os dois Container Apps, montando o file share em `/api/uploads`
   (não há flag na CLI para anexar um storage do environment: o script edita a
   definição do app com `jq` e a reenvia em `--yaml`, que também aceita JSON);
8. aponta `API_URL` do front para a API e `CORS_ORIGIN` da API para o front;
9. roda o smoke test em `/health` e imprime as URLs e as credenciais do gestor.

Para apenas reconstruir e publicar uma nova revisão:

```bash
./infra/deploy.sh --deploy-only
```

### Variáveis aceitas

| Variável | Padrão | Observação |
| --- | --- | --- |
| `LOCATION` | `brazilsouth` | a região precisa oferecer `Standard_B1ms` — veja abaixo |
| `RESOURCE_GROUP` | `rg-resolveai` | |
| `SUFFIX` | aleatório na 1ª execução | reaproveitado de `infra/.azure-secrets.env` |
| `FRONT_DIR` | `../tc_fase05_front` | o front vive em outro repositório |

## Segredos

`infra/deploy.sh` gera `JWT_SECRET`, a senha do Postgres e `MANAGER_PASSWORD` na primeira
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

## Deploy contínuo (opcional)

`.github/workflows/deploy.yml` reconstrói a imagem e publica uma nova revisão a cada push
na `main`. Configure:

```bash
az ad sp create-for-rbac --name gh-resolveai --role contributor \
  --scopes /subscriptions/<SUB_ID>/resourceGroups/rg-resolveai --json-auth
```

- secret `AZURE_CREDENTIALS` — o JSON devolvido pelo comando acima;
- variables `ACR_NAME` e `RESOURCE_GROUP`.

## Custo

Container Apps tem franquia mensal gratuita; o Postgres B1ms é o item relevante. Entre
demonstrações:

```bash
az postgres flexible-server stop  -g rg-resolveai -n <servidor>
az postgres flexible-server start -g rg-resolveai -n <servidor>
```

## Armadilhas conhecidas

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

### Escolher a região

Nem toda região oferece o SKU Burstable `Standard_B1ms`, e o erro só aparece na criação.
Confirme antes de trocar `LOCATION`:

```bash
az postgres flexible-server list-skus -l <regiao> -o json |
  python3 -c 'import sys,json; caps=json.load(sys.stdin)[0]; print([s["name"] for e in caps["supportedServerEditions"] if e["name"]=="Burstable" for s in e["supportedServerSkus"]])'
```

Nesta assinatura, `eastus2`, `eastus`, `southcentralus` e `westeurope` **não** oferecem o SKU;
`brazilsouth`, `centralus`, `westus3` e `northeurope` oferecem. A região também precisa
suportar Container Apps — `brazilsouth` suporta os dois.
