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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const userService_1 = __importDefault(require("../services/userService"));
const hybridDataService_1 = require("../services/hybridDataService");
const syncService_1 = require("../services/syncService");
const auth_1 = require("../middleware/auth");
const firebase_1 = require("../config/firebase");
const router = (0, express_1.Router)();
/**
 * @swagger
 * /api/admin/users/blocked:
 *   get:
 *     summary: Liste des utilisateurs bloqués
 *     tags: [Administration]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Liste des utilisateurs bloqués
 *       403:
 *         description: Accès refusé (Manager uniquement)
 */
router.get('/users/blocked', auth_1.authMiddleware, auth_1.managerMiddleware, async (req, res) => {
    try {
        const blockedUsers = await userService_1.default.getBlockedUsers();
        res.status(200).json({
            success: true,
            count: blockedUsers.length,
            users: blockedUsers.map(user => ({
                id: user.id_user,
                firebase_uid: user.firebase_uid,
                email: user.email,
                display_name: user.display_name,
                date_creation: user.date_creation,
                type_user: user.id_type_user
            }))
        });
    }
    catch (error) {
        console.error('Erreur liste bloqués:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur serveur'
        });
    }
});
/**
 * @swagger
 * /api/admin/users/{id}/unblock:
 *   post:
 *     summary: Débloquer un utilisateur
 *     tags: [Administration]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID de l'utilisateur à débloquer
 *     responses:
 *       200:
 *         description: Utilisateur débloqué
 *       404:
 *         description: Utilisateur non trouvé
 *       403:
 *         description: Accès refusé (Manager uniquement)
 */
router.post('/users/:id/unblock', auth_1.authMiddleware, auth_1.managerMiddleware, async (req, res) => {
    try {
        const userId = parseInt(req.params.id, 10);
        if (isNaN(userId)) {
            res.status(400).json({
                success: false,
                error: 'ID utilisateur invalide'
            });
            return;
        }
        // Vérifier que l'utilisateur existe
        const user = await userService_1.default.findById(userId);
        if (!user) {
            res.status(404).json({
                success: false,
                error: 'Utilisateur non trouvé'
            });
            return;
        }
        // Débloquer l'utilisateur localement
        await userService_1.default.unblockUser(userId);
        // Réinitialiser les tentatives de connexion échouées
        const { LoginAttemptService } = await Promise.resolve().then(() => __importStar(require('../services/loginAttemptService')));
        await LoginAttemptService.resetAttempts(user.email);
        console.log(`✅ Tentatives de connexion réinitialisées pour: ${user.email}`);
        // Débloquer aussi dans Firestore si en ligne
        const isOnline = await hybridDataService_1.hybridDataService.isFirebaseAvailable();
        if (isOnline && user.firebase_uid) {
            try {
                const db = (0, firebase_1.getFirestore)();
                await db.collection('users').doc(user.firebase_uid).update({
                    est_bloque: false,
                    raison_blocage: null,
                    date_blocage: null,
                    date_deblocage: new Date()
                });
                console.log(`✅ Utilisateur débloqué dans Firestore: ${user.email}`);
            }
            catch (firebaseError) {
                console.warn('⚠️ Erreur déblocage Firestore:', firebaseError.message);
            }
        }
        res.status(200).json({
            success: true,
            message: `Utilisateur ${user.email} débloqué avec succès`,
            details: {
                tentatives_reinitialisees: true
            },
            user: {
                id: user.id_user,
                firebase_uid: user.firebase_uid,
                email: user.email,
                display_name: user.display_name
            }
        });
    }
    catch (error) {
        console.error('Erreur déblocage:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur lors du déblocage'
        });
    }
});
/**
 * @swagger
 * /api/admin/users/{id}/block:
 *   post:
 *     summary: Bloquer un utilisateur
 *     tags: [Administration]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Utilisateur bloqué
 *       404:
 *         description: Utilisateur non trouvé
 */
