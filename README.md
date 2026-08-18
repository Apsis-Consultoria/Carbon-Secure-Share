# Secure Share Carbon

Área segura para troca de documentos entre a APSIS Consultoria e os clientes dos
projetos de carbono. O cliente entra com o próprio e-mail e senha e vê **apenas**
a pasta do projeto dele, podendo visualizar (com marca d'água), baixar e enviar
arquivos. O armazenamento real é o SharePoint da APSIS, via Microsoft Graph.

Este é o **lado do cliente**. O lado da APSIS (criar projeto, subir arquivo,
liberar acesso, definir permissão por item) vive na tela Secure Share do
[Portal Apsis Carbon](https://github.com/Apsis-Consultoria/Portal-Apsis-Carbon).

## Arquitetura

```
Navegador do cliente (React + Vite, JavaScript)
   │
   ├─ Entrar ─────────────► carbon-ss-login   ──► RPC carbon_secure_share_autenticar
   │                          (emite token de sessão assinado, HMAC-SHA256)
   │
   ├─ Listar pasta ───────► carbon-ss-listar  ──► SharePoint (Graph) + permissões
   ├─ Ver / baixar ───────► carbon-ss-baixar  ──► SharePoint + marca d'água
   ├─ Baixar pasta (ZIP) ─► carbon-ss-arvore  ──► manifesto do que pode baixar
   │                        + carbon-ss-baixar   (o ZIP é montado no navegador)
   ├─ Enviar arquivos ────► carbon-ss-enviar  ──► SharePoint (Graph)
   └─ Trocar senha ───────► carbon-ss-senha   ──► RPC carbon_secure_share_trocar_senha
```

- **Frontend:** React 18 + Vite 6 + TailwindCSS 3.4 + React Router 6 +
  lucide-react + sonner. **JavaScript/JSX**, sem TypeScript. Alias `@` para `./src`
- **Backend:** Supabase Edge Functions em **TypeScript** (Deno). É a única camada
  que fala com o SharePoint e com o banco
- **Banco:** o **mesmo** projeto Supabase do Portal Apsis Carbon
- **Estilo:** Tailwind puro, sem shadcn/ui e sem Radix. As primitivas em
  `src/components/ui/` vieram do Portal Apsis Carbon, para os dois sistemas
  parecerem o mesmo produto

## Segurança: as três regras que não se negociam

**1. Todo byte passa por `carbon-ss-baixar`, com a permissão conferida na hora.**
A `downloadUrl` do SharePoint nunca chega ao navegador, e nenhuma função daqui a
solicita ao Graph. Ela é pré-autenticada: quem a recebesse baixaria o arquivo
cru, sem marca d'água, contornando qualquer restrição de "somente visualizar".

**2. O projeto vem do token, nunca do parâmetro.** A função de login emite um
token assinado (HMAC-SHA256, validade de 8 horas) que já carrega os projetos
autorizados. As demais funções só validam a assinatura e derivam o projeto dali.
Um `projeto_id` que não está no token devolve 403.

**3. A regra de uma pasta vale para todo o conteúdo dela.** A herança está
implementada no servidor (`_shared/regrasPermissao.ts` e a função
`carbon_secure_share_nivel_item` no banco), não no frontend. Implementada só na
tela, bastaria pedir o arquivo pelo caminho completo para contornar.

Dois modos de acesso ao conteúdo:

| Modo | Quem pode | Comportamento |
|---|---|---|
| `preview` | inclusive "somente visualizar" | `inline`; PDF com marca d'água; Office convertido em PDF pelo Graph e também marcado |
| `download` | só quem pode baixar (403 caso contrário) | `attachment`; PDF com marca d'água; demais em streaming |

Converter Office em PDF no servidor substitui o visualizador externo do
`secure_share` original (`view.officeapps.live.com`), que exigia entregar a URL
do documento a um terceiro e não permitia estampar marca d'água no arquivo.

### Download de pasta em ZIP

O ZIP é montado **no navegador**, em streaming (`src/lib/pastaZip.js`).
`carbon-ss-arvore` devolve o manifesto do que aquele cliente pode baixar e
`carbon-ss-baixar` entrega os bytes de um arquivo por vez.

A escolha é deliberada: uma Edge Function tem teto de tempo e de memória, e uma
pasta de due diligence com alguns GB falharia no meio, gerando um ZIP corrompido
- um defeito que só aparece na hora de abrir.

Valem as mesmas permissões: item negado não entra nem é contado, item "somente
visualizar" fica fora e é reportado em `ignorados`, e a tela avisa quantos
ficaram de fora. **Nunca truncamos em silêncio.**

## Como rodar

```bash
npm install
npm run dev
```

Sobe em **http://localhost:5176**. A porta é obrigatória e `strictPort` está
ligado: 5174 é do Portal Apsis e 5175 do Portal Apsis Carbon, e os três precisam
poder rodar ao mesmo tempo.

Por padrão escuta só em `127.0.0.1`. Para testar no celular:

```bash
VITE_EXPOR_REDE=true npm run dev
```

### Variáveis do frontend

Crie um `.env` na raiz com as duas variáveis abaixo. Elas são **públicas por
design**: entram no bundle e qualquer pessoa lê no DevTools. Nada que comece com
`VITE_` é secreto.

```
VITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co
VITE_SUPABASE_ANON_KEY=COLE_A_ANON_KEY_AQUI
```

A proteção real é a RLS do Postgres (as tabelas do Secure Share não têm policy
nenhuma, então a anon key não lê uma linha) somada ao token de sessão que cada
Edge Function exige.

Faltando qualquer uma delas, o app renderiza `src/pages/ErroConfig.jsx` em vez de
tela branca.

### Secrets das Edge Functions

Configurados no painel do Supabase (Edge Functions > Secrets) ou por
`supabase secrets set`. **Nunca no repositório, nunca com prefixo `VITE_`.**

| Secret | Para que serve |
|---|---|
| `SESSION_SECRET` | assina o token de sessão. Mínimo de 32 caracteres. Trocar invalida todas as sessões abertas. Gerar com `openssl rand -base64 48` |
| `AZURE_TENANT_ID` | registro do app no Entra ID |
| `AZURE_CLIENT_ID` | idem |
| `AZURE_CLIENT_SECRET` | idem |
| `SUPABASE_URL` | injetado pela plataforma |
| `SUPABASE_SERVICE_ROLE_KEY` | injetado pela plataforma |

O registro do app no Azure precisa da permissão de **aplicativo** (não delegada)
`Sites.ReadWrite.All`, com consentimento de administrador.

## Banco de dados

As tabelas principais (`carbon_secure_share_projetos`, `_equipe`, `_clientes`,
`_permissoes`) e as funções `carbon_secure_share_autenticar`, `_nome_pasta` e
`_nivel_item` vêm da migration `20260817120000_secure_share.sql` do repositório
**Portal-Apsis-Carbon**.

Este repositório traz apenas o que é exclusivo do lado do cliente
(`supabase/migrations/20260818120000_portal_cliente.sql`):

- `carbon_secure_share_tentativas` - contador anti força bruta do login
- `carbon_secure_share_trocar_senha` - troca de senha pelo próprio cliente
- `carbon_secure_share_limpar_tentativas` - expurgo, retenção de 90 dias

**Ordem de aplicação:** a migration do Portal-Apsis-Carbon primeiro, esta depois.

### Passo de operação: expurgo das tentativas

A tabela de tentativas cresce sem parar. O expurgo não é agendado na migration
de propósito (`pg_cron` pode não estar habilitado, e uma migration que depende de
extensão ausente trava o deploy). Agende depois:

```sql
select cron.schedule(
  'carbon-ss-limpar-tentativas',
  '0 4 * * 0',
  $$ select public.carbon_secure_share_limpar_tentativas(90) $$
);
```

## Deploy

- **Frontend:** push em `main` → build no AWS Amplify (`amplify.yml`)
- **Edge Functions:** push em `main` que toque `supabase/functions/**` →
  workflow `.github/workflows/deploy-functions.yml`

## Convenções

- Interface e documentação em **português do Brasil**, com acentuação correta
- **Proibido** o caractere travessão (em dash). Use hífen
- Cartões `rounded-2xl`, campos `rounded-xl`, botões `rounded-xl`
- Paleta: verde APSIS `#1A4731` (hover `#245E40`), laranja `#F47920` (hover
  `#e06810`). A tela de login usa `#F48126`, diferente de propósito
- **LGPD:** nunca hardcode dado pessoal. Os nomes e e-mails de clientes existem
  no banco porque são necessários ao acesso nominal, nunca no código
