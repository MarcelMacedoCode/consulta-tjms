/**
 * Scraper eSAJ — TJMS
 * 
 * Extrai dados completos de processos do portal e-SAJ do TJMS:
 *   - 1º Grau: https://esaj.tjms.jus.br/cpopg5/
 *   - 2º Grau: https://esaj.tjms.jus.br/cposg5/
 * 
 * Dados extraídos: classe, área, assunto, distribuição, juiz, valor,
 * partes (com advogados), movimentações completas.
 */

const cheerio = require('cheerio');
const fetch = require('node-fetch');

// ── Config ──────────────────────────────────────────────────
const BASE_1G = 'https://esaj.tjms.jus.br/cpopg5';
const BASE_2G = 'https://esaj.tjms.jus.br/cposg5';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
};

const MAX_RETRIES = 3;
const TIMEOUT_MS = 15000;

// ── Helpers ─────────────────────────────────────────────────

function limpar(texto) {
  if (!texto) return '';
  return texto.replace(/\s+/g, ' ').replace(/\n/g, ' ').trim();
}

/**
 * Formata o número do processo para a URL de busca do eSAJ.
 * Entrada: "0800123-45.2023.8.12.0001" ou "08001234520238120001"
 * Retorna: { numeroDigitoAno: "0800123-45.2023", foro: "0001", completo: "0800123-45.2023.8.12.0001" }
 */