router.post('/users/:id/block', auth_1.authMiddleware, auth_1.managerMiddleware, async (req, res) => {
    try {
        const userId = parseInt(req.params.id, 10);
        if (isNaN(userId)) {
            res.status(400).json({
                success: false,
                error: 'ID utilisateur invalide'
            });
            return;
        }
        const user = await userService_1.default.findById(userId);
        if (!user) {
            res.status(404).json({
                success: false,
                error: 'Utilisateur non trouvé'
            });
            return;
        }
        // Bloquer l'utilisateur localement
        await userService_1.default.blockUser(userId);
        // Bloquer aussi dans Firestore si en ligne
        const isOnline = await hybridDataService_1.hybridDataService.isFirebaseAvailable();
        if (isOnline && user.firebase_uid) {
            try {
                const db = (0, firebase_1.getFirestore)();
                await db.collection('users').doc(user.firebase_uid).update({
                    est_bloque: true
                });
                console.log(`✅ Utilisateur bloqué dans Firestore: ${user.email}`);
            }
            catch (firebaseError) {
                console.warn('⚠️ Erreur blocage Firestore:', firebaseError.message);
            }
        }
        res.status(200).json({
            success: true,
            message: `Utilisateur ${user.email} bloqué avec succès`
        });
    }
    catch (error) {
        console.error('Erreur blocage:', error);
        // Gestion spécifique de l'erreur des managers
        if (error.message?.includes('managers ne peuvent pas être bloqués')) {
            res.status(403).json({
                success: false,
                error: 'Les managers ne peuvent pas être bloqués'
            });
            return;
        }
        res.status(500).json({
            success: false,
            error: 'Erreur lors du blocage'
        });
    }
});
/**
 * @swagger
 * /api/admin/users:
 *   get:
 *     summary: Liste de tous les utilisateurs
 *     tags: [Administration]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Liste des utilisateurs
 */
router.get('/users', auth_1.authMiddleware, auth_1.managerMiddleware, async (req, res) => {
    try {
        const users = await userService_1.default.findAll();
        res.status(200).json({
            success: true,
            count: users.length,
            users: users.map(user => ({
                id: user.id_user,
                firebase_uid: user.firebase_uid,
                email: user.email,
                display_name: user.display_name,
                date_creation: user.date_creation,
                derniere_sync: user.derniere_sync,
                est_bloque: user.est_bloque,
                type_user: user.id_type_user,
                type_libelle: user.type_libelle
            }))
        });
    }
    catch (error) {
        console.error('Erreur liste users:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur serveur'
        });
    }
});
/**
 * @swagger
 * /api/admin/users/{id}/update-type:
 *   put:
 *     summary: Modifier le type d'un utilisateur
 *     tags: [Administration]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - type_user
 *             properties:
 *               type_user:
 *                 type: integer
 *                 description: 1=Visiteur, 2=Utilisateur, 3=Manager
 *     responses:
 *       200:
 *         description: Type utilisateur mis à jour
 *       404:
 *         description: Utilisateur non trouvé
 */
router.put('/users/:id/update-type', auth_1.authMiddleware, auth_1.managerMiddleware, async (req, res) => {
    try {
        const userId = parseInt(req.params.id, 10);
        const { type_user } = req.body;
        if (isNaN(userId)) {
            res.status(400).json({
                success: false,
                error: 'ID utilisateur invalide'
            });
            return;
        }
        if (!type_user || ![1, 2, 3].includes(type_user)) {
            res.status(400).json({
                success: false,
                error: 'Type utilisateur invalide (1=Visiteur, 2=Utilisateur, 3=Manager)'
            });
            return;
        }
        const user = await userService_1.default.findById(userId);
        if (!user) {
            res.status(404).json({
                success: false,
                error: 'Utilisateur non trouvé'
            });
            return;
        }
        // Mettre à jour le type localement
        await userService_1.default.update(userId, { type_user });
        // Mettre à jour aussi dans Firestore si en ligne
        const isOnline = await hybridDataService_1.hybridDataService.isFirebaseAvailable();
        if (isOnline && user.firebase_uid) {
            try {
                const db = (0, firebase_1.getFirestore)();
                await db.collection('users').doc(user.firebase_uid).update({
                    type_user
                });
                console.log(`✅ Type utilisateur mis à jour dans Firestore: ${user.email}`);
            }
            catch (firebaseError) {
                console.warn('⚠️ Erreur mise à jour Firestore:', firebaseError.message);
            }
        }
        res.status(200).json({
            success: true,
            message: `Type utilisateur mis à jour pour ${user.email}`,
            user: {
                id: user.id_user,
                firebase_uid: user.firebase_uid,
                email: user.email,
                type_user
            }
        });
    }
    catch (error) {
        console.error('Erreur update type:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur lors de la mise à jour'
        });
    }
});
/**
 * @swagger
 * /api/admin/sync/status:
 *   get:
 *     summary: Statut de la synchronisation Firebase
 *     tags: [Administration]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Statut de synchronisation
 */
