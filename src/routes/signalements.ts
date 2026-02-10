import { Router, Request, Response } from 'express';
import { body, param, validationResult } from 'express-validator';
import SignalementService from '../services/signalementService';
import { authMiddleware, managerMiddleware } from '../middleware/auth';
import pool from '../config/database';
import { hybridDataService } from '../services/hybridDataService';
import { syncService } from '../services/syncService';
import { getFirestore } from '../config/firebase';
import * as admin from 'firebase-admin';

const router = Router();

// ============================================
// HELPER: Sync Signalement to Firebase
// ============================================

async function syncSignalementToFirebase(signalementId: number): Promise<boolean> {
    const isOnline = await hybridDataService.isFirebaseAvailable();
    if (!isOnline) {
        console.log('💾 Mode hors ligne : signalement mis à jour localement (à synchroniser)');
        return false;
    }

    try {
        const db = getFirestore();

        // Récupérer les données complètes du signalement
        const result = await pool.query(`
            SELECT 
                s.id_signalement, s.firebase_id,
                ST_X(s.location) as longitude, ST_Y(s.location) as latitude,
                s.description, s.date_signalement,
                u.id_user, u.display_name, u.email, u.firebase_uid,
                st.id_status, st.libelle as status_libelle, st.couleur as status_couleur
            FROM Signalement s
            JOIN User_ u ON s.id_user = u.id_user
            JOIN Status st ON s.id_status = st.id_status
            WHERE s.id_signalement = $1
        `, [signalementId]);

        if (result.rows.length === 0) {
            console.warn(`⚠️ Signalement ${signalementId} non trouvé`);
            return false;
        }

        const row = result.rows[0];
        const firebaseId = row.firebase_id || row.id_signalement.toString();
        const docRef = db.collection('signalements').doc(firebaseId);

        const signalementData = {
            postgres_id: row.id_signalement,
            location: new admin.firestore.GeoPoint(row.latitude || 0, row.longitude || 0),
            description: row.description,
            date_signalement: row.date_signalement,
            updated_at: admin.firestore.FieldValue.serverTimestamp(),
            firebase_uid: row.firebase_uid,
            user: {
                id_user: row.id_user,
                display_name: row.display_name,
                email: row.email
            },
            status: {
                id_status: row.id_status,
                libelle: row.status_libelle,
                couleur: row.status_couleur
            },
            sync_version: admin.firestore.FieldValue.increment(1)
        };

        const docSnap = await docRef.get();
        if (docSnap.exists) {
            await docRef.update(signalementData);
            console.log(`✅ Signalement ${signalementId} mis à jour dans Firebase (doc: ${firebaseId})`);
        } else {
            await docRef.set({
                ...signalementData,
                created_at: admin.firestore.FieldValue.serverTimestamp()
            });
            console.log(`✅ Signalement ${signalementId} créé dans Firebase (doc: ${firebaseId})`);
        }

        // Mettre à jour le firebase_id si nécessaire et marquer comme synchronisé
        await pool.query(
            'UPDATE Signalement SET firebase_id = $1, est_synchronise = TRUE, derniere_sync = CURRENT_TIMESTAMP WHERE id_signalement = $2',
            [firebaseId, signalementId]
        );

        return true;
    } catch (error) {
        console.warn('⚠️ Erreur sync signalement Firebase:', (error as Error).message);
        return false;
    }
}

// ============================================
// HELPER: Sync Reparation to Firebase
// ============================================

async function syncReparationToFirebase(reparation: any, signalementId: number): Promise<boolean> {
    const isOnline = await hybridDataService.isFirebaseAvailable();
    if (!isOnline) {
        console.log('💾 Mode hors ligne : réparation créée/mise à jour localement (à synchroniser)');
        return false;
    }

    try {
        const db = getFirestore();
        const reparationData = {
            id_reparation: reparation.id_reparation,
            id_signalement: signalementId,
            surface_m2: reparation.surface_m2 || 0,
            budget: reparation.budget || 0,
            id_entreprise: reparation.id_entreprise,
            id_status: reparation.id_status,
            date_debut: reparation.date_debut || null,
            date_fin_prevue: reparation.date_fin_prevue || null,
            date_fin_reelle: reparation.date_fin_reelle || null,
            commentaire: reparation.commentaire || null,
            id_user: reparation.id_user,
            updated_at: admin.firestore.FieldValue.serverTimestamp()
        };

        // Utiliser l'id_reparation comme ID du document pour faciliter les mises à jour
        const docRef = db.collection('reparations').doc(reparation.id_reparation.toString());
        const docSnapshot = await docRef.get();

        if (docSnapshot.exists) {
            await docRef.update(reparationData);
            console.log(`✅ Réparation ${reparation.id_reparation} mise à jour dans Firebase`);
        } else {
            await docRef.set({
                ...reparationData,
                created_at: admin.firestore.FieldValue.serverTimestamp()
            });
            console.log(`✅ Réparation ${reparation.id_reparation} créée dans Firebase`);
        }

        // Marquer comme synchronisée dans PostgreSQL
        await pool.query(
            `UPDATE Reparation 
             SET est_synchronise = TRUE, 
                 firebase_id = $1,
                 derniere_sync = CURRENT_TIMESTAMP 
             WHERE id_reparation = $2`,
            [reparation.id_reparation.toString(), reparation.id_reparation]
        );

        // Marquer aussi le signalement comme synchronisé
        await pool.query(
            'UPDATE Signalement SET est_synchronise = TRUE WHERE id_signalement = $1',
            [signalementId]
        );

        return true;
    } catch (error) {
        console.warn('⚠️ Erreur sync réparation Firebase:', (error as Error).message);
        return false;
    }
}

// ============================================
// HELPER: Sync HistoriqueStatus to Firebase
// ============================================

async function syncHistoriqueStatusToFirebase(historique: any): Promise<boolean> {
    const isOnline = await hybridDataService.isFirebaseAvailable();
    if (!isOnline) {
        console.log('💾 Mode hors ligne : historique status créé localement (à synchroniser)');
        return false;
    }

    try {
        const db = getFirestore();
        const historiqueData = {
            id_historique: historique.id_historique,
            id_reparation: historique.id_reparation,
            id_status_ancien: historique.id_status_ancien || null,
            id_status_nouveau: historique.id_status_nouveau,
            id_user: historique.id_user,
            date_modification: historique.date_modification || null,
            commentaire: historique.commentaire || null,
            updated_at: admin.firestore.FieldValue.serverTimestamp()
        };

        // Utiliser l'id_historique comme ID du document
        const docRef = db.collection('historique_status').doc(historique.id_historique.toString());
        const docSnapshot = await docRef.get();

        if (docSnapshot.exists) {
            await docRef.update(historiqueData);
            console.log(`✅ Historique status ${historique.id_historique} mis à jour dans Firebase`);
        } else {
            await docRef.set({
                ...historiqueData,
                created_at: admin.firestore.FieldValue.serverTimestamp()
            });
            console.log(`✅ Historique status ${historique.id_historique} créé dans Firebase`);
        }

        return true;
    } catch (error) {
        console.warn('⚠️ Erreur sync historique status Firebase:', (error as Error).message);
        return false;
    }
}

// ============================================
// ROUTES PUBLIQUES (Visiteurs)
// ============================================

/**
 * @swagger
 * /api/signalements:
 *   get:
 *     summary: Liste de tous les signalements avec leurs détails
 *     tags: [Signalements - Visiteur]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: integer
 *         description: Filtrer par ID de statut
 *       - in: query
 *         name: date_debut
 *         schema:
 *           type: string
 *           format: date
 *         description: Date de début pour le filtre
 *       - in: query
 *         name: date_fin
 *         schema:
 *           type: string
 *           format: date
 *         description: Date de fin pour le filtre
 *     responses:
 *       200:
 *         description: Liste des signalements pour affichage sur carte
 */
router.get('/', async (req: Request, res: Response): Promise<void> => {
    try {
        const { status, date_debut, date_fin } = req.query;

        const signalements = await SignalementService.findAll({
            status: status ? parseInt(status as string, 10) : undefined,
            dateDebut: date_debut as string,
            dateFin: date_fin as string
        });

        res.status(200).json({
            success: true,
            count: signalements.length,
            signalements: signalements.map(s => ({
                id: s.id_signalement,
                description: s.description,
                location: s.location,
                niveau: s.niveau || null,
                date_signalement: s.date_signalement,
                status: {
                    libelle: s.status_libelle,
                    couleur: s.status_couleur
                },
                signale_par: s.user_display_name || s.user_email,
                reparation: s.reparation ? {
                    surface_m2: s.reparation.surface_m2,
                    budget: s.reparation.budget,
                    date_debut: s.reparation.date_debut,
                    date_fin_prevue: s.reparation.date_fin_prevue,
                    date_fin_reelle: s.reparation.date_fin_reelle,
                    entreprise: {
                        nom: s.reparation.entreprise_nom,
                        telephone: s.reparation.entreprise_tel
                    }
                } : null
            }))
        });
    } catch (error: any) {
        console.error('Erreur récupération signalements:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur serveur'
        });
    }
});