function parseNumeroCNJ(numero) {
  const limpo = numero.replace(/[^0-9]/g, '');
  
  if (limpo.length !== 20) {
    throw new Error(`Número do processo inválido: esperado 20 dígitos, recebido ${limpo.length}`);
  }

  const nnnnnnn = limpo.substring(0, 7);
  const dd = limpo.substring(7, 9);
  const aaaa = limpo.substring(9, 13);
  const j = limpo.substring(13, 14);
  const tr = limpo.substring(14, 16);
  const oooo = limpo.substring(16, 20);

  const completo = `${nnnnnnn}-${dd}.${aaaa}.${j}.${tr}.${oooo}`;
  const numeroDigitoAno = `${nnnnnnn}-${dd}.${aaaa}`;

  return { numeroDigitoAno, foro: oooo, completo, j, tr };
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
      
      if (resp.ok) {
        return resp;
      }

      // Se 503/502, retry
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

// ── Parser do HTML do eSAJ ──────────────────────────────────

function parseProcessoHTML(html, grau) {
  const $ = cheerio.load(html);

  // Verificar se encontrou processo
  const mensagemErro = $('#mensagemRetorno').text().trim();
  if (mensagemErro && mensagemErro.includes('não encontrado')) {
    return null;
  }

  // Se a página tem uma lista de resultados (múltiplos processos), pegar o primeiro link
  const linkProcesso = $('a.linkProcesso').first().attr('href');
  if (linkProcesso && !$('#classeProcesso').length && !$('#labelClasse').length) {
    return { redirect: linkProcesso };
  }

  const resultado = {
    fonte: 'esaj',
    grau: grau,
    classe: '',
    area: '',
    assunto: '',
    distribuicao: '',
    juiz: '',
    valorAcao: '',
    partes: [],
    movimentacoes: [],
  };

  // ── Dados básicos ──
  // O eSAJ usa diferentes seletores dependendo da versão/tribunal
  resultado.classe = limpar(
    $('#classeProcesso').text() || 
    $('#labelClasse').text() || 
    $('span[id*="classe"]').first().text()
  );

  resultado.area = limpar(
    $('#areaProcesso span').first().text() || 
    $('#labelArea').text() || 
    $('div#areaProcesso').text()
  );

  resultado.assunto = limpar(
    $('#assuntoProcesso').text() || 
    $('#labelAssunto').text() || 
    $('span[id*="assunto"]').first().text()
  );

  resultado.distribuicao = limpar(
    $('#dataHoraDistribuicaoProcesso').text() || 
    $('div#dataHoraDistribuicaoProcesso').text() ||
    $('#labelDistribuicao').text()
  );

  resultado.juiz = limpar(
    $('#juizProcesso').text() || 
    $('span[id*="juiz"]').first().text() ||
    $('#labelJuiz').text()
  );

  resultado.valorAcao = limpar(
    $('#valorAcaoProcesso').text() || 
    $('div#valorAcaoProcesso').text() ||
    $('#labelValor').text()
  );

  // Número do processo (confirmação)
  resultado.numero = limpar(
    $('#numeroProcesso').text() ||
    $('span.unj-larger').first().text() ||
    $('h2.subtitle').first().text()
  );

  // ── Partes do processo ──
  // Tabela principal: #tablePartesPrincipais
  // Tabela expandida: #tableTodasPartes
  const tabelaPartes = $('#tableTodasPartes').length ? '#tableTodasPartes' : '#tablePartesPrincipais';
  
  $(tabelaPartes + ' tr').each((i, tr) => {
    const $tr = $(tr);
    
    // Coluna da participação (Autor, Réu, etc.)
    const tipoEl = $tr.find('td').first().find('span.tipoDeParticipacao, span.mensagemExibworking, span');
    let tipo = limpar($tr.find('td').first().text());
    
    // Às vezes o tipo está em um span com classe específica
    if (!tipo) {
      tipo = limpar($tr.find('.tipoDeParticipacao').text());
    }

    // Coluna do nome
    const nomeCompleto = limpar($tr.find('td').last().text());
    
    if (!tipo && !nomeCompleto) return;

    // Separar partes e advogados
    // Formato típico: "Nome da Parte   Advogado: Dr. Fulano (OAB: 12345/MS)"
    const $tdNome = $tr.find('td').last();
    const nomeParteEl = $tdNome.clone();
    nomeParteEl.find('span.mensagemExibworking, span.nomeAdvogado, span.advogado').remove();
    
    // Extrair nome da parte (primeiro texto antes dos advogados)
    let nomeParte = '';
    let advogados = [];

    // Abordagem por textos dentro da célula
    const textoCompleto = $tdNome.html() || '';
    
    // Tentar extrair advogados via regex no HTML
    const htmlCelula = textoCompleto;
    
    // Nome da parte é geralmente o primeiro texto significativo
    const firstText = $tdNome.contents().filter(function() {
      return this.nodeType === 3; // text node
    }).first().text();
    
    nomeParte = limpar(firstText || nomeCompleto.split('Advogado')[0].split('Adv.')[0]);
    
    // Advogados: procurar spans ou texto com "Advogado:", "Adv.:", "OAB"
    const matchAdvs = nomeCompleto.match(/(?:Advogad[oa]|Adv\.?):\s*([^()]+?)(?:\(OAB[:\s]*([^)]+)\))?(?=\s*Advogad[oa]|\s*Adv\.?:|$)/gi);
    if (matchAdvs) {
      matchAdvs.forEach(m => {
        const advMatch = m.match(/(?:Advogad[oa]|Adv\.?):\s*(.+?)(?:\(OAB[:\s]*(.+?)\))?$/i);
        if (advMatch) {
          advogados.push({
            nome: limpar(advMatch[1]),
            oab: advMatch[2] ? limpar(advMatch[2]) : '',
          });
        }
      });
    }

    if (nomeParte || tipo) {
      resultado.partes.push({
        tipo: tipo.replace(/:$/, '').trim(),
        nome: nomeParte || nomeCompleto,
        advogados: advogados,
      });
    }
  });

  // Abordagem alternativa para partes se a tabela não funcionou
  if (resultado.partes.length === 0) {
    // Tentar formato com divs/spans (versão mobile ou versão alternativa)
    $('.secaoFormBody, #partesProcesso').find('tr, .linha-parte').each((i, el) => {
      const $el = $(el);
      const tipo = limpar($el.find('.label, .tipoParticipacao, td:first-child').text());
      const nome = limpar($el.find('.value, .nomeParticipante, td:last-child').text());
      if (tipo || nome) {
        resultado.partes.push({ tipo, nome, advogados: [] });
      }
    });
  }

  // ── Movimentações ──
  // Tabela: #tabelaTodasMovimentacoes ou #tabelaUltimasMovimentacoes
  const tabelaMovs = $('#tabelaTodasMovimentacoes').length ? '#tabelaTodasMovimentacoes' : '#tabelaUltimasMovimentacoes';
  
  $(tabelaMovs + ' tr').each((i, tr) => {
    const $tr = $(tr);
    
    const data = limpar(
      $tr.find('td.dataMovimentacao, td.dataMovimentacaoProcesso, td:first-child').first().text()
    );
    
    const descricao = limpar(
      $tr.find('td.descricaoMovimentacao, td.descricaoMovimentacaoProcesso, td:last-child').first().text()
    );
    
    if (data || descricao) {
      resultado.movimentacoes.push({ data, descricao });
    }
  });

  // Limpar movimentações sem conteúdo
  resultado.movimentacoes = resultado.movimentacoes.filter(m => m.data || m.descricao);

  return resultado;
}

