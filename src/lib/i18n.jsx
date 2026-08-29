import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

/**
 * i18n - idioma da interface do portal do cliente.
 *
 * ------------------------------------------------------------------------
 * PADRAO E INGLES. Portugues e opcional, por um seletor visivel.
 * ------------------------------------------------------------------------
 * Este portal e a UNICA tela da APSIS que uma pessoa de fora abre, e no mercado
 * de carbono boa parte dessas pessoas nao fala portugues: comprador de credito,
 * auditor de VVB, verificador do Verra. Por isso a interface nasce em ingles.
 * Os documentos continuam no idioma em que foram enviados; o que muda aqui e a
 * casca.
 *
 * ATENCAO - isto e uma EXCECAO deliberada a convencao dos outros repositorios
 * da APSIS ("interface e documentacao em portugues do Brasil"). Ela vale para a
 * INTERFACE DESTE PORTAL, que e voltada para fora. O codigo, os comentarios, os
 * commits e a documentacao continuam em portugues, porque quem os le e a equipe.
 *
 * ------------------------------------------------------------------------
 * POR QUE DICIONARIO PROPRIO, E NAO O TRADUTOR DO NAVEGADOR
 * ------------------------------------------------------------------------
 * O index.html traz `translate="no"` e `<meta name="google" content="notranslate">`,
 * e o src/main.jsx tem o dom-guard, tudo para BLOQUEAR o Google Tradutor: ele
 * envolve os textos em <font> por fora do React e a reconciliacao quebra com
 * NotFoundError. Foi bug real em producao no Portal Apsis.
 *
 * Logo, "traduzir a pagina" aqui nao pode ser um gancho para o tradutor do
 * navegador. Tambem nao deveria: numa tela que entrega documento sob acordo de
 * confidencialidade, o texto que fala de permissao e de marca d'agua nao pode
 * depender de traducao automatica, que erra justamente em frase curta e tecnica.
 *
 * ------------------------------------------------------------------------
 * ONDE FICA A ESCOLHA
 * ------------------------------------------------------------------------
 * localStorage, e nao sessionStorage. A sessao morre ao fechar a aba de
 * proposito (maquina compartilhada), mas o idioma nao e dado sensivel e e
 * irritante ter de reescolher a cada visita.
 *
 * O atributo lang do <html> acompanha a escolha, para leitor de tela pronunciar
 * certo. O translate="no" permanece nos dois idiomas.
 */

const CHAVE = 'carbon-ss-idioma';

export const IDIOMAS = [
  { codigo: 'en', rotulo: 'EN', nome: 'English' },
  { codigo: 'pt', rotulo: 'PT', nome: 'Português' },
];

const PADRAO = 'en';

/* ===== Dicionario ========================================================= */
/* Chave em ingles porque e o idioma padrao: lendo o codigo, a chave ja diz o
   texto. Toda chave DEVE existir nos dois idiomas - ha um teste mecanico disso
   em `chavesFaltando()`, usado pelo aviso de desenvolvimento mais abaixo.     */

