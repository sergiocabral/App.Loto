# Luckygames

Aplicação Next.js para consultar resultados das Loterias da Caixa, carregar resultados no banco PostgreSQL e visualizar análises simples para apoio à escolha de números.

## Requisitos

- Node.js 20 ou superior
- npm
- PostgreSQL acessível pela aplicação

## Rodando localmente

Entre na pasta do app:

```bash
cd app-loto-next
```

Instale as dependências:

```bash
npm install
```

Crie o arquivo de ambiente a partir do exemplo:

```bash
cp .env.example .env
```

Edite o `.env` com os dados do seu PostgreSQL.

Prepare o banco:

```bash
npm run db:migrate
```

Suba o servidor de desenvolvimento:

```bash
npm run dev
```

Acesse:

```text
http://localhost:3000
```

## Rodando em modo produção local

```bash
npm run build
npm run start
```

Por padrão, o Next.js sobe em:

```text
http://localhost:3000
```

## Arquivos de ambiente

O app lê variáveis destes arquivos, nessa ordem:

1. `.env`
2. `.env.local`, sobrescrevendo valores do `.env`

Esses arquivos devem ficar na raiz do app `app-loto-next`, por exemplo:

```text
app-loto-next/.env
app-loto-next/.env.local
```

O `.env` real não deve ser versionado. O arquivo versionado é apenas:

```text
.env.example
```

## Variáveis do `.env`

| Variável | Obrigatória | Exemplo | Uso |
| --- | --- | --- | --- |
| `POSTGRES_HOST` | Sim | `localhost` | Host do PostgreSQL. |
| `POSTGRES_PORT` | Não | `5432` | Porta do PostgreSQL. Se vazio, usa `5432`. |
| `POSTGRES_USER` | Sim | `luckygames` | Usuário do banco. |
| `POSTGRES_PASSWORD` | Sim | `change-me` | Senha do banco. |
| `POSTGRES_DATABASE` | Recomendado | `luckygames` | Banco usado pela aplicação. Se vazio, usa o valor de `POSTGRES_USER`. |
| `POSTGRES_SSL` | Não | `false` | Ativa SSL na conexão com PostgreSQL quando `true`. |
| `POSTGRES_SSL_ALLOW_INSECURE` | Não | `false` | Permite SSL sem validar certificado. Não pode ser `true` em produção. |
| `POSTGRES_CONNECTION_TIMEOUT_MS` | Não | `5000` | Timeout para abrir conexão com o banco. |
| `POSTGRES_IDLE_TIMEOUT_MS` | Não | `30000` | Tempo máximo de conexão ociosa no pool. |
| `POSTGRES_QUERY_TIMEOUT_MS` | Não | `30000` | Timeout de queries no cliente PostgreSQL. |
| `POSTGRES_STATEMENT_TIMEOUT_MS` | Não | `30000` | Timeout de statements no PostgreSQL. |

## Exemplo de `.env`

```env
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=luckygames
POSTGRES_PASSWORD=change-me
POSTGRES_DATABASE=luckygames
POSTGRES_SSL=false
POSTGRES_SSL_ALLOW_INSECURE=false

POSTGRES_CONNECTION_TIMEOUT_MS=5000
POSTGRES_IDLE_TIMEOUT_MS=30000
POSTGRES_QUERY_TIMEOUT_MS=30000
POSTGRES_STATEMENT_TIMEOUT_MS=30000
```

## Banco de dados

O app usa PostgreSQL para armazenar:

- loterias suportadas;
- concursos;
- números sorteados;
- grupos de números, incluindo o caso especial da Dupla Sena.

Para criar ou atualizar o schema:

```bash
npm run db:migrate
```

O script executa `database/schema.sql` no banco configurado no `.env`.

## Sincronização dos resultados

A sincronização incremental com a API das Loterias da Caixa é pública e roda em pequenos lotes. Ela também pode ser iniciada pela interface quando o usuário carrega uma loteria.

Proteções atuais:

- rate limit simples por IP e loteria;
- validação de body JSON;
- lote pequeno por chamada;
- lock em memória por loteria para evitar duas sincronizações iguais no mesmo processo.

A API aceita apenas a ação pública `sync-caixa` para carregar resultados faltantes. Não há token administrativo nem endpoint público para sobrescrever manualmente um concurso específico.

## Scripts úteis

```bash
npm run dev       # servidor local de desenvolvimento
npm run build     # build de produção
npm run start     # servidor Next.js em produção
npm run lint      # lint do projeto
npm test          # testes automatizados
npm run db:migrate # aplica o schema no PostgreSQL
```

## Testes

A suíte usa Vitest.

Rode:

```bash
npm test
```

Validação completa recomendada antes de publicar:

```bash
npm test
npm run lint
npm run build
```

## Observações para deploy

Para um servidor Node/VPS:

1. copie o projeto;
2. crie `app-loto-next/.env` com os dados reais;
3. rode `npm install`;
4. rode `npm run db:migrate`;
5. rode `npm run build`;
6. inicie com `npm run start`.

Para Cloudflare Workers/Pages, o app precisa de adaptação específica, principalmente por causa do acesso PostgreSQL via `pg` e do modelo de runtime distribuído.
