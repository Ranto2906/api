"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.LoginAttemptService = void 0;
const database_1 = require("../config/database");
const firebase_1 = require("../config/firebase");
const hybridDataService_1 = require("./hybridDataService");
const admin = __importStar(require("firebase-admin"));
const userService_1 = require("./userService");
/**
 * Service de gestion des tentatives de connexion et des paramètres
 * Synchronisé entre PostgreSQL (local) et Firebase
 */
class LoginAttemptService {
    /**
     * Enregistre une tentative de connexion (PostgreSQL + Firebase)
     */
    static async recordAttempt(email, success, ip, raisonEchec) {
        // 1. Enregistrer dans PostgreSQL (local)
        const result = await (0, database_1.query)(`INSERT INTO TentativeConnexion (email, ip_address, succes, raison_echec)
       VALUES ($1, $2, $3, $4)
       RETURNING id_tentative, date_tentative`, [email, ip || null, success, raisonEchec || null]);
        // 2. Synchroniser vers Firebase si disponible
        const isOnline = await hybridDataService_1.hybridDataService.isFirebaseAvailable();
        if (isOnline) {
            try {
                const db = (0, firebase_1.getFirestore)();
                const tentative = result.rows[0];
                await db.collection('TentativeConnexion').doc(tentative.id_tentative.toString()).set({
                    id: tentative.id_tentative,
                    email,
                    ip_address: ip || null,
                    succes: success,
                    date_tentative: admin.firestore.Timestamp.fromDate(tentative.date_tentative),
                    raison_echec: raisonEchec || null
                });
                console.log(`✅ Tentative ${tentative.id_tentative} synchronisée vers Firebase`);
            }
            catch (error) {
                console.warn('⚠️ Échec sync tentative vers Firebase:', error.message);
            }
        }
    }
    /**
     * Obtient le nombre de tentatives échouées récentes pour un email
     */
    static async getRecentFailedAttempts(email, minutes) {
        const duree = minutes || await this.getParameterValue('duree_blocage_minutes', 30);
        const result = await (0, database_1.query)(`SELECT COUNT(*) as count 
       FROM TentativeConnexion 
       WHERE email = $1 
       AND succes = FALSE 
       AND date_tentative > NOW() - ($2 || ' minutes')::INTERVAL`, [email, duree]);
        return parseInt(result.rows[0].count, 10);
    }
    /**
     * Obtient la limite de tentatives depuis les paramètres
     */
    static async getAttemptLimit() {
        return this.getParameterValue('max_tentatives_connexion', 5);
    }
    /**
     * Vérifie si un email doit être bloqué (trop de tentatives)
     */
    static async shouldBlockEmail(email) {
        const blocageActif = await this.getParameterBoolean('activer_blocage_auto', true);
        if (!blocageActif)
            return false;
        const failedAttempts = await this.getRecentFailedAttempts(email);
        const limit = await this.getAttemptLimit();
        return failedAttempts >= limit;
    }
    /**
     * Vérifie le blocage avec les paramètres
     * Retourne aussi si l'utilisateur est un manager (non bloçable)
     */
    static async checkBlocking(email) {
        const attempts = await this.getRecentFailedAttempts(email);
        const maxAttempts = await this.getAttemptLimit();
        // Vérifier si l'utilisateur existe et est un manager
        const user = await userService_1.UserService.findByEmail(email);
        const isManager = user?.id_type_user === 3;
        const isPermanentlyBlocked = user?.est_bloque === true;
        return {
            isBlocked: attempts >= maxAttempts && !isManager,
            isManager,
            isPermanentlyBlocked,
            attempts,
            maxAttempts,
            remainingAttempts: Math.max(0, maxAttempts - attempts)
        };
    }
    /**
     * Bloque automatiquement un utilisateur après trop de tentatives
     * Note: Les managers (type 3) ne peuvent pas être bloqués automatiquement
     * @returns true si l'utilisateur a été bloqué, false sinon (manager ou utilisateur introuvable)
     */
    static async autoBlockUserIfNeeded(email) {
        const blocageActif = await this.getParameterBoolean('activer_blocage_auto', true);
        if (!blocageActif) {
            return { blocked: false, reason: 'Blocage automatique désactivé' };
        }
        const blockInfo = await this.checkBlocking(email);
        // Les managers ne peuvent pas être bloqués
        if (blockInfo.isManager) {
            console.log(`⚠️ Tentative de blocage automatique d'un manager (${email}) - Ignorée`);
            return { blocked: false, reason: 'Les managers ne peuvent pas être bloqués' };
        }
        // Déjà bloqué
        if (blockInfo.isPermanentlyBlocked) {
            return { blocked: false, reason: 'Utilisateur déjà bloqué' };
        }
        // Vérifier si le seuil est atteint
        if (blockInfo.isBlocked) {
            const user = await userService_1.UserService.findByEmail(email);
            if (user) {
                try {
                    await userService_1.UserService.blockUser(user.id_user);
                    console.log(`🔒 Utilisateur ${email} bloqué automatiquement après ${blockInfo.attempts} tentatives échouées`);
                    // Synchroniser vers Firebase si disponible
                    const isOnline = await hybridDataService_1.hybridDataService.isFirebaseAvailable();
                    if (isOnline && user.firebase_uid) {
                        try {
                            const db = (0, firebase_1.getFirestore)();
                            await db.collection('users').doc(user.firebase_uid).update({
                                est_bloque: true,
                                raison_blocage: 'Blocage automatique: trop de tentatives de connexion',
                                date_blocage: admin.firestore.FieldValue.serverTimestamp()
                            });
                        }
                        catch (fbError) {
                            console.warn('⚠️ Erreur sync blocage vers Firebase:', fbError.message);
                        }
                    }
                    return {
                        blocked: true,
                        reason: `Compte bloqué automatiquement après ${blockInfo.attempts} tentatives échouées`
                    };
                }
                catch (error) {
                    console.error('❌ Erreur blocage automatique:', error.message);
                    return { blocked: false, reason: error.message };
                }
            }
        }
        return { blocked: false, reason: 'Seuil non atteint' };
    }
    /**
     * Réinitialise les tentatives de connexion pour un email
     */
    static async resetAttempts(email) {
        await (0, database_1.query)(`DELETE FROM TentativeConnexion WHERE email = $1 AND succes = FALSE`, [email]);
    }
    /**
     * Obtient l'historique des tentatives pour un email
     */
    static async getAttemptHistory(email, limit = 10) {
        const result = await (0, database_1.query)(`SELECT id_tentative, email, ip_address, succes, date_tentative, raison_echec
       FROM TentativeConnexion
       WHERE email = $1
       ORDER BY date_tentative DESC
       LIMIT $2`, [email, limit]);
        return result.rows;
    }
    /**
     * Obtient toutes les tentatives récentes (pour admin)
     */
    static async getAllRecentAttempts(hours = 24) {
        const result = await (0, database_1.query)(`SELECT id_tentative, email, ip_address, succes, date_tentative, raison_echec
       FROM TentativeConnexion
       WHERE date_tentative > NOW() - ($1 || ' hours')::INTERVAL
       ORDER BY date_tentative DESC`, [hours]);
        return result.rows;
    }
    /**
     * Nettoie les anciennes tentatives
     */
    static async cleanOldAttempts(days = 30) {
        const result = await (0, database_1.query)(`DELETE FROM TentativeConnexion 
       WHERE date_tentative < NOW() - ($1 || ' days')::INTERVAL
       RETURNING id_tentative`, [days]);
        return result.rowCount || 0;
    }
    // =============================================
    // GESTION DES PARAMÈTRES
    // =============================================
    /**
     * Obtient un paramètre par son nom
     */
    static async getParameter(nom) {
        const result = await (0, database_1.query)(`SELECT id_parametre, nom, valeur, type, description, date_modification
       FROM Parametre WHERE nom = $1`, [nom]);
        return result.rows[0] || null;
    }
    /**
     * Obtient la valeur d'un paramètre avec valeur par défaut
     */
    static async getParameterValue(nom, defaultValue) {
        const param = await this.getParameter(nom);
        if (param && param.type === 'number') {
            return parseInt(param.valeur, 10);
        }
        return defaultValue;
    }
    /**
     * Obtient la valeur string d'un paramètre
     */
    static async getParameterString(nom, defaultValue = '') {
        const param = await this.getParameter(nom);
        return param?.valeur || defaultValue;
    }
    /**
     * Obtient la valeur boolean d'un paramètre
     */
    static async getParameterBoolean(nom, defaultValue = false) {
        const param = await this.getParameter(nom);
        if (param && param.type === 'boolean') {
            return param.valeur === 'true';
        }
        return defaultValue;
    }
    /**
     * Met à jour un paramètre (PostgreSQL + Firebase)
     */
    static async setParameter(nom, valeur) {
        // 1. Mettre à jour dans PostgreSQL
        await (0, database_1.query)(`UPDATE Parametre SET valeur = $1, date_modification = NOW() WHERE nom = $2`, [valeur, nom]);
        // 2. Synchroniser vers Firebase si disponible
        const isOnline = await hybridDataService_1.hybridDataService.isFirebaseAvailable();
        if (isOnline) {
            try {
                const db = (0, firebase_1.getFirestore)();
                const param = await this.getParameter(nom);
                if (param) {
                    await db.collection('Parametre').doc(param.id_parametre.toString()).update({
                        valeur,
                        date_modification: admin.firestore.Timestamp.now()
                    });
                    console.log(`✅ Paramètre '${nom}' synchronisé vers Firebase`);
                }
            }
            catch (error) {
                console.warn('⚠️ Échec sync paramètre vers Firebase:', error.message);
            }
        }
    }
    /**
     * Obtient tous les paramètres
     */
    static async getAllParameters() {
        const result = await (0, database_1.query)(`SELECT id_parametre, nom, valeur, type, description, date_modification
       FROM Parametre ORDER BY nom`);
        return result.rows;
    }
    /**
     * Crée ou met à jour un paramètre (PostgreSQL + Firebase)
     */
    static async upsertParameter(nom, valeur, type = 'string', description) {
        // 1. Upsert dans PostgreSQL
        const result = await (0, database_1.query)(`INSERT INTO Parametre (nom, valeur, type, description)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (nom) DO UPDATE SET 
         valeur = EXCLUDED.valeur,
         type = EXCLUDED.type,
         description = COALESCE(EXCLUDED.description, Parametre.description),
         date_modification = NOW()
       RETURNING id_parametre, date_modification`, [nom, valeur, type, description || null]);
        // 2. Synchroniser vers Firebase si disponible
        const isOnline = await hybridDataService_1.hybridDataService.isFirebaseAvailable();
        if (isOnline) {
            try {
                const db = (0, firebase_1.getFirestore)();
                const param = result.rows[0];
                await db.collection('Parametre').doc(param.id_parametre.toString()).set({
                    id: param.id_parametre,
                    nom,
                    valeur,
                    type,
                    description: description || null,
                    date_modification: admin.firestore.Timestamp.fromDate(param.date_modification)
                });
                console.log(`✅ Paramètre '${nom}' créé/mis à jour dans Firebase`);
            }
            catch (error) {
                console.warn('⚠️ Échec sync paramètre vers Firebase:', error.message);
            }
        }
    }
    /**
     * Synchronise tous les paramètres de PostgreSQL vers Firebase
     */
    static async syncAllParametersToFirebase() {
        const isOnline = await hybridDataService_1.hybridDataService.isFirebaseAvailable();
        if (!isOnline) {
            console.log('⚠️ Firebase non disponible, synchronisation ignorée');
            return;
        }
        try {
            const db = (0, firebase_1.getFirestore)();
            const params = await this.getAllParameters();
            for (const param of params) {
                await db.collection('Parametre').doc(param.id_parametre.toString()).set({
                    id: param.id_parametre,
                    nom: param.nom,
                    valeur: param.valeur,
                    type: param.type,
                    description: param.description || null,
                    date_modification: admin.firestore.Timestamp.fromDate(param.date_modification)
                });
            }
            console.log(`✅ ${params.length} paramètres synchronisés vers Firebase`);
        }
        catch (error) {
            console.error('❌ Erreur sync paramètres:', error.message);
        }
    }
    /**
     * Synchronise les paramètres de Firebase vers PostgreSQL (cache local)
     */
    static async syncParametersFromFirebase() {
        const isOnline = await hybridDataService_1.hybridDataService.isFirebaseAvailable();
        if (!isOnline)
            return;
        try {
            const db = (0, firebase_1.getFirestore)();
            const snapshot = await db.collection('Parametre').get();
            for (const doc of snapshot.docs) {
                if (doc.id.startsWith('_'))
                    continue; // Ignorer les placeholders
                const data = doc.data();
                await (0, database_1.query)(`INSERT INTO Parametre (id_parametre, nom, valeur, type, description, date_modification)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (nom) DO UPDATE SET 
             valeur = EXCLUDED.valeur,
             type = EXCLUDED.type,
             description = COALESCE(EXCLUDED.description, Parametre.description),
             date_modification = EXCLUDED.date_modification`, [
                    data.id,
                    data.nom,
                    data.valeur,
                    data.type,
                    data.description || null,
                    data.date_modification?.toDate() || new Date()
                ]);
            }
            console.log(`✅ ${snapshot.size} paramètres synchronisés depuis Firebase`);
        }
        catch (error) {
            console.error('❌ Erreur sync paramètres depuis Firebase:', error.message);
        }
    }
    /**
     * Synchronise les tentatives de connexion récentes vers Firebase
     */
    static async syncRecentAttemptsToFirebase(hours = 24) {
        const isOnline = await hybridDataService_1.hybridDataService.isFirebaseAvailable();
        if (!isOnline)
            return;
        try {
            const db = (0, firebase_1.getFirestore)();
            const attempts = await this.getAllRecentAttempts(hours);
            for (const attempt of attempts) {
                await db.collection('TentativeConnexion').doc(attempt.id_tentative.toString()).set({
                    id: attempt.id_tentative,
                    email: attempt.email,
                    ip_address: attempt.ip_address || null,
                    succes: attempt.succes,
                    date_tentative: admin.firestore.Timestamp.fromDate(attempt.date_tentative),
                    raison_echec: attempt.raison_echec || null
                });
            }
            console.log(`✅ ${attempts.length} tentatives synchronisées vers Firebase`);
        }
        catch (error) {
            console.error('❌ Erreur sync tentatives:', error.message);
        }
    }
}
exports.LoginAttemptService = LoginAttemptService;
exports.default = LoginAttemptService;
//# sourceMappingURL=loginAttemptService.js.map