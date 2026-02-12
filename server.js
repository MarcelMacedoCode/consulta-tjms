const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

// Scrapers
const datajud = require('./scrapers/datajud');
const esaj = require('./scrapers/esaj');
const eproc = require('./scrapers/eproc');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ───────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      connectSrc: ["'self'"],
    }
  }
}));

app.use(cors());
app.use(express.json());

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas requisições. Tente novamente em 1 minuto.' }
});
app.use('/api/', limiter);

app.use(express.static(path.join(__dirname, 'public')));

// ── API Routes ──────────────────────────────────────────────

app.get('/api/tribunais', (req, res) => {
  res.json({ tribunais: Object.keys(datajud.TRIBUNAIS) });
});

// Rota original (compatibilidade)
app.post('/api/consulta', async (req, res) => {
  try {
    const { numero, tribunal = 'tjms' } = req.body;
    if (!numero) return res.status(400).json({ error: 'Campo "numero" é obrigatório.' });
    const data = await datajud.consultar(numero, tribunal);
    res.json(data);
  } catch (err) {
    console.error('[ERRO] DataJud:', err.message);
    res.status(502).json({ error: err.message });
  }
});

/**
 * POST /api/consulta-completa
 * Consulta UNIFICADA: DataJud + eSAJ + eproc em paralelo.
 */
app.post('/api/consulta-completa', async (req, res) => {
  try {
    const { numero } = req.body;
    if (!numero) return res.status(400).json({ error: 'Campo "numero" é obrigatório.' });

    const numeroLimpo = numero.replace(/[^0-9]/g, '');
    if (numeroLimpo.length < 10) {
      return res.status(400).json({ error: 'Número do processo inválido.' });
    }

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`[CONSULTA COMPLETA] ${numero}`);
    console.log(`${'═'.repeat(60)}`);

    const [resultDatajud, resultEsaj, resultEproc] = await Promise.allSettled([
      datajud.consultar(numero, 'tjms'),
      esaj.consultarAmbosGraus(numero),
      eproc.consultarAmbosGraus(numero),
    ]);

    const dadosDatajud = resultDatajud.status === 'fulfilled' ? resultDatajud.value : null;
    const dadosEsaj = resultEsaj.status === 'fulfilled' ? resultEsaj.value : null;
    const dadosEproc = resultEproc.status === 'fulfilled' ? resultEproc.value : null;

    console.log(`  DataJud: ${dadosDatajud?.total || 0} resultado(s) ${resultDatajud.status === 'rejected' ? '(ERRO: ' + resultDatajud.reason.message + ')' : ''}`);
    console.log(`  eSAJ 1G: ${dadosEsaj?.primeiroGrau ? 'OK' : '-'} ${dadosEsaj?.erros?.primeiroGrau || ''}`);
    console.log(`  eSAJ 2G: ${dadosEsaj?.segundoGrau ? 'OK' : '-'} ${dadosEsaj?.erros?.segundoGrau || ''}`);
    console.log(`  eproc 1G: ${dadosEproc?.primeiroGrau ? 'OK' : '-'} ${dadosEproc?.erros?.primeiroGrau || ''}`);
    console.log(`  eproc 2G: ${dadosEproc?.segundoGrau ? 'OK' : '-'} ${dadosEproc?.erros?.segundoGrau || ''}`);

    const unificado = mergeResultados(dadosDatajud, dadosEsaj, dadosEproc);

    res.json({
      datajud: dadosDatajud,
      esaj: dadosEsaj ? { primeiroGrau: dadosEsaj.primeiroGrau, segundoGrau: dadosEsaj.segundoGrau } : null,
      eproc: dadosEproc ? { primeiroGrau: dadosEproc.primeiroGrau, segundoGrau: dadosEproc.segundoGrau } : null,
      unificado,
      erros: {
        datajud: resultDatajud.status === 'rejected' ? resultDatajud.reason.message : null,
        esaj: dadosEsaj?.erros || null,
        eproc: dadosEproc?.erros || null,
      }
    });
  } catch (err) {
    console.error('[ERRO] Consulta completa:', err.message);
    res.status(500).json({ error: 'Erro interno na consulta.' });
  }
});

app.post('/api/consulta-esaj', async (req, res) => {
  try {
    const { numero, grau = 'ambos' } = req.body;
    if (!numero) return res.status(400).json({ error: 'Campo "numero" é obrigatório.' });
    let resultado;
    if (grau === '1') resultado = await esaj.consultarPrimeiroGrau(numero);
    else if (grau === '2') resultado = await esaj.consultarSegundoGrau(numero);
    else resultado = await esaj.consultarAmbosGraus(numero);
    res.json(resultado);
  } catch (err) {
    console.error('[ERRO] eSAJ:', err.message);
    res.status(502).json({ error: err.message });
  }
});