/**
 * @swagger
 * /api/signalements/stats/recapitulatif:
 *   get:
 *     summary: Tableau récapitulatif pour les visiteurs
 *     tags: [Signalements - Visiteur]
 *     description: Statistiques globales - nb de signalements, surface, budget, avancement
 *     responses:
 *       200:
 *         description: Statistiques récapitulatives
 */
router.get('/stats/recapitulatif', async (req: Request, res: Response): Promise<void> => {
    try {
        const stats = await SignalementService.getStats();

        res.status(200).json({
            success: true,
            recapitulatif: {
                signalements: {
                    total: stats.total,
                    par_status: stats.par_status
                },
                surface_totale_m2: stats.surface_totale,
                budget_total: stats.budget_total,
                avancement_pct: stats.avancement_pct
            }
        });
    } catch (error: any) {
        console.error('Erreur récupération récapitulatif:', error);
        res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
});

/**
 * @swagger
 * /api/signalements/config/statuts:
 *   get:
 *     summary: Liste des statuts disponibles
 *     tags: [Signalements - Configuration]
 *     responses:
 *       200:
 *         description: Liste des statuts
 */
router.get('/config/statuts', async (req: Request, res: Response): Promise<void> => {
    try {
        const result = await pool.query('SELECT * FROM Status ORDER BY id_status');

        res.status(200).json({
            success: true,
            statuts: result.rows
        });
    } catch (error: any) {
        console.error('Erreur récupération statuts:', error);
        res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
});

/**
 * @swagger
 * /api/signalements/config/entreprises:
 *   get:
 *     summary: Liste des entreprises disponibles
 *     tags: [Signalements - Configuration]
 *     responses:
 *       200:
 *         description: Liste des entreprises
 */
router.get('/config/entreprises', async (req: Request, res: Response): Promise<void> => {
    try {
        const result = await pool.query('SELECT * FROM Entreprise ORDER BY nom');

        res.status(200).json({
            success: true,
            entreprises: result.rows
        });
    } catch (error: any) {
        console.error('Erreur récupération entreprises:', error);
        res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
});

/**
 * @swagger
 * /api/signalements/user/mes-signalements:
 *   get:
 *     summary: Liste des signalements de l'utilisateur connecté
 *     tags: [Signalements - Utilisateur]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Liste des signalements de l'utilisateur
 *       401:
 *         description: Non authentifié
 */
router.get('/user/mes-signalements', authMiddleware, async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = req.user?.id;

        if (!userId) {
            res.status(401).json({
                success: false,
                error: 'Utilisateur non identifié'
            });
            return;
        }

        const signalements = await SignalementService.findByUserId(userId);

        res.status(200).json({
            success: true,
            count: signalements.length,
            signalements: signalements.map(s => ({
                id: s.id_signalement,
                description: s.description,
                location: s.location,
                niveau: s.niveau || null,
                date_signalement: s.date_signalement,
                firebase_id: s.firebase_id,
                est_synchronise: s.est_synchronise,
                status: {
                    id: s.id_status,
                    libelle: s.status_libelle,
                    couleur: s.status_couleur
                },
                reparation: s.reparation
            }))
        });
    } catch (error: any) {
        console.error('Erreur récupération mes signalements:', error);
        res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
});

// ============================================
// ROUTES MANAGER
// ============================================

/**
 * @swagger
 * /api/signalements/manager/list:
 *   get:
 *     summary: Liste des signalements pour gestion (Manager)
 *     tags: [Signalements - Manager]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: integer
 *       - in: query
 *         name: date_debut
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: date_fin
 *         schema:
 *           type: string
 *           format: date
 *     responses:
 *       200:
 *         description: Liste des signalements avec détails de gestion
 */
router.get('/manager/list', authMiddleware, managerMiddleware, async (req: Request, res: Response): Promise<void> => {
    try {
        const { status, date_debut, date_fin } = req.query;

        const signalements = await SignalementService.findAll({
            status: status ? parseInt(status as string, 10) : undefined,
            dateDebut: date_debut as string,
            dateFin: date_fin as string
        });

        res.status(200).json({
            success: true,
            count: signalements.length,
            signalements
        });
    } catch (error: any) {
        console.error('Erreur liste signalements manager:', error);
        res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
});

/**
 * @swagger
 * /api/signalements/manager/pending-sync:
 *   get:
 *     summary: Liste des signalements non synchronisés avec Firebase
 *     tags: [Signalements - Manager]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Liste des signalements en attente de synchronisation
 */
router.get('/manager/pending-sync', authMiddleware, managerMiddleware, async (req: Request, res: Response): Promise<void> => {
    try {
        const pending = await SignalementService.getPendingSync();

        res.status(200).json({
            success: true,
            count: pending.length,
            signalements: pending
        });
    } catch (error: any) {
        console.error('Erreur récupération signalements non synchronisés:', error);
        res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
});

/**
 * @swagger
 * /api/signalements/manager/sync:
 *   post:
 *     summary: Synchronisation bidirectionnelle des signalements et réparations avec Firebase
 *     description: |
 *       Effectue une synchronisation complète entre PostgreSQL et Firebase:
 *       - Envoie les données locales non synchronisées vers Firebase
 *       - Récupère les nouvelles données de Firebase vers PostgreSQL
 *     tags: [Signalements - Manager]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Résultat de la synchronisation bidirectionnelle
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 result:
 *                   type: object
 *                   properties:
 *                     toFirebase:
 *                       type: object
 *                       properties:
 *                         signalements:
 *                           type: integer
 *                         reparations:
 *                           type: integer
 *                         errors:
 *                           type: integer
 *                     fromFirebase:
 *                       type: object
 *                       properties:
 *                         signalements:
 *                           type: integer
 *                         reparations:
 *                           type: integer
 *                         errors:
 *                           type: integer
 */
router.post('/manager/sync', authMiddleware, managerMiddleware, async (req: Request, res: Response): Promise<void> => {
    try {
        // Vérifier si Firebase est disponible
        const isOnline = await hybridDataService.isFirebaseAvailable();

        if (!isOnline) {
            res.status(503).json({
                success: false,
                error: 'Firebase non disponible. Synchronisation impossible.',
                offline: true
            });
            return;
        }

        // Effectuer la synchronisation bidirectionnelle via le SyncService
        const result = await syncService.syncBidirectional();

        res.status(200).json({
            success: true,
            message: `Synchronisation terminée: ${result.totals.synced} synchronisés, ${result.totals.errors} erreurs`,
            result: {
                totals: result.totals,
                firebase_to_postgres: result.firebaseToPostgres,
                postgres_to_firebase: result.postgresToFirebase
            }
        });
    } catch (error: any) {
        console.error('Erreur synchronisation:', error);
        res.status(500).json({ success: false, error: 'Erreur serveur lors de la synchronisation' });
    }
});

// ============================================
// POPUP / MARKER INFO (pour survol carte)
// ============================================

/**
 * @swagger
 * /api/signalements/{id}/popup:
 *   get:
 *     summary: Informations pour popup/marker sur la carte
 *     description: Retourne les informations essentielles pour afficher au survol d'un point sur la carte
 *     tags: [Signalements - Visiteur]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID du signalement
 *     responses:
 *       200:
 *         description: Informations du popup
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: integer
 *                     date_signalement:
 *                       type: string
 *                       format: date-time
 *                     status:
 *                       type: object
 *                     surface_m2:
 *                       type: number
 *                     budget:
 *                       type: number
 *                     niveau:
 *                       type: integer
 *                     entreprise:
 *                       type: object
 *                     photos_url:
 *                       type: string
 *                     photos_count:
 *                       type: integer
 *       404:
 *         description: Signalement non trouvé
 */
router.get('/:id/popup', async (req: Request, res: Response): Promise<void> => {
    try {
        const id = parseInt(req.params.id, 10);

        if (isNaN(id)) {
            res.status(400).json({ success: false, error: 'ID invalide' });
            return;
        }

        // Requête optimisée pour récupérer toutes les infos nécessaires au popup
        const result = await pool.query(`
            SELECT 
                s.id_signalement,
                s.description,
                s.date_signalement,
                s.niveau,
                ST_X(s.location) as longitude,
                ST_Y(s.location) as latitude,
                -- Status
                st.id_status,
                st.libelle as status_libelle,
                st.couleur as status_couleur,
                -- Réparation
                r.id_reparation,
                r.surface_m2,
                r.budget,
                r.avancement_pct,
                r.date_creation as date_creation_reparation,
                r.date_passage_en_cours,
                r.date_termine,
                -- Entreprise
                e.id_entreprise,
                e.nom as entreprise_nom,
                e.telephone as entreprise_telephone,
                e.email as entreprise_email,
                -- Nombre de photos
                (SELECT COUNT(*) FROM Photo p WHERE p.id_signalement = s.id_signalement) as photos_count
            FROM Signalement s
            JOIN Status st ON s.id_status = st.id_status
            LEFT JOIN Reparation r ON s.id_signalement = r.id_signalement
            LEFT JOIN Entreprise e ON r.id_entreprise = e.id_entreprise
            WHERE s.id_signalement = $1
        `, [id]);

        if (result.rows.length === 0) {
            res.status(404).json({ success: false, error: 'Signalement non trouvé' });
            return;
        }

        const row = result.rows[0];
        const baseUrl = `${req.protocol}://${req.get('host')}`;

        res.status(200).json({
            success: true,
            data: {
                id: row.id_signalement,
                description: row.description,
                date_signalement: row.date_signalement,
                niveau: row.niveau || null,
                location: {
                    latitude: row.latitude,
                    longitude: row.longitude
                },
                // Status du signalement
                status: {
                    id: row.id_status,
                    libelle: row.status_libelle,
                    couleur: row.status_couleur
                },
                // Infos réparation (si existe)
                reparation: row.id_reparation ? {
                    id: row.id_reparation,
                    surface_m2: parseFloat(row.surface_m2) || 0,
                    budget: parseFloat(row.budget) || 0,
                    avancement_pct: row.avancement_pct || 0,
                    date_creation: row.date_creation_reparation,
                    date_passage_en_cours: row.date_passage_en_cours,
                    date_termine: row.date_termine
                } : null,
                // Entreprise concernée
                entreprise: row.id_entreprise ? {
                    id: row.id_entreprise,
                    nom: row.entreprise_nom,
                    telephone: row.entreprise_telephone,
                    email: row.entreprise_email
                } : null,
                // Photos
                photos: {
                    count: parseInt(row.photos_count) || 0,
                    url: `${baseUrl}/api/photos/signalement/${row.id_signalement}`
                }
            }
        });
    } catch (error: any) {
        console.error('Erreur récupération popup signalement:', error);
        res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
});

/**
 * @swagger
 * /api/signalements/{id}:
 *   get:
 *     summary: Détails complets d'un signalement
 *     tags: [Signalements - Visiteur]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID du signalement
 *     responses:
 *       200:
 *         description: Détails du signalement
 *       404:
 *         description: Signalement non trouvé
 */
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
    try {
        const id = parseInt(req.params.id, 10);

        if (isNaN(id)) {
            res.status(400).json({ success: false, error: 'ID invalide' });
            return;
        }

        const signalement = await SignalementService.findById(id);

        if (!signalement) {
            res.status(404).json({ success: false, error: 'Signalement non trouvé' });
            return;
        }

        res.status(200).json({
            success: true,
            signalement: {
                id: signalement.id_signalement,
                description: signalement.description,
                location: signalement.location,
                niveau: signalement.niveau || null,
                date_signalement: signalement.date_signalement,
                firebase_id: signalement.firebase_id,
                est_synchronise: signalement.est_synchronise,
                signale_par: {
                    display_name: signalement.user_display_name,
                    email: signalement.user_email
                },
                status: {
                    id: signalement.id_status,
                    libelle: signalement.status_libelle,
                    couleur: signalement.status_couleur
                },
                reparation: signalement.reparation
            }
        });
    } catch (error: any) {
        console.error('Erreur récupération signalement:', error);
        res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
});

// ============================================
// ROUTES UTILISATEUR CONNECTÉ (CRUD)
// ============================================

/**
 * @swagger
 * /api/signalements:
 *   post:
 *     summary: Créer un nouveau signalement
 *     tags: [Signalements - Utilisateur]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - latitude
 *               - longitude
 *             properties:
 *               latitude:
 *                 type: number
 *                 example: -18.8792
 *               longitude:
 *                 type: number
 *                 example: 47.5079
 *               description:
 *                 type: string
 *                 example: "Nid de poule dangereux sur la route principale"
 *     responses:
 *       201:
 *         description: Signalement créé avec succès
 *       400:
 *         description: Données invalides
 *       401:
 *         description: Non authentifié
 */
router.post('/',
    authMiddleware,
    [
        body('latitude').isFloat({ min: -90, max: 90 }).withMessage('Latitude invalide (doit être entre -90 et 90)'),
        body('longitude').isFloat({ min: -180, max: 180 }).withMessage('Longitude invalide (doit être entre -180 et 180)'),
        body('description').optional().isString().isLength({ max: 500 }).withMessage('Description trop longue (max 500 caractères)')
    ],
    async (req: Request, res: Response): Promise<void> => {
        try {
            // Validation des entrées
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                res.status(400).json({
                    success: false,
                    errors: errors.array()
                });
                return;
            }

            const { description, latitude, longitude } = req.body;
            const firebaseUid = req.user?.firebase_uid;

            if (!firebaseUid) {
                res.status(401).json({
                    success: false,
                    error: 'Utilisateur Firebase non identifié'
                });
                return;
            }

            const signalement = await SignalementService.create({
                latitude: parseFloat(latitude),
                longitude: parseFloat(longitude),
                description,
                firebase_uid: firebaseUid
            });

            res.status(201).json({
                success: true,
                message: 'Signalement créé avec succès',
                signalement: {
                    id: signalement.id_signalement,
                    location: signalement.location,
                    description: signalement.description,
                    date_signalement: signalement.date_signalement,
                    firebase_id: signalement.firebase_id,
                    est_synchronise: signalement.est_synchronise
                }
            });
        } catch (error: any) {
            console.error('Erreur création signalement:', error);
            res.status(500).json({ success: false, error: 'Erreur serveur' });
        }
    }
);

/**
 * @swagger
 * /api/signalements/{id}:
 *   put:
 *     summary: Modifier un signalement (uniquement si statut "Nouveau")
 *     tags: [Signalements - Utilisateur]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               latitude:
 *                 type: number
 *               longitude:
 *                 type: number
 *               description:
 *                 type: string
 *     responses:
 *       200:
 *         description: Signalement mis à jour
 *       400:
 *         description: Données invalides
 *       401:
 *         description: Non authentifié
 *       403:
 *         description: Non autorisé
 *       404:
 *         description: Signalement non trouvé
 *       409:
 *         description: Signalement verrouillé (en cours de traitement)
 */
router.put('/:id',
    authMiddleware,
    [
        param('id').isInt({ min: 1 }).withMessage('ID invalide'),
        body('latitude').optional().isFloat({ min: -90, max: 90 }).withMessage('Latitude invalide'),
        body('longitude').optional().isFloat({ min: -180, max: 180 }).withMessage('Longitude invalide'),
        body('description').optional().isString().isLength({ max: 500 }).withMessage('Description trop longue')
    ],
    async (req: Request, res: Response): Promise<void> => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                res.status(400).json({
                    success: false,
                    errors: errors.array()
                });
                return;
            }

            const id = parseInt(req.params.id, 10);
            const userId = req.user?.id;
            const { description, latitude, longitude } = req.body;

            if (!userId) {
                res.status(401).json({
                    success: false,
                    error: 'Utilisateur non identifié'
                });
                return;
            }

            const signalement = await SignalementService.update(id, userId, {
                description,
                latitude: latitude ? parseFloat(latitude) : undefined,
                longitude: longitude ? parseFloat(longitude) : undefined
            });

            if (!signalement) {
                res.status(404).json({ success: false, error: 'Signalement non trouvé' });
                return;
            }

            res.status(200).json({
                success: true,
                message: 'Signalement mis à jour',
                signalement
            });
        } catch (error: any) {
            console.error('Erreur modification signalement:', error);

            if (error.message.startsWith('UNAUTHORIZED')) {
                res.status(403).json({ success: false, error: error.message.replace('UNAUTHORIZED: ', '') });
                return;
            }

            if (error.message.startsWith('LOCKED')) {
                res.status(409).json({ success: false, error: error.message.replace('LOCKED: ', '') });
                return;
            }

            res.status(500).json({ success: false, error: 'Erreur serveur' });
        }
    }
);

