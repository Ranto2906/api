import { Router, Request, Response } from 'express';
import { body, param, validationResult } from 'express-validator';
import { authMiddleware, managerMiddleware } from '../middleware/auth';
import pool from '../config/database';
import { hybridDataService } from '../services/hybridDataService';
import { getFirestore } from '../config/firebase';
import * as admin from 'firebase-admin';

const router = Router();

// ============================================
// HELPER: Calculer le budget automatiquement
// ============================================

async function calculerBudget(surface_m2: number, niveau: number): Promise<{
    prix_par_m2: number;
    budget: number;
    id_prix_config: number | null;
}> {
    // Récupérer le prix actif
    const prixResult = await pool.query(`
        SELECT Id_prix_config, prix_par_m2 FROM PrixConfig 
        WHERE est_actif = TRUE 
        ORDER BY date_effet DESC 
        LIMIT 1
    `);

    let prix_par_m2 = 0; // 0 si aucun prix configuré
    let id_prix_config = null;

    if (prixResult.rows.length > 0) {
        prix_par_m2 = parseFloat(prixResult.rows[0].prix_par_m2);
        id_prix_config = prixResult.rows[0].id_prix_config;
    }

    const budget = prix_par_m2 * niveau * surface_m2;

    return {
        prix_par_m2,
        budget: Math.round(budget * 100) / 100,
        id_prix_config
    };
}

// ============================================
// HELPER: Créer un enregistrement d'historique de prix
// ============================================

async function creerHistoriquePrix(
    prix_par_m2: number,
    niveau: number,
    surface_m2: number,
    budget: number,
    id_prix_config: number | null
): Promise<number> {
    const result = await pool.query(`
        INSERT INTO HistoriquePrix (prix_par_m2, niveau, surface_m2, budget_calcule, id_prix_config)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING Id_historique_prix
    `, [prix_par_m2, niveau, surface_m2, budget, id_prix_config]);

    return result.rows[0].id_historique_prix;
}

// ============================================
// HELPER: Calculer l'avancement en fonction du statut
// ============================================

function calculerAvancement(id_status: number): number {
    switch (id_status) {
        case 1: return 0;   // Nouveau = 0%
        case 2: return 50;  // En cours = 50%
        case 3: return 100; // Terminé = 100%
        default: return 0;
    }
}

// ============================================
// ROUTES RÉPARATIONS
// ============================================

/**
 * @swagger
 * /api/reparations:
 *   get:
 *     summary: Liste de toutes les réparations avec détails
 *     tags: [Réparations]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: integer
 *       - in: query
 *         name: niveau
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Liste des réparations
 */
