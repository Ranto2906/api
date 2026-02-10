import { Router, Request, Response } from 'express';
import { body, query as queryValidator, validationResult } from 'express-validator';
import UserService, { CreateUserDTO, UpdateUserDTO } from '../services/userService';
import { authMiddleware, managerMiddleware } from '../middleware/auth';
import { getAuth, getFirestore } from '../config/firebase';
import { hybridDataService } from '../services/hybridDataService';
import { emailService } from '../services/emailService';
import * as admin from 'firebase-admin';

const router = Router();

/**
 * @swagger
 * tags:
 *   - name: Gestion Utilisateurs
 *     description: "Endpoints pour la gestion des utilisateurs (Managers uniquement)"
 */

/**
 * @swagger
 * /api/users:
 *   get:
 *     summary: Lister tous les utilisateurs
 *     description: |
 *       Récupère la liste de tous les utilisateurs avec pagination, recherche et filtrage.
 *       **Accès**: Manager uniquement
 *     tags: [Gestion Utilisateurs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Numéro de page (par défaut 1)
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *         description: Nombre d'utilisateurs par page (par défaut 10)
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: "Recherche par email, nom d'affichage ou UID Firebase"
 *       - in: query
 *         name: type_user
 *         schema:
 *           type: integer
 *           enum: [1, 2, 3]
 *         description: "Filtrer par type (1=Visiteur, 2=Utilisateur, 3=Manager)"
 *       - in: query
 *         name: est_bloque
 *         schema:
 *           type: boolean
 *         description: "Filtrer par statut de blocage (true/false)"
 *       - in: query
 *         name: sort_by
 *         schema:
 *           type: string
 *           enum: [date_creation, email, display_name]
 *           default: date_creation
 *         description: Champ de tri
 *       - in: query
 *         name: order
 *         schema:
 *           type: string
 *           enum: [ASC, DESC]
 *           default: DESC
 *         description: Ordre de tri
 *     responses:
 *       200:
 *         description: Liste des utilisateurs
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/User'
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     total:
 *                       type: integer
 *                     page:
 *                       type: integer
 *                     limit:
 *                       type: integer
 *                     pages:
 *                       type: integer
 *       401:
 *         description: Non authentifié
 *       403:
 *         description: Accès refusé (Manager uniquement)
 */
