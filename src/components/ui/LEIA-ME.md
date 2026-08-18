# Primitivas de interface do Apsis Carbon

Padrão visual extraído das telas já existentes (`src/pages/Projetos.jsx`,
`src/pages/ProjetoPdd.jsx`, `src/pages/BoasVindas.jsx`). Nenhuma estética nova foi
inventada aqui: os componentes só transformam em prop o que já se repetia nas telas.

**Use estas primitivas.** Não reimplemente cartão, tabela, badge, estado vazio nem
formulário na sua tela: o objetivo é que onze módulos de domínio diferentes pareçam o
mesmo sistema.

## Regras que valem para todos

- Tailwind direto, sem shadcn e sem Radix. Nenhuma dependência nova.
- Paleta: verde `#1A4731` (e `#245E40` no hover), laranja `#F47920` (e `#e06810` no
  hover), texto `#1A2B1F`, secundário `#5C7060`, terciário `#8A9990`, borda `#DDE3DE`,
  fundo `#F4F6F4`, divisória interna `#F4F6F4`, trilha `#E8EDE9`.
- Raio: cartão `rounded-2xl`, campo `rounded-xl`, botão `rounded-xl` no tamanho md e
  `rounded-lg` no sm, selo `rounded-full`.
- Toda prop, todo valor de enum e todo texto visível em português.
- `className` sempre existe e é aplicada por último no invólucro, para a tela ajustar
  `col-span`, largura e margem sem precisar de outro `<div>`.
- Nenhum componente busca dados, nenhum usa TanStack Query, nenhum chama `toast`. Quem
  decide isso é a tela.

### Tons

`Badge.jsx` é a **fonte de verdade dos tons**. Seis valores, aceitos por `Badge`,
`SeletorStatus`, `AvisoDiscreto` e `BarraProgresso`:

`'neutro' | 'verde' | 'ambar' | 'vermelho' | 'azul' | 'laranja'`

Tom desconhecido cai em `neutro` em vez de renderizar sem cor. Não use as cores cruas do
Tailwind (`bg-amber-50`, `text-sky-700`): elas não conversam com o verde da marca. Se
precisar do tom fora de um componente, importe de `./Badge`:

```js
import { TONS, classesDoTom, corSolidaDoTom, corIconeDoTom } from '@/components/ui/Badge';

classesDoTom('ambar');   // 'bg-[#FDF3E3] text-[#8A5A12] border-[#F2DDB4]'
corSolidaDoTom('verde'); // '#2F8F5B'  (preenchimento cheio)
corIconeDoTom('azul');   // '#1F4A6B'  (ícone sobre superfície clara)
```

### Acessibilidade (não é opcional)

- Todo controle tem rótulo: `Campo` amarra `<label htmlFor>` ao `id` do controle;
  `SeletorStatus` e botões só de ícone exigem `rotuloAcessivel`.
- Todo erro é anunciável: a mensagem do `Campo` tem `role="alert"`, o estado de erro da
  `Tabela` também, e o `AvisoDiscreto` vermelho nasce como `role="alert"`.
- Espera é anunciada: `Carregando` é `role="status"` com `aria-live="polite"`.
- `BarraProgresso` expõe `role="progressbar"` com `aria-valuenow`.
- `PainelLateral` é `role="dialog"` `aria-modal`, prende o foco, fecha no Escape e
  devolve o foco a quem o abriu.

---

## Cartao

`import Cartao, { CLASSE_CARTAO } from '@/components/ui/Cartao';`

A superfície branca padrão, com cabeçalho opcional (caixa de ícone + título + subtítulo
+ ação à direita) e rodapé opcional.

