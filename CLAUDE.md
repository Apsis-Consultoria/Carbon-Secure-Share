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
4. **O frontend NÃO TEM VARIÁVEL DE AMBIENTE. NENHUMA.** Não existe `.env`, não
   existe `import.meta.env` em `src/`, não existe URL de Supabase nem anon key
   no bundle. Tudo vai para o caminho relativo `/api/<funcao>`, e quem sabe o
   endereço é a hospedagem, por rewrite (ver `src/lib/endpoint.js`).

   Com a URL no bundle, qualquer pessoa que abrisse a tela de login descobriria
   o endereço do projeto e passaria a bater direto nas Edge Functions, fora do
   nosso domínio, sem log, WAF nem limite de taxa. Não reintroduza `VITE_*`
   aqui: se algo precisa de configuração, ela vive no backend ou na hospedagem.

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