/**
 * @swagger
 * /api/signalements/{id}:
 *   delete:
 *     summary: Supprimer un signalement (uniquement si statut "Nouveau")
 *     tags: [Signalements - Utilisateur]
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
 *         description: Signalement supprimé
 *       401:
 *         description: Non authentifié
 *       403:
 *         description: Non autorisé
 *       404:
 *         description: Signalement non trouvé
 *       409:
 *         description: Signalement verrouillé (en cours de traitement)
 */
router.delete('/:id',
    authMiddleware,
    [param('id').isInt({ min: 1 }).withMessage('ID invalide')],
    async (req: Request, res: Response): Promise<void> => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                res.status(400).json({
                    success: false,
                    errors: errors.array()
                });
                return;
            }

            const id = parseInt(req.params.id, 10);
            const userId = req.user?.id;

            if (!userId) {
                res.status(401).json({
                    success: false,
                    error: 'Utilisateur non identifié'
                });
                return;
            }

            const deleted = await SignalementService.delete(id, userId);

            if (!deleted) {
                res.status(404).json({ success: false, error: 'Signalement non trouvé' });
                return;
            }

            res.status(200).json({
                success: true,
                message: 'Signalement supprimé avec succès'
            });
        } catch (error: any) {
            console.error('Erreur suppression signalement:', error);

            if (error.message.startsWith('UNAUTHORIZED')) {
                res.status(403).json({ success: false, error: error.message.replace('UNAUTHORIZED: ', '') });
                return;
            }

            if (error.message.startsWith('LOCKED')) {
                res.status(409).json({ success: false, error: error.message.replace('LOCKED: ', '') });
                return;
            }

            res.status(500).json({ success: false, error: 'Erreur serveur' });
        }
    }
);

