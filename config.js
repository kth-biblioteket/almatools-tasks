const database = require('./db');

let cachedConfig = null;
let lastLoaded = 0;
const CACHE_TTL = 10 * 1000; // 10 sekunder cache, kan ändras

async function loadConfig() {
    const now = Date.now();
    if (cachedConfig && now - lastLoaded < CACHE_TTL) {
        return cachedConfig;
    }

    return new Promise((resolve) => {
        database.db.query(
            "SELECT `key`, `value` FROM system_config",
            (err, results) => {
                if (err) {
                    console.error("Fel vid hämtning av config:", err);
                    return resolve({});
                }

                cachedConfig = {};
                for (const row of results) {
                    cachedConfig[row.key] = row.value;
                }
                lastLoaded = now;
                resolve(cachedConfig);
            }
        );
    });
}

async function getConfig(key, defaultValue = null) {
    const config = await loadConfig();
    return config.hasOwnProperty(key) ? config[key] : defaultValue;
}

// --- Sätt/uppdatera ett configvärde ---
async function setConfig(key, value) {
    return new Promise((resolve) => {
        database.db.query(
            `INSERT INTO system_config (\`key\`, \`value\`)
             VALUES (?, ?)
             ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`)`,
            [key, String(value)],
            (err) => {
                if (err) console.error("Fel vid uppdatering av config:", err);
                // nollställ cache så nästa getConfig hämtar nytt värde
                cachedConfig = null;
                resolve(!err);
            }
        );
    });
}

// --- Hämta alla configvärden som objekt ---
async function getAllConfig() {
    return await loadConfig();
}

module.exports = {
    getConfig,
    setConfig,
    getAllConfig,
};