router.get('/sync/status', auth_1.authMiddleware, auth_1.managerMiddleware, async (req, res) => {
    try {
        const syncStatus = await hybridDataService_1.hybridDataService.getSyncStatus();
        const isFirebaseConnected = hybridDataService_1.hybridDataService.isFirebaseAvailableSync();
        res.status(200).json({
            success: true,
            firebase_connected: isFirebaseConnected,
            ...syncStatus,
            current_mode: isFirebaseConnected ? 'firebase' : 'postgres'
        });
    }
    catch (error) {
        console.error('Erreur statut sync:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur serveur'
        });
    }
});
/**
 * @swagger
 * /api/admin/sync/users:
 *   post:
 *     summary: Synchroniser tous les utilisateurs vers Firebase
 *     tags: [Administration]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Synchronisation effectuée
 */
router.post('/sync/users', auth_1.authMiddleware, auth_1.managerMiddleware, async (req, res) => {
    try {
        const isOnline = await hybridDataService_1.hybridDataService.isFirebaseAvailable();
        if (!isOnline) {
            res.status(503).json({
                success: false,
                error: 'Firebase non disponible. Synchronisation impossible.'
            });
            return;
        }
        const db = (0, firebase_1.getFirestore)();
        const localUsers = await userService_1.default.findAll();
        let synced = 0;
        let errors = 0;
        for (const user of localUsers) {
            try {
                // Skip users without firebase_uid (created offline only)
                if (!user.firebase_uid) {
                    console.log(`⏭️ Skip sync user ${user.email} (pas de firebase_uid)`);
                    continue;
                }
                await db.collection('users').doc(user.firebase_uid).set({
                    firebase_uid: user.firebase_uid,
                    email: user.email,
                    display_name: user.display_name,
                    type_user: user.id_type_user,
                    est_bloque: user.est_bloque,
                    date_creation: user.date_creation
                }, { merge: true });
                synced++;
            }
            catch (err) {
                console.warn(`⚠️ Erreur sync user ${user.email}:`, err.message);
                errors++;
            }
        }
        res.status(200).json({
            success: true,
            message: 'Synchronisation utilisateurs terminée',
            stats: {
                total: localUsers.length,
                synced,
                errors
            }
        });
    }
    catch (error) {
        console.error('Erreur synchronisation users:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur lors de la synchronisation'
        });
    }
});
/**
 * @swagger
 * /api/admin/firebase/users:
 *   get:
 *     summary: Liste des utilisateurs Firebase Auth
 *     tags: [Administration]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Liste des utilisateurs Firebase
 */
router.get('/firebase/users', auth_1.authMiddleware, auth_1.managerMiddleware, async (req, res) => {
    try {
        const isOnline = await hybridDataService_1.hybridDataService.isFirebaseAvailable();
        if (!isOnline) {
            res.status(503).json({
                success: false,
                error: 'Firebase non disponible'
            });
            return;
        }
        const auth = (0, firebase_1.getAuth)();
        const listResult = await auth.listUsers(100);
        res.status(200).json({
            success: true,
            count: listResult.users.length,
            users: listResult.users.map(user => ({
                uid: user.uid,
                email: user.email,
                display_name: user.displayName,
                email_verified: user.emailVerified,
                disabled: user.disabled,
                created_at: user.metadata.creationTime
            }))
        });
    }
    catch (error) {
        console.error('Erreur liste Firebase users:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur serveur'
        });
    }
});
/**
 * @swagger
 * /api/admin/firebase/users/{uid}/disable:
 *   post:
 *     summary: Désactiver un utilisateur Firebase Auth
 *     tags: [Administration]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: uid
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Utilisateur désactivé
 */
