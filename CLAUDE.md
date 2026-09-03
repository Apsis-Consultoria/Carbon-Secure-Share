# SECURE SHARE CARBON - Contexto do Projeto

## O que é

Portal do CLIENTE para troca de documentos dos projetos de carbono da APSIS. O
cliente entra com e-mail e senha, vê apenas a pasta do projeto dele, visualiza
com marca d'água, baixa e envia arquivos. O armazenamento real é o SharePoint.

Este repositório é **só o lado do cliente**. O lado da APSIS (criar projeto,
subir arquivo, liberar acesso, permissão por item) é a tela Secure Share do
`Portal-Apsis-Carbon`.

Os dois **compartilham o mesmo projeto Supabase**, de propósito: é a mesma pasta
e o mesmo cadastro vistos de dois lados. Dois bancos exigiriam sincronizar
credencial e permissão, e a primeira divergência seria um cliente que continua
entrando depois de a equipe ter revogado o acesso.

## Stack

- Frontend: React 18 + Vite 6 + TailwindCSS 3.4 + React Router 6 + lucide-react
  + sonner + client-zip
- **JavaScript/JSX no frontend, TypeScript nas Edge Functions (Deno).** Nada além
  disso. Alias `@` -> `./src`
- Dev server na porta **5176** (5174 é do Portal Apsis, 5175 do Portal Apsis
  Carbon; os três rodam juntos)
- Tailwind puro, sem shadcn/ui e sem Radix

## Regras críticas

1. **Todo byte de arquivo passa por `carbon-ss-baixar`,** com a permissão
   conferida na requisição. A `downloadUrl` do SharePoint NUNCA chega ao
   navegador e nenhuma função a solicita ao Graph: ela é pré-autenticada, e quem
   a tivesse baixaria o arquivo cru, sem marca d'água, contornando "somente
   visualizar".
2. **O projeto vem do TOKEN de sessão, nunca do parâmetro.** Um `projeto_id` que
   não está no token é 403. Foi assim que o `secure_share` fechou o IDOR
   original.
3. **A regra de uma pasta vale para todo o conteúdo dela,** inclusive subpastas e
   inclusive o ZIP. A herança é aplicada no SERVIDOR
   (`_shared/regrasPermissao.ts` e `carbon_secure_share_nivel_item`). No
   frontend seria contornável pedindo o arquivo pelo caminho completo.
4. **O frontend não tem `import.meta.env` nem `.env`.** Nenhuma anon key, em
   nenhuma hipótese. Tudo vai por `caminhoFuncao()` de `src/lib/endpoint.js`.

   **O destino é decidido no BUILD, e desde 02/09/2026 tem dois modos.**
   `vite.config.js` injeta `__BASE_API__` pelo `define`:

   | `SUPABASE_API_URL` no build | `__BASE_API__` | Depende de rewrite? | Endereço no bundle? |
   |---|---|---|---|
   | ausente (e sempre em dev) | `/api` | sim | não |
   | presente | `https://<ref>.supabase.co/functions/v1` | não | **sim** |

   O modo relativo é o DESENHO PREFERIDO: com a URL no bundle, qualquer pessoa
   que abra a tela de login descobre o endereço e passa a bater direto nas Edge
   Functions, fora do nosso domínio, sem log, WAF nem limite de taxa. Quem
   autoriza é o token de sessão assinado com `SESSION_SECRET`, conferido dentro
   de cada função, então conhecer o endereço não dá acesso: o que se perdeu é
   defesa em profundidade, não a fechadura.

   **Por que o segundo modo existe.** Em 02/09/2026
   `secureshare.apsiscarbon.com` subiu sem a regra de rewrite, que só se
   configura no console do Amplify. O POST do login levava 301 para
   `/api/carbon-ss-codigo/`, o navegador seguia virando GET, perdia o corpo e
   recebia 404. Nenhuma mudança de código alcançava isso com caminho relativo.

   **COMO VOLTAR AO MODO PREFERIDO:** quando a regra de rewrite existir, apague a
   variável `SUPABASE_API_URL` do ambiente de build da Amplify. O próximo build
   volta para `/api`. Não há código para mexer, e o valor não está escrito em
   lugar nenhum do repositório.

   Não reintroduza `VITE_*`: sem o prefixo, o Vite se recusa a expor a variável
   por conta própria, e quem decide se ela entra no bundle é o `define`, num
   único lugar auditável. Também não existe cliente supabase-js aqui, de
   propósito: ele só criaria a tentação de consultar uma tabela direto e pular a
   checagem de permissão.

   Também não existe cliente supabase-js neste bundle, de propósito: ele só
   criaria a tentação de consultar uma tabela direto e pular a checagem de
   permissão.
5. **Proibido o caractere travessão (em dash).** Em código, comentários, textos,
   markdown, SQL e commits. Use hífen. Para conferir:
   `grep -rlP "\xe2\x80\x94" .` (o teste com `$'\u2014'` NÃO funciona no Git Bash
   e dá falso negativo).
