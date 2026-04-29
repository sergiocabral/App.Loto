# Luckygames

Aplicação Next.js para consultar resultados das Loterias da Caixa, persistir concursos em PostgreSQL e visualizar análises simples para apoiar a leitura histórica dos sorteios. O app não promete previsão ou ganho; ele organiza dados públicos, filtros e estatísticas para consulta.

## Funcionalidades atuais

- Consulta das loterias suportadas: Mega Sena, Lotofácil, Quina, Lotomania, Dupla Sena, Timemania e Dia de Sorte.
- Persistência dos concursos em PostgreSQL.
- Sincronização incremental com a API pública das Loterias da Caixa, com botão para carregar/pausar resultados.
- Consulta por número de concurso.
- Filtro por números: exibe concursos que contenham todos os números informados.
- Lista de resultados otimizada: começa com 25 concursos e o botão "Ver mais resultados" carrega blocos cada vez maiores, em sequência 50, 100, 200 e 400.
- Análise rápida por período: últimos 10, 25, 50, 100 concursos ou faixa personalizada no slider "Ajustar".
- Análise específica da Dupla Sena por todos os sorteios, 1º sorteio ou 2º sorteio.
- Visões da análise rápida:
  - Mais sorteados.
  - Calor recente: mapa de calor ponderado por recorrência recente; o último concurso vale 1 ponto, o anterior 0,9 e os anteriores valem progressivamente menos.
  - Mapa: mapa de calor por frequência simples.
  - Menos sorteados.
  - Atrasados.
- Sugestões "Estou com sorte" baseadas na visão ativa da análise rápida, sem garantia estatística.
- Página raw em `/raw/[loteria]`, com opção de consultar concurso via `?draw=NUMERO`.
- Página 404 personalizada com identidade visual do site.
- Comentários via Remark42, quando configurado.
- Analytics via Umami, quando configurado.
- Chat GPT opcional para conversar sobre o recorte carregado, quando OpenAI estiver configurado.
- Redirect canônico opcional no Cloudflare Worker usando `OFFICIAL_DOMAIN_NAME`, entregue como uma página HTML leve que redireciona pelo navegador.

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

Para rodar localmente em modo produção Next.js:

```bash
npm run build
npm run start
```

O `next start` também sobe, por padrão, em:

```text
http://localhost:3000
```

## Rodando localmente como Cloudflare Worker

Para testar o runtime mais próximo do Cloudflare Workers, use o preview do OpenNext:

```bash
npm run preview
```

Esse comando executa o build OpenNext e inicia um Worker local via Wrangler.

Para preview local com Wrangler, mantenha secrets fora do Git. Se precisar informar secrets ao Worker local, use `App.Loto/.dev.vars`, que é ignorado pelo Git:

```env
POSTGRES_PASSWORD=change-me
OPENAI_API_KEY=
```

As demais variáveis não secretas do Worker ficam em `wrangler.jsonc`. Se quiser sobrescrever alguma apenas localmente, adicione também em `.dev.vars`.

## Arquivos de ambiente

### Localhost com Next.js