router.post('/firebase/users/:uid/disable', auth_1.authMiddleware, auth_1.managerMiddleware, async (req, res) => {
    try {
        const { uid } = req.params;
        const isOnline = await hybridDataService_1.hybridDataService.isFirebaseAvailable();
        if (!isOnline) {
            res.status(503).json({
                success: false,
                error: 'Firebase non disponible'
            });
            return;
        }
        const auth = (0, firebase_1.getAuth)();
        await auth.updateUser(uid, { disabled: true });
        // Aussi bloquer localement
        await userService_1.default.blockUserByFirebaseUid(uid);
        res.status(200).json({
            success: true,
            message: 'Utilisateur Firebase désactivé'
        });
    }
    catch (error) {
        console.error('Erreur disable Firebase user:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur serveur'
        });
    }
});
/**
 * @swagger
 * /api/admin/firebase/users/{uid}/enable:
 *   post:
 *     summary: Réactiver un utilisateur Firebase Auth
 *     tags: [Administration]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: uid
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Utilisateur réactivé
 */
router.post('/firebase/users/:uid/enable', auth_1.authMiddleware, auth_1.managerMiddleware, async (req, res) => {
    try {
        const { uid } = req.params;
        const isOnline = await hybridDataService_1.hybridDataService.isFirebaseAvailable();
        if (!isOnline) {
            res.status(503).json({
                success: false,
                error: 'Firebase non disponible'
            });
            return;
        }
        const auth = (0, firebase_1.getAuth)();
        await auth.updateUser(uid, { disabled: false });
        // Aussi débloquer localement
        await userService_1.default.unblockUserByFirebaseUid(uid);
        res.status(200).json({
            success: true,
            message: 'Utilisateur Firebase réactivé'
        });
    }
    catch (error) {
        console.error('Erreur enable Firebase user:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur serveur'
        });
    }
});
/**
 * @swagger
 * /api/admin/sync/status:
 *   get:
 *     summary: Obtenir le statut de la synchronisation
 *     tags: [Administration, Synchronisation]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Statut de la synchronisation
 */
router.get('/sync/status', auth_1.authMiddleware, auth_1.managerMiddleware, async (req, res) => {
    try {
        const isOnline = await hybridDataService_1.hybridDataService.isFirebaseAvailable();
        const stats = await syncService_1.syncService.getSyncStats();
        res.status(200).json({
            success: true,
            firebase_connected: isOnline,
            sync_stats: stats
        });
    }
    catch (error) {
        console.error('Erreur statut sync:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur serveur'
        });
    }
});
/**
 * @swagger
 * /api/admin/sync/execute:
 *   post:
 *     summary: Déclencher une synchronisation bidirectionnelle manuelle
 *     tags: [Administration, Synchronisation]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Synchronisation effectuée
 */
router.post('/sync/execute', auth_1.authMiddleware, auth_1.managerMiddleware, async (req, res) => {
    try {
        const isOnline = await hybridDataService_1.hybridDataService.isFirebaseAvailable();
        if (!isOnline) {
            res.status(503).json({
                success: false,
                error: 'Firebase non disponible. Synchronisation impossible.'
            });
            return;
        }
        console.log('🔄 Démarrage synchronisation manuelle...');
        const result = await syncService_1.syncService.syncBidirectional();
        res.status(200).json({
            success: true,
            message: 'Synchronisation terminée',
            results: {
                totals: result.totals,
                firebase_to_postgres: result.firebaseToPostgres,
                postgres_to_firebase: result.postgresToFirebase
            }
        });
    }
    catch (error) {
        console.error('Erreur synchronisation:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur lors de la synchronisation'
        });
    }
});
/**
 * @swagger
 * /api/admin/sync/auto:
 *   post:
 *     summary: Activer/désactiver la synchronisation automatique
 *     tags: [Administration, Synchronisation]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               enabled:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Configuration mise à jour
 */