| prop | tipo | padrão | o que faz |
| --- | --- | --- | --- |
| `titulo` | string | - | título do cabeçalho |
| `subtitulo` | node | - | linha de apoio sob o título |
| `icone` | componente lucide | - | ícone na caixa colorida |
| `tomIcone` | `'verde' \| 'laranja' \| 'neutro'` | `'verde'` | cor da caixa do ícone |
| `acao` | node | - | botão ou link à direita do cabeçalho |
| `nivelTitulo` | `2 \| 3` | `2` | `h2` ou `h3` (nenhuma tela renderiza `h1`) |
| `semPaddingCorpo` | boolean | `false` | corpo sem padding, para lista com divisórias |
| `rodape` | node | - | faixa inferior com fundo `#F4F6F4/40` |
| `className` | string | `''` | classes no invólucro |
| `classeCorpo` | string | `''` | classes no corpo |
| `children` | node | - | corpo |

`CLASSE_CARTAO` é a string de classes da superfície, para quando o invólucro precisa ser
outro elemento (um `<form>`, por exemplo).

```jsx
<Cartao
  icone={FolderTree}
  titulo="Novo projeto"
  subtitulo="Somente o nome é obrigatório."
  acao={<BotaoSecundario icone={X} tamanho="sm" rotuloAcessivel="Fechar" onClick={fechar} />}
  rodape={<div className="flex justify-end gap-2"><BotaoPrimario tipo="submit">Salvar</BotaoPrimario></div>}
>
  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">...</div>
</Cartao>
```

---

## Tabela

`import Tabela from '@/components/ui/Tabela';`

Listagem com os quatro estados resolvidos. Carregando, erro e vazio **substituem** a
tabela (cada um com visual próprio); a superfície do cartão continua.

| prop | tipo | padrão | o que faz |
| --- | --- | --- | --- |
| `colunas` | `Coluna[]` | `[]` | ver abaixo |
| `dados` | `object[]` | `[]` | as linhas |
| `legenda` | string | - | **informe sempre**: vira `<caption>` escondida e rótulo da região rolável |
| `chaveLinha` | `(linha, i) => string` | `linha.id ?? 'linha-i'` | key do React |
| `carregando` | boolean | `false` | mostra `Carregando` |
| `rotuloCarregando` | string | `'Carregando registros'` | texto anunciado |
| `erro` | boolean \| string \| Error | `false` | mostra o bloco de erro; string vira a mensagem |
| `mensagemErro` | string | texto padrão de falha de rede | usado quando `erro` não é string |
| `iconeVazio` | componente lucide | `Inbox` | ícone do estado vazio |
| `tituloVazio` | string | `'Nenhum registro'` | |
| `textoVazio` | node | - | explique por que vale preencher |
| `acaoVazio` | node | - | normalmente um `BotaoPrimario` |
| `vazio` | node | - | substitui o estado vazio inteiro |
| `onLinhaClick` | `(linha, i) => void` | - | linha vira `role="button"` com Enter e Espaço |
| `rotuloLinha` | `(linha, i) => string` | - | rótulo acessível da linha clicável |
| `classeLinha` | `(linha, i) => string` | - | classes por linha (esmaecer inativo etc.) |
| `rodape` | node | - | faixa abaixo da tabela |
| `comSuperficie` | boolean | `true` | `false` quando já está dentro de um `Cartao` |
| `className` | string | `''` | |

`Coluna`:

| campo | tipo | o que faz |
| --- | --- | --- |
| `chave` | string | propriedade da linha e key da célula (obrigatório) |
| `titulo` | node | cabeçalho (`text-[10px] uppercase tracking-wider text-[#8A9990]`) |
| `alinhamento` | `'esquerda' \| 'centro' \| 'direita'` | padrão esquerda (direita se `numerica`) |
| `larguraMinima` | number (px) \| string CSS | garante a rolagem horizontal em tela estreita |
| `render` | `(linha, i) => node` | conteúdo da célula; sem ele mostra `linha[chave]`, e nulo/vazio vira `-` |
| `classeCelula` | string | classes extras na célula |
| `numerica` | boolean | `tabular-nums` e alinhamento à direita |

