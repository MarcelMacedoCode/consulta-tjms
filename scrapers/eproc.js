/**
 * Scraper eproc — TJMS
 * 
 * O eproc tem uma consulta pública que retorna dados básicos:
 *   - Partes, assuntos, classe, órgão julgador, movimentações
 * 
 * URLs do eproc TJMS (padrão da comunidade eproc):
 *   1º Grau: https://eproc1g.tjms.jus.br/eproc/externo_controlador.php?acao=processo_consulta_publica
 *   2º Grau: https://eproc2g.tjms.jus.br/eproc/externo_controlador.php?acao=processo_consulta_publica
 * 
 * NOTA: O eproc do TJMS ainda está em fase de expansão (piloto desde Nov/2025).
 * Processos antigos continuam no eSAJ. Novos processos em comarcas migradas vão pro eproc.
 * As URLs podem mudar — configuráveis via env vars.
 */

const cheerio = require('cheerio');
const fetch = require('node-fetch');

// ── Config ──────────────────────────────────────────────────
// URLs configuráveis via env (pode mudar conforme a implantação avança)
const EPROC_1G = process.env.EPROC_1G_URL || 'https://eproc1g.tjms.jus.br/eproc';
const EPROC_2G = process.env.EPROC_2G_URL || 'https://eproc2g.tjms.jus.br/eproc';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
};

const MAX_RETRIES = 2;
const TIMEOUT_MS = 12000;

// ── Helpers ─────────────────────────────────────────────────

function limpar(texto) {
  if (!texto) return '';
  return texto.replace(/\s+/g, ' ').replace(/\n/g, ' ').trim();
}

function formatarNumeroEproc(numeroCNJ) {
  // O eproc aceita o número CNJ com ou sem formatação
  // Geralmente usa o formato: NNNNNNN-DD.AAAA.J.TR.OOOO
  const limpo = numeroCNJ.replace(/[^0-9]/g, '');
  if (limpo.length !== 20) {
    throw new Error(`Número inválido: esperado 20 dígitos, recebido ${limpo.length}`);
  }
  const n = limpo;
  return `${n.substring(0,7)}-${n.substring(7,9)}.${n.substring(9,13)}.${n.substring(13,14)}.${n.substring(14,16)}.${n.substring(16,20)}`;
}

