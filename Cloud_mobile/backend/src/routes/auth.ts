import { Router, Request, Response } from 'express';
import admin, { auth, db } from '../config/firebase.js';

const router = Router();

/**
 * POST /api/auth/verify
 * Vérifie un token Firebase ID Token
 * Body: { idToken: string }
 */
router.post('/verify', async (req: Request, res: Response) => {
  try {
    const { idToken } = req.body;

    if (!idToken) {
      return res.status(400).json({
        success: false,
        error: 'Token manquant',
      });
    }

    // Vérifier le token avec Firebase Admin
    const decodedToken = await auth.verifyIdToken(idToken);
    
    console.log('✅ Token vérifié pour:', decodedToken.email);

    res.json({
      success: true,
      data: {
        uid: decodedToken.uid,
        email: decodedToken.email,
        emailVerified: decodedToken.email_verified,
        name: decodedToken.name || null,
      },
      message: 'Token valide',
    });
  } catch (error: any) {
    console.error('❌ Erreur de vérification du token:', error.message);
    res.status(401).json({
      success: false,
      error: 'Token invalide ou expiré',
      details: error.message,
    });
  }
});

/**
 * POST /api/auth/login
 * Login avec email/password via Firebase
 * Note: Cette route nécessite que l'utilisateur se connecte côté frontend
 * puis envoie son ID Token ici pour vérification
 */
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { idToken } = req.body;

    if (!idToken) {
      return res.status(400).json({
        success: false,
        error: 'ID Token Firebase requis. Connectez-vous d\'abord via le frontend.',
      });
    }

    // Vérifier le token
    const decodedToken = await auth.verifyIdToken(idToken);
    
    // Récupérer les infos utilisateur Firebase
    const userRecord = await auth.getUser(decodedToken.uid);

    // Chercher l'utilisateur dans la collection User_ par email
    const userSnapshot = await db.collection('User_')
      .where('email', '==', userRecord.email)
      .limit(1)
      .get();

    let userData = null;
    if (!userSnapshot.empty) {
      const userDoc = userSnapshot.docs[0];
      userData = {
        docId: userDoc.id,
        ...userDoc.data()
      };
    }

    console.log('✅ Login réussi pour:', userRecord.email);

    res.json({
      success: true,
      data: {
        // Données Firebase Auth
        uid: userRecord.uid,
        email: userRecord.email,
        emailVerified: userRecord.emailVerified,
        // Données Firestore User_
        ...(userData || {}),
      },
      message: 'Connexion réussie',
    });
  } catch (error: any) {
    console.error('❌ Erreur de login:', error.message);
    res.status(401).json({
      success: false,
      error: 'Échec de l\'authentification',
      details: error.message,
    });
  }
});

/**
 * GET /api/auth/user/:uid
 * Récupère les informations d'un utilisateur par son UID
 */
router.get('/user/:uid', async (req: Request, res: Response) => {
  try {
    const { uid } = req.params;

    const userRecord = await auth.getUser(uid);

    res.json({
      success: true,
      data: {
        uid: userRecord.uid,
        email: userRecord.email,
        emailVerified: userRecord.emailVerified,
        displayName: userRecord.displayName,
        disabled: userRecord.disabled,
      },
    });
  } catch (error: any) {
    console.error('❌ Erreur récupération utilisateur:', error.message);
    res.status(404).json({
      success: false,
      error: 'Utilisateur non trouvé',
      details: error.message,
    });
  }
});

/**
 * GET /api/auth/test
 * Test simple de connexion à Firebase Auth
 */
router.get('/test', async (req: Request, res: Response) => {
  try {
    // Lister les utilisateurs (max 1) pour tester la connexion
    const listResult = await auth.listUsers(1);
    
    console.log('✅ Test Firebase Auth réussi');
    
    res.json({
      success: true,
      message: 'Connexion Firebase Auth OK',
      data: {
        totalUsers: listResult.users.length,
        hasUsers: listResult.users.length > 0,
      },
    });
  } catch (error: any) {
    console.error('❌ Erreur test Firebase Auth:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur de connexion à Firebase Auth',
      details: {
        code: error.code,
        message: error.message,
      },
    });
  }
});

