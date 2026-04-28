# Luckygames

Aplicação Next.js para consultar resultados das Loterias da Caixa, persistir concursos em PostgreSQL e visualizar análises simples para apoio à escolha de números.

## Requisitos

- Node.js 20 ou superior.
- npm.
- PostgreSQL acessível pela aplicação.
- Conta Cloudflare com Workers habilitado, apenas para deploy em Cloudflare Workers.

## Rodando em localhost com Next.js

Entre na pasta do app:

```bash
cd App.Loto
```

Instale as dependências:

```bash
npm install
```

Crie o arquivo de ambiente local:

```bash
cp .env.example .env
```

Edite `App.Loto/.env` com os dados do PostgreSQL local ou remoto. No mínimo, configure:

```env
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=luckygames
POSTGRES_PASSWORD=change-me
POSTGRES_DATABASE=luckygames
POSTGRES_SSL=false
```

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

## Rodando produção local

```bash
npm run build
npm run start
```

Por padrão, o Next.js sobe em:

```text
http://localhost:3000
```

## Rodando localmente como Cloudflare Worker

Para testar o mesmo runtime usado no Cloudflare Workers, use o preview do OpenNext:

```bash
npm run preview
```

Esse comando executa o build OpenNext e inicia um Worker local via Wrangler.

Para preview local, mantenha segredos fora do Git. Se precisar informar secrets ao Wrangler local, use `App.Loto/.dev.vars`, que é ignorado pelo Git:

```env
POSTGRES_PASSWORD=change-me
```

As demais variáveis não secretas do Worker ficam em `wrangler.jsonc`. Se quiser sobrescrever alguma delas apenas localmente, adicione também em `.dev.vars`.

## Arquivos de ambiente

### Localhost com Next.js

Em desenvolvimento e produção local com `next dev`/`next start`, o app lê:

1. `.env`
2. `.env.local`, sobrescrevendo valores do `.env`

Esses arquivos devem ficar na raiz do app:

```text
App.Loto/.env
App.Loto/.env.local
```

O `.env` real não deve ser versionado. O arquivo versionado é apenas `.env.example`.

### Cloudflare Workers

No Cloudflare Workers, as variáveis vêm de três lugares:

1. `wrangler.jsonc`, para variáveis não secretas versionadas.
2. Secrets/variables configurados no painel da Cloudflare.
3. `.dev.vars`, apenas para preview local com Wrangler.

O `wrangler.jsonc` usa `keep_vars: true`, então variáveis e secrets configurados no painel da Cloudflare são preservados durante o deploy.

## Variáveis de ambiente