router.get('/',
    authMiddleware,
    managerMiddleware,
    [
        queryValidator('page').optional().isInt({ min: 1 }),
        queryValidator('limit').optional().isInt({ min: 1, max: 100 }),
        queryValidator('search').optional().isString().trim(),
        queryValidator('type_user').optional().isInt({ min: 1, max: 3 }),
        queryValidator('est_bloque').optional().isBoolean(),
        queryValidator('sort_by').optional().isIn(['date_creation', 'email', 'display_name']),
        queryValidator('order').optional().isIn(['ASC', 'DESC'])
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

            const page = parseInt(req.query.page as string) || 1;
            const limit = Math.min(parseInt(req.query.limit as string) || 10, 100);
            const search = (req.query.search as string) || '';
            const typeUser = req.query.type_user ? parseInt(req.query.type_user as string) : null;
            const estBloque = req.query.est_bloque ? req.query.est_bloque === 'true' : null;
            const sortBy = (req.query.sort_by as string) || 'date_creation';
            const order = ((req.query.order as string) || 'DESC').toUpperCase();

            const offset = (page - 1) * limit;

            // Construire les conditions WHERE
            const conditions: string[] = [];
            const params: any[] = [];

            if (search) {
                conditions.push(`(u.email ILIKE $${params.length + 1} OR u.display_name ILIKE $${params.length + 1} OR u.firebase_uid ILIKE $${params.length + 1})`);
                params.push(`%${search}%`);
            }

            if (typeUser !== null) {
                conditions.push(`u.id_type_user = $${params.length + 1}`);
                params.push(typeUser);
            }

            if (estBloque !== null) {
                conditions.push(`u.est_bloque = $${params.length + 1}`);
                params.push(estBloque);
            }

            const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

            // Compter le total
            const countResult = await hybridDataService.query(
                `SELECT COUNT(*) as total FROM user_ u ${whereClause}`,
                params
            );
            const total = countResult.rows[0].total;

            // Récupérer les utilisateurs
            const result = await hybridDataService.query(
                `SELECT u.id_user, u.firebase_uid, u.email, u.display_name, u.date_creation, 
                u.derniere_sync, u.est_bloque, u.id_type_user, t.libelle as type_libelle
         FROM user_ u
         JOIN TypeUser t ON u.id_type_user = t.id_type_user
         ${whereClause}
         ORDER BY u.${sortBy} ${order}
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
                [...params, limit, offset]
            );

            const users = result.rows.map((user: any) => ({
                id: user.id_user,
                firebase_uid: user.firebase_uid,
                email: user.email,
                display_name: user.display_name,
                type_user: user.id_type_user,
                type_libelle: user.type_libelle,
                est_bloque: user.est_bloque,
                date_creation: user.date_creation,
                derniere_sync: user.derniere_sync
            }));

            res.status(200).json({
                success: true,
                data: users,
                pagination: {
                    total,
                    page,
                    limit,
                    pages: Math.ceil(total / limit)
                }
            });
        } catch (error: any) {
            console.error('Erreur liste utilisateurs:', error);
            res.status(500).json({
                success: false,
                error: 'Erreur serveur'
            });
        }
    }
);

/**
 * @swagger
 * /api/users/search:
 *   get:
 *     summary: Recherche rapide d'utilisateurs
 *     description: |
 *       Effectue une recherche par email, nom ou UID Firebase.
 *       **Accès**: Manager uniquement
 *     tags: [Gestion Utilisateurs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *         description: Termes de recherche
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 5
 *     responses:
 *       200:
 *         description: Résultats de recherche
 */
router.get('/search',
    authMiddleware,
    managerMiddleware,
    [
        queryValidator('q').notEmpty().isString().trim(),
        queryValidator('limit').optional().isInt({ min: 1, max: 50 })
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

            const query_str = (req.query.q as string).trim();
            const limit = Math.min(parseInt(req.query.limit as string) || 5, 50);

            const result = await hybridDataService.query(
                `SELECT u.id_user, u.firebase_uid, u.email, u.display_name, u.est_bloque, u.id_type_user, t.libelle as type_libelle
         FROM user_ u
         JOIN TypeUser t ON u.id_type_user = t.id_type_user
         WHERE u.email ILIKE $1 OR u.display_name ILIKE $1 OR u.firebase_uid ILIKE $1
         LIMIT $2`,
                [`%${query_str}%`, limit]
            );

            res.status(200).json({
                success: true,
                results: result.rows.map((user: any) => ({
                    id: user.id_user,
                    firebase_uid: user.firebase_uid,
                    email: user.email,
                    display_name: user.display_name,
                    type_user: user.id_type_user,
                    type_libelle: user.type_libelle,
                    est_bloque: user.est_bloque
                }))
            });
        } catch (error: any) {
            console.error('Erreur recherche:', error);
            res.status(500).json({
                success: false,
                error: 'Erreur serveur'
            });
        }
    }
);

/**
 * @swagger
 * /api/users/{id}:
 *   get:
 *     summary: Récupérer les détails d'un utilisateur
 *     description: "**Accès**: Manager uniquement"
 *     tags: [Gestion Utilisateurs]
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
 *         description: Détails de l'utilisateur
 *       404:
 *         description: Utilisateur non trouvé
 */
router.get('/:id',
    authMiddleware,
    managerMiddleware,
    async (req: Request, res: Response): Promise<void> => {
        try {
            const userId = parseInt(req.params.id, 10);

            if (isNaN(userId)) {
                res.status(400).json({
                    success: false,
                    error: 'ID utilisateur invalide'
                });
                return;
            }

            const user = await UserService.findById(userId);

            if (!user) {
                res.status(404).json({
                    success: false,
                    error: 'Utilisateur non trouvé'
                });
                return;
            }

            res.status(200).json({
                success: true,
                data: {
                    id: user.id_user,
                    firebase_uid: user.firebase_uid,
                    email: user.email,
                    display_name: user.display_name,
                    type_user: user.id_type_user,
                    est_bloque: user.est_bloque,
                    date_creation: user.date_creation,
                    derniere_sync: user.derniere_sync
                }
            });
        } catch (error: any) {
            console.error('Erreur récupération utilisateur:', error);
            res.status(500).json({
                success: false,
                error: 'Erreur serveur'
            });
        }
    }
);

/**
 * @swagger
 * /api/users:
 *   post:
 *     summary: Créer un nouvel utilisateur
 *     description: |
 *       Crée un nouvel utilisateur dans Firebase Auth et PostgreSQL.
 *       **Accès**: Manager uniquement
 *     tags: [Gestion Utilisateurs]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *               - display_name
 *               - type_user
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: "jean.dupont@email.mg"
 *               password:
 *                 type: string
 *                 minLength: 6
 *                 example: "SecurePassword123"
 *               display_name:
 *                 type: string
 *                 example: "Jean Dupont"
 *               type_user:
 *                 type: integer
 *                 enum: [1, 2, 3]
 *                 description: "1=Visiteur, 2=Utilisateur, 3=Manager"
 *                 example: 2
 *     responses:
 *       201:
 *         description: Utilisateur créé avec succès
 *       400:
 *         description: Données invalides
 *       409:
 *         description: Email déjà utilisé
 *       503:
 *         description: Service indisponible
 */
router.post('/',
    authMiddleware,
    managerMiddleware,
    [
        body('email').isEmail().withMessage('Email invalide'),
        body('password').isLength({ min: 6 }).withMessage('Le mot de passe doit contenir au moins 6 caractères'),
        body('display_name').notEmpty().isString().withMessage('Le nom est requis'),
        body('type_user').isInt({ min: 1, max: 3 }).withMessage('Type utilisateur invalide (1-3)')
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

            const { email, password, display_name, type_user } = req.body;

            // Vérifier si l'utilisateur existe déjà
            const existingUser = await UserService.findByEmail(email);
            if (existingUser) {
                res.status(409).json({
                    success: false,
                    error: 'Cet email est déjà utilisé'
                });
                return;
            }

            const isOnline = await hybridDataService.isFirebaseAvailable();

            if (!isOnline) {
                res.status(503).json({
                    success: false,
                    error: 'Impossible de créer un utilisateur hors ligne. Connexion internet requise.'
                });
                return;
            }

            try {
                const auth = getAuth();
                const db = getFirestore();

                // Créer l'utilisateur dans Firebase Auth
                const userRecord = await auth.createUser({
                    email,
                    password,
                    displayName: display_name
                });

                console.log(`✅ Utilisateur Firebase Auth créé: ${userRecord.uid}`);

                // Synchroniser vers PostgreSQL d'abord pour obtenir l'id_user
                const user = await UserService.syncFromFirebase({
                    firebase_uid: userRecord.uid,
                    email,
                    password,
                    display_name,
                    type_user
                });

                const now = new Date();

                // Créer le profil dans Firestore avec le format attendu
                await db.collection('users').doc(userRecord.uid).set({
                    date_creation: now,
                    derniere_sync: now,
                    display_name,
                    email,
                    est_bloque: false,
                    firebase_uid: userRecord.uid,
                    id_type_user: type_user,
                    id_user: user.id_user,
                    password
                });

                console.log(`✅ Profil Firestore créé pour: ${email}`);

                res.status(201).json({
                    success: true,
                    message: 'Utilisateur créé avec succès',
                    data: {
                        id: user.id_user,
                        firebase_uid: user.firebase_uid,
                        email: user.email,
                        display_name: user.display_name,
                        type_user: user.id_type_user
                    }
                });
            } catch (firebaseError: any) {
                console.error('❌ Erreur Firebase:', firebaseError);

                if (firebaseError.code === 'auth/email-already-exists') {
                    res.status(409).json({
                        success: false,
                        error: 'Cet email est déjà utilisé'
                    });
                    return;
                }

                res.status(400).json({
                    success: false,
                    error: 'Erreur lors de la création',
                    details: firebaseError.message
                });
            }
        } catch (error: any) {
            console.error('Erreur création utilisateur:', error);
            res.status(500).json({
                success: false,
                error: 'Erreur serveur',
                details: error.message
            });
        }
    }
);

/**
 * @swagger
 * /api/users/{id}:
 *   put:
 *     summary: Mettre à jour un utilisateur
 *     description: |
 *       Met à jour les informations d'un utilisateur.
 *       **Accès**: Manager uniquement
 *     tags: [Gestion Utilisateurs]
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
 *             properties:
 *               display_name:
 *                 type: string
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *                 minLength: 6
 *               type_user:
 *                 type: integer
 *                 enum: [1, 2, 3]
 *     responses:
 *       200:
 *         description: Utilisateur mis à jour
 *       404:
 *         description: Utilisateur non trouvé
 */
router.put('/:id',
    authMiddleware,
    managerMiddleware,
    [
        body('display_name').optional().isString(),
        body('email').optional().isEmail(),
        body('password').optional().isLength({ min: 6 }),
        body('type_user').optional().isInt({ min: 1, max: 3 })
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

            const userId = parseInt(req.params.id, 10);
            if (isNaN(userId)) {
                res.status(400).json({
                    success: false,
                    error: 'ID utilisateur invalide'
                });
                return;
            }

            // Vérifier que l'utilisateur existe
            const user = await UserService.findById(userId);
            if (!user) {
                res.status(404).json({
                    success: false,
                    error: 'Utilisateur non trouvé'
                });
                return;
            }

            const updateData: UpdateUserDTO = {};

            if (req.body.display_name !== undefined) {
                updateData.display_name = req.body.display_name;
            }
            if (req.body.email !== undefined) {
                // Vérifier que le nouvel email n'existe pas
                const existingUser = await UserService.findByEmail(req.body.email);
                if (existingUser && existingUser.id_user !== userId) {
                    res.status(409).json({
                        success: false,
                        error: 'Cet email est déjà utilisé'
                    });
                    return;
                }
                updateData.email = req.body.email;
            }
            if (req.body.password !== undefined) {
                updateData.password = req.body.password;
            }
            if (req.body.type_user !== undefined) {
                updateData.type_user = req.body.type_user;
            }

            const updatedUser = await UserService.update(userId, updateData);

            // Synchroniser vers Firebase si en ligne
            const isOnline = await hybridDataService.isFirebaseAvailable();
            if (isOnline && user.firebase_uid) {
                try {
                    const auth = getAuth();
                    const db = getFirestore();

                    // Mettre à jour Firebase Auth
                    const authUpdate: any = {};
                    if (updateData.display_name) authUpdate.displayName = updateData.display_name;
                    if (updateData.email) authUpdate.email = updateData.email;
                    if (updateData.password) authUpdate.password = updateData.password;

                    if (Object.keys(authUpdate).length > 0) {
                        await auth.updateUser(user.firebase_uid, authUpdate);
                    }

                    // Mettre à jour Firestore avec le bon format
                    const firestoreUpdate: any = {
                        derniere_sync: new Date()
                    };
                    if (updateData.display_name !== undefined) firestoreUpdate.display_name = updateData.display_name;
                    if (updateData.email !== undefined) firestoreUpdate.email = updateData.email;
                    if (updateData.password !== undefined) firestoreUpdate.password = updateData.password;
                    if (updateData.type_user !== undefined) firestoreUpdate.id_type_user = updateData.type_user;

                    await db.collection('users').doc(user.firebase_uid).update(firestoreUpdate);

                    console.log(`✅ Utilisateur synchronisé vers Firebase: ${updatedUser!.email}`);
                } catch (firebaseError: any) {
                    console.warn('⚠️ Erreur synchronisation Firebase:', firebaseError.message);
                }
            }

            res.status(200).json({
                success: true,
                message: 'Utilisateur mis à jour',
                data: {
                    id: updatedUser!.id_user,
                    firebase_uid: updatedUser!.firebase_uid,
                    email: updatedUser!.email,
                    display_name: updatedUser!.display_name,
                    type_user: updatedUser!.id_type_user,
                    est_bloque: updatedUser!.est_bloque
                }
            });
        } catch (error: any) {
            console.error('Erreur mise à jour utilisateur:', error);
            res.status(500).json({
                success: false,
                error: 'Erreur serveur'
            });
        }
    }
);

/**
 * @swagger
 * /api/users/{id}:
 *   delete:
 *     summary: Supprimer un utilisateur
 *     description: |
 *       Supprime un utilisateur (de la base de données locale).
 *       **Accès**: Manager uniquement
 *     tags: [Gestion Utilisateurs]
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
 *         description: Utilisateur supprimé
 *       404:
 *         description: Utilisateur non trouvé
 */
router.delete('/:id',
    authMiddleware,
    managerMiddleware,
    async (req: Request, res: Response): Promise<void> => {
        try {
            const userId = parseInt(req.params.id, 10);
            if (isNaN(userId)) {
                res.status(400).json({
                    success: false,
                    error: 'ID utilisateur invalide'
                });
                return;
            }

            const user = await UserService.findById(userId);
            if (!user) {
                res.status(404).json({
                    success: false,
                    error: 'Utilisateur non trouvé'
                });
                return;
            }

            // Empêcher la suppression d'un manager
            if (user.id_type_user === 3) {
                res.status(403).json({
                    success: false,
                    error: 'Impossible de supprimer un manager'
                });
                return;
            }

            // Supprimer du cache local
            if (user.firebase_uid) {
                await UserService.deleteFromCache(user.firebase_uid);
            }

            res.status(200).json({
                success: true,
                message: 'Utilisateur supprimé du cache local'
            });
        } catch (error: any) {
            console.error('Erreur suppression utilisateur:', error);
            res.status(500).json({
                success: false,
                error: 'Erreur serveur'
            });
        }
    }
);

/**
 * @swagger
 * /api/users/{id}/block:
 *   post:
 *     summary: Bloquer un utilisateur
 *     description: "**Accès**: Manager uniquement"
 *     tags: [Gestion Utilisateurs]
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
 */
router.post('/:id/block',
    authMiddleware,
    managerMiddleware,
    async (req: Request, res: Response): Promise<void> => {
        try {
            const userId = parseInt(req.params.id, 10);
            if (isNaN(userId)) {
                res.status(400).json({ success: false, error: 'ID invalide' });
                return;
            }

            const user = await UserService.findById(userId);
            if (!user) {
                res.status(404).json({ success: false, error: 'Utilisateur non trouvé' });
                return;
            }

            if (user.id_type_user === 3) {
                res.status(403).json({ success: false, error: 'Impossible de bloquer un manager' });
                return;
            }

            await UserService.blockUser(userId);

            res.status(200).json({
                success: true,
                message: 'Utilisateur bloqué'
            });
        } catch (error: any) {
            console.error('Erreur blocage:', error);
            res.status(500).json({ success: false, error: 'Erreur serveur' });
        }
    }
);

/**
 * @swagger
 * /api/users/{id}/unblock:
 *   post:
 *     summary: Débloquer un utilisateur
 *     description: "**Accès**: Manager uniquement"
 *     tags: [Gestion Utilisateurs]
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
 *         description: Utilisateur débloqué
 */
router.post('/:id/unblock',
    authMiddleware,
    managerMiddleware,
    async (req: Request, res: Response): Promise<void> => {
        try {
            const userId = parseInt(req.params.id, 10);
            if (isNaN(userId)) {
                res.status(400).json({ success: false, error: 'ID invalide' });
                return;
            }

            const user = await UserService.findById(userId);
            if (!user) {
                res.status(404).json({ success: false, error: 'Utilisateur non trouvé' });
                return;
            }

            await UserService.unblockUser(userId);

            res.status(200).json({
                success: true,
                message: 'Utilisateur débloqué'
            });
        } catch (error: any) {
            console.error('Erreur déblocage:', error);
            res.status(500).json({ success: false, error: 'Erreur serveur' });
        }
    }
);

/**
 * @swagger
 * /api/users/stats/summary:
 *   get:
 *     summary: Statistiques des utilisateurs
 *     description: "**Accès**: Manager uniquement"
 *     tags: [Gestion Utilisateurs]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Statistiques
 */
router.get('/stats/summary',
    authMiddleware,
    managerMiddleware,
    async (req: Request, res: Response): Promise<void> => {
        try {
            const result = await hybridDataService.query(
                `SELECT 
           COUNT(*) as total_users,
           SUM(CASE WHEN est_bloque THEN 1 ELSE 0 END) as blocked_users,
           SUM(CASE WHEN id_type_user = 1 THEN 1 ELSE 0 END) as visitors,
           SUM(CASE WHEN id_type_user = 2 THEN 1 ELSE 0 END) as regular_users,
           SUM(CASE WHEN id_type_user = 3 THEN 1 ELSE 0 END) as managers
         FROM user_`
            );

            res.status(200).json({
                success: true,
                data: result.rows[0]
            });
        } catch (error: any) {
            console.error('Erreur stats:', error);
            res.status(500).json({ success: false, error: 'Erreur serveur' });
        }
    }
);

// ============================================
// ENVOI DES IDENTIFIANTS PAR EMAIL
// ============================================

/**
 * @swagger
 * /api/users/{id}/send-credentials:
 *   post:
 *     summary: Envoyer les identifiants de connexion par email
 *     description: |
 *       Envoie un email à l'utilisateur avec ses informations de connexion (email + mot de passe).
 *       **Accès**: Manager uniquement
 *     tags: [Gestion Utilisateurs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID de l'utilisateur
 *     responses:
 *       200:
 *         description: Email envoyé avec succès
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *       400:
 *         description: Utilisateur sans email
 *       404:
 *         description: Utilisateur non trouvé
 *       500:
 *         description: Erreur serveur ou email non envoyé
 */
router.post('/:id/send-credentials',
    authMiddleware,
    managerMiddleware,
    async (req: Request, res: Response): Promise<void> => {
        try {
            const userId = parseInt(req.params.id, 10);

            if (isNaN(userId)) {
                res.status(400).json({
                    success: false,
                    error: 'ID utilisateur invalide'
                });
                return;
            }

            // Récupérer l'utilisateur avec son mot de passe
            const result = await hybridDataService.query(
                'SELECT id_user, email, password, display_name FROM User_ WHERE id_user = $1',
                [userId]
            );

            if (result.rows.length === 0) {
                res.status(404).json({
                    success: false,
                    error: 'Utilisateur non trouvé'
                });
                return;
            }

            const user = result.rows[0];

            if (!user.email) {
                res.status(400).json({
                    success: false,
                    error: 'Cet utilisateur n\'a pas d\'adresse email'
                });
                return;
            }

            if (!user.password) {
                res.status(400).json({
                    success: false,
                    error: 'Cet utilisateur n\'a pas de mot de passe défini'
                });
                return;
            }

            // Vérifier si le service email est configuré
            if (!emailService.isReady()) {
                res.status(500).json({
                    success: false,
                    error: 'Service email non configuré. Vérifiez EMAIL_USER et EMAIL_PASSWORD dans .env'
                });
                return;
            }

            // Envoyer l'email avec les identifiants
            const emailResult = await emailService.sendWelcomeEmail({
                email: user.email,
                displayName: user.display_name || user.email.split('@')[0],
                temporaryPassword: user.password  // Mot de passe stocké directement
            });

            if (emailResult.success) {
                console.log(`📧 Identifiants envoyés à ${user.email}`);
                res.status(200).json({
                    success: true,
                    message: `Les identifiants ont été envoyés à ${user.email}`
                });
            } else {
                res.status(500).json({
                    success: false,
                    error: `Impossible d'envoyer l'email: ${emailResult.error}`
                });
            }
        } catch (error: any) {
            console.error('Erreur envoi identifiants:', error);
            res.status(500).json({
                success: false,
                error: 'Erreur serveur'
            });
        }
    }
);

export default router;
