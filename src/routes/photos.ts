import { Router, Request, Response } from 'express';
import { body, param, validationResult } from 'express-validator';
import { authMiddleware, managerMiddleware } from '../middleware/auth';
import pool from '../config/database';
import { hybridDataService } from '../services/hybridDataService';
import { getFirestore } from '../config/firebase';
import * as admin from 'firebase-admin';

const router = Router();

// ============================================
// GESTION DES PHOTOS - CLOUDINARY
// ============================================

/**
 * @swagger
 * /api/photos/signalement/{id}:
 *   get:
 *     summary: Obtenir les photos d'un signalement
 *     tags: [Photos]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID du signalement
 *     responses:
 *       200:
 *         description: Liste des photos
 */
router.get('/signalement/:id',
    [param('id').isInt({ min: 1 }).withMessage('ID signalement invalide')],
    async (req: Request, res: Response): Promise<void> => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                res.status(400).json({ success: false, errors: errors.array() });
                return;
            }

            const signalementId = parseInt(req.params.id, 10);

            // Vérifier que le signalement existe
            const signalementCheck = await pool.query(
                'SELECT id_signalement FROM Signalement WHERE id_signalement = $1',
                [signalementId]
            );

            if (signalementCheck.rows.length === 0) {
                res.status(404).json({ success: false, error: 'Signalement non trouvé' });
                return;
            }

            // Récupérer les photos
            const result = await pool.query(`
                SELECT 
                    p.Id_photo,
                    p.Id_signalement,
                    p.url,
                    p.cloudinary_public_id,
                    p.file_name,
                    p.path,
                    p.mime_type,
                    p.taille_octets,
                    p.largeur,
                    p.hauteur,
                    p.uploaded_at,
                    p.firebase_id
                FROM Photo p
                WHERE p.Id_signalement = $1
                ORDER BY p.uploaded_at DESC
            `, [signalementId]);

            res.status(200).json({
                success: true,
                signalement_id: signalementId,
                count: result.rows.length,
                photos: result.rows
            });
        } catch (error: any) {
            console.error('Erreur récupération photos:', error);
            res.status(500).json({ success: false, error: 'Erreur serveur' });
        }
    }
);

/**
 * @swagger
 * /api/photos/signalement/{id}:
 *   post:
 *     summary: Ajouter une photo à un signalement (depuis Cloudinary)
 *     description: Enregistre les métadonnées d'une photo déjà uploadée sur Cloudinary
 *     tags: [Photos]
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
 *               - url
 *             properties:
 *               url:
 *                 type: string
 *                 example: "https://res.cloudinary.com/ddzceygkn/image/upload/v1770711297/signalements/..."
 *               cloudinary_public_id:
 *                 type: string
 *                 example: "signalements/tOSASTTSVzXyKmYAvZPB/w1iEk6R25cWPQPUF8W23giXbu2E3_1770..."
 *               file_name:
 *                 type: string
 *                 example: "w1iEk6R25cWPQPUF8W23giXbu2E3_1770711296102_fsr9dt"
 *               path:
 *                 type: string
 *                 example: "signalements/tOSASTTSVzXyKmYAvZPB/..."
 *               taille_octets:
 *                 type: integer
 *               largeur:
 *                 type: integer
 *               hauteur:
 *                 type: integer
 *     responses:
 *       201:
 *         description: Photo ajoutée
 */