| Variável | Localhost | Cloudflare Workers | Uso |
| --- | --- | --- | --- |
| `POSTGRES_HOST` | Obrigatória | Configurada em `wrangler.jsonc` ou painel | Host do PostgreSQL. |
| `POSTGRES_PORT` | Opcional | Configurada em `wrangler.jsonc` ou painel | Porta do PostgreSQL. Padrão: `5432`. |
| `POSTGRES_USER` | Obrigatória | Configurada em `wrangler.jsonc` ou painel | Usuário do banco. |
| `POSTGRES_PASSWORD` | Obrigatória | Secret obrigatório | Senha do banco. Nunca versionar. |
| `POSTGRES_DATABASE` | Recomendada | Configurada em `wrangler.jsonc` ou painel | Banco usado pela aplicação. Se vazio, usa `POSTGRES_USER`. |
| `POSTGRES_SSL` | Opcional | Configurada em `wrangler.jsonc` ou painel | Ativa SSL na conexão com PostgreSQL quando `true`. |
| `POSTGRES_SSL_ALLOW_INSECURE` | Opcional | Configurada em `wrangler.jsonc` ou painel | Permite SSL sem validar certificado. Não pode ser `true` em produção. |
| `POSTGRES_CONNECTION_TIMEOUT_MS` | Opcional | Configurada em `wrangler.jsonc` ou painel | Timeout para abrir conexão com o banco. |
| `POSTGRES_IDLE_TIMEOUT_MS` | Opcional | Configurada em `wrangler.jsonc` ou painel | Tempo máximo de conexão ociosa no pool. |
| `POSTGRES_QUERY_TIMEOUT_MS` | Opcional | Configurada em `wrangler.jsonc` ou painel | Timeout de queries no cliente PostgreSQL. |
| `POSTGRES_STATEMENT_TIMEOUT_MS` | Opcional | Configurada em `wrangler.jsonc` ou painel | Timeout de statements no PostgreSQL. |
| `POSTGRES_POOL_MAX` | Opcional | Recomendado `1` | Tamanho máximo do pool. Em Workers, usar `1`. |
| `POSTGRES_POOL_MAX_USES` | Opcional | Recomendado `1` | Quantidade máxima de usos por conexão. Em Workers, usar `1`. |
| `HYPERDRIVE_CONNECTION_STRING` | Opcional | Opcional | Connection string quando usar Cloudflare Hyperdrive sem binding. |
| `NEXT_RUNTIME_PROVIDER` | Opcional | `cloudflare` | Marca o runtime Cloudflare para ajustes seguros de pool. |
| `NEXT_PUBLIC_UMAMI_SCRIPT_URL` | Opcional | Opcional em build time | URL pública do script Umami usado para analytics. |
| `NEXT_PUBLIC_UMAMI_WEBSITE_ID` | Opcional | Opcional em build time | Identificador do site no Umami. |
| `NEXT_PUBLIC_REMARK42_HOST` | Opcional | Opcional em build time | Host público do Remark42. Padrão usado no app: `https://comments.cabral.dev`. |
| `NEXT_PUBLIC_REMARK42_SITE_ID` | Opcional | Opcional em build time | Site ID do Remark42. Padrão usado no app: `global`. |
| `NEXT_PUBLIC_REMARK42_LOCALE` | Opcional | Opcional em build time | Locale do Remark42. Padrão usado no app: `bp`. |
| `NEXT_PUBLIC_REMARK42_NO_FOOTER` | Opcional | Opcional em build time | Remove footer do Remark42 quando diferente de `false`. |

Observações:

- `NEXT_PUBLIC_*` é incorporado no bundle durante o build. Defina essas variáveis antes do build se quiser valores diferentes dos padrões.
- `POSTGRES_PASSWORD` precisa existir como secret no Worker. Se faltar, a API retorna erro de configuração antes de tentar conectar no banco.
- `LUCKYGAMES_ADMIN_TOKEN` não é usado pelo app atualmente.

## Exemplo de `.env` para localhost

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
POSTGRES_POOL_MAX=10
POSTGRES_POOL_MAX_USES=

HYPERDRIVE_CONNECTION_STRING=
NEXT_RUNTIME_PROVIDER=

NEXT_PUBLIC_UMAMI_SCRIPT_URL=https://umami.cabral.dev/script.js
NEXT_PUBLIC_UMAMI_WEBSITE_ID=ea4bd301-7337-44bd-9ec9-746074f3f4de

NEXT_PUBLIC_REMARK42_HOST=https://comments.cabral.dev
NEXT_PUBLIC_REMARK42_SITE_ID=global
NEXT_PUBLIC_REMARK42_LOCALE=bp
NEXT_PUBLIC_REMARK42_NO_FOOTER=true
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

O script executa `database/schema.sql` no banco configurado no ambiente.

Para produção no Cloudflare Workers, rode a migração a partir de uma máquina local ou ambiente CI com acesso ao PostgreSQL. A migração não é executada automaticamente pelo Worker.

## Analytics com Umami

Quando `NEXT_PUBLIC_UMAMI_SCRIPT_URL` e `NEXT_PUBLIC_UMAMI_WEBSITE_ID` estiverem definidos, o layout injeta automaticamente o script do Umami em todas as páginas.

Exemplo gerado no HTML:

```html
<script defer src="https://umami.cabral.dev/script.js" data-website-id="ea4bd301-7337-44bd-9ec9-746074f3f4de"></script>
```

Se qualquer uma das duas variáveis estiver vazia, o script não é carregado.

## Comentários com Remark42

A seção de comentários é carregada no cliente via Remark42. Por padrão, o app usa:

```env
NEXT_PUBLIC_REMARK42_HOST=https://comments.cabral.dev
NEXT_PUBLIC_REMARK42_SITE_ID=global
NEXT_PUBLIC_REMARK42_LOCALE=bp
NEXT_PUBLIC_REMARK42_NO_FOOTER=true
```

Para trocar de instância, site ID ou locale, defina as variáveis `NEXT_PUBLIC_REMARK42_*` antes do build.

