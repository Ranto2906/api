import { Router, Request, Response } from 'express';
import { db } from '../config/firebase.js';
import type { Signalement, SignalementApiResponse, RecapitulatifData } from '../types/signalement.js';
import { STATUS_COLORS, STATUS_LABELS } from '../types/signalement.js';

const router = Router();

/**
 * Convertit un document Firestore en Signalement
 */
const docToSignalement = (doc: FirebaseFirestore.DocumentSnapshot): Signalement => {
  const data = doc.data()!;
  const status = data.status || 'nouveau';

  return {
    id: doc.id,
    latitude: data.latitude ?? null,
    longitude: data.longitude ?? null,
    dateSignalement: data.dateSignalement?.toDate?.() ?? data.createdAt?.toDate?.() ?? null,
    createdAt: data.createdAt?.toDate?.() ?? null,
    status,
    statusLabel: STATUS_LABELS[status as keyof typeof STATUS_LABELS] || status,
    statusCouleur: STATUS_COLORS[status as keyof typeof STATUS_COLORS] || '#999999',
    userId: data.userId ?? null,
    userEmail: data.userEmail ?? null,
    userName: data.userName ?? null,
    surfaceM2: data.surfaceM2 ?? null,
    budget: data.budget ?? null,
    dateDebut: data.dateDebut?.toDate?.() ?? null,
    dateFinPrevue: data.dateFinPrevue?.toDate?.() ?? null,
    commentaire: data.commentaire ?? null,
    entrepriseNom: data.entrepriseNom ?? data.entreprise?.nom ?? null,
    estSynchronise: data.estSynchronise ?? true,
  };
};

/**
 * POST /api/signalements
 * Crée un nouveau signalement
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { latitude, longitude, status, userId, userEmail } = req.body;

    if (latitude == null || longitude == null) {
      return res.status(400).json({
        success: false,
        error: 'Latitude et longitude requises',
      } as SignalementApiResponse);
    }

    const docRef = await db.collection('signalements').add({
      latitude,
      longitude,
      status: status || 'nouveau',
      userId: userId || null,
      userEmail: userEmail || null,
      createdAt: new Date(),
      dateSignalement: new Date(),
      estSynchronise: false,
    });

    res.status(201).json({
      success: true,
      data: { id: docRef.id },
      message: 'Signalement créé avec succès',
    } as SignalementApiResponse);
  } catch (error) {
    console.error('Erreur lors de la création du signalement:', error);
    res.status(500).json({
      success: false,
      error: 'Impossible de créer le signalement',
    } as SignalementApiResponse);
  }
});

/**
 * GET /api/signalements
 * Récupère tous les signalements
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const snapshot = await db.collection('signalements').get();
    const signalements: Signalement[] = snapshot.docs.map(docToSignalement);

    signalements.sort((a, b) => {
      const timeA = a.createdAt?.getTime() ?? 0;
      const timeB = b.createdAt?.getTime() ?? 0;
      return timeB - timeA;
    });

    res.json({
      success: true,
      data: signalements,
      message: `${signalements.length} signalements trouvés`,
    } as SignalementApiResponse);
  } catch (error: any) {
    console.error('❌ Erreur lors de la récupération des signalements:', error);
    console.error('   Type:', typeof error);
    console.error('   Code:', error.code);
    console.error('   Message:', error.message);
    console.error('   Details:', error.details);
    console.error('   Reason:', error.reason);
    console.error('   Domain:', error.domain);
    if (error.errorInfoMetadata) {
      console.error('   Error Info Metadata:', JSON.stringify(error.errorInfoMetadata, null, 2));
    }
    res.status(500).json({
      success: false,
      error: 'Impossible de récupérer les signalements',
      details: {
        code: error.code,
        message: error.message,
        reason: error.reason,
      }
    } as SignalementApiResponse);
  }
});

/**
 * GET /api/signalements/recap
 * Récupère le tableau récapitulatif
 */