Em desenvolvimento e produção local com `next dev` ou `next start`, o app lê:

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
| `POSTGRES_HOST` | Obrigatória, exceto com Hyperdrive string | Configurada em `wrangler.jsonc` ou painel | Host do PostgreSQL. |
| `POSTGRES_PORT` | Opcional | Configurada em `wrangler.jsonc` ou painel | Porta do PostgreSQL. Padrão: `5432`. |
| `POSTGRES_USER` | Obrigatória, exceto com Hyperdrive string | Configurada em `wrangler.jsonc` ou painel | Usuário do banco. |
| `POSTGRES_PASSWORD` | Obrigatória, exceto com Hyperdrive string | Secret obrigatório quando usar `POSTGRES_*` | Senha do banco. Nunca versionar. |
| `POSTGRES_DATABASE` | Recomendada | Configurada em `wrangler.jsonc` ou painel | Banco usado pela aplicação. Se vazio, usa `POSTGRES_USER`. |
| `POSTGRES_SSL` | Opcional | Configurada em `wrangler.jsonc` ou painel | Ativa SSL na conexão com PostgreSQL quando `true`. |
| `POSTGRES_SSL_ALLOW_INSECURE` | Opcional | Configurada em `wrangler.jsonc` ou painel | Permite SSL sem validar certificado. Não pode ser `true` em produção. |
| `POSTGRES_CONNECTION_TIMEOUT_MS` | Opcional | Configurada em `wrangler.jsonc` ou painel | Timeout para abrir conexão com o banco. |
| `POSTGRES_IDLE_TIMEOUT_MS` | Opcional | Configurada em `wrangler.jsonc` ou painel | Tempo máximo de conexão ociosa no pool. |
| `POSTGRES_QUERY_TIMEOUT_MS` | Opcional | Configurada em `wrangler.jsonc` ou painel | Timeout de queries no cliente PostgreSQL. |
| `POSTGRES_STATEMENT_TIMEOUT_MS` | Opcional | Configurada em `wrangler.jsonc` ou painel | Timeout de statements no PostgreSQL. |
| `POSTGRES_POOL_MAX` | Opcional | Recomendado `1` | Tamanho máximo do pool. Em Workers, use `1`. |
| `POSTGRES_POOL_MAX_USES` | Opcional | Recomendado `1` | Quantidade máxima de usos por conexão. Em Workers, use `1`. |
| `HYPERDRIVE_CONNECTION_STRING` | Opcional | Opcional | Connection string quando usar Cloudflare Hyperdrive sem binding. |
| `NEXT_RUNTIME_PROVIDER` | Opcional | `cloudflare` | Marca o runtime Cloudflare para ajustes seguros de pool. |
| `OFFICIAL_DOMAIN_NAME` | Opcional | Recomendada | Domínio canônico sem protocolo, caminho ou porta, por exemplo `luckygames.tips`. Quando vazio ou inválido, não redireciona domínios alternativos. |
| `NEXT_PUBLIC_APP_VERSION` | Opcional em build time | Opcional em build time | Versão pública usada em saídas textuais. Padrão interno: `v1.3.x`. |
| `NEXT_PUBLIC_UMAMI_SCRIPT_URL` | Opcional em build time | Opcional em build time | URL pública do script Umami usado para analytics. |
| `NEXT_PUBLIC_UMAMI_WEBSITE_ID` | Opcional em build time | Opcional em build time | Identificador do site no Umami. |
| `NEXT_PUBLIC_REMARK42_HOST` | Opcional em build time | Opcional em build time | Host público do Remark42. Padrão usado no app: `https://comments.cabral.dev`. |
| `NEXT_PUBLIC_REMARK42_SITE_ID` | Opcional em build time | Opcional em build time | Site ID do Remark42. Padrão usado no app: `global`. |
| `NEXT_PUBLIC_REMARK42_LOCALE` | Opcional em build time | Opcional em build time | Locale do Remark42. Padrão usado no app: `bp`. |
| `NEXT_PUBLIC_REMARK42_NO_FOOTER` | Opcional em build time | Opcional em build time | Remove footer do Remark42 quando diferente de `false`. |
| `OPENAI_API_KEY` | Opcional | Secret opcional | Chave da OpenAI. Habilita o chat somente quando usada junto com `OPENAI_CHAT_MODEL`. |
| `OPENAI_CHAT_MODEL` | Opcional | Opcional/secret | Modelo usado pelo chat. Habilita o chat somente quando usado junto com `OPENAI_API_KEY`. |
| `CHATGPT_BUTTON1` | Opcional | Opcional | Sobrescreve o 1º botão de sugestão do chat no formato `Rótulo|Mensagem|Prompt`. |
| `CHATGPT_BUTTON2` | Opcional | Opcional | Sobrescreve o 2º botão de sugestão do chat no formato `Rótulo|Mensagem|Prompt`. |
| `CHATGPT_BUTTON3` | Opcional | Opcional | Sobrescreve o 3º botão de sugestão do chat no formato `Rótulo|Mensagem|Prompt`. |
| `CHATGPT_BUTTON4` | Opcional | Opcional | Sobrescreve o 4º botão de sugestão do chat no formato `Rótulo|Mensagem|Prompt`. |

Observações:

- Variáveis `NEXT_PUBLIC_*` são incorporadas no bundle durante o build. Defina esses valores antes do build se quiser algo diferente dos padrões.
- `POSTGRES_PASSWORD` precisa existir como secret no Worker quando a conexão usa `POSTGRES_*`. Se faltar, a API retorna erro de configuração antes de tentar conectar no banco.
- `OPENAI_API_KEY` deve ser secret no Worker. Sem `OPENAI_API_KEY` e `OPENAI_CHAT_MODEL`, o chat não aparece para o usuário.
- `OFFICIAL_DOMAIN_NAME` deve ser apenas domínio, como `luckygames.tips`. Não use `https://`, `/`, porta ou path.

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
OFFICIAL_DOMAIN_NAME=

