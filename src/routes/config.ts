import { Router, Request, Response } from 'express';
import { body, param, validationResult } from 'express-validator';
import { authMiddleware, managerMiddleware } from '../middleware/auth';
import pool from '../config/database';

const router = Router();

// ============================================
// GESTION DES PRIX PAR M²
// ============================================

/**
 * @swagger
 * /api/config/prix:
 *   get:
 *     summary: Obtenir le prix actuel par m²
 *     tags: [Configuration]
 *     responses:
 *       200:
 *         description: Prix actuel
 */
router.get('/prix', async (req: Request, res: Response): Promise<void> => {
    try {
        const result = await pool.query(`
            SELECT 
                pc.Id_prix_config,
                pc.prix_par_m2,
                pc.description,
                pc.date_effet,
                pc.est_actif,
                u.display_name as cree_par_nom,
                u.email as cree_par_email
            FROM PrixConfig pc
            LEFT JOIN User_ u ON pc.cree_par = u.Id_user
            WHERE pc.est_actif = TRUE
            ORDER BY pc.date_effet DESC
            LIMIT 1
        `);

        if (result.rows.length === 0) {
            // Aucun prix configuré
            res.status(200).json({
                success: true,
                configured: false,
                prix: null,
                message: 'Aucun prix configuré'
            });
            return;
        }

        res.status(200).json({
            success: true,
            configured: true,
            prix: {
                id: result.rows[0].id_prix_config,
                prix_par_m2: parseFloat(result.rows[0].prix_par_m2),
                description: result.rows[0].description,
                date_effet: result.rows[0].date_effet,
                est_actif: result.rows[0].est_actif,
                cree_par: result.rows[0].cree_par_nom || result.rows[0].cree_par_email
            }
        });
    } catch (error: any) {
        console.error('Erreur récupération prix:', error);
        res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
});

/**
 * @swagger
 * /api/config/prix:
 *   post:
 *     summary: Définir un nouveau prix par m² (désactive l'ancien)
 *     tags: [Configuration]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - prix_par_m2
 *             properties:
 *               prix_par_m2:
 *                 type: number
 *                 example: 55000
 *               description:
 *                 type: string
 *                 example: "Nouveau tarif 2026"
 *     responses:
 *       201:
 *         description: Prix créé
 */
router.post('/prix',
    authMiddleware,
    managerMiddleware,
    [
        body('prix_par_m2').isFloat({ min: 1 }).withMessage('Prix par m² doit être supérieur à 0'),
        body('description').optional().isString().isLength({ max: 255 }).withMessage('Description trop longue (max 255)')
    ],
    async (req: Request, res: Response): Promise<void> => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                res.status(400).json({ success: false, errors: errors.array() });
                return;
            }

            const { prix_par_m2, description } = req.body;
            const userId = req.user?.id;

            // Désactiver l'ancien prix actif
            await pool.query('UPDATE PrixConfig SET est_actif = FALSE WHERE est_actif = TRUE');

            // Créer le nouveau prix
            const result = await pool.query(`
                INSERT INTO PrixConfig (prix_par_m2, description, est_actif, cree_par)
                VALUES ($1, $2, TRUE, $3)
                RETURNING Id_prix_config, prix_par_m2, description, date_effet, est_actif
            `, [prix_par_m2, description || null, userId]);

            // Mettre à jour aussi le paramètre global
            await pool.query(
                `INSERT INTO Parametre (nom, valeur, type, description)
                 VALUES ('prix_par_m2', $1, 'number', 'Prix par m² pour le calcul des budgets')
                 ON CONFLICT (nom) DO UPDATE SET valeur = $1, date_modification = CURRENT_TIMESTAMP`,
                [prix_par_m2.toString()]
            );

            const row = result.rows[0];
            res.status(201).json({
                success: true,
                message: 'Prix configuré avec succès',
                prix: {
                    id: row.id_prix_config,
                    prix_par_m2: parseFloat(row.prix_par_m2),
                    description: row.description,
                    date_effet: row.date_effet,
                    est_actif: row.est_actif
                }
            });
        } catch (error: any) {
            console.error('Erreur création prix:', error);
            res.status(500).json({ success: false, error: 'Erreur serveur' });
        }
    }
);