/**
 * POST /api/auth/register
 * Créer un utilisateur avec propriétés personnalisées
 * Body: { email, password, nom, prenom, id_type_user }
 */
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { email, password, nom, prenom, id_type_user } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email et mot de passe requis',
      });
    }

    // 1. Créer l'utilisateur dans Firebase Auth
    const userRecord = await auth.createUser({
      email,
      password,
      displayName: `${prenom || ''} ${nom || ''}`.trim(),
    });

    console.log('✅ Utilisateur créé dans Firebase Auth:', userRecord.uid);

    // 2. Générer le prochain ID pour User_
    const usersSnapshot = await db.collection('User_').orderBy('id', 'desc').limit(1).get();
    const nextId = usersSnapshot.empty ? 1 : (usersSnapshot.docs[0].data().id + 1);

    // 3. Créer le profil utilisateur dans Firestore collection User_
    // Structure exacte demandée
    const userProfile = {
      date_creation: new Date(),
      email: email,
      est_bloque: false,
      id: nextId,
      id_type_user: id_type_user || 2, // Par défaut: Utilisateur
      nom: nom || '',
      password: password, // Stocké en clair comme dans la structure
      prenom: prenom || '',
    };

    // Utiliser l'id comme nom de document
    await db.collection('User_').doc(String(nextId)).set(userProfile);

    console.log('✅ Profil utilisateur créé dans User_');

    res.status(201).json({
      success: true,
      data: {
        uid: userRecord.uid,
        ...userProfile,
      },
      message: 'Utilisateur créé avec succès',
    });
  } catch (error: any) {
    console.error('❌ Erreur création utilisateur:', error);
    res.status(500).json({
      success: false,
      error: 'Impossible de créer l\'utilisateur',
      details: error.message,
    });
  }
});

/**
 * GET /api/auth/profile/:uid
 * Récupère le profil complet d'un utilisateur (Auth + Firestore)
 */
router.get('/profile/:uid', async (req: Request, res: Response) => {
  try {
    const { uid } = req.params;

    // 1. Récupérer depuis Firebase Auth
    const userRecord = await auth.getUser(uid);

    // 2. Chercher dans User_ par email
    const userSnapshot = await db.collection('User_')
      .where('email', '==', userRecord.email)
      .limit(1)
      .get();

    if (userSnapshot.empty) {
      return res.status(404).json({
        success: false,
        error: 'Profil utilisateur non trouvé dans User_',
      });
    }

    const userData = userSnapshot.docs[0].data();

    res.json({
      success: true,
      data: {
        // Données Firebase Auth
        uid: userRecord.uid,
        emailVerified: userRecord.emailVerified,
        disabled: userRecord.disabled,
        // Données Firestore User_ (structure exacte)
        date_creation: userData.date_creation,
        email: userData.email,
        est_bloque: userData.est_bloque,
        id: userData.id,
        id_type_user: userData.id_type_user,
        nom: userData.nom,
        prenom: userData.prenom,
        // On ne renvoie pas le password pour des raisons de sécurité
      },
    });
  } catch (error: any) {
    console.error('❌ Erreur récupération profil:', error);
    res.status(500).json({
      success: false,
      error: 'Impossible de récupérer le profil',
      details: error.message,
    });
  }
});

/**
 * PUT /api/auth/profile/:id
 * Met à jour le profil utilisateur dans User_ (par ID document)
 * Body: { nom, prenom, id_type_user, est_bloque, password }
 */
router.put('/profile/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { nom, prenom, id_type_user, est_bloque, password } = req.body;

    const updateData: any = {};
    if (nom !== undefined) updateData.nom = nom;
    if (prenom !== undefined) updateData.prenom = prenom;
    if (id_type_user !== undefined) updateData.id_type_user = id_type_user;
    if (est_bloque !== undefined) updateData.est_bloque = est_bloque;
    if (password !== undefined) updateData.password = password;

    await db.collection('User_').doc(id).update(updateData);

    console.log('✅ Profil utilisateur mis à jour (id:', id, ')');

    res.json({
      success: true,
      message: 'Profil mis à jour',
      data: updateData,
    });
  } catch (error: any) {
    console.error('❌ Erreur mise à jour profil:', error);
    res.status(500).json({
      success: false,
      error: 'Impossible de mettre à jour le profil',
      details: error.message,
    });
  }
});

/**
 * POST /api/auth/set-custom-claims
 * Définir des Custom Claims (rôles) pour un utilisateur
 * Body: { uid, claims: { role: 'manager', id_type_user: 3 } }
 */
router.post('/set-custom-claims', async (req: Request, res: Response) => {
  try {
    const { uid, claims } = req.body;

    if (!uid || !claims) {
      return res.status(400).json({
        success: false,
        error: 'UID et claims requis',
      });
    }

    await auth.setCustomUserClaims(uid, claims);

    console.log('✅ Custom claims définis pour:', uid);

    res.json({
      success: true,
      message: 'Custom claims définis',
    });
  } catch (error: any) {
    console.error('❌ Erreur custom claims:', error);
    res.status(500).json({
      success: false,
      error: 'Impossible de définir les custom claims',
      details: error.message,
    });
  }
});

export default router;
