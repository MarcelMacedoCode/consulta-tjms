const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Config DataJud ──────────────────────────────────────────
const DATAJUD_BASE = 'https://api-publica.datajud.cnj.jus.br';
const API_KEY = process.env.DATAJUD_API_KEY || 'cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==';

// Mapa de tribunais suportados (pode expandir depois)
const TRIBUNAIS = {
  'tjms':   'api_publica_tjms',
  'tjsp':   'api_publica_tjsp',
  'tjrj':   'api_publica_tjrj',
  'tjmg':   'api_publica_tjmg',
  'tjpr':   'api_publica_tjpr',
  'tjsc':   'api_publica_tjsc',
  'tjrs':   'api_publica_tjrs',
  'tjba':   'api_publica_tjba',
  'tjpe':   'api_publica_tjpe',
  'tjce':   'api_publica_tjce',
  'tjgo':   'api_publica_tjgo',
  'tjmt':   'api_publica_tjmt',
  'tjpa':   'api_publica_tjpa',
  'tjam':   'api_publica_tjam',
  'tjma':   'api_publica_tjma',
  'tjpi':   'api_publica_tjpi',
  'tjrn':   'api_publica_tjrn',
  'tjpb':   'api_publica_tjpb',
  'tjal':   'api_publica_tjal',
  'tjse':   'api_publica_tjse',
  'tjes':   'api_publica_tjes',
  'tjro':   'api_publica_tjro',
  'tjac':   'api_publica_tjac',
  'tjap':   'api_publica_tjap',
  'tjrr':   'api_publica_tjrr',
  'tjto':   'api_publica_tjto',
  'tjdft':  'api_publica_tjdft',
  'trf1':   'api_publica_trf1',
  'trf2':   'api_publica_trf2',
  'trf3':   'api_publica_trf3',
  'trf4':   'api_publica_trf4',
  'trf5':   'api_publica_trf5',
  'trf6':   'api_publica_trf6',
  'stj':    'api_publica_stj',
  'stf':    'api_publica_stf',
  'tst':    'api_publica_tst',
  'trt1':   'api_publica_trt1',
  'trt2':   'api_publica_trt2',
  'trt3':   'api_publica_trt3',
  'trt4':   'api_publica_trt4',
  'trt5':   'api_publica_trt5',
  'trt6':   'api_publica_trt6',
  'trt7':   'api_publica_trt7',
  'trt8':   'api_publica_trt8',
  'trt9':   'api_publica_trt9',
  'trt10':  'api_publica_trt10',
  'trt11':  'api_publica_trt11',
  'trt12':  'api_publica_trt12',
  'trt13':  'api_publica_trt13',
  'trt14':  'api_publica_trt14',
  'trt15':  'api_publica_trt15',
  'trt16':  'api_publica_trt16',
  'trt17':  'api_publica_trt17',
  'trt18':  'api_publica_trt18',
  'trt19':  'api_publica_trt19',
  'trt20':  'api_publica_trt20',
  'trt21':  'api_publica_trt21',
  'trt22':  'api_publica_trt22',
  'trt23':  'api_publica_trt23',
  'trt24':  'api_publica_trt24',
};

// ── Middleware ───────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      connectSrc: ["'self'"],
    }
  }
}));

app.use(cors());
app.use(express.json());

// Rate limiting: 60 requests per minute per IP
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas requisições. Tente novamente em 1 minuto.' }
});
app.use('/api/', limiter);

// Serve static frontend
app.use(express.static(path.join(__dirname, 'public')));

// ── API Routes ──────────────────────────────────────────────

// GET /api/tribunais — lista os tribunais disponíveis
app.get('/api/tribunais', (req, res) => {
  res.json({ tribunais: Object.keys(TRIBUNAIS) });
});

// POST /api/consulta — consulta processo
app.post('/api/consulta', async (req, res) => {
  try {
    const { numero, tribunal = 'tjms' } = req.body;

    if (!numero || typeof numero !== 'string') {
      return res.status(400).json({ error: 'Campo "numero" é obrigatório.' });
    }

    const tribunalKey = tribunal.toLowerCase().trim();
    const endpoint = TRIBUNAIS[tribunalKey];

    if (!endpoint) {
      return res.status(400).json({
        error: `Tribunal "${tribunal}" não encontrado.`,
        disponiveis: Object.keys(TRIBUNAIS)
      });
    }

    // Limpa o número: remove pontos, traços, espaços
    const numeroLimpo = numero.replace(/[^0-9]/g, '');

    if (numeroLimpo.length < 10) {
      return res.status(400).json({ error: 'Número do processo parece inválido. Verifique e tente novamente.' });
    }

    const url = `${DATAJUD_BASE}/${endpoint}/_search`;

    const body = {
      query: {
        match: {
          numeroProcesso: numeroLimpo
        }
      }
    };

    console.log(`[CONSULTA] Tribunal: ${tribunalKey.toUpperCase()} | Processo: ${numeroLimpo}`);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `APIKey ${API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`[ERRO] DataJud HTTP ${response.status}: ${text}`);
      return res.status(502).json({
        error: `A API do DataJud retornou erro ${response.status}.`,
        detalhes: text.substring(0, 200)
      });
    }

    const data = await response.json();

    if (data.hits && data.hits.hits && data.hits.hits.length > 0) {
      const processos = data.hits.hits.map(h => h._source);
      res.json({
        total: data.hits.total?.value || processos.length,
        processos
      });
    } else {
      res.json({ total: 0, processos: [] });
    }

  } catch (err) {
    console.error('[ERRO] Falha na consulta:', err.message);
    res.status(500).json({ error: 'Erro interno ao consultar a API do DataJud.' });
  }
});

// Fallback: serve index.html para qualquer rota não-API
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start ───────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  🏛  Consulta TJMS rodando em http://localhost:${PORT}\n`);
});
