import express from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import { pool } from "./db.js";
import { authRequired, managerRequired } from "./auth.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = Number(process.env.PORT || 3001);

function businessDay() {
  const now = new Date();
  const hour = now.getHours();
  return hour >= 7 && hour < 17;
}

function datePrefix() {
  const d = new Date();
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yy}${mm}${dd}`;
}

function validateType(type) {
  return ["SP", "SG", "SE"].includes(type);
}

app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", database: "connected" });
  } catch (error) {
    console.error("Erro ao conectar ao MySQL:", error);
    res.status(503).json({
      status: "error",
      database: "unavailable",
      message: error.message
    });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "Usuário e senha são obrigatórios." });
  }

  const [rows] = await pool.query(
    "SELECT * FROM attendants WHERE username = ? AND active = TRUE LIMIT 1",
    [username]
  );
  const user = rows[0];

  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: "Usuário ou senha inválidos." });
  }

  const token = jwt.sign(
    { id: user.id, name: user.name, username: user.username, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: "8h" }
  );

  res.json({
    token,
    user: { id: user.id, name: user.name, username: user.username, role: user.role }
  });
});

app.post("/api/tickets", async (req, res) => {
  const { type } = req.body;
  if (!validateType(type)) {
    return res.status(400).json({ error: "Tipo de senha inválido." });
  }
  if (!businessDay()) {
    return res.status(400).json({ error: "O expediente é das 07h às 17h." });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [seqRows] = await conn.query(
      `SELECT COALESCE(MAX(sequence_number), 0) + 1 AS nextSequence
       FROM tickets WHERE type = ? AND DATE(issued_at) = CURDATE()
       FOR UPDATE`,
      [type]
    );
    const sequence = Number(seqRows[0].nextSequence);
    const number = `${datePrefix()}-${type}${String(sequence).padStart(3, "0")}`;

    const [result] = await conn.query(
      `INSERT INTO tickets (number, type, sequence_number, status)
       VALUES (?, ?, ?, 'AGUARDANDO')`,
      [number, type, sequence]
    );

    await conn.query(
      `INSERT INTO audit_logs (ticket_id, action, details)
       VALUES (?, 'EMISSAO', 'Senha emitida pelo totem')`,
      [result.insertId]
    );

    await conn.commit();
    res.status(201).json({
      id: result.insertId,
      number,
      type,
      status: "AGUARDANDO"
    });
  } catch (error) {
    console.error("Erro ao emitir a senha:", error);
    await conn.rollback();
    res.status(500).json({ error: "Não foi possível emitir a senha." });
  } finally {
    conn.release();
  }
});

async function selectNextTicket(conn) {
  const [settingRows] = await conn.query(
    "SELECT priority_turn FROM settings WHERE id = 1 FOR UPDATE"
  );
  const turn = settingRows[0]?.priority_turn || "SP";

  const typeOrder =
    turn === "SP"
      ? `CASE type WHEN 'SP' THEN 1 WHEN 'SE' THEN 2 WHEN 'SG' THEN 3 END`
      : `CASE type WHEN 'SE' THEN 1 WHEN 'SG' THEN 2 WHEN 'SP' THEN 3 END`;

  const [rows] = await conn.query(
    `SELECT * FROM tickets
     WHERE status = 'AGUARDANDO'
     ORDER BY ${typeOrder}, issued_at ASC, id ASC
     LIMIT 1
     FOR UPDATE`
  );

  return rows[0];
}

app.post("/api/tickets/next", authRequired, async (req, res) => {
  const { counter } = req.body;
  if (!counter) return res.status(400).json({ error: "Informe o guichê." });
  if (!businessDay()) return res.status(400).json({ error: "Fora do expediente." });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const ticket = await selectNextTicket(conn);
    if (!ticket) {
      await conn.rollback();
      return res.status(404).json({ error: "Não há senhas aguardando." });
    }

    const nextTurn = ticket.type === "SP" ? "SESG" : "SP";
    await conn.query(
      "UPDATE settings SET priority_turn = ? WHERE id = 1",
      [nextTurn]
    );

    await conn.query(
      `UPDATE tickets
       SET status='CHAMADA',
           call_count=call_count+1,
           first_called_at=COALESCE(first_called_at, NOW()),
           counter_number=?
       WHERE id=?`,
      [counter, ticket.id]
    );

    await conn.query(
      `INSERT INTO audit_logs
       (attendant_id, counter_number, ticket_id, action, details)
       VALUES (?, ?, ?, 'CHAMADA', 'Primeira chamada')`,
      [req.user.id, counter, ticket.id]
    );

    await conn.commit();
    res.json({ ...ticket, status: "CHAMADA", counter_number: counter, call_count: ticket.call_count + 1 });
  } catch {
    await conn.rollback();
    res.status(500).json({ error: "Não foi possível chamar a próxima senha." });
  } finally {
    conn.release();
  }
});

app.post("/api/tickets/:id/recall", authRequired, async (req, res) => {
  const { counter } = req.body;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query("SELECT * FROM tickets WHERE id=? FOR UPDATE", [req.params.id]);
    const ticket = rows[0];

    if (!ticket) {
      await conn.rollback();
      return res.status(404).json({ error: "Senha não encontrada." });
    }
    if (!["CHAMADA", "CHAMADA_NOVAMENTE"].includes(ticket.status)) {
      await conn.rollback();
      return res.status(400).json({ error: "Esta senha não pode ser chamada novamente." });
    }

    const newCount = ticket.call_count + 1;
    if (newCount >= 2) {
      await conn.query(
        `UPDATE tickets
         SET status='CHAMADA_NOVAMENTE', call_count=?, second_called_at=NOW(), counter_number=?
         WHERE id=?`,
        [newCount, counter || ticket.counter_number, ticket.id]
      );
    } else {
      await conn.query(
        `UPDATE tickets SET status='CHAMADA_NOVAMENTE', call_count=?, second_called_at=NOW()
         WHERE id=?`,
        [newCount, ticket.id]
      );
    }

    await conn.query(
      `INSERT INTO audit_logs
       (attendant_id, counter_number, ticket_id, action, details)
       VALUES (?, ?, ?, 'CHAMADA_NOVAMENTE', 'Última chamada')`,
      [req.user.id, counter || ticket.counter_number, ticket.id]
    );

    await conn.commit();
    res.json({ message: "Senha chamada novamente.", call_count: newCount });
  } catch {
    await conn.rollback();
    res.status(500).json({ error: "Não foi possível chamar novamente." });
  } finally {
    conn.release();
  }
});

app.post("/api/tickets/:id/no-show", authRequired, async (req, res) => {
  const [result] = await pool.query(
    `UPDATE tickets SET status='NAO_COMPARECEU'
     WHERE id=? AND call_count >= 2
       AND status IN ('CHAMADA','CHAMADA_NOVAMENTE')`,
    [req.params.id]
  );
  if (!result.affectedRows) {
    return res.status(400).json({ error: "A senha precisa ter duas chamadas e estar aguardando atendimento." });
  }
  await pool.query(
    `INSERT INTO audit_logs (attendant_id, counter_number, ticket_id, action, details)
     SELECT ?, counter_number, id, 'NAO_COMPARECEU', 'Cliente não compareceu após duas chamadas'
     FROM tickets WHERE id=?`,
    [req.user.id, req.params.id]
  );
  res.json({ message: "Senha marcada como não compareceu." });
});

app.post("/api/tickets/:id/start", authRequired, async (req, res) => {
  const { counter } = req.body;
  const [result] = await pool.query(
    `UPDATE tickets SET status='EM_ATENDIMENTO', service_started_at=NOW(),
     counter_number=COALESCE(?, counter_number)
     WHERE id=? AND status IN ('CHAMADA','CHAMADA_NOVAMENTE')`,
    [counter || null, req.params.id]
  );
  if (!result.affectedRows) return res.status(400).json({ error: "Senha não está em chamada." });

  await pool.query(
    `INSERT INTO audit_logs (attendant_id, counter_number, ticket_id, action, details)
     SELECT ?, counter_number, id, 'INICIO_ATENDIMENTO', 'Atendimento iniciado'
     FROM tickets WHERE id=?`,
    [req.user.id, req.params.id]
  );
  res.json({ message: "Atendimento iniciado." });
});

app.post("/api/tickets/:id/finish", authRequired, async (req, res) => {
  const [result] = await pool.query(
    `UPDATE tickets SET status='ATENDIDA', service_finished_at=NOW()
     WHERE id=? AND status='EM_ATENDIMENTO'`,
    [req.params.id]
  );
  if (!result.affectedRows) return res.status(400).json({ error: "Senha não está em atendimento." });

  await pool.query(
    `INSERT INTO audit_logs (attendant_id, counter_number, ticket_id, action, details)
     SELECT ?, counter_number, id, 'FINALIZACAO', 'Atendimento finalizado'
     FROM tickets WHERE id=?`,
    [req.user.id, req.params.id]
  );
  res.json({ message: "Atendimento finalizado." });
});

app.get("/api/panel", async (_req, res) => {
  const [rows] = await pool.query(
    `SELECT number, type, counter_number, status, service_finished_at
     FROM tickets
     WHERE status IN ('CHAMADA','CHAMADA_NOVAMENTE','EM_ATENDIMENTO','ATENDIDA')
       AND DATE(issued_at)=CURDATE()
     ORDER BY COALESCE(service_finished_at, first_called_at) DESC, id DESC
     LIMIT 5`
  );
  res.json(rows);
});

app.get("/api/reports", authRequired, managerRequired, async (_req, res) => {
  const [summary] = await pool.query(
    `SELECT
      COUNT(*) AS issued,
      SUM(status='ATENDIDA') AS attended,
      SUM(type='SP') AS sp_issued,
      SUM(type='SG') AS sg_issued,
      SUM(type='SE') AS se_issued,
      SUM(status='ATENDIDA' AND type='SP') AS sp_attended,
      SUM(status='ATENDIDA' AND type='SG') AS sg_attended,
      SUM(status='ATENDIDA' AND type='SE') AS se_attended,
      ROUND(AVG(
        CASE WHEN status='ATENDIDA'
        THEN TIMESTAMPDIFF(SECOND, service_started_at, service_finished_at) END
      ) / 60, 2) AS average_minutes
     FROM tickets
     WHERE DATE(issued_at)=CURDATE()`
  );

  const [details] = await pool.query(
    `SELECT number, type, issued_at, service_started_at, service_finished_at,
            counter_number, status
     FROM tickets
     WHERE DATE(issued_at)=CURDATE()
     ORDER BY issued_at DESC`
  );

  res.json({ summary: summary[0], details });
});

app.get("/api/audit", authRequired, managerRequired, async (_req, res) => {
  const [rows] = await pool.query(
    `SELECT a.id, u.name AS attendant, a.counter_number, t.number AS ticket,
            a.action, a.details, a.created_at
     FROM audit_logs a
     LEFT JOIN attendants u ON u.id=a.attendant_id
     LEFT JOIN tickets t ON t.id=a.ticket_id
     ORDER BY a.created_at DESC LIMIT 200`
  );
  res.json(rows);
});

app.listen(PORT, () => {
  console.log(`nassauTickets API em http://localhost:${PORT}`);
});