// ── Funções públicas ────────────────────────────────────────

/**
 * Consulta processo no eSAJ 1º Grau
 */
async function consultarPrimeiroGrau(numeroCNJ) {
  const parsed = parseNumeroCNJ(numeroCNJ);
  
  // URL de busca do eSAJ CPOPG5
  const searchUrl = `${BASE_1G}/search.do?` + new URLSearchParams({
    'conversationId': '',
    'dadosConsulta.localPesquisa.cdLocal': '-1',
    'cbPesquisa': 'NUMPROC',
    'dadosConsulta.tipoNuProcesso': 'UNIFICADO',
    'numeroDigitoAnoUnificado': parsed.numeroDigitoAno,
    'foroNumeroUnificado': parsed.foro,
    'dadosConsulta.valorConsultaNuUnificado': parsed.completo,
    'dadosConsulta.valorConsulta': '',
  }).toString();

  console.log(`[eSAJ 1G] Consultando: ${parsed.completo}`);
  
  const resp = await fetchComRetry(searchUrl);
  let html = await resp.text();

  let resultado = parseProcessoHTML(html, '1º Grau');

  // Se retornou redirect (lista de resultados), seguir o link
  if (resultado && resultado.redirect) {
    const showUrl = resultado.redirect.startsWith('http') 
      ? resultado.redirect 
      : `${BASE_1G}/${resultado.redirect}`;
    
    const resp2 = await fetchComRetry(showUrl);
    html = await resp2.text();
    resultado = parseProcessoHTML(html, '1º Grau');
  }

  return resultado;
}

/**
 * Consulta processo no eSAJ 2º Grau
 */
async function consultarSegundoGrau(numeroCNJ) {
  const parsed = parseNumeroCNJ(numeroCNJ);
  
  const searchUrl = `${BASE_2G}/search.do?` + new URLSearchParams({
    'conversationId': '',
    'paginaConsulta': '0',
    'cbPesquisa': 'NUMPROC',
    'tipoNuProcesso': 'UNIFICADO',
    'numeroDigitoAnoUnificado': parsed.numeroDigitoAno,
    'foroNumeroUnificado': parsed.foro,
    'dePesquisaNuUnificado': parsed.completo,
    'dePesquisa': '',
  }).toString();

  console.log(`[eSAJ 2G] Consultando: ${parsed.completo}`);

  const resp = await fetchComRetry(searchUrl);
  let html = await resp.text();
  
  let resultado = parseProcessoHTML(html, '2º Grau');

  if (resultado && resultado.redirect) {
    const showUrl = resultado.redirect.startsWith('http') 
      ? resultado.redirect 
      : `${BASE_2G}/${resultado.redirect}`;
    
    const resp2 = await fetchComRetry(showUrl);
    html = await resp2.text();
    resultado = parseProcessoHTML(html, '2º Grau');
  }

  return resultado;
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

module.exports = {
  consultarPrimeiroGrau,
  consultarSegundoGrau,
  consultarAmbosGraus,
  parseNumeroCNJ,
};