// ============================================
// ROUTES MANAGER - RÉPARATION
// ============================================

/**
 * @swagger
 * /api/signalements/{id}/reparation:
 *   post:
 *     summary: Créer/Modifier les infos de réparation
 *     tags: [Signalements - Manager]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               surface_m2:
 *                 type: number
 *                 example: 25.5
 *               budget:
 *                 type: number
 *                 example: 1500000
 *               id_entreprise:
 *                 type: integer
 *                 example: 1
 *               date_debut:
 *                 type: string
 *                 format: date
 *               date_fin_prevue:
 *                 type: string
 *                 format: date
 *               commentaire:
 *                 type: string
 *     responses:
 *       200:
 *         description: Réparation mise à jour
 *       201:
 *         description: Réparation créée
 *       404:
 *         description: Signalement non trouvé
 */
router.post('/:id/reparation',
    authMiddleware,
    managerMiddleware,
    [
        param('id').isInt({ min: 1 }).withMessage('ID signalement invalide'),
        body('surface_m2').isFloat({ min: 0.01 }).withMessage('Surface m² requise et doit être > 0'),
        body('id_entreprise').optional().isInt({ min: 1 }).withMessage('ID entreprise invalide'),
        body('date_debut').optional().isISO8601().withMessage('Date début invalide'),
        body('date_fin_prevue').optional().isISO8601().withMessage('Date fin prévue invalide'),
        body('commentaire').optional().isString().withMessage('Commentaire invalide')
    ],
    async (req: Request, res: Response): Promise<void> => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                res.status(400).json({
                    success: false,
                    errors: errors.array()
                });
                return;
            }

            const signalementId = parseInt(req.params.id, 10);
            const { surface_m2, id_entreprise, date_debut, date_fin_prevue, commentaire } = req.body;
            const managerId = req.user?.id;

            // Vérifier que le signalement existe et récupérer son niveau
            const signalementResult = await pool.query(
                'SELECT id_signalement, niveau FROM Signalement WHERE id_signalement = $1',
                [signalementId]
            );

            if (signalementResult.rows.length === 0) {
                res.status(404).json({ success: false, error: 'Signalement non trouvé' });
                return;
            }

            const niveau = signalementResult.rows[0].niveau;
            if (!niveau) {
                res.status(400).json({
                    success: false,
                    error: 'Le signalement n\'a pas de niveau défini. Veuillez d\'abord attribuer un niveau au signalement via PUT /api/signalements/:id/status'
                });
                return;
            }

            // Vérifier si une réparation existe déjà
            const existingResult = await pool.query(
                'SELECT id_reparation FROM Reparation WHERE id_signalement = $1',
                [signalementId]
            );

            // Récupérer le prix actif pour calculer le budget
            const prixResult = await pool.query(
                'SELECT Id_prix_config, prix_par_m2 FROM PrixConfig WHERE est_actif = TRUE ORDER BY date_effet DESC LIMIT 1'
            );

            let prix_par_m2 = 0;
            let id_prix_config = null;
            if (prixResult.rows.length > 0) {
                prix_par_m2 = parseFloat(prixResult.rows[0].prix_par_m2);
                id_prix_config = prixResult.rows[0].id_prix_config;
            }

            if (prix_par_m2 === 0) {
                res.status(400).json({
                    success: false,
                    error: 'Aucun prix par m² configuré. Veuillez configurer un prix via /api/config/prix'
                });
                return;
            }

            const budget = prix_par_m2 * niveau * surface_m2;

            // Créer l'historique de prix pour traçabilité
            const historiqueResult = await pool.query(`
                INSERT INTO HistoriquePrix (prix_par_m2, niveau, surface_m2, budget_calcule, id_prix_config)
                VALUES ($1, $2, $3, $4, $5)
                RETURNING Id_historique_prix
            `, [prix_par_m2, niveau, surface_m2, budget, id_prix_config]);
            const id_historique_prix = historiqueResult.rows[0].id_historique_prix;

            let result;

            if (existingResult.rows.length > 0) {
                // Mise à jour de la réparation existante
                result = await pool.query(`
                    UPDATE Reparation 
                    SET surface_m2 = $1,
                        budget = $2,
                        id_entreprise = COALESCE($3, id_entreprise),
                        date_debut = COALESCE($4, date_debut),
                        date_fin_prevue = COALESCE($5, date_fin_prevue),
                        commentaire = COALESCE($6, commentaire),
                        Id_historique_prix = $7,
                        est_synchronise = FALSE
                    WHERE id_signalement = $8
                    RETURNING *
                `, [surface_m2, budget, id_entreprise, date_debut, date_fin_prevue, commentaire, id_historique_prix, signalementId]);

                await pool.query(
                    'UPDATE Signalement SET est_synchronise = FALSE WHERE id_signalement = $1',
                    [signalementId]
                );

                await syncReparationToFirebase(result.rows[0], signalementId);
                await syncSignalementToFirebase(signalementId);

                res.status(200).json({
                    success: true,
                    message: 'Réparation mise à jour',
                    reparation: result.rows[0],
                    calcul: {
                        formule: `${prix_par_m2} Ar × ${niveau} × ${surface_m2} m²`,
                        prix_par_m2,
                        niveau,
                        surface_m2,
                        budget: Math.round(budget * 100) / 100
                    }
                });
            } else {
                // Création avec statut "En cours" (id = 2) et avancement 50%
                result = await pool.query(`
                    INSERT INTO Reparation 
                    (surface_m2, budget, avancement_pct, date_passage_en_cours,
                     id_entreprise, date_debut, date_fin_prevue, commentaire,
                     id_signalement, id_status, id_user, Id_historique_prix, est_synchronise)
                    VALUES ($1, $2, 50, CURRENT_TIMESTAMP, $3, $4, $5, $6, $7, 2, $8, $9, FALSE)
                    RETURNING *
                `, [surface_m2, budget, id_entreprise || null, date_debut, date_fin_prevue, commentaire, signalementId, managerId, id_historique_prix]);

                // Mettre à jour le statut du signalement à "En cours"
                await pool.query(
                    'UPDATE Signalement SET id_status = 2, est_synchronise = FALSE WHERE id_signalement = $1',
                    [signalementId]
                );

                await syncReparationToFirebase(result.rows[0], signalementId);
                await syncSignalementToFirebase(signalementId);

                res.status(201).json({
                    success: true,
                    message: 'Réparation créée avec budget calculé automatiquement',
                    reparation: result.rows[0],
                    calcul: {
                        formule: `${prix_par_m2} Ar × ${niveau} × ${surface_m2} m²`,
                        prix_par_m2,
                        niveau,
                        surface_m2,
                        budget: Math.round(budget * 100) / 100
                    }
                });
            }
        } catch (error: any) {
            console.error('Erreur gestion réparation:', error);
            res.status(500).json({ success: false, error: 'Erreur serveur' });
        }
    }
);

/**
 * @swagger
 * /api/signalements/{id}/niveau:
 *   put:
 *     summary: Mettre à jour le niveau de dégradation d'un signalement
 *     tags: [Signalements - Manager]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID du signalement
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - niveau
 *             properties:
 *               niveau:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 10
 *                 example: 5
 *                 description: "Niveau de dégradation (1=faible, 10=critique)"
 *     responses:
 *       200:
 *         description: Niveau mis à jour avec succès
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 signalement:
 *                   type: object
 *                   properties:
 *                     id_signalement:
 *                       type: integer
 *                     niveau:
 *                       type: integer
 *                     ancien_niveau:
 *                       type: integer
 *                       nullable: true
 *       400:
 *         description: Niveau invalide
 *       404:
 *         description: Signalement non trouvé
 */
