"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.query = query;
exports.getClient = getClient;
exports.checkConnection = checkConnection;
const pg_1 = require("pg");
/**
 * Configuration de la connexion PostgreSQL
 */
const pool = new pg_1.Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://etu003659:Randria@localhost:5432/travaux_routiers',
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});
// Test de connexion au démarrage
pool.on('connect', () => {
    console.log('✅ Connecté à PostgreSQL');
});
pool.on('error', (err) => {
    console.error('❌ Erreur PostgreSQL:', err);
});
/**
 * Exécute une requête SQL
 */
async function query(text, params) {
    const start = Date.now();
    try {
        const result = await pool.query(text, params);
        const duration = Date.now() - start;
        console.log('📝 Query exécutée', { text: text.substring(0, 50), duration, rows: result.rowCount });
        return result;
    }
    catch (error) {
        console.error('❌ Erreur query:', error);
        throw error;
    }
}
/**
 * Obtient un client pour les transactions
 */
async function getClient() {
    const client = await pool.connect();
    return client;
}
/**
 * Vérifie la connexion à la base de données
 */
async function checkConnection() {
    try {
        await pool.query('SELECT NOW()');
        return true;
    }
    catch (error) {
        console.error('❌ Connexion PostgreSQL échouée:', error);
        return false;
    }
}
exports.default = pool;
//# sourceMappingURL=database.js.map