router.get('/', authMiddleware, async (req: Request, res: Response): Promise<void> => {
    try {
        const { status, niveau } = req.query;

        // Récupérer les stats globales (toujours, indépendamment des filtres)
        const statsResult = await pool.query(`
            SELECT 
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE r.Id_status = 1) as nouveau,
                COUNT(*) FILTER (WHERE r.Id_status = 2) as en_cours,
                COUNT(*) FILTER (WHERE r.Id_status = 3) as termine,
                COALESCE(SUM(r.budget), 0) as budget_total
            FROM Reparation r
        `);

        const stats = statsResult.rows[0];

        let queryText = `
            SELECT 
                r.Id_reparation,
                r.surface_m2,
                r.budget,
                r.avancement_pct,
                r.date_creation,
                r.date_debut,
                r.date_passage_en_cours,
                r.date_fin_prevue,
                r.date_fin_reelle,
                r.date_termine,
                r.commentaire,
                r.Id_signalement,
                r.Id_status,
                sig.niveau,
                s.libelle as status_libelle,
                s.couleur as status_couleur,
                e.Id_entreprise,
                e.nom as entreprise_nom,
                e.telephone as entreprise_tel,
                u.display_name as manager_nom,
                hp.prix_par_m2 as prix_applique,
                sig.description as signalement_description,
                ST_X(sig.location) as longitude,
                ST_Y(sig.location) as latitude
            FROM Reparation r
            JOIN Status s ON r.Id_status = s.Id_status
            LEFT JOIN Entreprise e ON r.Id_entreprise = e.Id_entreprise
            LEFT JOIN User_ u ON r.Id_user = u.Id_user
            LEFT JOIN HistoriquePrix hp ON r.Id_historique_prix = hp.Id_historique_prix
            JOIN Signalement sig ON r.Id_signalement = sig.Id_signalement
            WHERE 1=1
        `;

        const params: any[] = [];
        let paramIndex = 1;

        if (status) {
            queryText += ` AND r.Id_status = $${paramIndex++}`;
            params.push(status);
        }
        if (niveau) {
            queryText += ` AND sig.niveau = $${paramIndex++}`;
            params.push(niveau);
        }

        queryText += ' ORDER BY r.date_creation DESC';

        const result = await pool.query(queryText, params);

        res.status(200).json({
            success: true,
            count: result.rows.length,
            stats: {
                total: parseInt(stats.total),
                nouveau: parseInt(stats.nouveau),
                en_cours: parseInt(stats.en_cours),
                termine: parseInt(stats.termine),
                budget_total: Math.round(parseFloat(stats.budget_total) * 100) / 100
            },
            reparations: result.rows
        });
    } catch (error: any) {
        console.error('Erreur liste réparations:', error);
        res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
});

/**
 * @swagger
 * /api/reparations/{id}:
 *   get:
 *     summary: Détails d'une réparation
 *     tags: [Réparations]
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
 *         description: Détails de la réparation
 */
router.get('/:id',
    authMiddleware,
    [param('id').isInt({ min: 1 }).withMessage('ID réparation invalide')],
    async (req: Request, res: Response): Promise<void> => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                res.status(400).json({ success: false, errors: errors.array() });
                return;
            }

            const reparationId = parseInt(req.params.id, 10);

            const result = await pool.query(`
                SELECT 
                    r.*,
                    sig.niveau,
                    s.libelle as status_libelle,
                    s.couleur as status_couleur,
                    e.nom as entreprise_nom,
                    e.telephone as entreprise_tel,
                    e.email as entreprise_email,
                    u.display_name as manager_nom,
                    hp.prix_par_m2 as prix_applique,
                    hp.date_application as date_prix_applique,
                    sig.description as signalement_description,
                    ST_X(sig.location) as longitude,
                    ST_Y(sig.location) as latitude,
                    sig.date_signalement
                FROM Reparation r
                JOIN Status s ON r.Id_status = s.Id_status
                LEFT JOIN Entreprise e ON r.Id_entreprise = e.Id_entreprise
                LEFT JOIN User_ u ON r.Id_user = u.Id_user
                LEFT JOIN HistoriquePrix hp ON r.Id_historique_prix = hp.Id_historique_prix
                JOIN Signalement sig ON r.Id_signalement = sig.Id_signalement
                WHERE r.Id_reparation = $1
            `, [reparationId]);

            if (result.rows.length === 0) {
                res.status(404).json({ success: false, error: 'Réparation non trouvée' });
                return;
            }

            // Récupérer les photos du signalement associé
            const photosResult = await pool.query(
                'SELECT * FROM Photo WHERE Id_signalement = $1 ORDER BY uploaded_at DESC',
                [result.rows[0].id_signalement]
            );

            res.status(200).json({
                success: true,
                reparation: {
                    ...result.rows[0],
                    photos: photosResult.rows
                }
            });
        } catch (error: any) {
            console.error('Erreur détails réparation:', error);
            res.status(500).json({ success: false, error: 'Erreur serveur' });
        }
    }
);

/**
 * @swagger
 * /api/reparations/signalement/{signalementId}:
 *   post:
 *     summary: Créer une réparation avec calcul automatique du budget
 *     description: |
 *       Crée une nouvelle réparation avec :
 *       - Niveau de complexité (1-10)
 *       - Calcul automatique du budget : prix_par_m2 × niveau × surface_m2
 *       - Traçabilité du prix appliqué
 *     tags: [Réparations]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: signalementId
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
 *               - surface_m2
 *               - niveau
 *             properties:
 *               surface_m2:
 *                 type: number
 *                 example: 25.5
 *               niveau:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 10
 *                 example: 3
 *                 description: Niveau de complexité (1-10)
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
 *       201:
 *         description: Réparation créée avec budget calculé
 */
