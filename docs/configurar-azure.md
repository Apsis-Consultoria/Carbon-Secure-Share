# Configurar o Azure AD e o SharePoint

O que este documento resolve: dar ao Secure Share Carbon uma credencial de
**aplicativo** capaz de ler e escrever na biblioteca do SharePoint, sem depender
do usuário de ninguém.

Ao final, três valores existirão como **secrets das Edge Functions** no Supabase.
Nenhum deles entra no repositório, nenhum tem prefixo `VITE_`, e nenhum chega ao
navegador.

> O portal do Azure muda de lugar com frequência. Aqui os passos citam o **nome**
> de cada tela e opção, não o caminho de cliques. Se um nome não bater, procure
> pelo nome na busca do portal.

---

## Por que credencial de aplicativo, e não a do usuário

O Portal Apsis fala com o SharePoint direto do navegador, usando um token
**delegado** do colaborador logado, com escopo `Files.ReadWrite.All`. Isso
significa que qualquer pessoa logada, no console do navegador, tem em mãos um
token que lê e escreve toda a biblioteca a que ela tenha acesso.

Aqui isso não é nem possível: quem abre este portal é um **cliente**, que não tem
conta no tenant da APSIS. O acesso ao SharePoint acontece sempre no servidor, com
credencial de aplicativo (*client credentials*), guardada como secret da Edge
Function.

O ganho não é só de superfície de ataque. Com app-only, quem decide **quem** pode
ver **qual** arquivo é o nosso código (`carbon_secure_share_permissoes`), e não as
permissões que a pessoa por acaso tem no SharePoint.

---

## Permissão mínima: `Sites.Selected`, não `Sites.ReadWrite.All`

Esta é a decisão mais importante do documento.

| Permissão | Alcance |
|---|---|
| `Sites.ReadWrite.All` | escrita em **todos** os sites do SharePoint da APSIS |
| `Sites.Selected` | **nenhum** site, até um administrador autorizar site a site |

O segredo deste aplicativo vai viver no Supabase. Com `Sites.ReadWrite.All`, um
vazamento entrega o SharePoint inteiro da APSIS: RH, jurídico, perícias, tudo.
Com `Sites.Selected`, entrega uma biblioteca.

O `secure_share` original usa `Sites.ReadWrite.All`. **Não repita isso aqui** sem
uma razão escrita.

---

## São DOIS registros, um por sistema

O Portal Apsis Carbon e o Secure Share Carbon rodam no **mesmo projeto Supabase**,
e secret de Edge Function é por **projeto**. Se os dois lessem `AZURE_PORTAL_CLIENT_ID`,
só um registro caberia, e um dos sistemas usaria a credencial do outro em
silêncio. Por isso os nomes têm prefixo:

| Sistema | Secrets |
|---|---|
| Portal Apsis Carbon | `AZURE_PORTAL_TENANT_ID`, `AZURE_PORTAL_CLIENT_ID`, `AZURE_PORTAL_CLIENT_SECRET` |
| Secure Share Carbon | `AZURE_PORTAL_TENANT_ID`, `AZURE_PORTAL_CLIENT_ID`, `AZURE_PORTAL_CLIENT_SECRET` |

Dois registros não são só burocracia: o portal do cliente é a superfície exposta
na internet, e credencial separada permite **rotacionar e revogar um sem derrubar
o outro**. O log de entrada do Azure também passa a dizer qual sistema fez cada
chamada, o que é o que se quer numa investigação.

Este documento cobre o registro do **Secure Share Carbon**. O do Portal segue os
mesmos passos, mudando o nome e os secrets.

## 1. Registrar o aplicativo

No **Microsoft Entra ID** (antigo Azure Active Directory), em **App registrations**,
crie um registro novo:

- **Name:** `Secure Share Carbon`
- **Supported account types:** apenas contas deste diretório organizacional
  (*single tenant*)
- **Redirect URI:** deixe **vazio**. Este aplicativo não faz login de usuário; ele
  só usa client credentials. Um redirect aqui seria superfície sem uso.

Anote da tela **Overview**:

- **Application (client) ID** → vira `AZURE_PORTAL_CLIENT_ID`
- **Directory (tenant) ID** → vira `AZURE_PORTAL_TENANT_ID`

Os dois são identificadores, não segredos.

## 2. Criar o segredo

Em **Certificates & secrets > Client secrets > New client secret**.

- **Description:** `secure-share-carbon`
- **Expires:** o mais curto que a operação suportar. Um segredo que nunca expira é
  um segredo que ninguém troca.

