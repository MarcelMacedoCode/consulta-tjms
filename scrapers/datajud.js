/**
 * API DataJud — CNJ
 * 
 * Consulta metadados de processos na base nacional do DataJud.
 * Retorna: classe, assuntos, movimentações, órgão julgador, datas.
 * NÃO retorna: partes, advogados (dados protegidos pela Portaria 160).
 */

const fetch = require('node-fetch');

const DATAJUD_BASE = 'https://api-publica.datajud.cnj.jus.br';
const API_KEY = process.env.DATAJUD_API_KEY || 'cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==';

const TRIBUNAIS = {
  'tjms': 'api_publica_tjms', 'tjsp': 'api_publica_tjsp', 'tjrj': 'api_publica_tjrj',
  'tjmg': 'api_publica_tjmg', 'tjpr': 'api_publica_tjpr', 'tjsc': 'api_publica_tjsc',
  'tjrs': 'api_publica_tjrs', 'tjba': 'api_publica_tjba', 'tjpe': 'api_publica_tjpe',
  'tjce': 'api_publica_tjce', 'tjgo': 'api_publica_tjgo', 'tjmt': 'api_publica_tjmt',
  'tjpa': 'api_publica_tjpa', 'tjam': 'api_publica_tjam', 'tjma': 'api_publica_tjma',
  'tjpi': 'api_publica_tjpi', 'tjrn': 'api_publica_tjrn', 'tjpb': 'api_publica_tjpb',
  'tjal': 'api_publica_tjal', 'tjse': 'api_publica_tjse', 'tjes': 'api_publica_tjes',
  'tjro': 'api_publica_tjro', 'tjac': 'api_publica_tjac', 'tjap': 'api_publica_tjap',
  'tjrr': 'api_publica_tjrr', 'tjto': 'api_publica_tjto', 'tjdft': 'api_publica_tjdft',
  'trf1': 'api_publica_trf1', 'trf2': 'api_publica_trf2', 'trf3': 'api_publica_trf3',
  'trf4': 'api_publica_trf4', 'trf5': 'api_publica_trf5', 'trf6': 'api_publica_trf6',
  'stj': 'api_publica_stj', 'stf': 'api_publica_stf', 'tst': 'api_publica_tst',
};

async function consultar(numero, tribunal = 'tjms') {
  const tribunalKey = tribunal.toLowerCase().trim();
  const endpoint = TRIBUNAIS[tribunalKey];

  if (!endpoint) {
    throw new Error(`Tribunal "${tribunal}" não encontrado.`);
  }

  const numeroLimpo = numero.replace(/[^0-9]/g, '');
  if (numeroLimpo.length < 10) {
    throw new Error('Número do processo inválido.');
  }

  const url = `${DATAJUD_BASE}/${endpoint}/_search`;
  const body = { query: { match: { numeroProcesso: numeroLimpo } } };

  console.log(`[DataJud] Consultando: ${tribunalKey.toUpperCase()} | ${numeroLimpo}`);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `APIKey ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`DataJud HTTP ${response.status}: ${text.substring(0, 200)}`);
  }

  const data = await response.json();

  if (data.hits?.hits?.length > 0) {
    return {
      total: data.hits.total?.value || data.hits.hits.length,
      processos: data.hits.hits.map(h => ({ ...h._source, fonte: 'datajud' })),
    };
  }

  return { total: 0, processos: [] };
}

module.exports = { consultar, TRIBUNAIS };