router.post('/signalement/:signalementId',
    authMiddleware,
    managerMiddleware,
    [
        param('signalementId').isInt({ min: 1 }).withMessage('ID signalement invalide'),
        body('surface_m2').isFloat({ min: 0.01 }).withMessage('Surface invalide'),
        body('id_entreprise').optional().isInt({ min: 1 }).withMessage('ID entreprise invalide'),
        body('date_debut').optional().isISO8601().withMessage('Date début invalide'),
        body('date_fin_prevue').optional().isISO8601().withMessage('Date fin prévue invalide'),
        body('commentaire').optional().isString()
    ],
    async (req: Request, res: Response): Promise<void> => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                res.status(400).json({ success: false, errors: errors.array() });
                return;
            }

            const signalementId = parseInt(req.params.signalementId, 10);
            const { surface_m2, id_entreprise, date_debut, date_fin_prevue, commentaire } = req.body;
            const managerId = req.user?.id;

            // Vérifier que le signalement existe et récupérer son niveau
            const signalementCheck = await pool.query(
                'SELECT id_signalement, niveau FROM Signalement WHERE id_signalement = $1',
                [signalementId]
            );

            if (signalementCheck.rows.length === 0) {
                res.status(404).json({ success: false, error: 'Signalement non trouvé' });
                return;
            }

            const niveau = signalementCheck.rows[0].niveau;
            if (!niveau) {
                res.status(400).json({
                    success: false,
                    error: 'Le signalement n\'a pas de niveau défini. Attribuez un niveau via PUT /api/signalements/:id/status'
                });
                return;
            }

            // Vérifier si une réparation existe déjà
            const existingCheck = await pool.query(
                'SELECT id_reparation FROM Reparation WHERE id_signalement = $1',
                [signalementId]
            );

            if (existingCheck.rows.length > 0) {
                res.status(400).json({
                    success: false,
                    error: 'Une réparation existe déjà pour ce signalement. Utilisez PUT pour modifier.'
                });
                return;
            }

            // Calculer le budget automatiquement : prix_par_m2 * niveau * surface_m2
            const { prix_par_m2, budget, id_prix_config } = await calculerBudget(surface_m2, niveau);

            if (prix_par_m2 === 0) {
                res.status(400).json({
                    success: false,
                    error: 'Aucun prix par m² configuré. Configurez un prix via /api/config/prix'
                });
                return;
            }

            // Créer l'historique de prix pour traçabilité
            const id_historique_prix = await creerHistoriquePrix(
                prix_par_m2, niveau, surface_m2, budget, id_prix_config
            );

            // Créer la réparation avec statut "En cours" (id = 2)
            const result = await pool.query(`
                INSERT INTO Reparation (
                    surface_m2, budget, avancement_pct,
                    date_debut, date_fin_prevue, commentaire,
                    date_passage_en_cours,
                    Id_signalement, Id_entreprise, Id_status, Id_user, Id_historique_prix,
                    est_synchronise
                )
                VALUES ($1, $2, 50, $3, $4, $5, CURRENT_TIMESTAMP, $6, $7, 2, $8, $9, FALSE)
                RETURNING *
            `, [
                surface_m2, budget,
                date_debut || null, date_fin_prevue || null, commentaire || null,
                signalementId, id_entreprise || null, managerId, id_historique_prix
            ]);

            // Mettre à jour le statut du signalement à "En cours"
            await pool.query(
                'UPDATE Signalement SET id_status = 2, est_synchronise = FALSE WHERE id_signalement = $1',
                [signalementId]
            );

            res.status(201).json({
                success: true,
                message: 'Réparation créée avec budget calculé automatiquement',
                reparation: result.rows[0],
                calcul: {
                    formule: `${prix_par_m2} Ar × ${niveau} × ${surface_m2} m²`,
                    prix_par_m2,
                    niveau,
                    surface_m2,
                    budget
                }
            });
        } catch (error: any) {
            console.error('Erreur création réparation:', error);
            res.status(500).json({ success: false, error: 'Erreur serveur' });
        }
    }
);

/**
 * @swagger
 * /api/reparations/{id}:
 *   put:
 *     summary: Modifier une réparation (recalcul budget si surface change)
 *     tags: [Réparations]
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
 *               id_entreprise:
 *                 type: integer
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
 */
