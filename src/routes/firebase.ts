import { Router, Request, Response } from 'express';
import * as admin from 'firebase-admin';
import pool from '../config/database';
import { authMiddleware, managerMiddleware } from '../middleware/auth';
import { emailService } from '../services/emailService';

const router = Router();

/**
 * POST /api/firebase/verify-token
 * Vérifie un token Firebase et retourne les données utilisateur
 */
router.post('/verify-token', async (req: Request, res: Response): Promise<void> => {
  try {
    const { idToken } = req.body;

    if (!idToken) {
      res.status(400).json({
        error: 'ID token is required'
      });
      return;
    }

    // Vérifie le token Firebase
    const decodedToken = await admin.auth().verifyIdToken(idToken);

    res.status(200).json({
      success: true,
      user: {
        uid: decodedToken.uid,
        email: decodedToken.email,
        name: decodedToken.name,
        emailVerified: decodedToken.email_verified,
        issuedAtTime: decodedToken.iat
      }
    });
  } catch (error: any) {
    console.error('Firebase token verification error:', error);
    res.status(401).json({
      error: 'Invalid or expired token',
      details: error.message
    });
  }
});

/**
 * POST /api/firebase/create-user
 * Crée un utilisateur dans Firebase Authentication et envoie optionnellement un email
 * @body {string} email - Email de l'utilisateur (requis)
 * @body {string} password - Mot de passe (requis)
 * @body {string} displayName - Nom d'affichage
 * @body {string} phoneNumber - Numéro de téléphone
 * @body {boolean} sendEmail - Envoyer un email avec les identifiants (défaut: true)
 */
router.post('/create-user', authMiddleware, managerMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password, displayName, phoneNumber, sendEmail = true } = req.body;

    if (!email || !password) {
      res.status(400).json({
        error: 'Email and password are required'
      });
      return;
    }

    // Crée l'utilisateur dans Firebase Auth
    const userRecord = await admin.auth().createUser({
      email,
      password,
      displayName,
      phoneNumber
    });

    console.log(`✅ Utilisateur Firebase créé: ${userRecord.uid} (${email})`);

    // Envoyer l'email de bienvenue si demandé
    let emailSent = false;
    let emailError = null;

    if (sendEmail) {
      const emailResult = await emailService.sendWelcomeEmail({
        email,
        displayName: displayName || email.split('@')[0],
        temporaryPassword: password
      });

      emailSent = emailResult.success;
      emailError = emailResult.error;

      if (emailSent) {
        console.log(`📧 Email de bienvenue envoyé à ${email}`);
      } else {
        console.warn(`⚠️ Impossible d'envoyer l'email à ${email}: ${emailError}`);
      }
    }

    res.status(201).json({
      success: true,
      user: {
        uid: userRecord.uid,
        email: userRecord.email,
        displayName: userRecord.displayName,
        phoneNumber: userRecord.phoneNumber,
        createdAt: userRecord.metadata.creationTime
      },
      email: {
        sent: emailSent,
        error: emailError
      }
    });
  } catch (error: any) {
    console.error('Firebase user creation error:', error);
    res.status(400).json({
      error: 'Failed to create user',
      details: error.message
    });
  }
});

/**
 * POST /api/firebase/sync-signalement
 * Synchronise un signalement de PostgreSQL vers Firestore
 */
router.post('/sync-signalement', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id_signalement, id_user, description, gps_lat, gps_lng, photo_url, date_creation } = req.body;

    if (!id_signalement || !id_user) {
      res.status(400).json({
        error: 'id_signalement and id_user are required'
      });
      return;
    }

    // Ajoute le signalement à Firestore
    const signalementRef = admin.firestore().collection('signalements').doc(id_signalement.toString());

    await signalementRef.set({
      id_signalement,
      id_user,
      description,
      location: new admin.firestore.GeoPoint(gps_lat, gps_lng),
      photoUrl: photo_url,
      timestamp: admin.firestore.Timestamp.fromDate(new Date(date_creation || new Date())),
      syncedAt: admin.firestore.FieldValue.serverTimestamp(),
      status: 'new'
    }, { merge: true });

    res.status(200).json({
      success: true,
      message: 'Signalement synchronized to Firestore',
      documentId: id_signalement
    });
  } catch (error: any) {
    console.error('Firestore sync error:', error);
    res.status(400).json({
      error: 'Failed to sync signalement',
      details: error.message
    });
  }
});