async function fetchComRetry(url, options = {}, retries = MAX_RETRIES) {
  for (let i = 0; i < retries; i++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

      const resp = await fetch(url, {
        ...options,
        headers: { ...HEADERS, ...(options.headers || {}) },
        signal: controller.signal,
        redirect: 'follow',
      });

      clearTimeout(timeout);

      if (resp.ok) return resp;

      if (resp.status >= 500 && i < retries - 1) {
        await new Promise(r => setTimeout(r, 1000 * (i + 1)));
        continue;
      }

      throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
    } catch (err) {
      if (err.name === 'AbortError') {
        err.message = `Timeout de ${TIMEOUT_MS}ms excedido`;
      }
      if (i === retries - 1) throw err;
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

// ── Parser do HTML do eproc ─────────────────────────────────

/**
 * O eproc tem um HTML bem estruturado na consulta pública.
 * Estrutura típica:
 *   - Seção "Capa do processo" com dados básicos em <fieldset> ou <div>
 *   - Seção "Partes e Representantes" com tabela de partes
 *   - Seção "Eventos" com tabela de movimentações (data, evento, descrição, usuário)
 * 
 * Como a estrutura HTML exata pode variar, o parser é flexível e tenta
 * múltiplos seletores.
 */
function parseEprocHTML(html, grau) {
  const $ = cheerio.load(html);

  // Verificar se encontrou processo
  const erroMsg = $('div.aviso, div.infraAviso, .msgErro, .alert-danger').text().trim();
  if (erroMsg && (erroMsg.includes('não encontrado') || erroMsg.includes('Nenhum processo') || erroMsg.includes('inválido'))) {
    return null;
  }

  // Verificar se é página de login ou sem resultados
  if ($('form[name="frmLogin"]').length || $('input[name="txtSenha"]').length) {
    return null; // Requer autenticação, não é consulta pública
  }

  const resultado = {
    fonte: 'eproc',
    grau: grau,
    classe: '',
    area: '',
    assunto: '',
    distribuicao: '',
    juiz: '',
    orgaoJulgador: '',
    situacao: '',
    partes: [],
    movimentacoes: [],
  };

  // ── Dados básicos (Capa do processo) ──
  // O eproc organiza em "label: valor" dentro de divs ou tabelas
  
  // Abordagem 1: Labels com texto específico
  $('label, span.infraLabelObrigatorio, span.infraLabel, th').each((i, el) => {
    const labelText = limpar($(el).text()).toLowerCase();
    const valorEl = $(el).next('span, td, div').first();
    const valor = limpar(valorEl.text());

    if (labelText.includes('classe')) resultado.classe = valor || resultado.classe;
    if (labelText.includes('assunto')) resultado.assunto = valor || resultado.assunto;
    if (labelText.includes('área') || labelText.includes('area')) resultado.area = valor || resultado.area;
    if (labelText.includes('juiz') || labelText.includes('magistrado')) resultado.juiz = valor || resultado.juiz;
    if (labelText.includes('órgão julgador') || labelText.includes('orgao julgador')) resultado.orgaoJulgador = valor || resultado.orgaoJulgador;
    if (labelText.includes('distribuição') || labelText.includes('distribuicao') || labelText.includes('autuação')) resultado.distribuicao = valor || resultado.distribuicao;
    if (labelText.includes('situação') || labelText.includes('situacao')) resultado.situacao = valor || resultado.situacao;
  });

  // Abordagem 2: Tabela de dados com pares
  $('table tr, div.infraFieldset div.row, fieldset div').each((i, el) => {
    const texto = limpar($(el).text());
    
    // Tentar extrair pares "Label: Valor"
    const match = texto.match(/^(Classe|Assunto|Área|Juiz|Órgão Julgador|Distribuição|Autuação|Situação)[:\s]+(.+)/i);
    if (match) {
      const key = match[1].toLowerCase();
      const val = limpar(match[2]);
      if (key.includes('classe') && !resultado.classe) resultado.classe = val;
      if (key.includes('assunto') && !resultado.assunto) resultado.assunto = val;
      if (key.includes('área') && !resultado.area) resultado.area = val;
      if (key.includes('juiz') && !resultado.juiz) resultado.juiz = val;
      if (key.includes('órgão') && !resultado.orgaoJulgador) resultado.orgaoJulgador = val;
      if ((key.includes('distribuição') || key.includes('autuação')) && !resultado.distribuicao) resultado.distribuicao = val;
      if (key.includes('situação') && !resultado.situacao) resultado.situacao = val;
    }
  });

  // ── Partes ──
  // O eproc tipicamente mostra partes numa tabela ou seção com "Partes e Representantes"
  const secaoPartes = $('fieldset:contains("Partes"), div:contains("Partes e Representantes")').first();
  
  // Tentar tabela de partes
  $('table.infraTable tr, #divPartes tr, #tblPartes tr').each((i, tr) => {
    const $tr = $(tr);
    if ($tr.find('th').length) return; // header row
    
    const colunas = $tr.find('td');
    if (colunas.length >= 2) {
      const tipo = limpar($(colunas[0]).text());
      const nome = limpar($(colunas[1]).text());
      const advogado = colunas.length >= 3 ? limpar($(colunas[2]).text()) : '';
      
      if (tipo || nome) {
        const advogados = [];
        if (advogado) {
          advogados.push({ nome: advogado, oab: '' });
        }
        resultado.partes.push({ tipo, nome, advogados });
      }
    }
  });

  // Abordagem alternativa: partes em divs
  if (resultado.partes.length === 0) {
    $('div.parte, div.infraDivPartesProcesso, [id*="parte"]').each((i, el) => {
      const tipo = limpar($(el).find('.tipoParte, .infraTipoParte, strong').first().text());
      const nome = limpar($(el).find('.nomeParte, .infraNomeParte').first().text() || $(el).text());
      if (tipo || nome) {
        resultado.partes.push({ tipo, nome: nome.replace(tipo, '').trim(), advogados: [] });
      }
    });
  }

  // ── Movimentações/Eventos ──
  // O eproc chama de "eventos" e mostra em tabela: Nº | Data | Evento | Descrição | Usuário
  $('table#tblEventos tr, table.infraTable:last tr, #divEventos tr, #tabelaEventos tr').each((i, tr) => {
    const $tr = $(tr);
    if ($tr.find('th').length) return;
    
    const colunas = $tr.find('td');
    if (colunas.length >= 3) {
      // Pode ter: [nº, data, evento, descrição, ...] ou [data, evento, descrição]
      let data, descricao;
      
      if (colunas.length >= 4) {
        // Formato com número: [nº, data, evento, descrição]
        data = limpar($(colunas[1]).text());
        const evento = limpar($(colunas[2]).text());
        const desc = limpar($(colunas[3]).text());
        descricao = evento + (desc ? ` — ${desc}` : '');
      } else {
        // Formato sem número: [data, evento, descrição]
        data = limpar($(colunas[0]).text());
        descricao = limpar($(colunas[1]).text());
        if (colunas.length >= 3) {
          const extra = limpar($(colunas[2]).text());
          if (extra) descricao += ` — ${extra}`;
        }
      }

      if (data || descricao) {
        resultado.movimentacoes.push({ data, descricao });
      }
    }
  });

  // Se não encontrou nada significativo, retornar null
  const temDados = resultado.classe || resultado.assunto || resultado.partes.length || resultado.movimentacoes.length;
  return temDados ? resultado : null;
}

// ── Funções públicas ────────────────────────────────────────

/**
 * Consulta processo no eproc 1º Grau via consulta pública
 */
async function consultarPrimeiroGrau(numeroCNJ) {
  const numeroFormatado = formatarNumeroEproc(numeroCNJ);
  
  // Passo 1: Acessar a página de consulta pública (pega cookies/session)
  const consultaUrl = `${EPROC_1G}/externo_controlador.php?acao=processo_consulta_publica`;
  
  console.log(`[eproc 1G] Consultando: ${numeroFormatado}`);

  try {
    // Passo 2: Enviar o número do processo via POST
    const resp = await fetchComRetry(consultaUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        'txtNumProcesso': numeroFormatado,
        'hdnTipoConsulta': 'publica',
      }).toString(),
    });

    const html = await resp.text();
    return parseEprocHTML(html, '1º Grau');
  } catch (err) {
    console.error(`[eproc 1G] Erro: ${err.message}`);
    // Se o eproc ainda não está no ar para essa comarca, retorna null
    if (err.message.includes('ENOTFOUND') || err.message.includes('ECONNREFUSED') || err.message.includes('Timeout')) {
      return null;
    }
    throw err;
  }
}

