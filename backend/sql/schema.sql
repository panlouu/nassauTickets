CREATE DATABASE IF NOT EXISTS nassau_tickets
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE nassau_tickets;

CREATE TABLE IF NOT EXISTS settings (
  id INT PRIMARY KEY,
  priority_turn ENUM('SP','SESG') NOT NULL DEFAULT 'SP'
);

INSERT INTO settings (id, priority_turn)
VALUES (1, 'SP')
ON DUPLICATE KEY UPDATE id = id;

CREATE TABLE IF NOT EXISTS attendants (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  username VARCHAR(80) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('ATENDENTE','GESTOR') NOT NULL DEFAULT 'ATENDENTE',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tickets (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  number VARCHAR(30) NOT NULL UNIQUE,
  type ENUM('SP','SG','SE') NOT NULL,
  sequence_number INT NOT NULL,
  status ENUM(
    'EMITIDA','AGUARDANDO','CHAMADA','CHAMADA_NOVAMENTE',
    'EM_ATENDIMENTO','ATENDIDA','NAO_COMPARECEU'
  ) NOT NULL DEFAULT 'EMITIDA',
  issued_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  first_called_at DATETIME NULL,
  second_called_at DATETIME NULL,
  service_started_at DATETIME NULL,
  service_finished_at DATETIME NULL,
  counter_number INT NULL,
  call_count INT NOT NULL DEFAULT 0,
  INDEX idx_queue (status, type, issued_at),
  INDEX idx_report (issued_at, type, status)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  attendant_id INT NULL,
  counter_number INT NULL,
  ticket_id BIGINT NULL,
  action VARCHAR(60) NOT NULL,
  details VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (attendant_id) REFERENCES attendants(id) ON DELETE SET NULL,
  FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE SET NULL,
  INDEX idx_audit_date (created_at)
);

-- Usuário inicial de demonstração:
-- senha: admin123
INSERT INTO attendants (name, username, password_hash, role)
VALUES (
  'Administrador',
  'admin',
  '$2b$10$6QvX0K7fM6Zf9kZQj2s4Oe5H7Y6d5Qj9eZrYl8gJf7tK0m8oS1d5a',
  'GESTOR'
)
ON DUPLICATE KEY UPDATE username = username;