router.put('/:id',
    authMiddleware,
    managerMiddleware,
    [
        param('id').isInt({ min: 1 }).withMessage('ID réparation invalide'),
        body('surface_m2').optional().isFloat({ min: 0.01 }).withMessage('Surface invalide'),
        body('id_entreprise').optional().isInt({ min: 1 }).withMessage('ID entreprise invalide'),
        body('date_debut').optional().isISO8601().withMessage('Date début invalide'),
        body('date_fin_prevue').optional().isISO8601().withMessage('Date fin prévue invalide'),
        body('commentaire').optional().isString()
    ],
    async (req: Request, res: Response): Promise<void> => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                res.status(400).json({ success: false, errors: errors.array() });
                return;
            }

            const reparationId = parseInt(req.params.id, 10);
            const { surface_m2, id_entreprise, date_debut, date_fin_prevue, commentaire } = req.body;

            // Récupérer la réparation existante avec le niveau du signalement
            const existingResult = await pool.query(
                `SELECT r.*, s.niveau 
                 FROM Reparation r
                 JOIN Signalement s ON r.Id_signalement = s.Id_signalement
                 WHERE r.Id_reparation = $1`,
                [reparationId]
            );

            if (existingResult.rows.length === 0) {
                res.status(404).json({ success: false, error: 'Réparation non trouvée' });
                return;
            }

            const existing = existingResult.rows[0];
            const niveau = existing.niveau;
            const newSurface = surface_m2 ?? parseFloat(existing.surface_m2);

            // Recalculer le budget si la surface change
            let newBudget = parseFloat(existing.budget);
            let newHistoriquePrixId = existing.id_historique_prix;

            if (surface_m2 !== undefined) {
                const { prix_par_m2, budget, id_prix_config } = await calculerBudget(newSurface, niveau);
                newBudget = budget;

                // Créer un nouvel historique de prix
                newHistoriquePrixId = await creerHistoriquePrix(
                    prix_par_m2, niveau, newSurface, budget, id_prix_config
                );
            }

            // Mettre à jour la réparation
            const result = await pool.query(`
                UPDATE Reparation SET
                    surface_m2 = $1,
                    budget = $2,
                    id_entreprise = COALESCE($3, id_entreprise),
                    date_debut = COALESCE($4, date_debut),
                    date_fin_prevue = COALESCE($5, date_fin_prevue),
                    commentaire = COALESCE($6, commentaire),
                    id_historique_prix = $7,
                    est_synchronise = FALSE,
                    derniere_sync = CURRENT_TIMESTAMP
                WHERE Id_reparation = $8
                RETURNING *
            `, [
                newSurface, newBudget,
                id_entreprise, date_debut, date_fin_prevue, commentaire,
                newHistoriquePrixId, reparationId
            ]);

            res.status(200).json({
                success: true,
                message: 'Réparation mise à jour',
                reparation: result.rows[0],
                budget_recalcule: surface_m2 !== undefined || niveau !== undefined
            });
        } catch (error: any) {
            console.error('Erreur modification réparation:', error);
            res.status(500).json({ success: false, error: 'Erreur serveur' });
        }
    }
);

/**
 * @swagger
 * /api/reparations/{id}/status:
 *   put:
 *     summary: Changer le statut d'une réparation avec mise à jour de l'avancement
 *     description: |
 *       Met à jour le statut et l'avancement :
 *       - Nouveau (1) = 0%
 *       - En cours (2) = 50%
 *       - Terminé (3) = 100%
 *       
 *       Les dates sont mises à jour automatiquement selon le statut.
 *     tags: [Réparations]
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
 *                 enum: [1, 2, 3]
 *                 description: "1=Nouveau (0%), 2=En cours (50%), 3=Terminé (100%)"
 *               commentaire:
 *                 type: string
 *     responses:
 *       200:
 *         description: Statut mis à jour
 */
