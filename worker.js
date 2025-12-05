require('dotenv').config({ path: './almatools-tasks.env' });
const { db } = require('./db');
const { processRecord } = require('./librisimport');
const logger = require('./logger');
const nodemailer = require("nodemailer");

function ensureFailedLibrisRecordsTable() {
    const createTableQuery = `
    CREATE TABLE IF NOT EXISTS libris_import_records (
      id INT AUTO_INCREMENT PRIMARY KEY,
      libris_id VARCHAR(50),
      record_type VARCHAR(20),
      record LONGTEXT,
      message TEXT,
      attempts INT DEFAULT 0,
      last_attempt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      mail_sent TINYINT(1) DEFAULT 0,
      status ENUM('failed','success','max_attempts') DEFAULT 'success'
    )
  `;

    db.query(createTableQuery, (err, result) => {
        if (err) {
            logger.error('❌ Kunde inte skapa libris_import_records-tabellen ' + err);
        } else {
            logger.info('✅ Tabell libris_import_records är klar');
        }
    });
}

// Skapa tabellen om den inte finns
ensureFailedLibrisRecordsTable();

async function retryFailedLibrisRecords() {

    logger.info('ℹ️ Konrollerar om det finns misslyckade libris-poster...');

    //Antal max försök per post(justerbart via env)
    const maxAttempts = parseInt(process.env.LIBRISIMPORT_FAIL_MAX_ATTEMPTS, 10) || 5;

    db.query('SELECT * FROM libris_import_records WHERE status="failed"', async (err, results) => {
        if (err) return logger.error('❌ Fel vid hämtning av misslyckade poster ' + err);

        for (const row of results) {
            const librisId = row.libris_id;
            const type = row.record_type;
            const record = row.record;
            const attempts = row.attempts;

            if (attempts >= maxAttempts) {
                if (row.mail_sent === 0) {
                    if (process.env.SEND_ERROR_MAIL === 'true') {
                        // 🚨 Max försök nådda → skicka felmail
                        const mailOptions = {
                            from: process.env.MAILFROM_ADDRESS,
                            to: process.env.MAIL_ERROR_TO_ADDRESS,
                            subject: `🚨 LibrisImport Max Attempts uppnådd för ${librisId}`,
                            text: `Posten med LibrisId ${librisId} (typ: ${type}) har misslyckats ${attempts} gånger och kommer inte längre att bearbetas.\n\nRecord:\n${record}`
                        };
                        try {
                            const transporter = nodemailer.createTransport({
                                port: 25,
                                host: process.env.SMTP_HOST,
                                tls: { rejectUnauthorized: false }
                            });
                            await transporter.sendMail(mailOptions);
                            logger.info(`📧 Skickade mail för max attempts: ${librisId}`);

                            // Markera att mail har skickats
                            db.query('UPDATE libris_import_records SET mail_sent = 1 WHERE id = ?', [row.id]);
                        } catch (mailErr) {
                            logger.error(`❌ Kunde inte skicka mail för ${librisId}: ${mailErr.message}`);
                        }
                    }
                }

                // Markera att max_attempts har uppnåtts
                logger.info(`⚠️ Max försök uppnådda för ${librisId}, markerar som max_attempts.`);
                db.query('UPDATE libris_import_records SET status = "max_attempts" WHERE id = ?', [row.id]);

                continue; // hoppa över fler försök
            }

            try {
                const recordObj = JSON.parse(record);
                logger.info(`🔄 Försöker igen: ${librisId} (Typ: ${type}, Försök: ${attempts + 1})`);

                await processRecord(recordObj);

                db.query(
                    `UPDATE libris_import_records SET attempts = attempts + 1, last_attempt = NOW(), message = "✅ Retry lyckades och markerad som hanterad, librisId: ${librisId}", status = "success" WHERE id = ?`,
                    [row.id]
                );
                logger.info(`✅ Retry lyckades och markerad som hanterad, librisId: ${librisId}`);
            } catch (err) {
                db.query(
                    'UPDATE libris_import_records SET attempts = attempts + 1, last_attempt = NOW(), message = ? WHERE id = ?',
                    [err.message, row.id]
                );
                logger.warn(`❌ Retry misslyckades, librisId: ${librisId}, fel: ${err.message}`);
            }
        }
    });
}

// Kör retry-funktionen var x:e sekund (justerbart via env)
setInterval(retryFailedLibrisRecords, parseInt(process.env.LIBRISIMPORT_FAIL_RETRY_SECONDS, 10) * 1000);
retryFailedLibrisRecords();