router.get('/recap', async (req: Request, res: Response) => {
  try {
    const snapshot = await db.collection('signalements').get();
    const signalements = snapshot.docs.map(docToSignalement);

    const nbSignalements = signalements.length;
    const signalementsAvecReparation = signalements.filter(s => s.surfaceM2 !== null);
    const nbReparations = signalementsAvecReparation.length;
    
    const surfaceTotale = signalementsAvecReparation.reduce(
      (sum, s) => sum + (s.surfaceM2 ?? 0), 0
    );
    
    const budgetTotal = signalementsAvecReparation.reduce(
      (sum, s) => sum + (s.budget ?? 0), 0
    );
    
    const nbTermines = signalements.filter(s => s.status === 'termine').length;
    const avancementPct = nbSignalements > 0 
      ? Math.round((nbTermines / nbSignalements) * 100) 
      : 0;

    const recap: RecapitulatifData = {
      nbSignalements,
      nbReparations,
      surfaceTotale,
      budgetTotal,
      avancementPct,
    };

    res.json({
      success: true,
      data: recap,
    });
  } catch (error) {
    console.error('Erreur lors du calcul du récapitulatif:', error);
    res.status(500).json({
      success: false,
      error: 'Impossible de calculer le récapitulatif',
    });
  }
});

/**
 * GET /api/signalements/:id
 * Récupère un signalement par ID
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const doc = await db.collection('signalements').doc(id).get();

    if (!doc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Signalement non trouvé',
      } as SignalementApiResponse);
    }

    res.json({
      success: true,
      data: docToSignalement(doc),
    } as SignalementApiResponse);
  } catch (error) {
    console.error('Erreur lors de la récupération du signalement:', error);
    res.status(500).json({
      success: false,
      error: 'Impossible de récupérer le signalement',
    } as SignalementApiResponse);
  }
});

/**
 * PATCH /api/signalements/:id
 * Met à jour un signalement (pour le Manager)
 */
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status, surfaceM2, budget, entrepriseNom, commentaire, dateDebut, dateFinPrevue } = req.body;

    const docRef = db.collection('signalements').doc(id);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Signalement non trouvé',
      });
    }

    const updateData: any = { updatedAt: new Date() };
    if (status !== undefined) updateData.status = status;
    if (surfaceM2 !== undefined) updateData.surfaceM2 = surfaceM2;
    if (budget !== undefined) updateData.budget = budget;
    if (entrepriseNom !== undefined) updateData.entrepriseNom = entrepriseNom;
    if (commentaire !== undefined) updateData.commentaire = commentaire;
    if (dateDebut !== undefined) updateData.dateDebut = new Date(dateDebut);
    if (dateFinPrevue !== undefined) updateData.dateFinPrevue = new Date(dateFinPrevue);

    await docRef.update(updateData);

    res.json({
      success: true,
      message: 'Signalement mis à jour',
    });
  } catch (error) {
    console.error('Erreur lors de la mise à jour:', error);
    res.status(500).json({
      success: false,
      error: 'Impossible de mettre à jour le signalement',
    });
  }
});

/**
 * GET /api/signalements/user/:userId
 * Récupère les signalements d'un utilisateur
 */
router.get('/user/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const snapshot = await db
      .collection('signalements')
      .where('userId', '==', userId)
      .get();

    const signalements = snapshot.docs.map(docToSignalement);
    signalements.sort((a, b) => {
      const timeA = a.createdAt?.getTime() ?? 0;
      const timeB = b.createdAt?.getTime() ?? 0;
      return timeB - timeA;
    });

    res.json({
      success: true,
      data: signalements,
      message: `${signalements.length} signalements trouvés`,
    } as SignalementApiResponse);
  } catch (error) {
    console.error('Erreur:', error);
    res.status(500).json({
      success: false,
      error: 'Impossible de récupérer les signalements',
    } as SignalementApiResponse);
  }
});

export default router;