6. **Interface e documentação em português do Brasil**, com acentuação correta.
7. **LGPD:** nunca hardcode dado pessoal. Nome e e-mail de cliente existem no
   banco porque são necessários ao acesso nominal, nunca no código, nunca em
   exemplo. Não inventar cliente real em teste ou seed.
8. **Nunca tela branca.** Não há mais checagem de configuração no boot, porque
   não há configuração no frontend para checar. Se o rewrite `/api` faltar na
   hospedagem, `src/lib/api.js` detecta pelo `content-type` (a SPA devolveria
   HTML) e lança `proxy_nao_configurado` com mensagem própria, na primeira
   chamada. A tela de login continua aparecendo normalmente.
9. **Mensagem de erro é para LEITOR EXTERNO.** Quem lê é um cliente que não sabe
   o que é Edge Function, Graph ou SharePoint, e não pode fazer nada a respeito.
   Detalhe técnico vai para `console.error`, nunca para a resposta HTTP.

## Regra 10: conteúdo de cliente NUNCA vira documento na nossa origem

Desde que o frontend passou a falar por `/api/*` (rewrite da hospedagem), a
resposta de `carbon-ss-baixar` chega ao navegador na **mesma origem** do portal.
Antes vinha de `<ref>.supabase.co` e o isolamento era automático.

Consequência: um arquivo `.html` enviado por um cliente e aberto num `<iframe>`
rodaria script **com acesso ao `sessionStorage` do portal**, ou seja, ao token de
sessão de quem o abriu. Um cliente roubaria a sessão de outra pessoa da mesma
empresa só subindo um arquivo.

Três camadas, e nenhuma sozinha basta:

1. **Servidor** (`carbon-ss-baixar`): extensão ou content-type executável
   (`html`, `svg`, `xml`, ...) é servido como `text/plain`, mais
   `X-Content-Type-Options: nosniff` e `Content-Security-Policy` com `sandbox`;
2. **Lista branca no visualizador** (`src/components/Visualizador.jsx`): só
   imagem, PDF/Office e texto são exibidos. Formato fora da lista não vira
   iframe, vira "sem prévia" com o botão de baixar;
3. **`sandbox=""` no iframe**: sem `allow-same-origin`, o documento cai numa
   origem opaca e não alcança o `sessionStorage` mesmo que escape das outras duas.

Imagem vai em `<img>`, **nunca** em iframe: ali o navegador desliga script, o que
torna seguro até um SVG malicioso.

## Armadilhas que NÃO devem ser replicadas

- `index.html` precisa de `lang="pt-BR" translate="no"` e
  `<meta name="google" content="notranslate">`, mais o dom-guard do
  `src/main.jsx`. Sem isso o Google Tradutor envolve os textos em `<font>` por
  fora do React e a tela quebra. Aqui o risco é maior do que nos portais
  internos: a máquina é do cliente, com as extensões que ele tiver.
- Sessão em `sessionStorage`, não `localStorage`: cliente costuma acessar de
  máquina compartilhada, e a sessão deve morrer ao fechar a aba.
- O ZIP é montado no NAVEGADOR. Montar na Edge Function estoura tempo e memória
  numa pasta grande e gera arquivo corrompido.
- Nada de visualizador Office externo (`view.officeapps.live.com`): entregaria a
  URL do documento a um terceiro e impediria a marca d'água. O Graph converte
  para PDF do lado do servidor.
- Marca d'água sem logo remoto: o `secure_share` baixa um PNG do Storage de
  OUTRO projeto Supabase a cada PDF. Aqui a marca é tipográfica.
- Login não distingue "e-mail não existe" de "senha errada". Confirmar que um
  e-mail tem cadastro já diria que aquela pessoa é cliente da APSIS num projeto
  de carbono.
- `carregarPermissoes` FALHA FECHADA: erro de banco devolve um resolvedor que
  nega tudo. Um erro transitório não pode virar acesso indevido.

## Onde as coisas estão

| Camada | Caminho |
|---|---|
| Sessão assinada (HMAC) | `supabase/functions/_shared/sessao.ts` |
| Regra de permissão (pura) | `supabase/functions/_shared/regrasPermissao.ts` |
| Permissão com I/O | `supabase/functions/_shared/permissoes.ts` |
| SharePoint (Graph app-only) | `supabase/functions/_shared/graph.ts` |
| Marca d'água | `supabase/functions/_shared/marcaDagua.ts` |
| Sanitização de caminho | `supabase/functions/_shared/caminho.ts` |
| ZIP no navegador | `src/lib/pastaZip.js` |
| Chamadas do frontend | `src/lib/api.js` |

## Instruções para o Claude

Mantenha o contexto vivo em:

```
C:\Users\FilipeOliveiraAPSISC\Conciencia_Obisidian\projetos\Apsis Carbon\contexto.md
```

Leia no início de cada sessão. Se o diretório não existir, **pergunte onde está
o vault** em vez de criar arquivo vazio: ele pode estar sincronizado em outro
lugar, e criar vazio arriscaria sobrescrever o conteúdo real.

Registre sem precisar ser solicitado: feature concluída, bug relevante corrigido
e decisão arquitetural. Decisões técnicas novas entram em `decisoes.md` no
formato `CARB-XXX`.