app.post('/api/consulta-eproc', async (req, res) => {
  try {
    const { numero } = req.body;
    if (!numero) return res.status(400).json({ error: 'Campo "numero" é obrigatório.' });
    const resultado = await eproc.consultarAmbosGraus(numero);
    res.json(resultado);
  } catch (err) {
    console.error('[ERRO] eproc:', err.message);
    res.status(502).json({ error: err.message });
  }
});

app.get('/api/status', async (req, res) => {
  const eprocOk = await eproc.verificarDisponibilidade();
  res.json({
    fontes: { datajud: true, esaj: true, eproc: eprocOk },
    nota: eprocOk
      ? 'Todas as fontes disponíveis.'
      : 'eproc indisponível ou ainda em implantação. eSAJ e DataJud funcionando.'
  });
});

// ── Merge inteligente ───────────────────────────────────────

function mergeResultados(dadosDatajud, dadosEsaj, dadosEproc) {
  const proc = dadosDatajud?.processos?.[0] || {};
  const e1 = dadosEsaj?.primeiroGrau || {};
  const e2 = dadosEsaj?.segundoGrau || {};
  const ep1 = dadosEproc?.primeiroGrau || {};
  const ep2 = dadosEproc?.segundoGrau || {};

  return {
    numero: proc.numeroProcesso || '',
    classe: proc.classe?.nome || e1.classe || ep1.classe || '',
    classeCodigoCNJ: proc.classe?.codigo || null,
    area: e1.area || ep1.area || '',
    assuntos: proc.assuntos?.map(a => a.nome || a.codigo) || [],
    assuntoPrincipal: e1.assunto || ep1.assunto || proc.assuntos?.[0]?.nome || '',
    orgaoJulgador: proc.orgaoJulgador?.nome || ep1.orgaoJulgador || '',
    juiz: e1.juiz || ep1.juiz || '',
    distribuicao: e1.distribuicao || ep1.distribuicao || proc.dataAjuizamento || '',
    valorAcao: e1.valorAcao || '',
    grau: proc.grau || e1.grau || ep1.grau || '',
    formato: proc.formato?.nome || '',
    nivelSigilo: proc.nivelSigilo ?? null,
    situacao: ep1.situacao || '',
    dataUltimaAtualizacao: proc.dataHoraUltimaAtualizacao || '',

    // Partes: eSAJ (com advogados) > eproc > DataJud (não tem)
    partes: primeiroNaoVazio(e1.partes, ep1.partes, e2.partes, ep2.partes),

    // Movimentações: DataJud (padronizado) > eSAJ > eproc
    movimentacoes: mergeMovs(proc.movimentos, e1.movimentacoes, ep1.movimentacoes),

    fontes: {
      datajud: !!dadosDatajud?.total,
      esaj1g: !!dadosEsaj?.primeiroGrau,
      esaj2g: !!dadosEsaj?.segundoGrau,
      eproc1g: !!dadosEproc?.primeiroGrau,
      eproc2g: !!dadosEproc?.segundoGrau,
    },

    segundoGrau: (e2.classe || ep2.classe) ? {
      classe: e2.classe || ep2.classe || '',
      assunto: e2.assunto || ep2.assunto || '',
      movimentacoes: e2.movimentacoes || ep2.movimentacoes || [],
      partes: e2.partes || ep2.partes || [],
    } : null,
  };
}

function primeiroNaoVazio(...listas) {
  for (const l of listas) {
    if (l && l.length > 0) return l;
  }
  return [];
}

function mergeMovs(datajudMovs, esajMovs, eprocMovs) {
  if (datajudMovs?.length) {
    return datajudMovs
      .sort((a, b) => new Date(b.dataHora || 0) - new Date(a.dataHora || 0))
      .map(m => ({
        data: m.dataHora || '',
        descricao: m.nome || m.codigo || '',
        complementos: (m.complementosTabelados || []).map(c => c.nome || c.descricao || c.valor || '').filter(Boolean),
        fonte: 'datajud',
      }));
  }
  if (esajMovs?.length) return esajMovs.map(m => ({ ...m, complementos: [], fonte: 'esaj' }));
  if (eprocMovs?.length) return eprocMovs.map(m => ({ ...m, complementos: [], fonte: 'eproc' }));
  return [];
}

// Fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n  🏛  Consulta TJMS v2.0 — DataJud + eSAJ + eproc`);
  console.log(`  🌐  http://localhost:${PORT}\n`);
});
