# Pedido ao TI: acessos para o Apsis Carbon

Documento para encaminhar a quem administra o tenant da APSIS. Ele cobre **tudo**
o que o Apsis Carbon precisa no Azure, no SharePoint e no Exchange, para não
haver uma segunda rodada de pedidos.

Resumo em uma linha: **dois papéis para o Filipe** (Parte 1) resolvem quase tudo
para sempre. Sem eles, o TI precisa executar a Parte 2 inteira.

---

## Parte 1 - Papéis (o que evita pedidos futuros)

Estes são os pedidos que importam. Com eles, o time de desenvolvimento passa a
configurar aplicativos sozinho e o TI não é acionado de novo a cada permissão.

| Papel no Entra ID | Para quê | Sem ele |
|---|---|---|
| **Administrador de Aplicativos de Nuvem** (*Cloud Application Administrator*) | criar registros de aplicativo e conceder *Grant admin consent* nas permissões do Graph | cada permissão nova vira um chamado |
| **Administrador do SharePoint** | autorizar aplicativos em sites específicos (`Sites.Selected`) | cada site novo vira um chamado |

Os dois são papéis de escopo limitado: nenhum deles dá acesso a e-mail, a
arquivo de usuário nem a dado de RH. O *Cloud Application Administrator*
especificamente **não** permite gerenciar papéis de diretório, ou seja, não é
escalável para administrador global.

Se a política da APSIS não permitir conceder esses papéis, o TI precisa executar
a Parte 2 e ficará no caminho crítico de toda mudança futura.

---

## Parte 2 - O que precisa ser configurado

### 2.1. Dois registros de aplicativo

Já criados. Nada a fazer aqui além do que vem abaixo.

| Aplicativo | Para quê |
|---|---|
| `[Carbon] Secure Share` | portal do cliente externo: lê e escreve arquivos, envia o código de acesso |
| `[Carbon] Portal` | portal interno da equipe: mesma biblioteca, mais o convite de acesso |

### 2.2. Permissões de API - **iguais para os dois**

Microsoft Graph, tipo **Aplicativo** (não *Delegado*), com **consentimento do
administrador concedido**:

| Permissão | Para quê |
|---|---|
| `Sites.Selected` | acesso a sites do SharePoint, **nenhum** até ser autorizado site a site (item 2.3) |
| `Mail.Send` | enviar o código de acesso e o convite ao cliente |

Nenhuma outra permissão é necessária. Em particular, **não** conceder
`Sites.ReadWrite.All`, `Sites.FullControl.All` nem `Files.ReadWrite.All`: elas
dariam acesso a todo o SharePoint da APSIS, e a arquitetura foi feita para não
precisar disso.

> Para comparação: o registro `[Apsis] Portal`, do sistema antigo, tem hoje
> `Sites.FullControl.All`, `Sites.ReadWrite.All` e `Files.ReadWrite.All` como
> permissões de aplicativo. Vale uma revisão futura, mas não bloqueia nada agora.

### 2.3. Autorizar os dois aplicativos no site (o passo que trava)

`Sites.Selected` não concede acesso a nada sozinha. Cada aplicativo precisa ser
autorizado **no site**, com papel `write`:

- Site: `https://apsisconsult.sharepoint.com/sites/Projetos`
- Papel: **write** (não `read`: o cliente envia arquivos)
- Aplicativos: os dois do item 2.1

**Este passo não tem tela no portal do Azure.** Ele é uma chamada
`POST /sites/{id}/permissions` no Microsoft Graph, e esse endpoint **não aceita
chamada delegada**: exige `Sites.FullControl.All` como permissão de
**aplicativo**. É por isso que o Graph Explorer devolve `403` mesmo para quem é
administrador global.

Há dois caminhos. **Um só é necessário.**

**Caminho A - PnP PowerShell** (para quem é Administrador do SharePoint):

Exige que o aplicativo *PnP Management Shell*
(`31359c7f-bd7e-475c-86db-fdb8c937548e`) esteja consentido no tenant. Se não
estiver, o login falha com `AADSTS700016`. Consentir uma vez:

```powershell
Register-PnPManagementShellAccess
```

Depois, para cada aplicativo:

```powershell
Connect-PnPOnline -Url "https://apsisconsult.sharepoint.com/sites/Projetos" -Interactive
Grant-PnPAzureADAppSitePermission -AppId "<client-id>" -DisplayName "<nome>" -Permissions Write
```

**Caminho B - o script deste repositório** (não exige papel de SharePoint):

O aplicativo se autoriza sozinho, com `Sites.FullControl.All` ligada
**temporariamente**:

1. no `[Carbon] Secure Share`, acrescentar `Sites.FullControl.All` de aplicativo
   e conceder o consentimento;
2. rodar `node scripts/autorizar-site.mjs`, que autoriza os dois aplicativos;
3. **remover** `Sites.FullControl.All` e conceder o consentimento de novo.

O passo 3 é obrigatório. Sem ele o aplicativo fica com controle total de todo o
SharePoint, que é exatamente o que o `Sites.Selected` existe para evitar.

### 2.4. Restringir o `Mail.Send` a uma caixa

`Mail.Send` de aplicativo autoriza enviar e-mail **como qualquer pessoa do
tenant**, inclusive um diretor. Como a credencial vive num serviço de nuvem, um
vazamento viraria phishing perfeito.

A trava é uma política do Exchange Online, executada por quem administra o
Exchange, **para cada um dos dois aplicativos**:

```powershell
New-ApplicationAccessPolicy -AppId "<client-id>" -PolicyScopeGroupId portal@apsis.com.br -AccessRight RestrictAccess -Description "Apsis Carbon: somente a caixa do portal"
```

Conferir:

```powershell
Test-ApplicationAccessPolicy -Identity portal@apsis.com.br -AppId "<client-id>"
```

Depois disso os aplicativos só conseguem enviar como `portal@apsis.com.br`.

### 2.5. Pastas no SharePoint

Na biblioteca **`Secure Share`** do site `/sites/Projetos`, criar:

```
Apsis Carbon/
  Geral/
```

Os nomes precisam bater exatamente, maiúsculas incluídas.

Não é biblioteca nova: é uma pasta dentro da que o Secure Share já usa. O código
tem uma trava que recusa qualquer operação fora de `Apsis Carbon`.

---

## Como conferir que ficou tudo certo

Do lado do desenvolvimento, sem precisar do TI:

```powershell
node scripts/diagnostico-azure.mjs --escrita
```

Ele lê de dentro do token quais permissões o consentimento **realmente**
concedeu, resolve o site e a biblioteca, e faz um teste de escrita completo
dentro de `Apsis Carbon`. Nenhum segredo é impresso.

O resultado esperado lista apenas `Sites.Selected` e `Mail.Send`, e termina em
"Resultado: tudo certo".

---

## Mensagem pronta para encaminhar

> Preciso de dois papéis no Entra ID para tocar a configuração do Apsis Carbon
> sem depender do TI a cada passo: **Administrador de Aplicativos de Nuvem** e
> **Administrador do SharePoint**. Nenhum dos dois dá acesso a e-mail, arquivo de
> usuário ou dado de RH, e nenhum permite gerenciar papéis de diretório.
>
> Se não for possível, preciso que vocês executem quatro coisas, todas descritas
> em detalhe no documento anexo:
>
> 1. conceder consentimento de administrador para `Sites.Selected` e `Mail.Send`
>    (permissões de **aplicativo**) nos registros `[Carbon] Secure Share` e
>    `[Carbon] Portal`. Nenhuma outra permissão;
> 2. autorizar esses dois aplicativos no site `/sites/Projetos` com papel
>    `write`. Isso não tem tela no portal: é `POST /sites/{id}/permissions` no
>    Graph, que exige token de aplicativo. Alternativa mais simples: consentir o
>    app *PnP Management Shell* no tenant e me dar o papel de Administrador do
>    SharePoint, que aí eu mesmo faço;
> 3. criar uma Application Access Policy no Exchange restringindo os dois
>    aplicativos à caixa `portal@apsis.com.br`;
> 4. criar as pastas `Apsis Carbon` e `Apsis Carbon/Geral` na biblioteca
>    `Secure Share` do site `/sites/Projetos`.
>
> A escolha por `Sites.Selected` em vez de `Sites.ReadWrite.All` é deliberada:
> ela limita os aplicativos a um único site, em vez de dar acesso a todo o
> SharePoint da APSIS.