/**
 * GET /api/firebase/signalements
 * Récupère tous les signalements depuis Firestore
 */
router.get('/signalements', async (req: Request, res: Response) => {
  try {
    const snapshot = await admin.firestore().collection('signalements').get();

    const signalements = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    res.status(200).json({
      success: true,
      count: signalements.length,
      signalements
    });
  } catch (error: any) {
    console.error('Firestore query error:', error);
    res.status(400).json({
      error: 'Failed to fetch signalements',
      details: error.message
    });
  }
});

/**
 * GET /api/firebase/signalements/:id
 * Récupère un signalement spécifique depuis Firestore
 */
router.get('/signalements/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const doc = await admin.firestore().collection('signalements').doc(id).get();

    if (!doc.exists) {
      res.status(404).json({
        error: 'Signalement not found'
      });
      return;
    }

    res.status(200).json({
      success: true,
      signalement: {
        id: doc.id,
        ...doc.data()
      }
    });
  } catch (error: any) {
    console.error('Firestore query error:', error);
    res.status(400).json({
      error: 'Failed to fetch signalement',
      details: error.message
    });
  }
});

/**
 * POST /api/firebase/sync/signalements
 * Synchronise les signalements de PostgreSQL vers Firebase
 * Accessible uniquement aux Managers
 */
router.post('/sync/signalements', authMiddleware, managerMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    // Récupérer les signalements non synchronisés
    const query = `
      SELECT s.id_signalement, s.description, s.date_signalement, s.firebase_id, s.id_user, s.id_status,
             ST_X(s.location) as longitude, ST_Y(s.location) as latitude,
             u.email, u.display_name, st.libelle as status_libelle
      FROM Signalement s
      JOIN user_ u ON s.id_user = u.id_user
      JOIN Status st ON s.id_status = st.id_status
      WHERE s.est_synchronise = FALSE
    `;

    const result = await pool.query(query);
    const signalements = result.rows;

    let syncedCount = 0;
    const batch = admin.firestore().batch();

    for (const signalement of signalements) {
      try {
        // Créer ou mettre à jour dans Firebase
        const docRef = admin.firestore().collection('signalements').doc();
        const firebaseData = {
          location: signalement.longitude && signalement.latitude ? {
            latitude: parseFloat(signalement.latitude),
            longitude: parseFloat(signalement.longitude)
          } : null,
          description: signalement.description,
          date_signalement: signalement.date_signalement,
          user: {
            id: signalement.id_user,
            email: signalement.email,
            nom: signalement.nom,
            prenom: signalement.prenom
          },
          status: {
            id: signalement.id_status,
            libelle: signalement.status_libelle
          },
          synchronized_at: admin.firestore.FieldValue.serverTimestamp()
        };

        batch.set(docRef, firebaseData);

        // Mettre à jour PostgreSQL avec l'ID Firebase
        await pool.query(
          'UPDATE Signalement SET firebase_id = $1, est_synchronise = TRUE WHERE id_signalement = $2',
          [docRef.id, signalement.id_signalement]
        );

        syncedCount++;
      } catch (itemError: any) {
        console.error(`Erreur sync signalement ${signalement.id_signalement}:`, itemError);
      }
    }

    // Valider le batch Firebase
    if (syncedCount > 0) {
      await batch.commit();
    }

    res.status(200).json({
      success: true,
      synced: syncedCount,
      total: signalements.length
    });
  } catch (error: any) {
    console.error('Erreur synchronisation signalements:', error);
    res.status(500).json({
      error: 'Échec de la synchronisation des signalements',
      details: error.message
    });
  }
});