router.post('/signalement/:id',
    authMiddleware,
    [
        param('id').isInt({ min: 1 }).withMessage('ID signalement invalide'),
        body('url').isURL().withMessage('URL invalide'),
        body('cloudinary_public_id').optional().isString(),
        body('file_name').optional().isString(),
        body('path').optional().isString(),
        body('taille_octets').optional().isInt({ min: 0 }),
        body('largeur').optional().isInt({ min: 0 }),
        body('hauteur').optional().isInt({ min: 0 })
    ],
    async (req: Request, res: Response): Promise<void> => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                res.status(400).json({ success: false, errors: errors.array() });
                return;
            }

            const signalementId = parseInt(req.params.id, 10);
            const { url, cloudinary_public_id, file_name, path, taille_octets, largeur, hauteur } = req.body;

            // Vérifier que le signalement existe
            const signalementCheck = await pool.query(
                'SELECT id_signalement, firebase_id FROM Signalement WHERE id_signalement = $1',
                [signalementId]
            );

            if (signalementCheck.rows.length === 0) {
                res.status(404).json({ success: false, error: 'Signalement non trouvé' });
                return;
            }

            // Insérer la photo
            const result = await pool.query(`
                INSERT INTO Photo (
                    Id_signalement, url, cloudinary_public_id, file_name, 
                    path, taille_octets, largeur, hauteur
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                RETURNING *
            `, [
                signalementId, url, cloudinary_public_id || null, file_name || null,
                path || null, taille_octets || null, largeur || null, hauteur || null
            ]);

            const photo = result.rows[0];

            // Synchroniser vers Firebase si disponible
            const isOnline = await hybridDataService.isFirebaseAvailable();
            if (isOnline && signalementCheck.rows[0].firebase_id) {
                try {
                    const db = getFirestore();
                    const signalementRef = db.collection('signalements').doc(signalementCheck.rows[0].firebase_id);

                    // Ajouter la photo au tableau photos du signalement
                    await signalementRef.update({
                        photos: admin.firestore.FieldValue.arrayUnion({
                            id_photo: photo.id_photo,
                            url: url,
                            fileName: file_name,
                            path: path,
                            uploadedAt: new Date()
                        }),
                        updated_at: admin.firestore.FieldValue.serverTimestamp()
                    });

                    // Marquer comme synchronisé
                    await pool.query(
                        'UPDATE Photo SET est_synchronise = TRUE, firebase_id = $1 WHERE Id_photo = $2',
                        [signalementCheck.rows[0].firebase_id, photo.id_photo]
                    );

                    console.log(`✅ Photo ${photo.id_photo} synchronisée avec Firebase`);
                } catch (fbError: any) {
                    console.warn('⚠️ Erreur sync photo Firebase:', fbError.message);
                }
            }

            res.status(201).json({
                success: true,
                message: 'Photo ajoutée avec succès',
                photo: photo
            });
        } catch (error: any) {
            console.error('Erreur ajout photo:', error);
            res.status(500).json({ success: false, error: 'Erreur serveur' });
        }
    }
);

/**
 * @swagger
 * /api/photos/signalement/{id}/sync-firebase:
 *   post:
 *     summary: Synchroniser les photos depuis Firebase vers PostgreSQL
 *     description: Récupère les photos stockées dans Firebase et les importe dans la base locale
 *     tags: [Photos]
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
 *         description: Photos synchronisées
 */
router.post('/signalement/:id/sync-firebase',
    authMiddleware,
    [param('id').isInt({ min: 1 }).withMessage('ID signalement invalide')],
    async (req: Request, res: Response): Promise<void> => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                res.status(400).json({ success: false, errors: errors.array() });
                return;
            }

            const signalementId = parseInt(req.params.id, 10);

            // Vérifier que le signalement existe et a un firebase_id
            const signalementCheck = await pool.query(
                'SELECT id_signalement, firebase_id FROM Signalement WHERE id_signalement = $1',
                [signalementId]
            );

            if (signalementCheck.rows.length === 0) {
                res.status(404).json({ success: false, error: 'Signalement non trouvé' });
                return;
            }

            const firebaseId = signalementCheck.rows[0].firebase_id;
            if (!firebaseId) {
                res.status(400).json({ success: false, error: 'Signalement non synchronisé avec Firebase' });
                return;
            }

            const isOnline = await hybridDataService.isFirebaseAvailable();
            if (!isOnline) {
                res.status(503).json({ success: false, error: 'Firebase non disponible' });
                return;
            }

            const db = getFirestore();
            const signalementDoc = await db.collection('signalements').doc(firebaseId).get();

            if (!signalementDoc.exists) {
                res.status(404).json({ success: false, error: 'Signalement non trouvé dans Firebase' });
                return;
            }

            const data = signalementDoc.data();
            const firebasePhotos = data?.photos || [];
            let imported = 0;
            let skipped = 0;

            for (const photo of firebasePhotos) {
                // Vérifier si la photo existe déjà (par URL)
                const existsCheck = await pool.query(
                    'SELECT Id_photo FROM Photo WHERE Id_signalement = $1 AND url = $2',
                    [signalementId, photo.url]
                );

                if (existsCheck.rows.length > 0) {
                    skipped++;
                    continue;
                }

                // Importer la photo
                await pool.query(`
                    INSERT INTO Photo (
                        Id_signalement, url, cloudinary_public_id, file_name, 
                        path, firebase_id, est_synchronise, uploaded_at
                    )
                    VALUES ($1, $2, $3, $4, $5, $6, TRUE, $7)
                `, [
                    signalementId,
                    photo.url,
                    photo.path || null,
                    photo.fileName || null,
                    photo.path || null,
                    firebaseId,
                    photo.uploadedAt?.toDate?.() || new Date()
                ]);

                imported++;
            }

            res.status(200).json({
                success: true,
                message: `Synchronisation terminée: ${imported} importées, ${skipped} déjà présentes`,
                imported,
                skipped,
                total_firebase: firebasePhotos.length
            });
        } catch (error: any) {
            console.error('Erreur sync photos Firebase:', error);
            res.status(500).json({ success: false, error: 'Erreur serveur' });
        }
    }
);