NEXT_PUBLIC_APP_VERSION=v2.0.0
NEXT_PUBLIC_UMAMI_SCRIPT_URL=
NEXT_PUBLIC_UMAMI_WEBSITE_ID=

NEXT_PUBLIC_REMARK42_HOST=https://comments.cabral.dev
NEXT_PUBLIC_REMARK42_SITE_ID=global
NEXT_PUBLIC_REMARK42_LOCALE=bp
NEXT_PUBLIC_REMARK42_NO_FOOTER=true

OPENAI_API_KEY=
OPENAI_CHAT_MODEL=
CHATGPT_BUTTON1=Mapa quente|Mostre o mapa quente desse filtro.|Analise os concursos filtrados como um mapa quente da loteria.
CHATGPT_BUTTON2=Surpresas|Quais surpresas aparecem aqui?|Procure achados contraintuitivos nos resultados filtrados.
CHATGPT_BUTTON3=Ciclos|Analise ciclos e atrasos.|Faça uma análise de ciclos, atrasos e recorrência nos concursos filtrados.
CHATGPT_BUTTON4=Estratégia|Monte uma estratégia de leitura dos dados.|Crie uma estratégia de leitura dos dados filtrados.
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

## Sincronização dos resultados

A sincronização incremental com a API das Loterias da Caixa é pública e roda em lotes pequenos. Ela pode ser iniciada pela interface quando o usuário carrega uma loteria.

Proteções atuais:

- rate limit simples por IP e loteria;
- validação de body JSON;
- lote pequeno por chamada;
- lock em memória por loteria para evitar duas sincronizações iguais no mesmo processo.

A API aceita apenas a ação pública `sync-caixa` para carregar resultados faltantes. Não há endpoint público para sobrescrever manualmente um concurso específico.

## Analytics com Umami

Quando `NEXT_PUBLIC_UMAMI_SCRIPT_URL` e `NEXT_PUBLIC_UMAMI_WEBSITE_ID` estão definidos no build, o layout injeta automaticamente o script do Umami em todas as páginas.

Se qualquer uma das duas variáveis estiver vazia, o script não é carregado.

Além dos pageviews automáticos, o app envia eventos compatíveis com `window.umami.track(eventName, data)`, disponível no Umami 3.x. As chamadas são centralizadas e defensivas: se o script estiver bloqueado, ausente ou lento, a navegação e os botões continuam funcionando.

Eventos instrumentados:

- seleção de loteria;
- pesquisa por números, enviando apenas a quantidade pesquisada;
- consulta por concurso, sem enviar o número digitado;
- limpeza de filtro;
- carregamento incremental de resultados;
- seleção/cópia de sorteio;
- geração pelo botão “Estou com sorte” e cópia de sugestão;
- mudanças na análise rápida, período, faixa customizada e escopo da Dupla Sena;
- abertura da página de todos os sorteios;
- início, pausa, conclusão e falha de sincronização;
- abertura, fechamento, uso de sugestão, envio de pergunta, resposta recebida e falha do chat;
- clique no link `idontneedit.org` das áreas de doação.

Por privacidade, os eventos não enviam combinações sugeridas, números digitados pelo usuário nem texto livre do chat. São enviados apenas metadados como loteria, tipo de análise, contagens e estados da interação.

## Comentários com Remark42

A seção de comentários é carregada no cliente via Remark42. Por padrão, o app usa:

```env
NEXT_PUBLIC_REMARK42_HOST=https://comments.cabral.dev
NEXT_PUBLIC_REMARK42_SITE_ID=global
NEXT_PUBLIC_REMARK42_LOCALE=bp
NEXT_PUBLIC_REMARK42_NO_FOOTER=true
```

Para trocar de instância, site ID ou locale, defina as variáveis `NEXT_PUBLIC_REMARK42_*` antes do build.

## Chat GPT opcional

O chat aparece somente quando `OPENAI_API_KEY` e `OPENAI_CHAT_MODEL` estão configurados no servidor.