router.put('/:id/niveau',
    authMiddleware,
    managerMiddleware,
    [
        param('id').isInt({ min: 1 }).withMessage('ID signalement invalide'),
        body('niveau').isInt({ min: 1, max: 10 }).withMessage('Le niveau doit être un entier entre 1 et 10')
    ],
    async (req: Request, res: Response): Promise<void> => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                res.status(400).json({
                    success: false,
                    errors: errors.array()
                });
                return;
            }

            const signalementId = parseInt(req.params.id, 10);
            const { niveau } = req.body;

            // Vérifier que le signalement existe et récupérer l'ancien niveau
            const oldResult = await pool.query(
                'SELECT id_signalement, niveau FROM Signalement WHERE id_signalement = $1',
                [signalementId]
            );

            if (oldResult.rows.length === 0) {
                res.status(404).json({ success: false, error: 'Signalement non trouvé' });
                return;
            }

            const ancienNiveau = oldResult.rows[0].niveau;

            // Mettre à jour le niveau
            await pool.query(
                'UPDATE Signalement SET niveau = $1, est_synchronise = FALSE WHERE id_signalement = $2',
                [niveau, signalementId]
            );

            // Si une réparation existe, recalculer le budget avec le nouveau niveau
            const reparationResult = await pool.query(
                'SELECT r.id_reparation, r.surface_m2 FROM Reparation r WHERE r.id_signalement = $1',
                [signalementId]
            );

            let budgetRecalcule = null;

            if (reparationResult.rows.length > 0) {
                const reparation = reparationResult.rows[0];
                const surface_m2 = parseFloat(reparation.surface_m2);

                // Récupérer le prix actif
                const prixResult = await pool.query(
                    'SELECT prix_par_m2 FROM PrixConfig WHERE est_actif = TRUE ORDER BY date_creation DESC LIMIT 1'
                );

                if (prixResult.rows.length > 0) {
                    const prix_par_m2 = parseFloat(prixResult.rows[0].prix_par_m2);
                    const nouveauBudget = Math.round(prix_par_m2 * niveau * surface_m2 * 100) / 100;

                    await pool.query(
                        'UPDATE Reparation SET budget = $1, est_synchronise = FALSE WHERE id_reparation = $2',
                        [nouveauBudget, reparation.id_reparation]
                    );

                    budgetRecalcule = {
                        id_reparation: reparation.id_reparation,
                        formule: `${prix_par_m2} Ar × ${niveau} × ${surface_m2} m²`,
                        ancien_budget: null,
                        nouveau_budget: nouveauBudget
                    };

                    // Synchroniser la réparation mise à jour vers Firebase
                    const updatedRep = await pool.query('SELECT * FROM Reparation WHERE id_reparation = $1', [reparation.id_reparation]);
                    if (updatedRep.rows.length > 0) {
                        await syncReparationToFirebase(updatedRep.rows[0], signalementId);
                    }
                }
            }

            // Synchroniser le signalement vers Firebase
            await syncSignalementToFirebase(signalementId);

            res.status(200).json({
                success: true,
                message: `Niveau de dégradation mis à jour de ${ancienNiveau || 'non défini'} à ${niveau}`,
                signalement: {
                    id_signalement: signalementId,
                    niveau,
                    ancien_niveau: ancienNiveau || null
                },
                ...(budgetRecalcule && { budget_recalcule: budgetRecalcule })
            });
        } catch (error: any) {
            console.error('Erreur modification niveau:', error);
            res.status(500).json({ success: false, error: 'Erreur serveur' });
        }
    }
);

/**
 * @swagger
 * /api/signalements/{id}/status:
 *   put:
 *     summary: Modifier le statut d'un signalement
 *     tags: [Signalements - Manager]
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
 *               - id_status
 *             properties:
 *               id_status:
 *                 type: integer
 *                 example: 2
 *               niveau:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 10
 *                 example: 5
 *                 description: "Niveau de dégradation (optionnel)"
 *               commentaire:
 *                 type: string
 *                 example: "Travaux démarrés"
 *     responses:
 *       200:
 *         description: Statut mis à jour
 *       404:
 *         description: Signalement non trouvé
 */
router.put('/:id/status',
    authMiddleware,
    managerMiddleware,
    [
        param('id').isInt({ min: 1 }).withMessage('ID signalement invalide'),
        body('id_status').isInt({ min: 1, max: 3 }).withMessage('ID statut invalide (1-3)'),
        body('niveau').optional().isInt({ min: 1, max: 10 }).withMessage('Niveau doit être entre 1 et 10'),
        body('commentaire').optional().isString().withMessage('Commentaire invalide')
    ],
    async (req: Request, res: Response): Promise<void> => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                res.status(400).json({
                    success: false,
                    errors: errors.array()
                });
                return;
            }

            const signalementId = parseInt(req.params.id, 10);
            const { id_status, niveau, commentaire } = req.body;
            const managerId = req.user?.id;

            // Récupérer l'ancien statut et le niveau actuel
            const oldResult = await pool.query(
                'SELECT id_status, niveau FROM Signalement WHERE id_signalement = $1',
                [signalementId]
            );

            if (oldResult.rows.length === 0) {
                res.status(404).json({ success: false, error: 'Signalement non trouvé' });
                return;
            }

            const oldStatus = oldResult.rows[0].id_status;

            // Mettre à jour le statut et le niveau du signalement
            if (niveau !== undefined) {
                await pool.query(
                    'UPDATE Signalement SET id_status = $1, niveau = $2, est_synchronise = FALSE WHERE id_signalement = $3',
                    [id_status, niveau, signalementId]
                );
            } else {
                await pool.query(
                    'UPDATE Signalement SET id_status = $1, est_synchronise = FALSE WHERE id_signalement = $2',
                    [id_status, signalementId]
                );
            }

            // Mettre à jour le statut de la réparation si elle existe
            const reparationResult = await pool.query(
                'SELECT id_reparation FROM Reparation WHERE id_signalement = $1',
                [signalementId]
            );

            if (reparationResult.rows.length > 0) {
                const reparationId = reparationResult.rows[0].id_reparation;

                // Mettre à jour le statut de la réparation et marquer non synchronisé
                await pool.query(
                    'UPDATE Reparation SET id_status = $1, est_synchronise = FALSE WHERE id_reparation = $2',
                    [id_status, reparationId]
                );

                // Enregistrer dans l'historique
                const historiqueResult = await pool.query(`
          INSERT INTO HistoriqueStatus 
          (id_reparation, id_status_ancien, id_status_nouveau, id_user, commentaire)
          VALUES ($1, $2, $3, $4, $5)
          RETURNING id_historique, id_reparation, id_status_ancien, id_status_nouveau, id_user, date_modification, commentaire
        `, [reparationId, oldStatus, id_status, managerId, commentaire || null]);

                // Synchroniser l'historique vers Firebase
                if (historiqueResult.rows.length > 0) {
                    await syncHistoriqueStatusToFirebase(historiqueResult.rows[0]);
                }

                // Si terminé (id_status = 3), mettre la date de fin réelle
                if (id_status === 3) {
                    await pool.query(
                        'UPDATE Reparation SET date_fin_reelle = CURRENT_DATE WHERE id_reparation = $1',
                        [reparationId]
                    );
                }

                // Synchroniser la réparation mise à jour avec Firebase
                const updatedReparation = await pool.query(
                    'SELECT * FROM Reparation WHERE id_reparation = $1',
                    [reparationId]
                );
                if (updatedReparation.rows.length > 0) {
                    await syncReparationToFirebase(updatedReparation.rows[0], signalementId);
                }
            }

            // Synchroniser le signalement vers Firebase (nouveau statut)
            await syncSignalementToFirebase(signalementId);

            // Récupérer le signalement mis à jour
            const updatedResult = await pool.query(
                'SELECT id_status, niveau FROM Signalement WHERE id_signalement = $1',
                [signalementId]
            );

            res.status(200).json({
                success: true,
                message: 'Statut mis à jour',
                old_status: oldStatus,
                new_status: id_status,
                niveau: updatedResult.rows[0]?.niveau || null
            });
        } catch (error: any) {
            console.error('Erreur modification statut:', error);
            res.status(500).json({ success: false, error: 'Erreur serveur' });
        }
    }
);

// ============================================
// ROUTES MANAGER - GESTION COMPLÈTE
// ============================================

/**
 * @swagger
 * /api/signalements/manager/{id}/assigner-entreprise:
 *   put:
 *     summary: Assigner une entreprise responsable à un signalement
 *     tags: [Signalements - Manager]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID du signalement
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - id_entreprise
 *             properties:
 *               id_entreprise:
 *                 type: integer
 *                 example: 1
 *                 description: ID de l'entreprise à assigner
 *     responses:
 *       200:
 *         description: Entreprise assignée avec succès
 *       400:
 *         description: Données invalides
 *       404:
 *         description: Signalement ou entreprise non trouvé
 */
