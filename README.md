# nassauTickets

Sistema de Controle de Atendimento para um Laboratório de Análises Clínicas.

## Objetivo

O nassauTickets controla a emissão, fila, chamada e atendimento de senhas de um laboratório, seguindo as regras da atividade acadêmica.

## Tecnologias

- Frontend: React + Vite
- Backend: Node.js + Express
- Banco de dados: MySQL 8.0
- Comunicação: API REST + JSON

## Arquitetura

```text
frontend/ (React)
      |
      | HTTP / REST
      v
backend/ (Node.js + Express)
      |
      v
MySQL 8.0
```

## Tipos de senha

- SP — Senha Prioritária
- SG — Senha Geral
- SE — Senha para retirada de Exames

## Regra de prioridade

A seleção segue o ciclo:

`SP → SE/SG → SP → SE/SG`

Quando não houver SP, o sistema seleciona SE e depois SG. Qualquer guichê pode atender qualquer tipo de senha.

## Horário

Expediente previsto: 07:00 às 17:00. Atendimentos já iniciados devem ser finalizados; ao final do expediente, senhas ainda aguardando são descartadas.

## Estrutura

```text
nassauTickets/
├── backend/
├── docs/
│   ├── branding/
│   ├── mer/
│   ├── mockups/
│   ├── models/
│   │   └── uml/
│   └── requirements/
├── frontend/
├── .gitignore
├── LICENSE
└── README.md
```

## Instalação

### Banco de dados

1. Instale o MySQL 8.0.
2. Crie o banco executando `backend/sql/schema.sql`.
3. Copie `backend/.env.example` para `backend/.env`.
4. Preencha usuário e senha do MySQL.

### Backend

```bash
cd backend
npm install
npm run dev
```

API padrão: `http://localhost:3001`

### Frontend

Em outro terminal:

```bash
cd frontend
npm install
npm run dev
```

Frontend padrão: `http://localhost:5173`

## Funcionalidades

- Emissão anônima de senhas pelo totem
- Fila por prioridade
- Chamada de senha
- Chamar novamente
- Início e finalização do atendimento
- Painel com as 5 últimas chamadas
- Login de atendente
- Relatórios diário e mensal
- Auditoria
- Registro de guichê
- Máquina de estados da senha

## Configuração

Backend `.env`:

```env
PORT=3001
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=sua_senha
DB_NAME=nassau_tickets
JWT_SECRET=troque-esta-chave
```

Frontend pode usar `VITE_API_URL` para alterar a URL da API.

## Membros

| Nome | Matrícula | Papel |
|---|---|---|
| Pablo Oliveira | 1837789 | Scrum Master |
| Aylla Rocha | 1837798 | Desenvolvedor |

## Branches

- `main`: versão integrada/entregável
- `dev`: desenvolvimento

Fluxo recomendado:

```bash
git checkout -b dev
git add .
git commit -m "chore: cria estrutura inicial do projeto"
git push -u origin dev
```

Após validação, fazer merge de `dev` para `main`.

## Licença

MIT.