Os botões rápidos do chat podem ser personalizados com `CHATGPT_BUTTON1` até `CHATGPT_BUTTON4`, sempre no formato:

```text
Rótulo|Mensagem enviada ao chat|Prompt interno para orientar a resposta
```

O chat recebe apenas o contexto de loteria, filtros, concursos e análise rápida enviados pelo app. Ele possui limites de tamanho, rate limit simples e guardrails para não revelar instruções internas ou segredos.

## Redirect canônico por domínio

No Cloudflare Worker, `OFFICIAL_DOMAIN_NAME` permite receber tráfego por múltiplos domínios e redirecionar para o domínio oficial preservando path e query string. Para evitar exceções/cache agressivo de redirect HTTP no Worker, o domínio alternativo recebe uma página HTML mínima com `Cache-Control: no-store`, `meta refresh` e `window.location.replace(...)`.

Exemplo:

```env
OFFICIAL_DOMAIN_NAME=luckygames.tips
```

Regras importantes:

- Use somente o domínio, sem `https://`, sem `/`, sem porta e sem path.
- Se a variável estiver vazia, inválida ou apontar para localhost, nenhum redirect é feito.
- Se o app já foi carregado pelo domínio oficial, nenhum redirect é feito.
- O redirecionamento é decidido no Worker antes de entregar a requisição ao Next/OpenNext, mas a navegação para o domínio oficial é feita pelo navegador por uma resposta HTML `200` sem cache.

## Deploy no Cloudflare Workers

Este app usa Next.js com OpenNext para Cloudflare Workers. O deploy correto gera primeiro o bundle `.open-next` e depois publica o Worker.

### Configuração necessária no painel da Cloudflare

No Worker `app-loto`, configure pelo menos o secret:

```text
POSTGRES_PASSWORD
```

Se o chat for usado, configure também:

```text
OPENAI_API_KEY
```

As variáveis não secretas principais já estão versionadas em `wrangler.jsonc`, incluindo:

```text
NEXT_RUNTIME_PROVIDER
OFFICIAL_DOMAIN_NAME
POSTGRES_HOST
POSTGRES_PORT
POSTGRES_USER
POSTGRES_DATABASE
POSTGRES_SSL
POSTGRES_SSL_ALLOW_INSECURE
POSTGRES_CONNECTION_TIMEOUT_MS
POSTGRES_IDLE_TIMEOUT_MS
POSTGRES_QUERY_TIMEOUT_MS
POSTGRES_STATEMENT_TIMEOUT_MS
POSTGRES_POOL_MAX
POSTGRES_POOL_MAX_USES
```

Variáveis `NEXT_PUBLIC_*`, `OPENAI_CHAT_MODEL` e `CHATGPT_BUTTON1` até `CHATGPT_BUTTON4` podem ser configuradas no painel ou no ambiente de build, conforme a estratégia de deploy.

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
npx opennextjs-cloudflare build
npx wrangler deploy --dry-run
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

## Testes e validação

A suíte usa Vitest.

Rode os testes:

```bash
npm test
```

Validação completa recomendada antes de publicar:

```bash
npm run lint
npm test
npm run build
npx opennextjs-cloudflare build
npx wrangler deploy --dry-run
```

## Diagnóstico rápido

- `Missing PostgreSQL configuration: POSTGRES_PASSWORD`: o secret `POSTGRES_PASSWORD` não está chegando ao runtime do Worker.
- `Missing PostgreSQL configuration: POSTGRES_HOST`: a variável `POSTGRES_HOST` não está configurada no Worker ou foi removida do ambiente.
- Erro de timeout, autenticação ou SSL: as variáveis chegaram ao runtime, mas a conexão com o PostgreSQL falhou.
- Chat não aparece: confira `OPENAI_API_KEY` e `OPENAI_CHAT_MODEL` no runtime do servidor.
- Widget de comentários não aparece: confira as variáveis `NEXT_PUBLIC_REMARK42_*` e se o host externo do Remark42 está acessível pelo navegador.
- Analytics não aparece: confira se `NEXT_PUBLIC_UMAMI_SCRIPT_URL` e `NEXT_PUBLIC_UMAMI_WEBSITE_ID` estavam definidos antes do build.
- Redirect inesperado ou loop no Cloudflare: confira se `OFFICIAL_DOMAIN_NAME` contém somente domínio, sem protocolo, path ou porta, e limpe cache de redirects antigos no navegador/CDN se necessário.