Copie o campo **Value** na hora: ele só aparece uma vez. O campo **Secret ID**
**não** serve para nada aqui, e confundir os dois é o erro mais comum (o
diagnóstico avisa quando o valor é curto demais).

Esse valor vira `AZURE_PORTAL_CLIENT_SECRET`.

> **Anote a data de expiração num lembrete.** Quando ele vencer, o sistema para de
> falar com o SharePoint e o erro que aparece na tela é genérico. O diagnóstico do
> passo 5 identifica isso na hora.

## 3. Conceder a permissão

Em **API permissions > Add a permission > Microsoft Graph > Application permissions**
(não *Delegated*).

Adicione as **duas**:

| Permissão | Para quê |
|---|---|
| `Sites.Selected` | ler e escrever os arquivos na biblioteca |
| `Mail.Send` | enviar ao cliente o código de acesso do login |

`Mail.Send` passou a ser necessária quando o login deixou de ter senha: o cliente
recebe um código por e-mail. Ela é de **aplicativo**, o que significa enviar como
qualquer caixa do tenant - veja a trava obrigatória na seção 3.2.

Depois clique em **Grant admin consent for APSIS**. Sem esse clique a permissão
fica listada mas **não é concedida**, e o token sai sem ela. O diagnóstico do
passo 5 detecta exatamente esse caso.

### 3.1. Autorizar o site específico

`Sites.Selected` não dá acesso a nada sozinha: um administrador precisa autorizar
o aplicativo em cada site. Isso não tem tela no portal do Azure; é uma chamada ao
Graph, feita por quem tem papel de administrador do SharePoint.

Pelo **Graph Explorer** (`developer.microsoft.com/graph/graph-explorer`), logado
com a conta de administrador:

Primeiro, descubra o `id` do site:

```
GET https://graph.microsoft.com/v1.0/sites/apsisconsult.sharepoint.com:/sites/Projetos
```

Depois conceda a permissão de escrita ao aplicativo, usando o `id` devolvido:

```
POST https://graph.microsoft.com/v1.0/sites/{site-id}/permissions
Content-Type: application/json

{
  "roles": ["write"],
  "grantedToIdentities": [
    {
      "application": {
        "id": "<Application (client) ID>",
        "displayName": "Secure Share Carbon"
      }
    }
  ]
}
```

`"roles": ["write"]` e não `["read"]`: o cliente envia arquivos, então o
aplicativo precisa escrever. O diagnóstico com `--escrita` prova isso.

### 3.2. Travar o `Mail.Send` numa caixa só (obrigatório)

`Mail.Send` de aplicativo autoriza enviar e-mail **como qualquer pessoa da
APSIS**, inclusive um diretor. Como esse segredo vive no Supabase, um vazamento
viraria phishing perfeito, assinado por quem o atacante escolher.

A trava é uma política do Exchange Online, executada por quem administra o
Exchange:

```powershell
New-ApplicationAccessPolicy -AppId <Application (client) ID> -PolicyScopeGroupId portal@apsis.com.br -AccessRight RestrictAccess -Description "Secure Share Carbon: so a caixa do portal"
```

Depois disso o app só consegue enviar como `portal@apsis.com.br`, que é o
remetente configurado em `carbon_app_config`. Confirme com:

```powershell
Test-ApplicationAccessPolicy -Identity portal@apsis.com.br -AppId <Application (client) ID>
```

### Alternativa, se `Sites.Selected` não for viável

Se a governança da APSIS não permitir a chamada acima, use `Sites.ReadWrite.All`
no lugar, **e registre a decisão**. O sistema funciona igual; o que muda é o
tamanho do estrago em caso de vazamento. O diagnóstico avisa quando detecta essa
permissão.

## 4. Criar as pastas no SharePoint

Os arquivos do Carbon **não** vão para uma biblioteca separada: vão para uma pasta
dentro da biblioteca que a APSIS já usa.

```
/sites/Projetos
  biblioteca "Secure Share"        <- já existe, compartilhada com o Portal Apsis
    Apsis Carbon/                  <- criar
      Geral/                       <- criar
```

Os nomes precisam bater **exatamente**, maiúsculas incluídas: o código procura a
biblioteca e a pasta pelo nome. Eles vivem em `carbon_app_config`, chave
`secure_share`, nos campos `biblioteca`, `pastaBase` e `pastaGeral`.

A pasta `Geral` é a que todos os clientes enxergam. **Cuidado**: o que for
colocado ali aparece para todos os clientes de todos os projetos.

Como a biblioteca é dividida com o Portal Apsis, o código tem uma trava
(`exigirDentroDaBase` em `_shared/graph.ts`) que recusa qualquer operação fora de
`Apsis Carbon`. Ela é necessária porque o consentimento do Azure é por **site**,
não por pasta: a credencial tecnicamente alcança a biblioteca inteira.