/**
 * @swagger
 * /api/config/prix/historique:
 *   get:
 *     summary: Obtenir l'historique des prix configurés
 *     tags: [Configuration]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Historique des prix
 */
router.get('/prix/historique', authMiddleware, async (req: Request, res: Response): Promise<void> => {
    try {
        const page = Math.max(1, parseInt(req.query.page as string) || 1);
        const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));
        const offset = (page - 1) * limit;

        // Total
        const countResult = await pool.query('SELECT COUNT(*) FROM PrixConfig');
        const total = parseInt(countResult.rows[0].count);

        // Historique paginé
        const result = await pool.query(`
            SELECT 
                pc.Id_prix_config,
                pc.prix_par_m2,
                pc.description,
                pc.date_effet,
                pc.est_actif,
                u.display_name as cree_par_nom,
                u.email as cree_par_email
            FROM PrixConfig pc
            LEFT JOIN User_ u ON pc.cree_par = u.Id_user
            ORDER BY pc.date_effet DESC
            LIMIT $1 OFFSET $2
        `, [limit, offset]);

        res.status(200).json({
            success: true,
            count: result.rows.length,
            total,
            page,
            totalPages: Math.ceil(total / limit),
            historique: result.rows.map(row => ({
                id: row.id_prix_config,
                prix_par_m2: parseFloat(row.prix_par_m2),
                description: row.description,
                date_effet: row.date_effet,
                est_actif: row.est_actif,
                cree_par: row.cree_par_nom || row.cree_par_email || 'Système'
            }))
        });
    } catch (error: any) {
        console.error('Erreur récupération historique prix:', error);
        res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
});

/**
 * @swagger
 * /api/config/prix/calculer:
 *   post:
 *     summary: Calculer le budget pour une réparation
 *     description: Budget = prix_par_m2 * niveau * surface_m2
 *     tags: [Configuration]
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
 *     responses:
 *       200:
 *         description: Budget calculé
 */
router.post('/prix/calculer',
    [
        body('surface_m2').isFloat({ min: 0.01 }).withMessage('Surface invalide'),
        body('niveau').isInt({ min: 1, max: 10 }).withMessage('Niveau doit être entre 1 et 10')
    ],
    async (req: Request, res: Response): Promise<void> => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                res.status(400).json({ success: false, errors: errors.array() });
                return;
            }

            const { surface_m2, niveau } = req.body;

            // Récupérer le prix actif
            const prixResult = await pool.query(`
                SELECT prix_par_m2 FROM PrixConfig 
                WHERE est_actif = TRUE 
                ORDER BY date_effet DESC 
                LIMIT 1
            `);

            let prix_par_m2 = 0;
            let configured = false;
            if (prixResult.rows.length > 0) {
                prix_par_m2 = parseFloat(prixResult.rows[0].prix_par_m2);
                configured = true;
            }

            const budget = prix_par_m2 * niveau * surface_m2;

            res.status(200).json({
                success: true,
                configured,
                calcul: {
                    prix_par_m2,
                    niveau,
                    surface_m2,
                    formule: `${prix_par_m2} Ar × ${niveau} × ${surface_m2} m²`,
                    budget: Math.round(budget * 100) / 100
                }
            });
        } catch (error: any) {
            console.error('Erreur calcul budget:', error);
            res.status(500).json({ success: false, error: 'Erreur serveur' });
        }
    }
);

// ============================================
// STATISTIQUES DE TRAITEMENT
// ============================================