/**
 * @swagger
 * /api/photos/{id}:
 *   delete:
 *     summary: Supprimer une photo
 *     tags: [Photos]
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
 *         description: Photo supprimée
 */
router.delete('/:id',
    authMiddleware,
    managerMiddleware,
    [param('id').isInt({ min: 1 }).withMessage('ID photo invalide')],
    async (req: Request, res: Response): Promise<void> => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                res.status(400).json({ success: false, errors: errors.array() });
                return;
            }

            const photoId = parseInt(req.params.id, 10);

            // Récupérer les infos de la photo avant suppression
            const photoCheck = await pool.query(
                'SELECT p.*, s.firebase_id as signalement_firebase_id FROM Photo p JOIN Signalement s ON p.Id_signalement = s.Id_signalement WHERE p.Id_photo = $1',
                [photoId]
            );

            if (photoCheck.rows.length === 0) {
                res.status(404).json({ success: false, error: 'Photo non trouvée' });
                return;
            }

            const photo = photoCheck.rows[0];

            // Supprimer de PostgreSQL
            await pool.query('DELETE FROM Photo WHERE Id_photo = $1', [photoId]);

            // Supprimer de Firebase si possible
            const isOnline = await hybridDataService.isFirebaseAvailable();
            if (isOnline && photo.signalement_firebase_id) {
                try {
                    const db = getFirestore();
                    const signalementRef = db.collection('signalements').doc(photo.signalement_firebase_id);

                    // Retirer la photo du tableau
                    const doc = await signalementRef.get();
                    if (doc.exists) {
                        const photos = doc.data()?.photos || [];
                        const updatedPhotos = photos.filter((p: any) => p.url !== photo.url);
                        await signalementRef.update({
                            photos: updatedPhotos,
                            updated_at: admin.firestore.FieldValue.serverTimestamp()
                        });
                    }
                } catch (fbError: any) {
                    console.warn('⚠️ Erreur suppression photo Firebase:', fbError.message);
                }
            }

            res.status(200).json({
                success: true,
                message: 'Photo supprimée avec succès'
            });
        } catch (error: any) {
            console.error('Erreur suppression photo:', error);
            res.status(500).json({ success: false, error: 'Erreur serveur' });
        }
    }
);

/**
 * @swagger
 * /api/photos/bulk:
 *   post:
 *     summary: Ajouter plusieurs photos à un signalement
 *     tags: [Photos]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - signalement_id
 *               - photos
 *             properties:
 *               signalement_id:
 *                 type: integer
 *               photos:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     url:
 *                       type: string
 *                     fileName:
 *                       type: string
 *                     path:
 *                       type: string
 *                     uploadedAt:
 *                       type: string
 *     responses:
 *       201:
 *         description: Photos ajoutées
 */
router.post('/bulk',
    authMiddleware,
    [
        body('signalement_id').isInt({ min: 1 }).withMessage('ID signalement invalide'),
        body('photos').isArray({ min: 1 }).withMessage('Au moins une photo requise'),
        body('photos.*.url').isURL().withMessage('URL photo invalide')
    ],
    async (req: Request, res: Response): Promise<void> => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                res.status(400).json({ success: false, errors: errors.array() });
                return;
            }

            const { signalement_id, photos } = req.body;

            // Vérifier que le signalement existe
            const signalementCheck = await pool.query(
                'SELECT id_signalement FROM Signalement WHERE id_signalement = $1',
                [signalement_id]
            );

            if (signalementCheck.rows.length === 0) {
                res.status(404).json({ success: false, error: 'Signalement non trouvé' });
                return;
            }

            const insertedPhotos = [];
            for (const photo of photos) {
                const result = await pool.query(`
                    INSERT INTO Photo (Id_signalement, url, file_name, path, uploaded_at)
                    VALUES ($1, $2, $3, $4, $5)
                    ON CONFLICT DO NOTHING
                    RETURNING *
                `, [
                    signalement_id,
                    photo.url,
                    photo.fileName || null,
                    photo.path || null,
                    photo.uploadedAt ? new Date(photo.uploadedAt) : new Date()
                ]);

                if (result.rows.length > 0) {
                    insertedPhotos.push(result.rows[0]);
                }
            }

            res.status(201).json({
                success: true,
                message: `${insertedPhotos.length} photo(s) ajoutée(s)`,
                photos: insertedPhotos
            });
        } catch (error: any) {
            console.error('Erreur ajout photos bulk:', error);
            res.status(500).json({ success: false, error: 'Erreur serveur' });
        }
    }
);

export default router;