router.put('/:id/status',
    authMiddleware,
    managerMiddleware,
    [
        param('id').isInt({ min: 1 }).withMessage('ID réparation invalide'),
        body('id_status').isInt({ min: 1, max: 3 }).withMessage('ID statut invalide (1-3)'),
        body('commentaire').optional().isString()
    ],
    async (req: Request, res: Response): Promise<void> => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                res.status(400).json({ success: false, errors: errors.array() });
                return;
            }

            const reparationId = parseInt(req.params.id, 10);
            const { id_status, commentaire } = req.body;
            const managerId = req.user?.id;

            // Récupérer la réparation et son ancien statut
            const existingResult = await pool.query(
                'SELECT r.*, s.libelle as status_libelle FROM Reparation r JOIN Status s ON r.Id_status = s.Id_status WHERE r.Id_reparation = $1',
                [reparationId]
            );

            if (existingResult.rows.length === 0) {
                res.status(404).json({ success: false, error: 'Réparation non trouvée' });
                return;
            }

            const existing = existingResult.rows[0];
            const oldStatus = existing.id_status;
            const avancement = calculerAvancement(id_status);

            // Préparer les mises à jour de dates selon le nouveau statut
            let dateUpdates = '';
            const dateParams: any[] = [];
            let paramIndex = 4;

            if (id_status === 2 && oldStatus !== 2) {
                // Passage à "En cours"
                dateUpdates = ', date_passage_en_cours = CURRENT_TIMESTAMP';
            } else if (id_status === 3 && oldStatus !== 3) {
                // Passage à "Terminé"
                dateUpdates = ', date_termine = CURRENT_TIMESTAMP, date_fin_reelle = CURRENT_DATE';
            }

            // Mettre à jour la réparation
            const result = await pool.query(`
                UPDATE Reparation SET
                    Id_status = $1,
                    avancement_pct = $2,
                    est_synchronise = FALSE
                    ${dateUpdates}
                WHERE Id_reparation = $3
                RETURNING *
            `, [id_status, avancement, reparationId]);

            // Enregistrer dans l'historique des statuts
            await pool.query(`
                INSERT INTO HistoriqueStatus (Id_reparation, Id_status_ancien, Id_status_nouveau, Id_user, commentaire)
                VALUES ($1, $2, $3, $4, $5)
            `, [reparationId, oldStatus, id_status, managerId, commentaire || null]);

            // Mettre à jour le statut du signalement associé
            await pool.query(
                'UPDATE Signalement SET id_status = $1, est_synchronise = FALSE WHERE id_signalement = $2',
                [id_status, existing.id_signalement]
            );

            // Récupérer le nouveau statut
            const statusResult = await pool.query(
                'SELECT libelle, couleur FROM Status WHERE Id_status = $1',
                [id_status]
            );

            res.status(200).json({
                success: true,
                message: 'Statut mis à jour',
                reparation: result.rows[0],
                transition: {
                    ancien_status: oldStatus,
                    ancien_avancement: calculerAvancement(oldStatus),
                    nouveau_status: id_status,
                    nouveau_status_libelle: statusResult.rows[0]?.libelle,
                    nouvel_avancement: avancement
                }
            });
        } catch (error: any) {
            console.error('Erreur changement statut:', error);
            res.status(500).json({ success: false, error: 'Erreur serveur' });
        }
    }
);

/**
 * @swagger
 * /api/reparations/statistiques/delais:
 *   get:
 *     summary: Statistiques de délai de traitement des travaux
 *     tags: [Réparations, Statistiques]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: periode
 *         schema:
 *           type: string
 *           enum: [semaine, mois, trimestre, annee]
 *           default: mois
 *     responses:
 *       200:
 *         description: Statistiques de délais
 */