```jsx
<Tabela
  legenda="Contratos de emissão cadastrados"
  colunas={[
    { chave: 'nome', titulo: 'Contrato', larguraMinima: 220 },
    { chave: 'volume', titulo: 'Volume (tCO2e)', numerica: true, larguraMinima: 140,
      render: (l) => fmtNumero(l.volume) },
    { chave: 'status', titulo: 'Status', larguraMinima: 130,
      render: (l) => <Badge tom={TOM_POR_STATUS[l.status]}>{ROTULO[l.status]}</Badge> },
  ]}
  dados={contratos}
  carregando={query.isLoading}
  erro={query.isError}
  iconeVazio={FileText}
  tituloVazio="Nenhum contrato cadastrado"
  textoVazio="O contrato é o que amarra o volume vendido ao projeto que vai emitir."
  acaoVazio={<BotaoPrimario icone={Plus} onClick={abrirNovo}>Cadastrar contrato</BotaoPrimario>}
  onLinhaClick={(l) => abrirEdicao(l)}
  rotuloLinha={(l) => `Abrir ${l.nome}`}
/>
```

---

## Badge

`import Badge from '@/components/ui/Badge';`

| prop | tipo | padrão |
| --- | --- | --- |
| `tom` | `'neutro' \| 'verde' \| 'ambar' \| 'vermelho' \| 'azul' \| 'laranja'` | `'neutro'` |
| `tamanho` | `'sm' \| 'md'` | `'md'` |
| `icone` | componente lucide | - |
| `rotuloAcessivel` | string | - (use só em selo sem texto) |
| `className` | string | `''` |
| `children` | node | - |

```jsx
<Badge tom="ambar" icone={TriangleAlert}>Em validação</Badge>
```

Mapeie o status do banco para tom num objeto no topo da sua tela, e deixe o valor
desconhecido aparecer cru (como faz `Projetos.jsx`), para status novo no banco não sumir
da tela.

---

## EstadoVazio

`import EstadoVazio from '@/components/ui/EstadoVazio';`

| prop | tipo | padrão |
| --- | --- | --- |
| `icone` | componente lucide | `Inbox` |
| `titulo` | string | - |
| `texto` | node | - |
| `acao` | node | - |
| `compacto` | boolean | `false` |
| `comSuperficie` | boolean | `false` (acrescenta fundo branco e borda) |
| `className` | string | `''` |
| `children` | node | - (entra entre o texto e a ação) |

Escreva o texto explicando **por que** vale preencher, nunca só "Nenhum registro".

---

## Carregando

`import Carregando from '@/components/ui/Carregando';`

| prop | tipo | padrão |
| --- | --- | --- |
| `rotulo` | string | `'Carregando'` (diga o que está carregando) |
| `tamanho` | `'sm' \| 'md' \| 'lg'` | `'md'` |
| `linha` | boolean | `false` (versão inline, ao lado de um título) |
| `className` | string | `''` |

---

## AvisoDiscreto

`import AvisoDiscreto from '@/components/ui/AvisoDiscreto';`

Tom `neutro` = linha cinza sem caixa (degrade de falha de rede). Qualquer outro tom =
caixa colorida (regra de negócio que precisa ser lida).

| prop | tipo | padrão |
| --- | --- | --- |
| `tom` | os seis tons | `'neutro'` |
| `titulo` | node | - (sai em negrito antes do texto) |
| `texto` | node | - (alternativa a `children`) |
| `icone` | componente lucide \| `null` | padrão do tom; `null` remove |
| `papel` | `'status' \| 'alerta' \| 'nenhum'` | `'alerta'` se tom vermelho, senão `'status'` |
| `acao` | node | - |
| `className` | string | `''` |
| `children` | node | - |

```jsx
<AvisoDiscreto tom="ambar" titulo="Área declarada divergente da geometria.">
  Divergência de {pct}%, acima do limite de 5% aceito na due diligence.
</AvisoDiscreto>

<AvisoDiscreto texto="Não foi possível carregar agora. Se o aviso continuar, avise a equipe responsável pelo sistema." />
```

---

## Campo

`import Campo, { CLASSE_CAMPO } from '@/components/ui/Campo';`