const TEXTOS = {
  en: {
    /* Marca e navegacao */
    'app.nome': 'Secure Share',
    'app.subtitulo': 'APSIS Carbon',
    'nav.sair': 'Sign out',
    'idioma.rotulo': 'Language',
    'idioma.trocarPara': 'Switch to {nome}',

    /* Login - etapa 1, o endereco */
    'login.chamada':
      'Sign in with the e-mail address APSIS registered for your project. There is no password: we send a single-use code to that address.',
    'login.email': 'E-mail',
    'login.emailPlaceholder': 'your.email@company.com',
    'login.emailObrigatorio': 'Enter your e-mail address.',
    'login.pedirCodigo': 'Send me a code',
    'login.enviandoCodigo': 'Sending the code...',

    /* Login - etapa 2, o codigo.
       `login.codigoEnviado` E UMA FRASE DE CONTRATO, nao um texto qualquer: ela
       aparece IGUAL para endereco com e sem cadastro, entao nao pode afirmar que
       um e-mail saiu (seria mentira para quem nao tem cadastro) nem usar a forma
       condicional "se este endereco estiver cadastrado" (verdadeira, mas soa
       evasiva e ja denuncia que ha o que esconder). A saida e enunciar a REGRA,
       que e verdadeira sempre e nao diz nada sobre este endereco em particular.
       Se for reescrita, precisa continuar passando nos dois testes. */
    'login.codigoTitulo': 'Enter your code',
    'login.codigoEnviado':
      'Check {email}. Every address APSIS has registered for a project gets a {n}-digit code, valid for {minutos} minutes and good for a single sign-in.',
    'login.codigoReenviado': 'A new code was requested. Check {email} again.',
    'login.codigo': 'Verification code',
    'login.codigoObrigatorio': 'Enter the {n} digits of the code.',
    'login.outroEmail': 'Use another e-mail address',
    'login.reenviar': 'Send a new code',
    'login.reenviarEspera': 'in {n}s',
    'login.reenviarEmBreve': 'Available again shortly.',
    'login.reenviarBloqueado': 'Daily limit reached',
    'login.entrar': 'Sign in',
    'login.entrando': 'Signing in...',
    'login.naoChegou':
      'Nothing arrived? Check the spelling of the address, look in your spam folder, and then talk to the APSIS person responsible for your project.',
    /* Modo demonstracao. Envolvido em import.meta.env.DEV para as chaves
       DOBRAREM em producao: o Rollup nao remove chave solta de um objeto que e
       usado, entao sem isto os textos do demo ficariam no bundle publicado
       mesmo com o botao ja eliminado. Medido. */
    ...(import.meta.env.DEV
      ? {
          'demo.entrar': 'Enter demo mode',
          'demo.explica':
            'Opens the screens with fictitious data, no backend and no e-mail. Development only.',
          'demo.fluxoCodigo': 'Try the code flow',
          'demo.fluxoCodigoExplica':
            'Walks through the two sign-in steps with no network and no e-mail.',
          'demo.codigoFicticio': 'Demo code: {codigo}',
          'demo.faixa':
            'Demo mode: everything you see is fictitious, nothing is saved and no file is real.',
          'demo.arquivoAviso':
            'In demo mode the downloaded file carries placeholder text, not the real document.',
        }
      : {}),
    'login.semAcesso':
      'Never received a code? Codes only go to the address APSIS registered for your project. Talk to the APSIS person responsible for it.',
    'login.headline':
      'APSIS brings to the carbon market the same technical rigour of more than three decades in valuation.',
    'login.subheadline': 'Structuring, measurement and validation of carbon projects.',
    'login.categoria.projetos': 'Carbon Projects',
    'login.categoria.contratos': 'Emission Contracts',
    'login.categoria.gee': 'GHG Inventory',
    'login.categoria.certificacao': 'Certification and Verification',
    'login.categoria.esg': 'ESG Reports',
    'login.copyright': '© 2026 APSIS Consultoria. All rights reserved.',

    /* Documentos */
    'docs.titulo': 'Documents',
    'docs.subtitulo': 'Documents shared with you',
    'docs.apOs': 'Job no. {ap_os}',
    'docs.carregando': 'Loading documents',
    'docs.erro': 'We could not open your documents.',
    'docs.vazioTitulo': 'No documents yet',
    'docs.vazioTexto':
      'When the APSIS team uploads the files for this project, they will show up here. You will get an e-mail about it.',
    'docs.pastaVazia': 'Empty folder',
    'docs.atualizar': 'Refresh the file list',
    'docs.baixarTudo': 'Download all',
    'docs.soVisualizar': 'View only',
    'docs.visualizar': 'Open in a new tab',
    'docs.visualizarItem': 'View {nome}',
    'docs.baixar': 'Download',
    'docs.baixarItem': 'Download {nome}',
    'docs.baixarPasta': 'Download this folder as a ZIP',
    'docs.baixarPastaItem': 'Download the folder {nome} as a ZIP',
    'docs.rodapeMarca':
      'Documents opened here carry a watermark identifying who accessed them. They are confidential: do not redistribute them without authorisation from APSIS.',

    /* Visualizador */
    'visual.titulo': 'Preview',
    'visual.arquivos': 'Files',
    'visual.vazioTitulo': 'Select a file',
    'visual.vazioTexto': 'Pick a file on the left and it opens here, without leaving the page.',
    'visual.semPreviaTitulo': 'No preview for this format',
    'visual.semPreviaTexto': 'This file type cannot be shown here. Download it to open on your computer.',
    'visual.carregando': 'Opening the file',
    'visual.erro': 'We could not show this file.',
    'visual.abrirNovaAba': 'Open in a new tab',
    'visual.soVisualizacao': 'View only. Downloading is not enabled for you.',
    'visual.voltar': 'Back to the file list',
    'visual.protegido': 'Watermarked with your identity',

    /* ZIP */
    'zip.montando': 'Building the ZIP for "{nome}"',
    'zip.preparando': 'Preparing...',
    'zip.aviso':
      'The archive is built in your browser, one document at a time. Keep this tab open until it finishes.',
    'zip.cancelar': 'Cancel',
    'zip.cancelado': 'Download cancelled.',
    'zip.semArquivos': 'There are no files to download in this folder.',
    'zip.somenteVisualizacao':
      '{n} file(s) are view only and are not included in the ZIP.',
    'zip.pronto': '{n} file(s) in the ZIP.',
    'zip.foraSoVisualizar': '{n} were left out (view only)',
    'zip.truncado': 'the folder is too large and the ZIP was capped',
    'zip.falhou': 'We could not build the ZIP.',

    /* Envio */
    'envio.titulo': 'Send files to APSIS',
    'envio.subtitulo': 'They arrive in a separate folder, marked as sent by you.',
    'envio.solte': 'Drop them here',
    'envio.arraste': 'Drag files here, or click to choose',
    'envio.enviar': 'Send {n} file(s)',
    'envio.remover': 'Remove {nome} from the queue',
    'envio.soltarNaPasta': 'Drop here to upload into {nome}',
    'envio.paraPasta': 'Uploading to {nome}',
    'envio.paraRaiz': 'the project root',
    'envio.destino': 'Upload to: {nome}',
    'envio.enviando': 'Sending {n} file(s) to {nome}...',
    'envio.renomeados':
      '{n} already existed and were kept as a copy, so nothing was overwritten.',
    'envio.parcial': '{enviados} sent, {falhas} failed.',
    'envio.sucesso': '{n} file(s) sent to APSIS.',
    'envio.falhou': 'We could not send your files.',
    'pasta.naoAbriu': 'We could not open "{nome}"',

    /* Erros vindos do servidor, por codigo.
       OS QUATRO DA ENTRADA SAO SIMETRICOS: aparecem igual para endereco com e
       sem cadastro. `erro.espere` e `erro.teto_diario` sao contados por resumo do
       endereco, justamente para existirem tambem para quem nao e cliente; e
       `erro.codigo_invalido` cobre codigo errado, inexistente, expirado E
       pausado num texto so, porque separar "muitas tentativas" ja diria que
       existe codigo vivo para aquele endereco. Nao especialize nenhum deles. */
    'erro.email_invalido': 'That does not look like an e-mail address. Check what you typed.',
    'erro.espere':
      'A code was requested for this address less than a minute ago. You can ask for another one in {n} seconds.',
    'erro.teto_diario':
      'Too many codes were requested for this address today. Try again tomorrow, or talk to the APSIS person responsible for your project.',
    'erro.codigo_invalido': 'This code did not work. Check the digits, or ask for a new code.',
    'erro.acesso_indisponivel':
      'Your access to these documents is not available right now. Talk to the APSIS person responsible for your project.',
    'erro.recurso_desativado': 'This page has been updated. Reload it and sign in again.',
    'erro.nao_autenticado': 'Your session expired. Please sign in again.',
    'erro.sem_acesso_ao_projeto': 'You do not have access to this project.',
    'erro.sem_acesso_ao_arquivo': 'You do not have access to this file.',
    'erro.somente_visualizacao':
      'This file is view only. Downloading is not enabled for you.',
    'erro.nao_encontrado': 'The file was not found. It may have been moved or removed.',
    'erro.item_e_pasta': 'The item you asked for is a folder.',
    'erro.caminho_obrigatorio': 'No file was specified.',
    'erro.previa_indisponivel':
      'We could not generate a preview for this file. Download it to open.',
    'erro.armazenamento_indisponivel':
      'The system is temporarily unavailable. Please try again in a few minutes.',
    'erro.sharepoint_falhou': 'We could not reach your files right now. Please try again.',
    'erro.falha_ao_buscar': 'We could not download the file right now. Please try again.',
    'erro.arquivo_obrigatorio': 'Choose at least one file.',
    'erro.arquivos_demais': 'Too many files at once. Send them in smaller batches.',
    'erro.campos_obrigatorios': 'Fill in every field.',
    'erro.pasta_somente_leitura':
      'This folder is read only. Files here are published by APSIS.',
    'geral.rotulo': 'Shared with everyone',
    'geral.explica': 'Documents APSIS publishes for every client. Read only.',
    'erro.proxy_nao_configurado':
      'The system is not configured correctly. Please tell the APSIS person responsible for your project.',
    'erro.timeout': 'That took too long. Check your connection and try again.',
    'erro.falha_rede': 'We could not reach the server. Check your connection.',
    'erro.sem_permissao': 'You are not allowed to do that.',
    'erro.generico': 'Something went wrong on our side. Please try again shortly.',
  },

  pt: {
    'app.nome': 'Secure Share',
    'app.subtitulo': 'APSIS Carbon',
    'nav.sair': 'Sair',
    'idioma.rotulo': 'Idioma',
    'idioma.trocarPara': 'Mudar para {nome}',

    'login.chamada':
      'Entre com o e-mail que a APSIS cadastrou no seu projeto. Não há senha: enviamos um código de uso único para esse endereço.',
    'login.email': 'E-mail',
    'login.emailPlaceholder': 'seu.email@empresa.com',
    'login.emailObrigatorio': 'Informe o seu e-mail.',
    'login.pedirCodigo': 'Enviar um código',
    'login.enviandoCodigo': 'Enviando o código...',

    'login.codigoTitulo': 'Digite o seu código',
    'login.codigoEnviado':
      'Confira {email}. Todo endereço cadastrado pela APSIS em um projeto recebe um código de {n} dígitos, válido por {minutos} minutos e para uma única entrada.',
    'login.codigoReenviado': 'Um novo código foi pedido. Confira {email} de novo.',
    'login.codigo': 'Código de verificação',
    'login.codigoObrigatorio': 'Digite os {n} dígitos do código.',
    'login.outroEmail': 'Usar outro e-mail',
    'login.reenviar': 'Pedir um novo código',
    'login.reenviarEspera': 'em {n}s',
    'login.reenviarEmBreve': 'Disponível novamente em instantes.',
    'login.reenviarBloqueado': 'Limite diário atingido',
    'login.entrar': 'Entrar',
    'login.entrando': 'Entrando...',
    'login.naoChegou':
      'Não chegou nada? Confira se o endereço está escrito certo, procure na caixa de spam e depois fale com a pessoa da APSIS responsável pelo seu projeto.',
    /* Modo demonstracao. Envolvido em import.meta.env.DEV para as chaves
       DOBRAREM em producao: o Rollup nao remove chave solta de um objeto que e
       usado, entao sem isto os textos do demo ficariam no bundle publicado
       mesmo com o botao ja eliminado. Medido. */
    ...(import.meta.env.DEV
      ? {
          'demo.entrar': 'Entrar em modo demonstração',
          'demo.explica':
            'Abre as telas com dados fictícios, sem backend e sem e-mail. Só em desenvolvimento.',
          'demo.fluxoCodigo': 'Testar o fluxo de código',
          'demo.fluxoCodigoExplica':
            'Percorre as duas etapas da entrada, sem rede e sem e-mail.',
          'demo.codigoFicticio': 'Código de demonstração: {codigo}',
          'demo.faixa':
            'Modo demonstração: tudo o que você vê é fictício, nada é salvo e nenhum arquivo é real.',
          'demo.arquivoAviso':
            'No modo demonstração o arquivo baixado traz um texto de exemplo, não o documento real.',
        }
      : {}),
    'login.semAcesso':
      'Nunca recebeu um código? O código só vai para o endereço que a APSIS cadastrou no seu projeto. Fale com a pessoa da APSIS responsável por ele.',
    'login.headline':
      'A APSIS leva para o mercado de carbono o mesmo rigor técnico de mais de três décadas em avaliações.',
    'login.subheadline': 'Estruturação, mensuração e validação de projetos de carbono.',
    'login.categoria.projetos': 'Projetos de Carbono',
    'login.categoria.contratos': 'Contratos de Emissão',
    'login.categoria.gee': 'Inventário de GEE',
    'login.categoria.certificacao': 'Certificação e Verificação',
    'login.categoria.esg': 'Relatórios ESG',
    'login.copyright': '© 2026 APSIS Consultoria. Todos os direitos reservados.',

    'docs.titulo': 'Documentos',
    'docs.subtitulo': 'Documentos compartilhados com você',
    'docs.apOs': 'AP/OS {ap_os}',
    'docs.carregando': 'Carregando os documentos',
    'docs.erro': 'Não foi possível abrir os documentos.',
    'docs.vazioTitulo': 'Ainda não há documentos',
    'docs.vazioTexto':
      'Quando a equipe da APSIS enviar os arquivos deste projeto, eles aparecem aqui. Você recebe um aviso por e-mail.',
    'docs.pastaVazia': 'Pasta vazia',
    'docs.atualizar': 'Atualizar a lista de arquivos',
    'docs.baixarTudo': 'Baixar tudo',
    'docs.soVisualizar': 'Só visualizar',
    'docs.visualizar': 'Abrir em outra aba',
    'docs.visualizarItem': 'Visualizar {nome}',
    'docs.baixar': 'Baixar',
    'docs.baixarItem': 'Baixar {nome}',
    'docs.baixarPasta': 'Baixar esta pasta em ZIP',
    'docs.baixarPastaItem': 'Baixar a pasta {nome} em ZIP',
    'docs.rodapeMarca':
      'Os documentos abertos aqui recebem uma marca d’água com a identificação de quem acessou. Eles são confidenciais: não redistribua sem autorização da APSIS.',

    'visual.titulo': 'Visualização',
    'visual.arquivos': 'Arquivos',
    'visual.vazioTitulo': 'Selecione um arquivo',
    'visual.vazioTexto': 'Escolha um arquivo à esquerda e ele abre aqui, sem sair da página.',
    'visual.semPreviaTitulo': 'Sem visualização para este formato',
    'visual.semPreviaTexto': 'Este tipo de arquivo não pode ser exibido aqui. Baixe para abrir no seu computador.',
    'visual.carregando': 'Abrindo o arquivo',
    'visual.erro': 'Não foi possível exibir este arquivo.',
    'visual.abrirNovaAba': 'Abrir em outra aba',
    'visual.soVisualizacao': 'Só visualização. O download não está liberado para você.',
    'visual.voltar': 'Voltar à lista de arquivos',
    'visual.protegido': 'Com marca d’água identificando você',

    'zip.montando': 'Montando o ZIP de "{nome}"',
    'zip.preparando': 'Preparando...',
    'zip.aviso':
      'O arquivo é montado no seu navegador, um documento por vez. Mantenha esta aba aberta até terminar.',
    'zip.cancelar': 'Cancelar',
    'zip.cancelado': 'Download cancelado.',
    'zip.semArquivos': 'Não há arquivos para baixar nesta pasta.',
    'zip.somenteVisualizacao':
      '{n} arquivo(s) são somente para visualização e não entram no ZIP.',
    'zip.pronto': '{n} arquivo(s) no ZIP.',
    'zip.foraSoVisualizar': '{n} ficaram de fora (somente visualização)',
    'zip.truncado': 'a pasta é grande demais e o ZIP foi limitado',
    'zip.falhou': 'Não foi possível montar o ZIP.',

    'envio.titulo': 'Enviar arquivos para a APSIS',
    'envio.subtitulo': 'Eles chegam numa pasta separada, identificada como enviada por você.',
    'envio.solte': 'Solte aqui',
    'envio.arraste': 'Arraste arquivos ou clique para selecionar',
    'envio.enviar': 'Enviar {n} arquivo(s)',
    'envio.remover': 'Tirar {nome} da fila',
    'envio.soltarNaPasta': 'Solte aqui para enviar para {nome}',
    'envio.paraPasta': 'Enviando para {nome}',
    'envio.paraRaiz': 'a raiz do projeto',
    'envio.destino': 'Enviar para: {nome}',
    'envio.enviando': 'Enviando {n} arquivo(s) para {nome}...',
    'envio.renomeados':
      '{n} já existia(m) e entrou(aram) como cópia, então nada foi sobrescrito.',
    'envio.parcial': '{enviados} enviado(s), {falhas} com falha.',
    'envio.sucesso': '{n} arquivo(s) enviado(s) para a APSIS.',
    'envio.falhou': 'Não foi possível enviar.',
    'pasta.naoAbriu': 'Não foi possível abrir "{nome}"',

    'erro.email_invalido': 'Isso não parece um endereço de e-mail. Confira o que você digitou.',
    'erro.espere':
      'Um código foi pedido para este endereço há menos de um minuto. Você pode pedir outro em {n} segundos.',
    'erro.teto_diario':
      'Muitos códigos foram pedidos para este endereço hoje. Tente de novo amanhã ou fale com a pessoa da APSIS responsável pelo seu projeto.',
    'erro.codigo_invalido': 'Este código não funcionou. Confira os dígitos ou peça um novo código.',
    'erro.acesso_indisponivel':
      'O seu acesso a estes documentos não está disponível agora. Fale com a pessoa da APSIS responsável pelo seu projeto.',
    'erro.recurso_desativado': 'Esta página foi atualizada. Recarregue e entre novamente.',
    'erro.nao_autenticado': 'Sua sessão expirou. Entre novamente.',
    'erro.sem_acesso_ao_projeto': 'Você não tem acesso a este projeto.',
    'erro.sem_acesso_ao_arquivo': 'Você não tem acesso a este arquivo.',
    'erro.somente_visualizacao':
      'Este arquivo é somente para visualização. O download não está liberado para você.',
    'erro.nao_encontrado': 'O arquivo não foi encontrado. Ele pode ter sido movido ou removido.',
    'erro.item_e_pasta': 'O item pedido é uma pasta.',
    'erro.caminho_obrigatorio': 'Arquivo não informado.',
    'erro.previa_indisponivel':
      'Não foi possível gerar a visualização deste arquivo. Baixe o arquivo para abrir.',
    'erro.armazenamento_indisponivel':
      'O sistema está temporariamente indisponível. Tente novamente em alguns minutos.',
    'erro.sharepoint_falhou': 'O sistema não conseguiu acessar os arquivos agora. Tente novamente.',
    'erro.falha_ao_buscar': 'Não foi possível baixar o arquivo agora. Tente novamente.',
    'erro.arquivo_obrigatorio': 'Selecione ao menos um arquivo.',
    'erro.arquivos_demais': 'Muitos arquivos de uma vez. Envie em lotes menores.',
    'erro.campos_obrigatorios': 'Preencha todos os campos.',
    'erro.pasta_somente_leitura':
      'Esta pasta é somente leitura. Os arquivos aqui são publicados pela APSIS.',
    'geral.rotulo': 'Compartilhado com todos',
    'geral.explica': 'Documentos que a APSIS publica para todos os clientes. Somente leitura.',
    'erro.proxy_nao_configurado':
      'O sistema não está configurado corretamente. Avise a pessoa da APSIS responsável pelo seu projeto.',
    'erro.timeout': 'A operação demorou demais. Verifique a conexão e tente de novo.',
    'erro.falha_rede': 'Não foi possível falar com o servidor. Verifique a conexão.',
    'erro.sem_permissao': 'Você não tem permissão para esta ação.',
    'erro.generico': 'Algo deu errado do nosso lado. Tente novamente em alguns instantes.',
  },
};