/**
 * Consulta processo no eproc 2º Grau
 */
async function consultarSegundoGrau(numeroCNJ) {
  const numeroFormatado = formatarNumeroEproc(numeroCNJ);
  
  const consultaUrl = `${EPROC_2G}/externo_controlador.php?acao=processo_consulta_publica`;
  
  console.log(`[eproc 2G] Consultando: ${numeroFormatado}`);

  try {
    const resp = await fetchComRetry(consultaUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        'txtNumProcesso': numeroFormatado,
        'hdnTipoConsulta': 'publica',
      }).toString(),
    });

    const html = await resp.text();
    return parseEprocHTML(html, '2º Grau');
  } catch (err) {
    console.error(`[eproc 2G] Erro: ${err.message}`);
    if (err.message.includes('ENOTFOUND') || err.message.includes('ECONNREFUSED') || err.message.includes('Timeout')) {
      return null;
    }
    throw err;
  }
}

/**
 * Consulta nos dois graus em paralelo
 */
async function consultarAmbosGraus(numeroCNJ) {
  const [primeiroGrau, segundoGrau] = await Promise.allSettled([
    consultarPrimeiroGrau(numeroCNJ),
    consultarSegundoGrau(numeroCNJ),
  ]);

  return {
    primeiroGrau: primeiroGrau.status === 'fulfilled' ? primeiroGrau.value : null,
    segundoGrau: segundoGrau.status === 'fulfilled' ? segundoGrau.value : null,
    erros: {
      primeiroGrau: primeiroGrau.status === 'rejected' ? primeiroGrau.reason.message : null,
      segundoGrau: segundoGrau.status === 'rejected' ? segundoGrau.reason.message : null,
    }
  };
}

/**
 * Verifica se o eproc está acessível
 */
async function verificarDisponibilidade() {
  try {
    const resp = await fetchComRetry(`${EPROC_1G}/externo_controlador.php?acao=processo_consulta_publica`, {}, 1);
    return resp.ok;
  } catch {
    return false;
  }
}

module.exports = {
  consultarPrimeiroGrau,
  consultarSegundoGrau,
  consultarAmbosGraus,
  verificarDisponibilidade,
};