/**
 * @swagger
 * /api/config/statistiques/delais:
 *   get:
 *     summary: Obtenir les statistiques de délai de traitement des travaux
 *     tags: [Configuration, Statistiques]
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
                    EXTRACT(EPOCH FROM (r.date_termine - r.date_creation)) / 86400
                ), 0) as delai_moyen_jours,
                COALESCE(MIN(
                    EXTRACT(EPOCH FROM (r.date_termine - r.date_creation)) / 86400
                ), 0) as delai_min_jours,
                COALESCE(MAX(
                    EXTRACT(EPOCH FROM (r.date_termine - r.date_creation)) / 86400
                ), 0) as delai_max_jours,
                COUNT(*) FILTER (WHERE r.Id_status = 3) as total_termines,
                COUNT(*) as total_reparations
            FROM Reparation r
            WHERE r.date_creation >= CURRENT_TIMESTAMP - $1::INTERVAL
        `;

        // Répartition par statut
        const repartitionQuery = `
            SELECT 
                s.libelle as status,
                s.couleur,
                COUNT(*) as count,
                ROUND(COUNT(*) * 100.0 / NULLIF(SUM(COUNT(*)) OVER(), 0), 2) as pourcentage
            FROM Reparation r
            JOIN Status s ON r.Id_status = s.Id_status
            WHERE r.date_creation >= CURRENT_TIMESTAMP - $1::INTERVAL
            GROUP BY s.Id_status, s.libelle, s.couleur
            ORDER BY s.Id_status
        `;

        // Avancement moyen
        const avancementQuery = `
            SELECT 
                COALESCE(AVG(r.avancement_pct), 0) as avancement_moyen,
                COUNT(*) FILTER (WHERE r.avancement_pct = 0) as nouveau,
                COUNT(*) FILTER (WHERE r.avancement_pct = 50) as en_cours,
                COUNT(*) FILTER (WHERE r.avancement_pct = 100) as termine
            FROM Reparation r
            WHERE r.date_creation >= CURRENT_TIMESTAMP - $1::INTERVAL
        `;

        // Évolution par jour/semaine
        const evolutionQuery = `
            SELECT 
                DATE(r.date_creation) as date,
                COUNT(*) as nouvelles,
                COUNT(*) FILTER (WHERE r.Id_status = 3) as terminees
            FROM Reparation r
            WHERE r.date_creation >= CURRENT_TIMESTAMP - $1::INTERVAL
            GROUP BY DATE(r.date_creation)
            ORDER BY date DESC
        `;

        // Délai par niveau de complexité
        const delaiParNiveauQuery = `
            SELECT 
                s.niveau,
                COUNT(*) as count,
                COALESCE(AVG(
                    EXTRACT(EPOCH FROM (r.date_termine - r.date_creation)) / 86400
                ), 0) as delai_moyen_jours,
                COALESCE(AVG(r.budget), 0) as budget_moyen
            FROM Reparation r
            JOIN Signalement s ON r.Id_signalement = s.Id_signalement
            WHERE r.date_creation >= CURRENT_TIMESTAMP - $1::INTERVAL
              AND s.niveau IS NOT NULL
            GROUP BY s.niveau
            ORDER BY s.niveau
        `;

        const [delai, repartition, avancement, evolution, parNiveau] = await Promise.all([
            pool.query(delaiMoyenQuery, [intervalSQL]),
            pool.query(repartitionQuery, [intervalSQL]),
            pool.query(avancementQuery, [intervalSQL]),
            pool.query(evolutionQuery, [intervalSQL]),
            pool.query(delaiParNiveauQuery, [intervalSQL])
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
                    total_reparations: parseInt(delai.rows[0]?.total_reparations || 0)
                },
                repartition_status: repartition.rows,
                avancement: {
                    moyen_pct: Math.round(avancement.rows[0]?.avancement_moyen || 0),
                    nouveau: parseInt(avancement.rows[0]?.nouveau || 0),
                    en_cours: parseInt(avancement.rows[0]?.en_cours || 0),
                    termine: parseInt(avancement.rows[0]?.termine || 0)
                },
                evolution_quotidienne: evolution.rows,
                par_niveau: parNiveau.rows.map(row => ({
                    niveau: row.niveau,
                    count: parseInt(row.count),
                    delai_moyen_jours: Math.round(row.delai_moyen_jours * 100) / 100,
                    budget_moyen: Math.round(row.budget_moyen)
                }))
            }
        });
    } catch (error: any) {
        console.error('Erreur récupération statistiques délais:', error);
        res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
});

// ============================================
// STATISTIQUES GLOBALES (page Statistiques)
// ============================================

/**
 * @swagger
 * /api/config/statistiques:
 *   get:
 *     summary: Statistiques globales pour la page Statistiques
 *     description: |
 *       Retourne toutes les statistiques nécessaires à la page Statistiques :
 *       - Délais de traitement (moyen, min, max)
 *       - Compteurs de réparations par statut
 *       - Budget total et moyen
 *       - Statistiques des signalements
 *       - Statistiques des prix
 *     tags: [Statistiques]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: periode
 *         schema:
 *           type: string
 *           enum: [semaine, mois, trimestre, annee, tout]
 *           default: tout
 *     responses:
 *       200:
 *         description: Statistiques globales
 */