router.get('/statistiques/delais', authMiddleware, managerMiddleware, async (req: Request, res: Response): Promise<void> => {
    try {
        const periode = req.query.periode as string || 'mois';

        let intervalSQL = "1 month";
        switch (periode) {
            case 'semaine': intervalSQL = "7 days"; break;
            case 'trimestre': intervalSQL = "3 months"; break;
            case 'annee': intervalSQL = "1 year"; break;
            default: intervalSQL = "1 month";
        }

        // Délai moyen de traitement (création → terminé)
        const delaiMoyenQuery = `
            SELECT 
                COALESCE(AVG(
                    CASE WHEN date_termine IS NOT NULL 
                    THEN EXTRACT(EPOCH FROM (date_termine - date_creation)) / 86400 
                    END
                ), 0) as delai_moyen_jours,
                COALESCE(MIN(
                    CASE WHEN date_termine IS NOT NULL 
                    THEN EXTRACT(EPOCH FROM (date_termine - date_creation)) / 86400 
                    END
                ), 0) as delai_min_jours,
                COALESCE(MAX(
                    CASE WHEN date_termine IS NOT NULL 
                    THEN EXTRACT(EPOCH FROM (date_termine - date_creation)) / 86400 
                    END
                ), 0) as delai_max_jours,
                COUNT(*) FILTER (WHERE Id_status = 3) as total_termines,
                COUNT(*) as total_reparations,
                COALESCE(SUM(budget), 0) as budget_total
            FROM Reparation
            WHERE date_creation >= CURRENT_TIMESTAMP - $1::INTERVAL
        `;

        // Délai moyen par niveau (niveau est sur le signalement)
        const delaiParNiveauQuery = `
            SELECT 
                s.niveau,
                COUNT(*) as count,
                COALESCE(AVG(
                    CASE WHEN r.date_termine IS NOT NULL 
                    THEN EXTRACT(EPOCH FROM (r.date_termine - r.date_creation)) / 86400 
                    END
                ), 0) as delai_moyen_jours,
                COALESCE(AVG(r.budget), 0) as budget_moyen,
                COALESCE(SUM(r.budget), 0) as budget_total
            FROM Reparation r
            JOIN Signalement s ON r.Id_signalement = s.Id_signalement
            WHERE r.date_creation >= CURRENT_TIMESTAMP - $1::INTERVAL
              AND s.niveau IS NOT NULL
            GROUP BY s.niveau
            ORDER BY s.niveau
        `;

        // Avancement global
        const avancementQuery = `
            SELECT 
                COALESCE(AVG(avancement_pct), 0) as avancement_moyen,
                COUNT(*) FILTER (WHERE avancement_pct = 0) as nouveau,
                COUNT(*) FILTER (WHERE avancement_pct = 50) as en_cours,
                COUNT(*) FILTER (WHERE avancement_pct = 100) as termine
            FROM Reparation
            WHERE date_creation >= CURRENT_TIMESTAMP - $1::INTERVAL
        `;

        // Évolution par semaine
        const evolutionQuery = `
            SELECT 
                DATE_TRUNC('week', date_creation) as semaine,
                COUNT(*) as nouvelles,
                COUNT(*) FILTER (WHERE Id_status = 3) as terminees,
                COALESCE(SUM(budget), 0) as budget_semaine
            FROM Reparation
            WHERE date_creation >= CURRENT_TIMESTAMP - $1::INTERVAL
            GROUP BY DATE_TRUNC('week', date_creation)
            ORDER BY semaine DESC
        `;

        const [delai, parNiveau, avancement, evolution] = await Promise.all([
            pool.query(delaiMoyenQuery, [intervalSQL]),
            pool.query(delaiParNiveauQuery, [intervalSQL]),
            pool.query(avancementQuery, [intervalSQL]),
            pool.query(evolutionQuery, [intervalSQL])
        ]);

        res.status(200).json({
            success: true,
            periode,
            statistiques: {
                delais: {
                    moyen_jours: Math.round((delai.rows[0]?.delai_moyen_jours || 0) * 100) / 100,
                    min_jours: Math.round((delai.rows[0]?.delai_min_jours || 0) * 100) / 100,
                    max_jours: Math.round((delai.rows[0]?.delai_max_jours || 0) * 100) / 100,
                    total_termines: parseInt(delai.rows[0]?.total_termines || 0),
                    total_reparations: parseInt(delai.rows[0]?.total_reparations || 0),
                    budget_total: Math.round(delai.rows[0]?.budget_total || 0)
                },
                avancement: {
                    moyen_pct: Math.round(avancement.rows[0]?.avancement_moyen || 0),
                    nouveau: parseInt(avancement.rows[0]?.nouveau || 0),
                    en_cours: parseInt(avancement.rows[0]?.en_cours || 0),
                    termine: parseInt(avancement.rows[0]?.termine || 0)
                },
                par_niveau: parNiveau.rows.map(row => ({
                    niveau: row.niveau,
                    count: parseInt(row.count),
                    delai_moyen_jours: Math.round(row.delai_moyen_jours * 100) / 100,
                    budget_moyen: Math.round(row.budget_moyen),
                    budget_total: Math.round(row.budget_total)
                })),
                evolution_hebdomadaire: evolution.rows.map(row => ({
                    semaine: row.semaine,
                    nouvelles: parseInt(row.nouvelles),
                    terminees: parseInt(row.terminees),
                    budget: Math.round(row.budget_semaine)
                }))
            }
        });
    } catch (error: any) {
        console.error('Erreur statistiques délais:', error);
        res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
});

export default router;