router.put('/manager/:id/assigner-entreprise',
    authMiddleware,
    managerMiddleware,
    [
        param('id').isInt({ min: 1 }).withMessage('ID signalement invalide'),
        body('id_entreprise').isInt({ min: 1 }).withMessage('ID entreprise invalide')
    ],
    async (req: Request, res: Response): Promise<void> => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                res.status(400).json({
                    success: false,
                    errors: errors.array()
                });
                return;
            }

            const signalementId = parseInt(req.params.id, 10);
            const { id_entreprise } = req.body;
            const managerId = req.user?.id;

            // Vérifier que le signalement existe
            const signalement = await SignalementService.findById(signalementId);
            if (!signalement) {
                res.status(404).json({ success: false, error: 'Signalement non trouvé' });
                return;
            }

            // Vérifier que l'entreprise existe
            const entrepriseResult = await pool.query(
                'SELECT * FROM Entreprise WHERE id_entreprise = $1',
                [id_entreprise]
            );
            if (entrepriseResult.rows.length === 0) {
                res.status(404).json({ success: false, error: 'Entreprise non trouvée' });
                return;
            }

            // Vérifier si une réparation existe déjà
            const reparationResult = await pool.query(
                'SELECT id_reparation FROM Reparation WHERE id_signalement = $1',
                [signalementId]
            );

            if (reparationResult.rows.length > 0) {
                // Mettre à jour l'entreprise de la réparation existante et marquer non synchronisé
                await pool.query(
                    `UPDATE Reparation 
                     SET id_entreprise = $1, date_modification = CURRENT_TIMESTAMP, est_synchronise = FALSE 
                     WHERE id_signalement = $2`,
                    [id_entreprise, signalementId]
                );

                // Marquer le signalement comme non synchronisé
                await pool.query(
                    'UPDATE Signalement SET est_synchronise = FALSE WHERE id_signalement = $1',
                    [signalementId]
                );
            } else {
                // Créer une nouvelle réparation avec l'entreprise (non synchronisée)
                await pool.query(
                    `INSERT INTO Reparation 
                     (surface_m2, budget, id_entreprise, id_signalement, id_status, id_user, est_synchronise)
                     VALUES (0, 0, $1, $2, 2, $3, FALSE)`,
                    [id_entreprise, signalementId, managerId]
                );

                // Mettre à jour le statut du signalement à "En cours" et marquer non synchronisé
                await pool.query(
                    'UPDATE Signalement SET id_status = 2, est_synchronise = FALSE WHERE id_signalement = $1',
                    [signalementId]
                );
            }

            // Synchroniser la réparation avec Firebase
            const updatedReparation = await pool.query(
                'SELECT * FROM Reparation WHERE id_signalement = $1',
                [signalementId]
            );
            if (updatedReparation.rows.length > 0) {
                await syncReparationToFirebase(updatedReparation.rows[0], signalementId);
            }
            // Synchroniser le signalement vers Firebase
            await syncSignalementToFirebase(signalementId);

            res.status(200).json({
                success: true,
                message: 'Entreprise assignée avec succès',
                entreprise: entrepriseResult.rows[0]
            });
        } catch (error: any) {
            console.error('Erreur assignation entreprise:', error);
            res.status(500).json({ success: false, error: 'Erreur serveur' });
        }
    }
);

/**
 * @swagger
 * /api/signalements/manager/{id}/budget:
 *   put:
 *     summary: Définir ou modifier le budget d'un signalement
 *     tags: [Signalements - Manager]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID du signalement
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - budget
 *             properties:
 *               budget:
 *                 type: number
 *                 example: 1500000
 *                 description: Budget en Ariary
 *     responses:
 *       200:
 *         description: Budget mis à jour avec succès
 *       400:
 *         description: Données invalides
 *       404:
 *         description: Signalement non trouvé
 */
router.put('/manager/:id/budget',
    authMiddleware,
    managerMiddleware,
    [
        param('id').isInt({ min: 1 }).withMessage('ID signalement invalide'),
        body('budget').isFloat({ min: 0 }).withMessage('Budget invalide (doit être >= 0)')
    ],
    async (req: Request, res: Response): Promise<void> => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                res.status(400).json({
                    success: false,
                    errors: errors.array()
                });
                return;
            }

            const signalementId = parseInt(req.params.id, 10);
            const { budget } = req.body;
            const managerId = req.user?.id;

            // Vérifier que le signalement existe
            const signalement = await SignalementService.findById(signalementId);
            if (!signalement) {
                res.status(404).json({ success: false, error: 'Signalement non trouvé' });
                return;
            }

            // Vérifier si une réparation existe déjà
            const reparationResult = await pool.query(
                'SELECT id_reparation FROM Reparation WHERE id_signalement = $1',
                [signalementId]
            );

            let result;
            if (reparationResult.rows.length > 0) {
                // Mettre à jour le budget et marquer non synchronisé
                result = await pool.query(
                    `UPDATE Reparation 
                     SET budget = $1, date_modification = CURRENT_TIMESTAMP, est_synchronise = FALSE 
                     WHERE id_signalement = $2
                     RETURNING *`,
                    [budget, signalementId]
                );

                // Marquer le signalement comme non synchronisé
                await pool.query(
                    'UPDATE Signalement SET est_synchronise = FALSE WHERE id_signalement = $1',
                    [signalementId]
                );
            } else {
                // Créer une nouvelle réparation avec le budget (non synchronisée)
                result = await pool.query(
                    `INSERT INTO Reparation 
                     (surface_m2, budget, id_entreprise, id_signalement, id_status, id_user, est_synchronise)
                     VALUES (0, $1, 1, $2, 2, $3, FALSE)
                     RETURNING *`,
                    [budget, signalementId, managerId]
                );

                // Mettre à jour le statut du signalement à "En cours" et marquer non synchronisé
                await pool.query(
                    'UPDATE Signalement SET id_status = 2, est_synchronise = FALSE WHERE id_signalement = $1',
                    [signalementId]
                );
            }

            // Synchroniser avec Firebase
            await syncReparationToFirebase(result.rows[0], signalementId);
            await syncSignalementToFirebase(signalementId);

            res.status(200).json({
                success: true,
                message: 'Budget mis à jour avec succès',
                budget: result.rows[0].budget,
                reparation: result.rows[0]
            });
        } catch (error: any) {
            console.error('Erreur modification budget:', error);
            res.status(500).json({ success: false, error: 'Erreur serveur' });
        }
    }
);

/**
 * @swagger
 * /api/signalements/manager/{id}/surface:
 *   put:
 *     summary: Définir ou modifier la surface d'un signalement
 *     tags: [Signalements - Manager]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID du signalement
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - surface_m2
 *             properties:
 *               surface_m2:
 *                 type: number
 *                 example: 25.5
 *                 description: Surface en mètres carrés
 *     responses:
 *       200:
 *         description: Surface mise à jour avec succès
 *       400:
 *         description: Données invalides
 *       404:
 *         description: Signalement non trouvé
 */
router.put('/manager/:id/surface',
    authMiddleware,
    managerMiddleware,
    [
        param('id').isInt({ min: 1 }).withMessage('ID signalement invalide'),
        body('surface_m2').isFloat({ min: 0 }).withMessage('Surface invalide (doit être >= 0)')
    ],
    async (req: Request, res: Response): Promise<void> => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                res.status(400).json({
                    success: false,
                    errors: errors.array()
                });
                return;
            }

            const signalementId = parseInt(req.params.id, 10);
            const { surface_m2 } = req.body;
            const managerId = req.user?.id;

            // Vérifier que le signalement existe
            const signalement = await SignalementService.findById(signalementId);
            if (!signalement) {
                res.status(404).json({ success: false, error: 'Signalement non trouvé' });
                return;
            }

            // Vérifier si une réparation existe déjà
            const reparationResult = await pool.query(
                'SELECT id_reparation FROM Reparation WHERE id_signalement = $1',
                [signalementId]
            );

            let result;
            if (reparationResult.rows.length > 0) {
                // Mettre à jour la surface et marquer non synchronisé
                result = await pool.query(
                    `UPDATE Reparation 
                     SET surface_m2 = $1, date_modification = CURRENT_TIMESTAMP, est_synchronise = FALSE 
                     WHERE id_signalement = $2
                     RETURNING *`,
                    [surface_m2, signalementId]
                );

                // Marquer le signalement comme non synchronisé
                await pool.query(
                    'UPDATE Signalement SET est_synchronise = FALSE WHERE id_signalement = $1',
                    [signalementId]
                );
            } else {
                // Créer une nouvelle réparation avec la surface (non synchronisée)
                result = await pool.query(
                    `INSERT INTO Reparation 
                     (surface_m2, budget, id_entreprise, id_signalement, id_status, id_user, est_synchronise)
                     VALUES ($1, 0, 1, $2, 2, $3, FALSE)
                     RETURNING *`,
                    [surface_m2, signalementId, managerId]
                );

                // Mettre à jour le statut du signalement à "En cours" et marquer non synchronisé
                await pool.query(
                    'UPDATE Signalement SET id_status = 2, est_synchronise = FALSE WHERE id_signalement = $1',
                    [signalementId]
                );
            }

            // Tenter de synchroniser avec Firebase
            await syncReparationToFirebase(result.rows[0], signalementId);
            await syncSignalementToFirebase(signalementId);

            res.status(200).json({
                success: true,
                message: 'Surface mise à jour avec succès',
                surface_m2: result.rows[0].surface_m2,
                reparation: result.rows[0]
            });
        } catch (error: any) {
            console.error('Erreur modification surface:', error);
            res.status(500).json({ success: false, error: 'Erreur serveur' });
        }
    }
);