/* ===== Apoio ============================================================== */

/**
 * Chaves presentes num idioma e ausentes no outro.
 *
 * Existe porque o modo de falhar deste arquivo e sempre o mesmo: alguem
 * acrescenta um texto em ingles e esquece o portugues, e a tela fica bilingue
 * sem ninguem notar. Em desenvolvimento isso vira aviso no console; em producao
 * a funcao nao e chamada.
 */
export function chavesFaltando() {
  const en = Object.keys(TEXTOS.en);
  const pt = Object.keys(TEXTOS.pt);
  return {
    faltandoEmPt: en.filter((k) => !TEXTOS.pt[k]),
    faltandoEmEn: pt.filter((k) => !TEXTOS.en[k]),
  };
}

/** Substitui {marcadores} pelos valores. Marcador sem valor fica como esta. */
function interpolar(texto, valores) {
  if (!valores) return texto;
  return texto.replace(/\{(\w+)\}/g, (bruto, chave) =>
    Object.prototype.hasOwnProperty.call(valores, chave) ? String(valores[chave]) : bruto,
  );
}

function lerPreferencia() {
  try {
    const salvo = localStorage.getItem(CHAVE);
    if (IDIOMAS.some((i) => i.codigo === salvo)) return salvo;
  } catch {
    // Storage bloqueado (modo restrito). Segue no padrao.
  }
  return PADRAO;
}

