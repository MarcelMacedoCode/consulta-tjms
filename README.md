# ⚖ Consulta Processual — DataJud/CNJ

Aplicação web para consultar processos judiciais de qualquer tribunal brasileiro via API Pública do DataJud (CNJ).

## Funcionalidades

- Consulta por número do processo (formato CNJ)
- Suporte a **todos os tribunais** do Brasil (estaduais, federais, trabalhistas, superiores)
- Exibe: classe processual, órgão julgador, assuntos, datas e movimentações
- Timeline de movimentações em ordem cronológica
- Interface responsiva (funciona em desktop e celular)
- Rate limiting (proteção contra abuso)

## Executar localmente

```bash
# 1. Instalar dependências
npm install

# 2. Rodar
npm start

# 3. Acessar
# http://localhost:3000
```

## Deploy no Render

### Opção 1 — Via render.yaml (recomendado)

1. Faça push do repositório no GitHub
2. No [Render](https://render.com), clique em **New > Blueprint**
3. Conecte seu repositório GitHub
4. O Render vai detectar o `render.yaml` e configurar tudo automaticamente
5. Clique em **Apply** e aguarde o deploy

### Opção 2 — Manual

1. No Render, clique em **New > Web Service**
2. Conecte seu repositório GitHub
3. Configure:
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Plan**: Free
4. Em **Environment Variables**, adicione:
   - `DATAJUD_API_KEY` = `cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==`
5. Clique em **Create Web Service**

## Estrutura do projeto

```
consulta-tjms/
├── server.js          # Backend Express (proxy para API DataJud)
├── public/
│   └── index.html     # Frontend (HTML + CSS + JS vanilla)
├── package.json
├── render.yaml        # Config para deploy no Render
├── .gitignore
└── README.md
```

## API do backend

### `POST /api/consulta`

Consulta um processo no DataJud.

**Body (JSON):**
```json
{
  "numero": "0800123-45.2023.8.12.0001",
  "tribunal": "tjms"
}
```

**Resposta:**
```json
{
  "total": 1,
  "processos": [ { ... } ]
}
```

### `GET /api/tribunais`

Retorna a lista de tribunais disponíveis.

## Notas

- A **API Key** é pública e fornecida pelo CNJ. Pode ser alterada a qualquer momento. Se parar de funcionar, atualize pegando a chave vigente em: https://datajud-wiki.cnj.jus.br/api-publica/acesso/
- Processos sigilosos não são retornados pela API
- Rate limit: 60 requisições por minuto por IP

## Licença

Uso livre. Dados públicos do CNJ/DataJud.