**`onChange` recebe o VALOR, não o evento** (`(valor, evento) => void`). Em `checkbox` o
valor é booleano.

| prop | tipo | padrão | o que faz |
| --- | --- | --- | --- |
| `rotulo` | string | - | obrigatório na prática |
| `tipo` | `'texto' \| 'numero' \| 'decimal' \| 'data' \| 'select' \| 'textarea' \| 'checkbox'` ou qualquer `type` de input | `'texto'` | `'decimal'` = texto com `inputMode="decimal"`, para número em pt-BR com vírgula |
| `valor` | string \| number \| boolean \| null | - | controlado |
| `onChange` | `(valor, evento) => void` | - | |
| `obrigatorio` | boolean | `false` | `*` no rótulo + `required` |
| `erro` | string | - | borda vermelha, `aria-invalid` e mensagem com `role="alert"` |
| `dica` | node | - | texto de apoio, ligado por `aria-describedby` |
| `placeholder` | string | - | |
| `desabilitado` | boolean | `false` | |
| `somenteLeitura` | boolean | `false` | só vale para input e textarea; para travar um `select` use `desabilitado` |
| `opcoes` | `{valor, rotulo}[]` \| `string[]` | `[]` | para `select` |
| `rotuloVazio` | string | - | primeira opção vazia do select; ausente = sem opção vazia |
| `linhas` | number | `4` | `rows` do textarea |
| `monoespacado` | boolean | `false` | fonte mono 11px, para GeoJSON e código |
| `id` | string | gerado | |
| `nome` | string | - | atributo `name` |
| `className` | string | `''` | invólucro (use para `sm:col-span-2`) |
| `classeControle` | string | `''` | controle |
| `acao` | node | - | bloco abaixo do controle (botão de upload, "Limpar") |
| `children` | node \| `({id, classeCampo, descritoPor, invalido}) => node` | - | controle customizado |
| `extras` | object | `{}` | repassado ao controle (`maxLength`, `min`, `max`, `step`, `autoComplete`, `spellCheck`...) |

```jsx
<Campo
  rotulo="Nome do projeto"
  obrigatorio
  valor={form.nome}
  onChange={(v) => setForm((a) => ({ ...a, nome: v }))}
  erro={erros.nome}
  extras={{ maxLength: 200 }}
  className="sm:col-span-2"
/>

<Campo rotulo="Standard" tipo="select" opcoes={['VCS+CCB', 'VCS', 'CCB']}
  valor={form.standard} onChange={(v) => setForm((a) => ({ ...a, standard: v }))} />

<Campo rotulo="Área declarada (ha)" tipo="decimal" placeholder="13250,5"
  dica="Sem ponto de milhar." valor={form.area}
  onChange={(v) => setForm((a) => ({ ...a, area: v }))} />

{/* controle próprio: a função recebe o id já amarrado ao rótulo */}
<Campo rotulo="Geometria (GeoJSON)" dica="Cole o GeoJSON ou carregue um arquivo.">
  {({ id, classeCampo }) => (
    <textarea id={id} className={`${classeCampo} font-mono`} rows={4} />
  )}
</Campo>
```

Não envolva o controle num `<label>`: o vínculo é por `htmlFor`/`id`. Isso é o que evita
o `<label>` dentro de `<label>` que já causou bug no campo de arquivo.

---

## PainelLateral

`import PainelLateral from '@/components/ui/PainelLateral';`

Gaveta da direita, em portal no `body`. Fecha no Escape e no clique fora, prende o foco,
devolve o foco a quem abriu, trava a rolagem do fundo e rola por dentro.

| prop | tipo | padrão |
| --- | --- | --- |
| `aberto` | boolean | - (fechado não renderiza nada) |
| `onFechar` | `() => void` | - |
| `titulo` | string | - (é o rótulo acessível do diálogo: informe sempre) |
| `subtitulo` | node | - |
| `icone` | componente lucide | - |
| `largura` | `'sm' \| 'md' \| 'lg' \| 'xl'` | `'md'` |
| `rodape` | node | - (barra fixa embaixo, para os botões) |
| `fecharAoClicarFora` | boolean | `true` (use `false` com formulário preenchido) |
| `className` | string | `''` |
| `children` | node | - |