## 5. Provar que funciona, antes de depender disso

Rode o diagnóstico. Ele obtém o token, mostra **quais permissões o consentimento
realmente concedeu**, resolve o site e a biblioteca, lê a raiz e, com `--escrita`,
cria uma pasta temporária, envia um arquivo, lê de volta e apaga tudo.

O segredo nunca é impresso.

PowerShell:

```powershell
$env:AZURE_PORTAL_TENANT_ID = Read-Host "Tenant ID"
$env:AZURE_PORTAL_CLIENT_ID = Read-Host "Client ID"
$env:AZURE_PORTAL_CLIENT_SECRET = Read-Host "Client Secret"
node scripts/diagnostico-azure.mjs --escrita
```

Git Bash:

```bash
read -s -p "Client Secret: " AZURE_PORTAL_CLIENT_SECRET
export AZURE_PORTAL_CLIENT_SECRET
export AZURE_PORTAL_TENANT_ID=...; export AZURE_PORTAL_CLIENT_ID=...
node scripts/diagnostico-azure.mjs --escrita
```

Só siga adiante quando terminar em **"Resultado: tudo certo"**.

## 6. Gravar como secrets das Edge Functions

Depois que o projeto Supabase existir, os três valores vão para lá. **Nunca** em
arquivo do repositório.

Pelo painel: **Edge Functions > Secrets**. Ou pela CLI:

```bash
npx supabase secrets set AZURE_PORTAL_TENANT_ID="..." AZURE_PORTAL_CLIENT_ID="..." AZURE_PORTAL_CLIENT_SECRET="..." --project-ref bknkjcqrnzjjnvtviati
```

As aspas importam: o segredo do Azure costuma trazer `/`, `+` e `=`, e sem elas o
shell come parte do valor. O sintoma seria o login funcionando na emissao e
falhando na validacao, que e chato de diagnosticar. Colar pelo painel evita isso.

Falta ainda um quarto secret, que não é do Azure: `SESSION_SECRET`, que assina o
token de sessão do cliente. Gere um valor aleatório de 32 caracteres ou mais:

```bash
openssl rand -base64 48
```

Trocar o `SESSION_SECRET` invalida todas as sessões abertas. Isso é útil: é o
botão de "derrubar todo mundo" se algo der errado.

---

## Ordem de dependência

O Azure é só uma das peças. A ordem completa até testar com arquivo real:

| # | Passo | Depende de |
|---|---|---|
| 1 | Registrar o app e conceder `Sites.Selected` | - |
| 2 | Criar a biblioteca `Secure Share Carbon` | - |
| 3 | Rodar o diagnóstico e passar | 1 e 2 |
| 4 | **Provisionar o projeto Supabase** | - |
| 5 | Aplicar a migration do `Portal-Apsis-Carbon` | 4 |
| 6 | Aplicar `20260818120000_portal_cliente.sql` deste repositório | 5 |
| 7 | Gravar os 4 secrets | 4 e 3 |
| 8 | Publicar as 6 Edge Functions | 7 |
| 9 | Cadastrar um projeto e um cliente de teste | 6 |
| 10 | Apontar o front para as funções | 8 |

Os passos 1 a 3 podem ser feitos **hoje**, e são independentes do Supabase.

O passo 9, enquanto a tela do Portal Carbon não estiver publicada, é SQL direto no
banco: um `insert` em `carbon_secure_share_projetos`, outro em
`carbon_secure_share_clientes` e um `select carbon_secure_share_definir_senha(...)`
para emitir a senha.

O passo 10, em desenvolvimento, é a variável do processo do Vite (não do
navegador, e sem prefixo `VITE_`, então ela não entra no bundle):

```powershell
$env:SUPABASE_API_URL="https://<ref>.supabase.co"; npm run dev
```

Em produção é a regra de rewrite no console do Amplify. Ver o README.

---

## Quando algo parar de funcionar

| Sintoma | Causa provável |
|---|---|
| `invalid_client` no diagnóstico | segredo errado, expirado, ou copiaram o *Secret ID* em vez do *Value* |
| Token sem permissão nenhuma | faltou **Grant admin consent** |
| 403 no site, token com `Sites.Selected` | falta autorizar **este site** para o app (passo 3.1) |
| Lê mas não escreve | o papel concedido no site foi `read` em vez de `write` |
| 404 na biblioteca | nome diferente, inclusive maiúsculas |
| Funcionava e parou de repente | o client secret **expirou** |