router.post('/sync/auto', auth_1.authMiddleware, auth_1.managerMiddleware, async (req, res) => {
    try {
        const { enabled } = req.body;
        if (typeof enabled !== 'boolean') {
            res.status(400).json({
                success: false,
                error: 'Le paramètre "enabled" doit être un booléen'
            });
            return;
        }
        syncService_1.syncService.setAutoSync(enabled);
        res.status(200).json({
            success: true,
            message: `Synchronisation automatique ${enabled ? 'activée' : 'désactivée'}`,
            auto_sync_enabled: enabled
        });
    }
    catch (error) {
        console.error('Erreur configuration auto-sync:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur serveur'
        });
    }
});
/**
 * @swagger
 * /api/admin/sync/statistics:
 *   get:
 *     summary: Obtenir les statistiques de synchronisation
 *     tags: [Administration, Synchronisation]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: days
 *         schema:
 *           type: integer
 *           default: 7
 *         description: Nombre de jours à analyser
 *     responses:
 *       200:
 *         description: Statistiques de synchronisation
 */
router.get('/sync/statistics', auth_1.authMiddleware, auth_1.managerMiddleware, async (req, res) => {
    try {
        const days = parseInt(req.query.days) || 7;
        const pool = require('../config/database').default;
        // Statistiques par table
        const tableStatsQuery = `
      SELECT 
        table_name,
        COUNT(*) as total,
        SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END) as success,
        SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN status = 'CONFLICT' THEN 1 ELSE 0 END) as conflicts
      FROM SyncLog
      WHERE sync_date >= CURRENT_TIMESTAMP - ($1 || ' days')::INTERVAL
      GROUP BY table_name
      ORDER BY total DESC
    `;
        // Statistiques par jour
        const dailyStatsQuery = `
      SELECT 
        DATE(sync_date) as date,
        COUNT(*) as total,
        SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END) as success,
        SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) as failed
      FROM SyncLog
      WHERE sync_date >= CURRENT_TIMESTAMP - ($1 || ' days')::INTERVAL
      GROUP BY DATE(sync_date)
      ORDER BY date DESC
    `;
        // Statistiques globales
        const globalStatsQuery = `
      SELECT 
        COUNT(*) as total_syncs,
        SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END) as total_success,
        SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) as total_failed,
        SUM(CASE WHEN status = 'CONFLICT' THEN 1 ELSE 0 END) as total_conflicts,
        MAX(sync_date) as last_sync
      FROM SyncLog
      WHERE sync_date >= CURRENT_TIMESTAMP - ($1 || ' days')::INTERVAL
    `;
        const [tableStats, dailyStats, globalStats] = await Promise.all([
            pool.query(tableStatsQuery, [days]),
            pool.query(dailyStatsQuery, [days]),
            pool.query(globalStatsQuery, [days])
        ]);
        res.status(200).json({
            success: true,
            period_days: days,
            global: globalStats.rows[0] || { total_syncs: 0, total_success: 0, total_failed: 0, total_conflicts: 0 },
            by_table: tableStats.rows,
            by_day: dailyStats.rows
        });
    }
    catch (error) {
        console.error('Erreur récupération statistiques sync:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur serveur'
        });
    }
});
/**
 * @swagger
 * /api/admin/sync/conflicts:
 *   get:
 *     summary: Obtenir la liste des conflits de synchronisation
 *     tags: [Administration, Synchronisation]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Liste des conflits
 */
router.get('/sync/conflicts', auth_1.authMiddleware, auth_1.managerMiddleware, async (req, res) => {
    try {
        const query = `
      SELECT 
        sl.Id_SyncLog,
        sl.table_name,
        sl.record_id,
        sl.firebase_id,
        sl.operation,
        sl.status,
        sl.error_message,
        sl.sync_date
      FROM SyncLog sl
      WHERE sl.status = 'CONFLICT'
      ORDER BY sl.sync_date DESC
      LIMIT 100
    `;
        const pool = require('../config/database').default;
        const result = await pool.query(query);
        res.status(200).json({
            success: true,
            count: result.rows.length,
            conflicts: result.rows
        });
    }
    catch (error) {
        console.error('Erreur récupération conflits:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur serveur'
        });
    }
});
exports.default = router;
//# sourceMappingURL=admin.js.map