/* ===== Contexto =========================================================== */

const ContextoIdioma = createContext(null);

export function ProvedorIdioma({ children }) {
  const [idioma, setIdioma] = useState(lerPreferencia);

  // O lang do <html> acompanha a escolha, para leitor de tela pronunciar certo.
  // O translate="no" do index.html permanece nos dois idiomas: ele bloqueia o
  // Google Tradutor, que quebra a reconciliacao do React.
  useEffect(() => {
    document.documentElement.lang = idioma === 'pt' ? 'pt-BR' : 'en';
    try {
      localStorage.setItem(CHAVE, idioma);
    } catch {
      // Sem storage a escolha vale so para esta aba.
    }
  }, [idioma]);

  // Aviso de chave faltando, so em desenvolvimento. `import.meta.env.DEV` e uma
  // constante de build do Vite (nao e configuracao nossa) e dobra para false em
  // producao, entao este bloco inteiro sai do bundle publicado.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const { faltandoEmPt, faltandoEmEn } = chavesFaltando();
    if (faltandoEmPt.length) console.warn('[i18n] sem tradução em pt:', faltandoEmPt);
    if (faltandoEmEn.length) console.warn('[i18n] sem tradução em en:', faltandoEmEn);
  }, []);

  const t = useCallback(
    (chave, valores) => {
      const dicionario = TEXTOS[idioma] ?? TEXTOS[PADRAO];
      // Cai para o ingles quando a chave falta no idioma escolhido, e so entao
      // mostra a propria chave: texto em ingles no meio do portugues e ruim,
      // mas "docs.vazioTitulo" na tela e pior.
      const texto = dicionario[chave] ?? TEXTOS[PADRAO][chave] ?? chave;
      return interpolar(texto, valores);
    },
    [idioma],
  );

  const valor = useMemo(() => ({ idioma, setIdioma, t }), [idioma, t]);

  return <ContextoIdioma.Provider value={valor}>{children}</ContextoIdioma.Provider>;
}