```jsx
<PainelLateral
  aberto={aberto}
  onFechar={fechar}
  icone={FolderTree}
  titulo={editando ? 'Editar contrato' : 'Novo contrato'}
  subtitulo="As alterações valem a partir do salvamento."
  largura="lg"
  fecharAoClicarFora={!alterado}
  rodape={
    <div className="flex items-center justify-end gap-2">
      <BotaoSecundario variante="fantasma" onClick={fechar}>Cancelar</BotaoSecundario>
      <BotaoPrimario onClick={salvar} carregando={mutacao.isPending}>Salvar</BotaoPrimario>
    </div>
  }
>
  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">...</div>
</PainelLateral>
```

O `<form>` deve ficar dentro do `children`; se o botão de salvar está no `rodape`, use
`onClick` em vez de `type="submit"` (o rodapé está fora do formulário).

---

## BarraProgresso

`import BarraProgresso, { pctSeguro } from '@/components/ui/BarraProgresso';`

| prop | tipo | padrão |
| --- | --- | --- |
| `valor` | number \| string \| null | - (normalizado para 0..100) |
| `rotulo` | node | - (texto à esquerda, acima da barra) |
| `detalhe` | node | - (texto à direita, ex.: `'12/34 concluídos'`) |
| `rotuloAcessivel` | string | `'Progresso'` (usado quando não há `rotulo` visível) |
| `alta` | boolean | `false` (10px em vez de 6px) |
| `mostrarValor` | boolean | `false` (acrescenta `NN%` à direita) |
| `tom` | os seis tons | `'laranja'` |
| `tomCompleto` | `'verde'` \| `null` | `'verde'` (cor ao atingir 100) |
| `className` | string | `''` |

`pctSeguro(valor)` é exportada para a tela usar o mesmo número no texto que aparece ao
lado da barra.

---

## SeletorStatus

`import SeletorStatus from '@/components/ui/SeletorStatus';`

`<select>` que se pinta com o tom do valor escolhido. **`onChange` recebe o valor.**

| prop | tipo | padrão |
| --- | --- | --- |
| `valor` | string | - |
| `opcoes` | `{valor, rotulo, tom}[]` | `[]` |
| `onChange` | `(valor: string) => void` | - |
| `rotuloAcessivel` | string | `'Status'` (não há label visível: seja específico) |
| `desabilitado` | boolean | `false` |
| `carregando` | boolean | `false` (spinner ao lado e controle bloqueado) |
| `tamanho` | `'sm' \| 'md'` | `'md'` |
| `className` | string | `''` |

Valor fora de `opcoes` é preservado como opção extra em vez de o `select` cair sozinho
na primeira opção e o próximo salvamento gravar um status errado.

```jsx
<SeletorStatus
  valor={capitulo.status}
  opcoes={[
    { valor: 'nao_iniciado', rotulo: 'Não iniciado', tom: 'neutro' },
    { valor: 'em_andamento', rotulo: 'Em andamento', tom: 'azul' },
    { valor: 'em_revisao', rotulo: 'Em revisão', tom: 'ambar' },
    { valor: 'concluido', rotulo: 'Concluído', tom: 'verde' },
  ]}
  onChange={(status) => salvar({ status })}
  carregando={salvandoId === capitulo.id}
  rotuloAcessivel={`Status do capítulo ${capitulo.capitulo}`}
/>
```

---

## BotaoPrimario e BotaoSecundario

```js
import BotaoPrimario from '@/components/ui/BotaoPrimario';
import BotaoSecundario from '@/components/ui/BotaoSecundario';
```

Props comuns aos dois:

| prop | tipo | padrão | o que faz |
| --- | --- | --- | --- |
| `como` | `'button' \| 'link' \| 'externo'` | `'button'` | `link` = `<Link>` do react-router (`para`); `externo` = `<a target="_blank" rel="noopener noreferrer">` (`href`) |
| `tipo` | `'button' \| 'submit' \| 'reset'` | `'button'` | só para `como='button'` |
| `para` | string | - | destino interno |
| `href` | string | - | destino externo |
| `onClick` | `(evento) => void` | - | |
| `desabilitado` | boolean | `false` | |
| `carregando` | boolean | `false` | troca o ícone por spinner, bloqueia e marca `aria-busy` |
| `icone` | componente lucide | - | à esquerda |
| `iconeDireita` | componente lucide | - | à direita (`ArrowRight`) |
| `tamanho` | `'sm' \| 'md' \| 'lg'` | `'md'` | |
| `larguraTotal` | boolean | `false` | `w-full` |
| `rotuloAcessivel` | string | - | **obrigatório em botão só de ícone** |
| `titulo` | string | - | `title` (tooltip nativa) |
| `className` | string | `''` | |
| `children` | node | - | |

Específicas:

- `BotaoPrimario`: `tom` = `'laranja'` (padrão, criar e salvar) \| `'verde'` (navegação
  forte) \| `'vermelho'` (ação destrutiva confirmada).
- `BotaoSecundario`: `variante` = `'contorno'` (padrão) \| `'fantasma'` (só texto, para
  Cancelar) \| `'perigo'` (contorno vermelho).

```jsx
<BotaoPrimario icone={Plus} onClick={abrirNovo}>Novo projeto</BotaoPrimario>
<BotaoPrimario tipo="submit" carregando={salvar.isPending}>Salvar alterações</BotaoPrimario>
<BotaoPrimario tom="verde" como="link" para={urlPdd(p.id)} icone={ListTree} iconeDireita={ArrowRight}>PDD</BotaoPrimario>
<BotaoSecundario icone={Pencil} tamanho="sm" onClick={() => editar(p)}>Editar</BotaoSecundario>
<BotaoSecundario variante="fantasma" onClick={fechar}>Cancelar</BotaoSecundario>
```

Um botão primário por bloco. Dois pesos iguais na mesma linha fazem a pessoa parar para
decidir qual é o caminho.

---

## CabecalhoSecao

`import CabecalhoSecao from '@/components/ui/CabecalhoSecao';`

Barrinha laranja + rótulo em caixa alta, para dividir a tela em seções sem criar outro
nível de cartão.

| prop | tipo | padrão |
| --- | --- | --- |
| `titulo` | string | - |
| `descricao` | node | - |
| `acao` | node | - |
| `nivel` | `2 \| 3` | `2` |
| `id` | string | - (para `aria-labelledby` de uma `<section>`) |
| `className` | string | `''` |

```jsx
<CabecalhoSecao
  titulo="Monitoramento"
  descricao="Períodos com dado coletado em campo."
  acao={<BotaoPrimario icone={Plus} tamanho="sm" onClick={novo}>Novo período</BotaoPrimario>}
/>
```

---

## Esqueleto de tela de domínio

O título da página vive na topbar do `Layout` (a tela **não** renderiza `h1`).

```jsx
export default function MinhaTela() {
  const query = useQuery({ queryKey: ['carbon', 'meu-dominio'], queryFn: ..., enabled: MODO_DEMO || autenticado });
  const [aberto, setAberto] = useState(false);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <CabecalhoSecao
        titulo="Meu domínio"
        descricao={`${itens.length} registros`}
        acao={<BotaoPrimario icone={Plus} onClick={() => setAberto(true)}>Novo</BotaoPrimario>}
      />

      <Tabela legenda="..." colunas={COLUNAS} dados={itens}
        carregando={query.isLoading} erro={query.isError} />

      <PainelLateral aberto={aberto} onFechar={() => setAberto(false)} titulo="Novo registro" rodape={...}>
        ...campos...
      </PainelLateral>
    </div>
  );
}
```