/**
 * @swagger
 * /api/signalements/manager/{id}/gestion-complete:
 *   put:
 *     summary: Gestion complète d'un signalement (entreprise, budget, surface, dates)
 *     tags: [Signalements - Manager]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID du signalement
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               id_entreprise:
 *                 type: integer
 *                 example: 1
 *               budget:
 *                 type: number
 *                 example: 1500000
 *               surface_m2:
 *                 type: number
 *                 example: 25.5
 *               date_debut:
 *                 type: string
 *                 format: date
 *               date_fin_prevue:
 *                 type: string
 *                 format: date
 *               commentaire:
 *                 type: string
 *     responses:
 *       200:
 *         description: Signalement mis à jour avec succès
 *       400:
 *         description: Données invalides
 *       404:
 *         description: Signalement ou entreprise non trouvé
 */
router.put('/manager/:id/gestion-complete',
    authMiddleware,
    managerMiddleware,
    [
        param('id').isInt({ min: 1 }).withMessage('ID signalement invalide'),
        body('id_entreprise').optional().isInt({ min: 1 }).withMessage('ID entreprise invalide'),
        body('budget').optional().isFloat({ min: 0 }).withMessage('Budget invalide'),
        body('surface_m2').optional().isFloat({ min: 0 }).withMessage('Surface invalide'),
        body('date_debut').optional().isISO8601().withMessage('Date début invalide'),
        body('date_fin_prevue').optional().isISO8601().withMessage('Date fin prévue invalide'),
        body('commentaire').optional().isString().withMessage('Commentaire invalide')
    ],
    async (req: Request, res: Response): Promise<void> => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                res.status(400).json({
                    success: false,
                    errors: errors.array()
                });
                return;
            }

            const signalementId = parseInt(req.params.id, 10);
            const { id_entreprise, budget, surface_m2, date_debut, date_fin_prevue, commentaire } = req.body;
            const managerId = req.user?.id;

            // Vérifier que le signalement existe
            const signalement = await SignalementService.findById(signalementId);
            if (!signalement) {
                res.status(404).json({ success: false, error: 'Signalement non trouvé' });
                return;
            }

            // Vérifier que l'entreprise existe si fournie
            if (id_entreprise) {
                const entrepriseResult = await pool.query(
                    'SELECT * FROM Entreprise WHERE id_entreprise = $1',
                    [id_entreprise]
                );
                if (entrepriseResult.rows.length === 0) {
                    res.status(404).json({ success: false, error: 'Entreprise non trouvée' });
                    return;
                }
            }

            // Vérifier si une réparation existe déjà
            const reparationResult = await pool.query(
                'SELECT id_reparation FROM Reparation WHERE id_signalement = $1',
                [signalementId]
            );

            let result;
            if (reparationResult.rows.length > 0) {
                // Mettre à jour la réparation existante et marquer non synchronisé
                result = await pool.query(
                    `UPDATE Reparation 
                     SET id_entreprise = COALESCE($1, id_entreprise),
                         budget = COALESCE($2, budget),
                         surface_m2 = COALESCE($3, surface_m2),
                         date_debut = COALESCE($4, date_debut),
                         date_fin_prevue = COALESCE($5, date_fin_prevue),
                         commentaire = COALESCE($6, commentaire),
                         date_modification = CURRENT_TIMESTAMP,
                         est_synchronise = FALSE
                     WHERE id_signalement = $7
                     RETURNING *`,
                    [id_entreprise, budget, surface_m2, date_debut, date_fin_prevue, commentaire, signalementId]
                );

                // Marquer le signalement comme non synchronisé
                await pool.query(
                    'UPDATE Signalement SET est_synchronise = FALSE WHERE id_signalement = $1',
                    [signalementId]
                );
            } else {
                // Créer une nouvelle réparation (non synchronisée)
                result = await pool.query(
                    `INSERT INTO Reparation 
                     (surface_m2, budget, id_entreprise, date_debut, date_fin_prevue, commentaire, id_signalement, id_status, id_user, est_synchronise)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, 2, $8, FALSE)
                     RETURNING *`,
                    [surface_m2 || 0, budget || 0, id_entreprise || 1, date_debut, date_fin_prevue, commentaire, signalementId, managerId]
                );

                // Mettre à jour le statut du signalement à "En cours" et marquer non synchronisé
                await pool.query(
                    'UPDATE Signalement SET id_status = 2, est_synchronise = FALSE WHERE id_signalement = $1',
                    [signalementId]
                );
            }

            // Synchroniser avec Firebase
            await syncReparationToFirebase(result.rows[0], signalementId);
            await syncSignalementToFirebase(signalementId);

            // Récupérer les détails de l'entreprise assignée
            const entrepriseDetails = await pool.query(
                'SELECT * FROM Entreprise WHERE id_entreprise = $1',
                [result.rows[0].id_entreprise]
            );

            res.status(200).json({
                success: true,
                message: 'Signalement mis à jour avec succès',
                reparation: {
                    ...result.rows[0],
                    entreprise: entrepriseDetails.rows[0]
                }
            });
        } catch (error: any) {
            console.error('Erreur gestion complète signalement:', error);
            res.status(500).json({ success: false, error: 'Erreur serveur' });
        }
    }
);

/**
 * @swagger
 * /api/signalements/manager/{id}/modifier:
 *   put:
 *     summary: Modifier un signalement (description, localisation) - Accès Manager
 *     tags: [Signalements - Manager]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID du signalement
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               description:
 *                 type: string
 *               latitude:
 *                 type: number
 *               longitude:
 *                 type: number
 *     responses:
 *       200:
 *         description: Signalement modifié
 *       404:
 *         description: Signalement non trouvé
 */
router.put('/manager/:id/modifier',
    authMiddleware,
    managerMiddleware,
    [
        param('id').isInt({ min: 1 }).withMessage('ID invalide'),
        body('latitude').optional().isFloat({ min: -90, max: 90 }).withMessage('Latitude invalide'),
        body('longitude').optional().isFloat({ min: -180, max: 180 }).withMessage('Longitude invalide'),
        body('description').optional().isString().isLength({ max: 500 }).withMessage('Description trop longue')
    ],
    async (req: Request, res: Response): Promise<void> => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                res.status(400).json({
                    success: false,
                    errors: errors.array()
                });
                return;
            }

            const id = parseInt(req.params.id, 10);
            const { description, latitude, longitude } = req.body;

            // Vérifier que le signalement existe
            const checkResult = await pool.query(
                'SELECT id_signalement FROM Signalement WHERE id_signalement = $1',
                [id]
            );

            if (checkResult.rows.length === 0) {
                res.status(404).json({ success: false, error: 'Signalement non trouvé' });
                return;
            }

            // Construire la requête de mise à jour
            const updates: string[] = [];
            const values: any[] = [];
            let paramIndex = 1;

            if (description !== undefined) {
                updates.push(`description = $${paramIndex}`);
                values.push(description);
                paramIndex++;
            }

            if (latitude !== undefined && longitude !== undefined) {
                updates.push(`location = ST_SetSRID(ST_MakePoint($${paramIndex}, $${paramIndex + 1}), 4326)`);
                values.push(longitude, latitude);
                paramIndex += 2;
            }

            if (updates.length === 0) {
                res.status(400).json({ success: false, error: 'Aucune modification fournie' });
                return;
            }

            // Marquer comme non synchronisé
            updates.push('est_synchronise = FALSE');
            values.push(id);

            const result = await pool.query(
                `UPDATE Signalement SET ${updates.join(', ')} 
                 WHERE id_signalement = $${paramIndex}
                 RETURNING id_signalement, 
                           ST_X(location) as longitude, 
                           ST_Y(location) as latitude,
                           description, date_signalement, firebase_id, est_synchronise, id_user, id_status`,
                values
            );

            // Synchroniser le signalement vers Firebase
            await syncSignalementToFirebase(id);

            res.status(200).json({
                success: true,
                message: 'Signalement modifié par le manager',
                signalement: result.rows[0]
            });
        } catch (error: any) {
            console.error('Erreur modification signalement (manager):', error);
            res.status(500).json({ success: false, error: 'Erreur serveur' });
        }
    }
);

/**
 * @swagger
 * /api/signalements/manager/{id}/supprimer:
 *   delete:
 *     summary: Supprimer un signalement - Accès Manager
 *     tags: [Signalements - Manager]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID du signalement
 *     responses:
 *       200:
 *         description: Signalement supprimé
 *       404:
 *         description: Signalement non trouvé
 */