router.get('/statistiques', authMiddleware, managerMiddleware, async (req: Request, res: Response): Promise<void> => {
    try {
        const periode = req.query.periode as string || 'tout';

        let intervalFilter = '';
        const params: any[] = [];

        if (periode !== 'tout') {
            let intervalSQL = '1 month';
            switch (periode) {
                case 'semaine': intervalSQL = '7 days'; break;
                case 'trimestre': intervalSQL = '3 months'; break;
                case 'annee': intervalSQL = '1 year'; break;
                default: intervalSQL = '1 month';
            }
            intervalFilter = `WHERE r.date_creation >= CURRENT_TIMESTAMP - $1::INTERVAL`;
            params.push(intervalSQL);
        }

        const sigIntervalFilter = periode !== 'tout'
            ? `WHERE s.date_signalement >= CURRENT_TIMESTAMP - $1::INTERVAL`
            : '';

        // ===== RÉPARATIONS =====
        const reparationsStatsQuery = `
            SELECT 
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE r.Id_status = 1) as nouveau,
                COUNT(*) FILTER (WHERE r.Id_status = 2) as en_cours,
                COUNT(*) FILTER (WHERE r.Id_status = 3) as termine,
                COALESCE(SUM(r.budget), 0) as budget_total,
                COALESCE(AVG(r.budget), 0) as budget_moyen,
                COALESCE(SUM(r.surface_m2), 0) as surface_totale,
                COALESCE(AVG(r.avancement_pct), 0) as avancement_moyen
            FROM Reparation r
            ${intervalFilter}
        `;

        // ===== DÉLAIS =====
        const delaisQuery = `
            SELECT 
                COALESCE(AVG(
                    CASE WHEN r.date_termine IS NOT NULL 
                    THEN EXTRACT(EPOCH FROM (r.date_termine - r.date_creation)) / 86400 
                    END
                ), 0) as delai_moyen_jours,
                COALESCE(MIN(
                    CASE WHEN r.date_termine IS NOT NULL 
                    THEN EXTRACT(EPOCH FROM (r.date_termine - r.date_creation)) / 86400 
                    END
                ), 0) as delai_min_jours,
                COALESCE(MAX(
                    CASE WHEN r.date_termine IS NOT NULL 
                    THEN EXTRACT(EPOCH FROM (r.date_termine - r.date_creation)) / 86400 
                    END
                ), 0) as delai_max_jours,
                COUNT(*) FILTER (WHERE r.Id_status = 3) as total_termines
            FROM Reparation r
            ${intervalFilter}
        `;

        // ===== SIGNALEMENTS =====
        const signalementsStatsQuery = `
            SELECT 
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE s.Id_status = 1) as nouveau,
                COUNT(*) FILTER (WHERE s.Id_status = 2) as en_cours,
                COUNT(*) FILTER (WHERE s.Id_status = 3) as termine,
                COUNT(*) FILTER (WHERE s.niveau IS NOT NULL) as avec_niveau
            FROM Signalement s
            ${sigIntervalFilter}
        `;

        // ===== RÉPARTITION PAR STATUT =====
        const repartitionQuery = `
            SELECT 
                st.libelle as status,
                st.couleur,
                COUNT(r.*) as count
            FROM Status st
            LEFT JOIN Reparation r ON r.Id_status = st.Id_status
                ${periode !== 'tout' ? 'AND r.date_creation >= CURRENT_TIMESTAMP - $1::INTERVAL' : ''}
            GROUP BY st.Id_status, st.libelle, st.couleur
            ORDER BY st.Id_status
        `;

        // ===== PRIX ACTUEL =====
        const prixQuery = `
            SELECT 
                pc.prix_par_m2,
                pc.description,
                pc.date_effet,
                (SELECT COUNT(*) FROM PrixConfig) as total_changements
            FROM PrixConfig pc
            WHERE pc.est_actif = TRUE
            ORDER BY pc.date_effet DESC
            LIMIT 1
        `;

        // ===== ÉVOLUTION HEBDOMADAIRE =====
        const evolutionQuery = `
            SELECT 
                DATE_TRUNC('week', r.date_creation) as semaine,
                COUNT(*) as nouvelles,
                COUNT(*) FILTER (WHERE r.Id_status = 3) as terminees,
                COALESCE(SUM(r.budget), 0) as budget_semaine
            FROM Reparation r
            ${intervalFilter}
            GROUP BY DATE_TRUNC('week', r.date_creation)
            ORDER BY semaine DESC
            LIMIT 12
        `;

        // ===== TOP ENTREPRISES =====
        const entreprisesQuery = `
            SELECT 
                e.nom,
                COUNT(r.*) as nb_reparations,
                COALESCE(SUM(r.budget), 0) as budget_total,
                COUNT(*) FILTER (WHERE r.Id_status = 3) as terminees
            FROM Entreprise e
            LEFT JOIN Reparation r ON e.Id_entreprise = r.Id_entreprise
                ${periode !== 'tout' ? 'AND r.date_creation >= CURRENT_TIMESTAMP - $1::INTERVAL' : ''}
            GROUP BY e.Id_entreprise, e.nom
            ORDER BY nb_reparations DESC
            LIMIT 10
        `;

        const [repStats, delais, sigStats, repartition, prix, evolution, entreprises] = await Promise.all([
            pool.query(reparationsStatsQuery, params),
            pool.query(delaisQuery, params),
            pool.query(signalementsStatsQuery, params),
            pool.query(repartitionQuery, params),
            pool.query(prixQuery),
            pool.query(evolutionQuery, params),
            pool.query(entreprisesQuery, params)
        ]);

        const rep = repStats.rows[0];
        const del = delais.rows[0];
        const sig = sigStats.rows[0];
        const prixActuel = prix.rows[0];

        res.status(200).json({
            success: true,
            periode,
            statistiques: {
                // Cards principales (comme sur la capture)
                delais: {
                    moyen_jours: Math.round((parseFloat(del?.delai_moyen_jours) || 0) * 100) / 100,
                    min_jours: Math.round((parseFloat(del?.delai_min_jours) || 0) * 100) / 100,
                    max_jours: Math.round((parseFloat(del?.delai_max_jours) || 0) * 100) / 100,
                    total_termines: parseInt(del?.total_termines || '0')
                },

                // Statistiques réparations
                reparations: {
                    total: parseInt(rep?.total || '0'),
                    nouveau: parseInt(rep?.nouveau || '0'),
                    en_cours: parseInt(rep?.en_cours || '0'),
                    termine: parseInt(rep?.termine || '0'),
                    budget_total: Math.round(parseFloat(rep?.budget_total || '0') * 100) / 100,
                    budget_moyen: Math.round(parseFloat(rep?.budget_moyen || '0') * 100) / 100,
                    surface_totale: Math.round(parseFloat(rep?.surface_totale || '0') * 100) / 100,
                    avancement_moyen: Math.round(parseFloat(rep?.avancement_moyen || '0'))
                },

                // Statistiques signalements
                signalements: {
                    total: parseInt(sig?.total || '0'),
                    nouveau: parseInt(sig?.nouveau || '0'),
                    en_cours: parseInt(sig?.en_cours || '0'),
                    termine: parseInt(sig?.termine || '0'),
                    avec_niveau: parseInt(sig?.avec_niveau || '0')
                },

                // Répartition par statut
                repartition_status: repartition.rows.map(row => ({
                    status: row.status,
                    couleur: row.couleur,
                    count: parseInt(row.count)
                })),

                // Configuration prix
                prix: prixActuel ? {
                    prix_par_m2: parseFloat(prixActuel.prix_par_m2),
                    description: prixActuel.description,
                    date_effet: prixActuel.date_effet,
                    total_changements: parseInt(prixActuel.total_changements)
                } : null,

                // Évolution hebdomadaire
                evolution_hebdomadaire: evolution.rows.map(row => ({
                    semaine: row.semaine,
                    nouvelles: parseInt(row.nouvelles),
                    terminees: parseInt(row.terminees),
                    budget: Math.round(parseFloat(row.budget_semaine))
                })),

                // Top entreprises
                entreprises: entreprises.rows.map(row => ({
                    nom: row.nom,
                    nb_reparations: parseInt(row.nb_reparations),
                    budget_total: Math.round(parseFloat(row.budget_total)),
                    terminees: parseInt(row.terminees)
                }))
            }
        });
    } catch (error: any) {
        console.error('Erreur statistiques globales:', error);
        res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
});

export default router;
