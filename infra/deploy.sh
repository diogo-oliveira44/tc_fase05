#!/usr/bin/env bash
# Usage:
#   az login
#   ./infra/deploy.sh                # provisions everything, then deploys
#   ./infra/deploy.sh --deploy-only  # rebuilds and rolls out new revisions only
#

set -euo pipefail

LOCATION="${LOCATION:-brazilsouth}"      # see docs/DEPLOY.md: the region must offer Standard_B1ms
RESOURCE_GROUP="${RESOURCE_GROUP:-rg-resolveai}"
ENVIRONMENT="${ENVIRONMENT:-cae-resolveai}"
WORKSPACE="${WORKSPACE:-log-resolveai}"
API_APP="resolveai-api"
FRONT_APP="resolveai-front"
API_DIR="${API_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
FRONT_DIR="${FRONT_DIR:-$API_DIR/../tc_fase05_front}"
SECRETS_FILE="${SECRETS_FILE:-$API_DIR/infra/.azure-secrets.env}"

DEPLOY_ONLY=false
[[ "${1:-}" == "--deploy-only" ]] && DEPLOY_ONLY=true

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
exists() { az "$@" -o none 2>/dev/null; }

command -v az >/dev/null || { echo "Azure CLI (az) is required: https://aka.ms/InstallAzureCLI"; exit 1; }
command -v jq >/dev/null || { echo "jq is required: https://jqlang.github.io/jq/download/"; exit 1; }

if [[ ! -f "$SECRETS_FILE" ]]; then
  log "Generating secrets into $SECRETS_FILE"
  mkdir -p "$(dirname "$SECRETS_FILE")"
  cat > "$SECRETS_FILE" <<EOF
SUFFIX=${SUFFIX:-$(openssl rand -hex 4)}
PG_PASSWORD=Rv$(openssl rand -hex 12)Aa1
JWT_SECRET=$(openssl rand -hex 32)
MANAGER_PASSWORD=$(openssl rand -hex 12)
EOF
  chmod 600 "$SECRETS_FILE"
fi
log "Using the secrets in $SECRETS_FILE"
# shellcheck disable=SC1090
source "$SECRETS_FILE"

ACR="acrresolveai${SUFFIX}"
PG_SERVER="pg-resolveai-${SUFFIX}"
STORAGE="stresolveai${SUFFIX}"
PG_ADMIN="${PG_ADMIN:-resolveai}"
PG_DATABASE="tc_db_prod"
MANAGER_EMAIL="${MANAGER_EMAIL:-manager@resolveai.local}"

if [[ "$DEPLOY_ONLY" == false ]]; then
  log "Registering resource providers"
  az extension add --name containerapp --upgrade --only-show-errors >/dev/null
  for provider in Microsoft.App Microsoft.OperationalInsights Microsoft.DBforPostgreSQL Microsoft.ContainerRegistry Microsoft.Storage; do
    az provider register -n "$provider" --wait
  done

  log "Resource group $RESOURCE_GROUP ($LOCATION)"
  az group create -n "$RESOURCE_GROUP" -l "$LOCATION" -o none

  log "Container registry $ACR"
  exists acr show -n "$ACR" -g "$RESOURCE_GROUP" ||
    az acr create -g "$RESOURCE_GROUP" -n "$ACR" --sku Basic -o none

  log "PostgreSQL Flexible Server $PG_SERVER"
  exists postgres flexible-server show -g "$RESOURCE_GROUP" -n "$PG_SERVER" ||
    az postgres flexible-server create \
      -g "$RESOURCE_GROUP" -n "$PG_SERVER" -l "$LOCATION" \
      --version 18 --tier Burstable --sku-name Standard_B1ms --storage-size 32 \
      --admin-user "$PG_ADMIN" --admin-password "$PG_PASSWORD" \
      --public-access 0.0.0.0 --yes -o none

  log "Database $PG_DATABASE"
  exists postgres flexible-server db show -g "$RESOURCE_GROUP" -s "$PG_SERVER" -n "$PG_DATABASE" ||
    az postgres flexible-server db create -g "$RESOURCE_GROUP" -s "$PG_SERVER" -n "$PG_DATABASE" -o none

  # db/migrations/001_initial_schema.sql opens with CREATE EXTENSION pgcrypto/citext,
  # which the Flexible Server refuses until they are allowlisted.
  log "Allowlisting the pgcrypto and citext extensions"
  az postgres flexible-server parameter set \
    -g "$RESOURCE_GROUP" -s "$PG_SERVER" \
    --name azure.extensions --value PGCRYPTO,CITEXT -o none

  log "Storage account $STORAGE and the uploads file share"
  exists storage account show -n "$STORAGE" -g "$RESOURCE_GROUP" ||
    az storage account create -g "$RESOURCE_GROUP" -n "$STORAGE" -l "$LOCATION" \
      --sku Standard_LRS --kind StorageV2 -o none
  az storage share-rm create -g "$RESOURCE_GROUP" --storage-account "$STORAGE" \
    -n uploads --quota 5 -o none 2>/dev/null || true

  log "Log Analytics workspace $WORKSPACE"
  exists monitor log-analytics workspace show -g "$RESOURCE_GROUP" -n "$WORKSPACE" ||
    az monitor log-analytics workspace create -g "$RESOURCE_GROUP" -n "$WORKSPACE" -l "$LOCATION" -o none

  log "Container Apps environment $ENVIRONMENT"
  exists containerapp env show -g "$RESOURCE_GROUP" -n "$ENVIRONMENT" ||
    az containerapp env create -g "$RESOURCE_GROUP" -n "$ENVIRONMENT" -l "$LOCATION" \
      --logs-workspace-id "$(az monitor log-analytics workspace show \
        -g "$RESOURCE_GROUP" -n "$WORKSPACE" --query customerId -o tsv)" \
      --logs-workspace-key "$(az monitor log-analytics workspace get-shared-keys \
        -g "$RESOURCE_GROUP" -n "$WORKSPACE" --query primarySharedKey -o tsv)" \
      -o none

  az containerapp env storage set -g "$RESOURCE_GROUP" -n "$ENVIRONMENT" \
    --storage-name uploads \
    --azure-file-account-name "$STORAGE" \
    --azure-file-account-key "$(az storage account keys list \
      -g "$RESOURCE_GROUP" -n "$STORAGE" --query "[0].value" -o tsv)" \
    --azure-file-share-name uploads \
    --access-mode ReadWrite -o none
