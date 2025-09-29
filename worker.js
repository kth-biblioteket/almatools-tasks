require('dotenv').config({ path: './almatools-tasks.env' });
const { db } = require('./db');
const { processRecord } = require('./librisimport');
const logger = require('./logger');
const nodemailer = require("nodemailer");

function ensureFailedLibrisRecordsTable() {
    const createTableQuery = `
    CREATE TABLE IF NOT EXISTS libris_import_failed_records (
      id INT AUTO_INCREMENT PRIMARY KEY,
      libris_id VARCHAR(50),
      record_type VARCHAR(20),
      record LONGTEXT,
      attempts INT DEFAULT 0,
      last_attempt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;

    db.query(createTableQuery, (err, result) => {
        if (err) {
            logger.error('❌ Kunde inte skapa libris_import_failed_records-tabellen', err);
        } else {
            logger.info('✅ Tabell libris_import_failed_records är klar');
        }
    });
}

// Skapa tabellen om den inte finns
ensureFailedLibrisRecordsTable();

async function retryFailedLibrisRecords() {

    logger.info('ℹ️ Konrollerar om det finns misslyckade libris-poster...');

    //Antal max försök per post(justerbart via env)
    const maxAttempts = parseInt(process.env.LIBRISIMPORT_FAIL_MAX_ATTEMPTS, 10) || 5;

    db.query('SELECT * FROM libris_import_failed_records', async (err, results) => {
        if (err) return logger.error('❌ Fel vid hämtning av misslyckade poster', err);

        for (const row of results) {
            const librisId = row.libris_id;
            const type = row.record_type;
            const record = row.record;
            const attempts = row.attempts;

            if (attempts >= maxAttempts) {
                // 🚨 Max försök nådda → skicka felmail
                const mailOptions = {
                    from: process.env.MAILFROM_ADDRESS,
                    to: process.env.MAIL_ERROR_TO_ADDRESS,
                    subject: `🚨 LibrisImport Max Attempts uppnådd för ${librisId}`,
                    text: `Posten med LibrisId ${librisId} (typ: ${type}) har misslyckats ${attempts} gånger och kommer inte längre att bearbetas.\n\nRecord:\n${record}`
                };
                logger.error("❌ Max attempts nådda:", mailOptions.text);

                if (process.env.SEND_ERROR_MAIL === 'true') {
                    try {
                        const transporter = nodemailer.createTransport({
                            port: 25,
                            host: process.env.SMTP_HOST,
                            tls: { rejectUnauthorized: false }
                        });
                        await transporter.sendMail(mailOptions);
                        logger.info(`📧 Skickade mail för max attempts: ${librisId}`);
                    } catch (mailErr) {
                        logger.error(`❌ Kunde inte skicka mail för ${librisId}: ${mailErr.message}`);
                    }
                }

                continue; // hoppa över fler försök
            }

            try {
                const recordObj = JSON.parse(record);
                console.log(`🔄 Försöker igen: ${librisId} (Typ: ${type}, Försök: ${attempts + 1})`);

                await processRecord(recordObj);

                db.query('DELETE FROM libris_import_failed_records WHERE id = ?', [row.id]);
                logger.info(`✅ Retry lyckades, librisId: ${librisId}`);
            } catch (err) {
                db.query(
                    'UPDATE libris_import_failed_records SET attempts = attempts + 1, last_attempt = NOW() WHERE id = ?',
                    [row.id]
                );
                logger.warn(`❌ Retry misslyckades, librisId: ${librisId}, fel: ${err.message}`);
            }
        }
    });
}

// Kör retry-funktionen var x:e sekund (justerbart via env)
setInterval(retryFailedLibrisRecords, parseInt(process.env.LIBRISIMPORT_FAIL_RETRY_SECONDS, 10) * 1000);
retryFailedLibrisRecords();