/**
 * POST /api/firebase/sync/users
 * Synchronise les utilisateurs de PostgreSQL vers Firebase
 * Accessible uniquement aux Managers
 */
router.post('/sync/users', authMiddleware, managerMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    // Récupérer les utilisateurs sans firebase_uid
    const query = `
      SELECT u.*, t.libelle as type_libelle
      FROM user_ u
      JOIN typeuser t ON u.id_type_user = t.id_type_user
      WHERE u.firebase_uid IS NULL
    `;

    const result = await pool.query(query);
    const users = result.rows;

    let syncedCount = 0;

    for (const user of users) {
      try {
        // Créer l'utilisateur dans Firebase Auth
        const firebaseUser = await admin.auth().createUser({
          email: user.email,
          displayName: `${user.prenom} ${user.nom}`,
          disabled: user.est_bloque
        });

        // Créer le document utilisateur dans Firestore
        await admin.firestore().collection('users').doc(firebaseUser.uid).set({
          nom: user.nom,
          prenom: user.prenom,
          email: user.email,
          type: {
            id: user.id_type_user,
            libelle: user.type_libelle
          },
          date_creation: user.date_creation,
          est_bloque: user.est_bloque,
          synchronized_at: admin.firestore.FieldValue.serverTimestamp()
        });

        // Mettre à jour PostgreSQL avec l'UID Firebase
        await pool.query(
          'UPDATE user_ SET firebase_uid = $1 WHERE id_user = $2',
          [firebaseUser.uid, user.id_user]
        );

        syncedCount++;
      } catch (itemError: any) {
        console.error(`Erreur sync utilisateur ${user.id_user}:`, itemError);
      }
    }

    res.status(200).json({
      success: true,
      synced: syncedCount,
      total: users.length
    });
  } catch (error: any) {
    console.error('Erreur synchronisation utilisateurs:', error);
    res.status(500).json({
      error: 'Échec de la synchronisation des utilisateurs',
      details: error.message
    });
  }
});

/**
 * GET /api/firebase/status
 * Vérifier le statut de connexion Firebase
 */
router.get('/status', async (req: Request, res: Response): Promise<void> => {
  try {
    // Test simple de connexion à Firebase
    await admin.firestore().collection('_health').add({
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });

    res.status(200).json({
      connected: true,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('Erreur connexion Firebase:', error);
    res.status(200).json({
      connected: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /api/firebase/sync-status
 * Récupère le statut de synchronisation
 * Accessible uniquement aux Managers
 */
router.get('/sync-status', authMiddleware, managerMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    // Compter les signalements non synchronisés
    const signalementResult = await pool.query(
      'SELECT COUNT(*) as count FROM Signalement WHERE est_synchronise = FALSE'
    );

    // Compter les utilisateurs sans firebase_uid
    const userResult = await pool.query(
      'SELECT COUNT(*) as count FROM user_ WHERE firebase_uid IS NULL'
    );

    // Dernière synchronisation
    const lastSyncResult = await pool.query(`
      SELECT MAX(CASE WHEN firebase_id IS NOT NULL THEN date_signalement END) as last_signalement_sync
      FROM Signalement
    `);

    res.status(200).json({
      pending_signalements: parseInt(signalementResult.rows[0].count),
      pending_users: parseInt(userResult.rows[0].count),
      last_sync: lastSyncResult.rows[0].last_signalement_sync,
      needs_sync: parseInt(signalementResult.rows[0].count) > 0 || parseInt(userResult.rows[0].count) > 0
    });
  } catch (error: any) {
    console.error('Erreur statut synchronisation:', error);
    res.status(500).json({
      error: 'Échec de récupération du statut',
      details: error.message
    });
  }
});

export default router;
