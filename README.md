# Resolve Aí

Plataforma de gestão de ocorrências — Hackathon FSDT, Fase 5.
Este projeto contém somente o **Backend**. Caso queira mais detalhes do painel. Acesse o projeto neste [link](https://github.com/diogo-oliveira44/tc_fase05_front).

Solicitantes registram problemas (iluminação, vazamento, limpeza, segurança…), acompanham o
andamento e avaliam a resolução. Gestores priorizam, atribuem responsáveis, conduzem a
ocorrência pelo ciclo de vida e acompanham indicadores.

## Executar com Docker

```bash
cp .env.example .env     # defina JWT_SECRET, MANAGER_PASSWORD e ADMIN_PASSWORD
docker compose up --build
```

O container aguarda o PostgreSQL ficar saudável, aplica as migrations, cria o gestor inicial
e sobe na porta `3000`. Para a interface, suba também o `docker compose up` de
`tc_fase05_front` (porta `3001`).

| | Endereço |
| --- | --- |
| Front-end | http://localhost:3001 |
| API | http://localhost:3000/api/v1 |
| Swagger | http://localhost:3000/docs |
| Health check | http://localhost:3000/health |

O gestor é criado por um administrador via API ou pelo seed a partir de `MANAGER_EMAIL` / `MANAGER_PASSWORD`. Contas criadas
pelo cadastro público são sempre solicitantes.

## Executar localmente

Requer Bun e PostgreSQL:

```bash
docker compose run --rm --no-deps --user root api bun install --frozen-lockfile
bun run db:migrate
bun run db:seed
bun run start
```

## Validar

```bash
bun run typecheck          # inclui a suíte de testes
bun run openapi:validate   # o contrato bate com as rotas registradas
bun test                   # unidade + banco + integração HTTP
```

Sem Bun instalado, use o container:

```bash
docker compose run --rm api bun test
docker compose run --rm api bun run typecheck
```

A suíte sobe a aplicação real numa porta efêmera contra um banco de teste isolado e cobre
autenticação, permissões por perfil, isolamento entre solicitantes, as seis transições
válidas, os estados finais, a atomicidade do histórico, o bloqueio otimista, upload de
imagens e o dashboard. Não depende de nenhum passo manual.

## API

Prefixo `/api/v1`. Contrato completo em [`openapi.json`](openapi.json), navegável em `/docs`.

| Recurso | Endpoints |
| --- | --- |
| Autenticação | `POST /auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `GET /me` |
| Apoio | `GET /categories`, `GET /users?role=manager` (gestor) |
| Ocorrências | `POST /incidents`, `GET /incidents` (filtros, ordenação e paginação), `GET /incidents/{id}` |
| Acompanhamento | `GET /incidents/{id}/history`, `GET`/`POST /incidents/{id}/comments` |
| Imagens | `GET`/`POST /incidents/{id}/attachments`, `GET /incidents/{id}/attachments/{attachmentId}` |
| Avaliação | `GET`/`POST /incidents/{id}/rating` |
| Gestão | `PATCH /incidents/{id}/priority`, `PATCH /incidents/{id}/assignee`, `POST /incidents/{id}/transitions` |
| Indicadores | `GET /dashboard/summary` |

Access tokens duram 15 minutos; refresh tokens são rotativos e revogáveis. Uploads aceitam o
corpo binário (`image/jpeg`, `image/png`, `image/webp`), com o nome no header `X-File-Name`:
até cinco imagens de 5 MB por ocorrência, com tipo declarado no header `Content-Type` (JPEG, PNG ou WebP).

## Deploy

```bash
az login
./infra/deploy.sh
```

### Administrador

O papel `admin` gerencia contas e pode criar gestores com
`POST /api/v1/users/managers`. O corpo contém `name`, `email` e `password` (mínimo de 8 caracteres).
O endpoint sempre cria `manager`, independentemente de qualquer `role` enviado. Cadastro público continua
criando apenas solicitantes. Administradores podem listar usuários, mas não recebem
permissões de gestão ou leitura de ocorrências.

Para provisionar o primeiro administrador, configure `ADMIN_EMAIL`, `ADMIN_PASSWORD`
e, opcionalmente, `ADMIN_NAME` no ambiente. Execute `bun run db:migrate` seguido de
`bun run db:seed` (no Docker, use `docker compose exec -T api` antes desses comandos).
Recrie o contêiner após alterar seu arquivo de ambiente. O login usa `/api/v1/auth/login`.
O seed mantém o suporte às variáveis `MANAGER_*`; contas com outro papel não são
promovidas automaticamente quando o email já existe.