/** Hook das telas: `const { t, idioma, setIdioma } = useIdioma();` */
export function useIdioma() {
  const contexto = useContext(ContextoIdioma);
  if (!contexto) {
    throw new Error('useIdioma precisa estar dentro de <ProvedorIdioma>.');
  }
  return contexto;
}

/** Sobrou um {marcador} sem valor no texto ja interpolado? */
function temMarcadorCru(texto) {
  return /\{\w+\}/.test(texto);
}

/**
 * Texto de um erro vindo da API, pelo CODIGO.
 *
 * A camada de API (src/lib/api.js) nao conhece idioma: ela lanca ErroApi com o
 * codigo, e a traducao acontece aqui, na tela. Sem isso, trocar o idioma nao
 * mudaria a mensagem de erro ja formada, e a api.js precisaria de um hook do
 * React, que ela nao pode ter.
 *
 * `valores` existe porque ha texto de erro com numero dentro: `erro.espere` diz
 * em quantos segundos da para pedir outro codigo. Sem o parametro, a unica saida
 * seria escrever o texto sem o numero - e um cliente cego, que nao ve o contador
 * regressivo (ele fica fora da regiao aria-live de proposito), ficaria sem
 * nenhuma nocao de quanto esperar.
 *
 * A REDE DE SEGURANCA: se depois da interpolacao ainda sobrar um {marcador}, o
 * texto NAO vai para a tela. Quem le e um cliente externo, e "Aguarde {n}
 * segundos" e pior do que a mensagem generica - alem de ser exatamente o modo de
 * falhar de quem acrescenta um marcador novo e esquece de passar o valor.
 */
export function textoDoErro(t, erro, valores) {
  const codigo = erro?.codigo;
  if (codigo) {
    const traduzido = t(`erro.${codigo}`, valores);
    // t() devolve a propria chave quando nao encontra. Nesse caso caimos no
    // texto generico em vez de mostrar "erro.algum_codigo_novo" ao cliente.
    if (traduzido !== `erro.${codigo}` && !temMarcadorCru(traduzido)) return traduzido;
    if (temMarcadorCru(traduzido)) {
      // So o codigo no console: o texto pode ter recebido o e-mail da pessoa em
      // outro marcador, e nao ha por que o console guardar isso.
      console.error(
        `[i18n] erro.${codigo} tem marcador sem valor. Mostrando a mensagem generica.`,
      );
    }
  }
  if (erro?.status === 401) return t('erro.nao_autenticado');
  if (erro?.status === 403) return t('erro.sem_permissao');
  return t('erro.generico');
}