router.delete('/manager/:id/supprimer',
    authMiddleware,
    managerMiddleware,
    [param('id').isInt({ min: 1 }).withMessage('ID invalide')],
    async (req: Request, res: Response): Promise<void> => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                res.status(400).json({
                    success: false,
                    errors: errors.array()
                });
                return;
            }

            const id = parseInt(req.params.id, 10);

            // Vérifier que le signalement existe
            const checkResult = await pool.query(
                'SELECT id_signalement, firebase_id FROM Signalement WHERE id_signalement = $1',
                [id]
            );

            if (checkResult.rows.length === 0) {
                res.status(404).json({ success: false, error: 'Signalement non trouvé' });
                return;
            }

            const firebaseId = checkResult.rows[0].firebase_id;

            // Supprimer l'historique des status liés à la réparation
            await pool.query(
                `DELETE FROM HistoriqueStatus 
                 WHERE id_reparation IN (SELECT id_reparation FROM Reparation WHERE id_signalement = $1)`,
                [id]
            );

            // Supprimer la réparation si elle existe
            await pool.query('DELETE FROM Reparation WHERE id_signalement = $1', [id]);

            // Supprimer le signalement
            await pool.query('DELETE FROM Signalement WHERE id_signalement = $1', [id]);

            // Supprimer de Firebase si existe
            if (firebaseId) {
                try {
                    const { hybridDataService } = await import('../services/hybridDataService');
                    const isOnline = await hybridDataService.isFirebaseAvailable();
                    if (isOnline) {
                        const { getFirestore } = await import('../config/firebase');
                        const db = getFirestore();
                        await db.collection('signalements').doc(firebaseId).delete();
                        console.log(`✅ Signalement supprimé de Firebase: ${firebaseId}`);
                    }
                } catch (error) {
                    console.warn('⚠️ Erreur suppression Firebase:', (error as Error).message);
                }
            }

            res.status(200).json({
                success: true,
                message: 'Signalement supprimé par le manager'
            });
        } catch (error: any) {
            console.error('Erreur suppression signalement (manager):', error);
            res.status(500).json({ success: false, error: 'Erreur serveur' });
        }
    }
);

/**
 * @swagger
 * /api/signalements/manager/entreprises:
 *   post:
 *     summary: Créer une nouvelle entreprise
 *     tags: [Signalements - Manager]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - nom
 *             properties:
 *               nom:
 *                 type: string
 *                 example: "Entreprise ABC"
 *               telephone:
 *                 type: string
 *                 example: "+261 34 00 000 00"
 *               email:
 *                 type: string
 *                 example: "contact@abc.mg"
 *               adresse:
 *                 type: string
 *                 example: "Antananarivo, Madagascar"
 *     responses:
 *       201:
 *         description: Entreprise créée avec succès
 *       400:
 *         description: Données invalides
 */
router.post('/manager/entreprises',
    authMiddleware,
    managerMiddleware,
    [
        body('nom').notEmpty().isString().isLength({ max: 100 }).withMessage('Nom invalide (max 100 caractères)'),
        body('telephone').optional().isString().isLength({ max: 20 }).withMessage('Téléphone invalide'),
        body('email').optional().isEmail().withMessage('Email invalide'),
        body('adresse').optional().isString().withMessage('Adresse invalide')
    ],
    async (req: Request, res: Response): Promise<void> => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                res.status(400).json({
                    success: false,
                    errors: errors.array()
                });
                return;
            }

            const { nom, telephone, email, adresse } = req.body;

            const result = await pool.query(
                `INSERT INTO Entreprise (nom, telephone, email, adresse)
                 VALUES ($1, $2, $3, $4)
                 RETURNING *`,
                [nom, telephone || null, email || null, adresse || null]
            );

            res.status(201).json({
                success: true,
                message: 'Entreprise créée avec succès',
                entreprise: result.rows[0]
            });
        } catch (error: any) {
            console.error('Erreur création entreprise:', error);
            res.status(500).json({ success: false, error: 'Erreur serveur' });
        }
    }
);

/**
 * @swagger
 * /api/signalements/manager/entreprises/{id}:
 *   put:
 *     summary: Modifier une entreprise
 *     tags: [Signalements - Manager]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               nom:
 *                 type: string
 *               telephone:
 *                 type: string
 *               email:
 *                 type: string
 *               adresse:
 *                 type: string
 *     responses:
 *       200:
 *         description: Entreprise modifiée
 *       404:
 *         description: Entreprise non trouvée
 */
router.put('/manager/entreprises/:id',
    authMiddleware,
    managerMiddleware,
    [
        param('id').isInt({ min: 1 }).withMessage('ID invalide'),
        body('nom').optional().isString().isLength({ max: 100 }).withMessage('Nom invalide'),
        body('telephone').optional().isString().isLength({ max: 20 }).withMessage('Téléphone invalide'),
        body('email').optional().isEmail().withMessage('Email invalide'),
        body('adresse').optional().isString().withMessage('Adresse invalide')
    ],
    async (req: Request, res: Response): Promise<void> => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                res.status(400).json({
                    success: false,
                    errors: errors.array()
                });
                return;
            }

            const id = parseInt(req.params.id, 10);
            const { nom, telephone, email, adresse } = req.body;

            // Vérifier que l'entreprise existe
            const checkResult = await pool.query(
                'SELECT id_entreprise FROM Entreprise WHERE id_entreprise = $1',
                [id]
            );

            if (checkResult.rows.length === 0) {
                res.status(404).json({ success: false, error: 'Entreprise non trouvée' });
                return;
            }

            const result = await pool.query(
                `UPDATE Entreprise 
                 SET nom = COALESCE($1, nom),
                     telephone = COALESCE($2, telephone),
                     email = COALESCE($3, email),
                     adresse = COALESCE($4, adresse)
                 WHERE id_entreprise = $5
                 RETURNING *`,
                [nom, telephone, email, adresse, id]
            );

            res.status(200).json({
                success: true,
                message: 'Entreprise modifiée avec succès',
                entreprise: result.rows[0]
            });
        } catch (error: any) {
            console.error('Erreur modification entreprise:', error);
            res.status(500).json({ success: false, error: 'Erreur serveur' });
        }
    }
);

/**
 * @swagger
 * /api/signalements/manager/entreprises/{id}:
 *   delete:
 *     summary: Supprimer une entreprise
 *     tags: [Signalements - Manager]
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
 *         description: Entreprise supprimée
 *       400:
 *         description: Entreprise utilisée dans des réparations
 *       404:
 *         description: Entreprise non trouvée
 */
router.delete('/manager/entreprises/:id',
    authMiddleware,
    managerMiddleware,
    [param('id').isInt({ min: 1 }).withMessage('ID invalide')],
    async (req: Request, res: Response): Promise<void> => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                res.status(400).json({
                    success: false,
                    errors: errors.array()
                });
                return;
            }

            const id = parseInt(req.params.id, 10);

            // Vérifier que l'entreprise existe
            const checkResult = await pool.query(
                'SELECT id_entreprise FROM Entreprise WHERE id_entreprise = $1',
                [id]
            );

            if (checkResult.rows.length === 0) {
                res.status(404).json({ success: false, error: 'Entreprise non trouvée' });
                return;
            }

            // Vérifier si l'entreprise est utilisée
            const usageResult = await pool.query(
                'SELECT COUNT(*) as count FROM Reparation WHERE id_entreprise = $1',
                [id]
            );

            if (parseInt(usageResult.rows[0].count) > 0) {
                res.status(400).json({
                    success: false,
                    error: 'Cette entreprise est assignée à des réparations et ne peut pas être supprimée'
                });
                return;
            }

            await pool.query('DELETE FROM Entreprise WHERE id_entreprise = $1', [id]);

            res.status(200).json({
                success: true,
                message: 'Entreprise supprimée avec succès'
            });
        } catch (error: any) {
            console.error('Erreur suppression entreprise:', error);
            res.status(500).json({ success: false, error: 'Erreur serveur' });
        }
    }
);

/**
 * @swagger
 * /api/signalements/{id}/historique:
 *   get:
 *     summary: Historique des modifications de statut d'un signalement
 *     tags: [Signalements - Manager]
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
 *         description: Historique des modifications
 */
router.get('/:id/historique', authMiddleware, async (req: Request, res: Response): Promise<void> => {
    try {
        const signalementId = parseInt(req.params.id, 10);

        if (isNaN(signalementId)) {
            res.status(400).json({ success: false, error: 'ID invalide' });
            return;
        }

        const result = await pool.query(`
      SELECT 
        h.id_historique,
        h.date_modification,
        h.commentaire,
        sa.libelle as ancien_status,
        sa.couleur as ancien_couleur,
        sn.libelle as nouveau_status,
        sn.couleur as nouveau_couleur,
        u.display_name as modifie_par
      FROM HistoriqueStatus h
      JOIN Reparation r ON h.id_reparation = r.id_reparation
      LEFT JOIN Status sa ON h.id_status_ancien = sa.id_status
      JOIN Status sn ON h.id_status_nouveau = sn.id_status
      JOIN User_ u ON h.id_user = u.id_user
      WHERE r.id_signalement = $1
      ORDER BY h.date_modification DESC
    `, [signalementId]);

        res.status(200).json({
            success: true,
            count: result.rows.length,
            historique: result.rows.map(row => ({
                id: row.id_historique,
                date: row.date_modification,
                commentaire: row.commentaire,
                ancien_status: row.ancien_status ? {
                    libelle: row.ancien_status,
                    couleur: row.ancien_couleur
                } : null,
                nouveau_status: {
                    libelle: row.nouveau_status,
                    couleur: row.nouveau_couleur
                },
                modifie_par: `${row.modifie_par_prenom || ''} ${row.modifie_par_nom || ''}`.trim()
            }))
        });
    } catch (error: any) {
        console.error('Erreur récupération historique:', error);
        res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
});

export default router;