fi

# ----------------------------------------------------------------------- build
TAG="$(git -C "$API_DIR" rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M)"
REGISTRY="$ACR.azurecr.io"

az acr update -n "$ACR" --admin-enabled true -o none
ACR_PASSWORD="$(az acr credential show -n "$ACR" --query 'passwords[0].value' -o tsv)"

BUILD_MODE="${BUILD_MODE:-auto}"

build_image() {
  local image="$1" context="$2"

  if [[ "$BUILD_MODE" != "local" ]]; then
    log "Building $image:$TAG in the registry"
    az acr build -r "$ACR" -t "$image:$TAG" -t "$image:latest" "$context" -o none && return 0
    log "ACR Tasks unavailable; building $image locally instead"
    BUILD_MODE=local
  else
    log "Building $image:$TAG locally"
  fi

  command -v docker >/dev/null || { echo "Docker is required to build images locally." >&2; exit 1; }
  printf '%s' "$ACR_PASSWORD" | docker login "$REGISTRY" -u "$ACR" --password-stdin >/dev/null
  docker build --platform linux/amd64 \
    -t "$REGISTRY/$image:$TAG" -t "$REGISTRY/$image:latest" "$context"
  docker push "$REGISTRY/$image:$TAG"
  docker push "$REGISTRY/$image:latest"
}

build_image resolveai-api "$API_DIR"
build_image resolveai-front "$FRONT_DIR"

deploy_app() {
  local name="$1" image="$2" port="$3" cpu="$4" mem="$5"
  shift 5

  if exists containerapp show -g "$RESOURCE_GROUP" -n "$name"; then
    log "Rolling out a new revision of $name"
    az containerapp update -g "$RESOURCE_GROUP" -n "$name" --image "$REGISTRY/$image:$TAG" -o none
  else
    log "Creating $name"
    az containerapp create \
      -g "$RESOURCE_GROUP" -n "$name" --environment "$ENVIRONMENT" \
      --image "$REGISTRY/$image:$TAG" \
      --registry-server "$REGISTRY" --registry-username "$ACR" --registry-password "$ACR_PASSWORD" \
      --ingress external --target-port "$port" \
      --min-replicas 1 --max-replicas 1 --cpu "$cpu" --memory "$mem" \
      "$@" -o none
  fi
}

fqdn() { az containerapp show -g "$RESOURCE_GROUP" -n "$1" --query properties.configuration.ingress.fqdn -o tsv; }

deploy_app "$API_APP" resolveai-api 3000 0.5 1.0Gi \
  --secrets "pg-password=$PG_PASSWORD" "jwt-secret=$JWT_SECRET" "manager-password=$MANAGER_PASSWORD" \
  --env-vars \
    NODE_ENV=production PORT=3000 \
    POSTGRES_HOST="$PG_SERVER.postgres.database.azure.com" POSTGRES_PORT=5432 \
    POSTGRES_USER="$PG_ADMIN" POSTGRES_PASSWORD=secretref:pg-password \
    POSTGRES_PROD_DB="$PG_DATABASE" POSTGRES_SSL=true \
    JWT_SECRET=secretref:jwt-secret \
    MANAGER_EMAIL="$MANAGER_EMAIL" MANAGER_PASSWORD=secretref:manager-password \
    UPLOAD_DIRECTORY=/api/uploads MAX_UPLOAD_BYTES=5242880

if [[ -z "$(az containerapp show -g "$RESOURCE_GROUP" -n "$API_APP" \
  --query "properties.template.volumes[?name=='uploads'] | [0].name" -o tsv 2>/dev/null)" ]]; then
  log "Mounting the uploads file share on $API_APP"
  TEMPLATE="$API_DIR/infra/containerapp-api.json"
  az containerapp show -g "$RESOURCE_GROUP" -n "$API_APP" -o json |
    jq '
        .properties.configuration |= del(.secrets)
      | .properties.template.volumes =
          [{name: "uploads", storageName: "uploads", storageType: "AzureFile"}]
      | .properties.template.containers |=
          map(.volumeMounts = [{volumeName: "uploads", mountPath: "/api/uploads"}])
    ' > "$TEMPLATE"
  az containerapp update -g "$RESOURCE_GROUP" -n "$API_APP" --yaml "$TEMPLATE" -o none
fi

deploy_app "$FRONT_APP" resolveai-front 3001 0.25 0.5Gi \
  --env-vars NODE_ENV=production PORT=3001 "API_URL=https://$(fqdn "$API_APP")"

az containerapp update -g "$RESOURCE_GROUP" -n "$API_APP" \
  --set-env-vars "CORS_ORIGIN=https://$(fqdn "$FRONT_APP")" -o none