## Deploy no Cloudflare Workers

Este app usa Next.js com OpenNext para Cloudflare Workers. O deploy correto gera primeiro o bundle `.open-next` e depois publica o Worker.

### Configuração necessária no painel da Cloudflare

No Worker `app-loto`, configure pelo menos o secret:

```text
POSTGRES_PASSWORD
```

As variáveis não secretas principais já estão versionadas em `wrangler.jsonc`, incluindo:

```text
POSTGRES_HOST
POSTGRES_PORT
POSTGRES_USER
POSTGRES_DATABASE
POSTGRES_SSL
POSTGRES_CONNECTION_TIMEOUT_MS
POSTGRES_IDLE_TIMEOUT_MS
POSTGRES_QUERY_TIMEOUT_MS
POSTGRES_STATEMENT_TIMEOUT_MS
POSTGRES_POOL_MAX
POSTGRES_POOL_MAX_USES
NEXT_RUNTIME_PROVIDER
```

Se preferir gerenciar esses valores pelo painel da Cloudflare, mantenha os nomes exatamente iguais. O `keep_vars: true` preserva as variáveis e secrets do painel durante o deploy.

### Comandos de build/deploy na Cloudflare

Use este comando como deploy command:

```bash
npm run deploy
```

Esse script executa:

```bash
opennextjs-cloudflare build && opennextjs-cloudflare deploy
```

Não use apenas `npm run build` seguido de `npx wrangler deploy`, porque `npm run build` gera `.next`, mas não gera o bundle `.open-next` necessário para o Worker.

Se a interface da Cloudflare exigir comandos separados, use:

```bash
npx opennextjs-cloudflare build
```

como build command e:

```bash
npx opennextjs-cloudflare deploy
```

como deploy command.

### Deploy pela máquina local

Autenticado no Wrangler, rode:

```bash
npm run deploy
```

Para validar sem publicar:

```bash
npm run deploy -- --dry-run
```

### Usando Hyperdrive opcionalmente

Para usar Cloudflare Hyperdrive, crie o Hyperdrive apontando para seu PostgreSQL e adicione um binding `HYPERDRIVE` em `wrangler.jsonc`:

```jsonc
"hyperdrive": [
  {
    "binding": "HYPERDRIVE",
    "id": "<your-hyperdrive-id>"
  }
]
```

O app também aceita `HYPERDRIVE_CONNECTION_STRING`, mas o binding `HYPERDRIVE` é a opção recomendada em Workers.

## Sincronização dos resultados

A sincronização incremental com a API das Loterias da Caixa é pública e roda em pequenos lotes. Ela também pode ser iniciada pela interface quando o usuário carrega uma loteria.

Proteções atuais:

- rate limit simples por IP e loteria;
- validação de body JSON;
- lote pequeno por chamada;
- lock em memória por loteria para evitar duas sincronizações iguais no mesmo processo.

A API aceita apenas a ação pública `sync-caixa` para carregar resultados faltantes. Não há endpoint público para sobrescrever manualmente um concurso específico.

## Scripts úteis

```bash
npm run dev        # servidor local de desenvolvimento
npm run build      # build de produção Next.js
npm run start      # servidor Next.js em produção local
npm run preview    # build OpenNext e preview local via Wrangler
npm run deploy     # build OpenNext e deploy no Cloudflare Workers
npm run upload     # build OpenNext e upload via OpenNext/Cloudflare
npm run cf-typegen # gera tipos dos bindings Cloudflare
npm run lint       # lint do projeto
npm test           # testes automatizados
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
npm run lint
npm test
npm run build
npm run deploy -- --dry-run
```

## Diagnóstico rápido

- `Missing PostgreSQL configuration: POSTGRES_PASSWORD`: o secret `POSTGRES_PASSWORD` não está chegando ao runtime do Worker.
- `Missing PostgreSQL configuration: POSTGRES_HOST`: a variável `POSTGRES_HOST` não está configurada no Worker ou foi removida do ambiente.
- Erro de timeout, autenticação ou SSL: as variáveis já chegaram ao runtime, mas a conexão com o PostgreSQL falhou.
- Widget de comentários não aparece: confira as variáveis `NEXT_PUBLIC_REMARK42_*` e se o host externo do Remark42 está acessível pelo navegador.
