import express, { Express, Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';
import { initializeFirebase, getFirestore, getAuth } from './config/firebase';
import { checkConnection } from './config/database';
import { setupSwagger } from './config/swagger';
import { connectionMiddleware } from './middleware/connection';
import { hybridDataService } from './services/hybridDataService';
import { syncService } from './services/syncService';
import firebaseRoutes from './routes/firebase';
import authRoutes from './routes/auth';
import adminRoutes from './routes/admin';
import signalementRoutes from './routes/signalements';
import usersRoutes from './routes/users';
import configRoutes from './routes/config';
import photosRoutes from './routes/photos';
import reparationsRoutes from './routes/reparations';

// Load environment variables
dotenv.config();

// Initialize Firebase
const firebaseApp = initializeFirebase();
const firestore = firebaseApp ? getFirestore() : null;
const firebaseAuth = firebaseApp ? getAuth() : null;

const app: Express = express();
const port: number = parseInt(process.env.PORT || '3001', 10); // Changé de 3001 à 3001
const nodeEnv: string = process.env.NODE_ENV || 'development';

// ============================================
// Middleware de sécurité et logging
// ============================================

// Helmet pour les headers de sécurité
app.use(helmet());

// CORS
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  credentials: true
}));

// Morgan pour les logs
app.use(morgan('combined'));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// ============================================
// Routes de santé et info
// ============================================

/**
 * GET /health - Health check endpoint
 */
app.get('/health', async (req: Request, res: Response) => {
  const isFirebaseConnected = hybridDataService.isFirebaseAvailableSync();
  const syncStatus = await hybridDataService.getSyncStatus();

  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    service: 'Travaux Routiers API',
    version: '1.0.0',
    environment: nodeEnv,
    data_sources: {
      firebase: isFirebaseConnected ? '✅ Connected' : '🔴 Offline',
      postgres: '✅ Connected',
      current_mode: isFirebaseConnected ? 'firebase' : 'postgres',
      sync_status: syncStatus
    }
  });
});

/**
 * GET /api - API information and available endpoints
 */
app.get('/api', async (req: Request, res: Response) => {
  const isFirebaseConnected = hybridDataService.isFirebaseAvailableSync();
  const syncStatus = await hybridDataService.getSyncStatus();

  res.status(200).json({
    service: 'Travaux Routiers API',
    version: '1.0.0',
    description: 'API REST pour la gestion des travaux routiers à Antananarivo',
    documentation: '/api/docs',
    architecture: '🔄 Hybrid Firebase/PostgreSQL',
    data_sources: {
      firebase: {
        status: firebaseApp ? '✅ Connected' : '⚠️  Not configured',
        projectId: process.env.FIREBASE_PROJECT_ID || 'Not set',
        online: isFirebaseConnected
      },
      postgres: {
        status: '✅ Connected',
        pending_sync: syncStatus
      },
      current_mode: isFirebaseConnected ? '🔥 Firebase (online)' : '💾 PostgreSQL (offline)'
    },
    endpoints: {
      documentation: 'GET /api/docs',
      auth: {
        register: '⚠️ DÉSACTIVÉ - POST /api/auth/register',
        login: 'POST /api/auth/login',
        logout: 'POST /api/auth/logout',
        me: 'GET /api/auth/me',
        update: 'PUT /api/auth/update',
        verifySession: 'GET /api/auth/verify-session'
      },
      users: {
        description: '🔐 Manager uniquement - CRUD complet des utilisateurs',
        list: 'GET /api/users',
        search: 'GET /api/users/search?q=...',
        getById: 'GET /api/users/:id',
        create: 'POST /api/users',
        update: 'PUT /api/users/:id',
        delete: 'DELETE /api/users/:id',
        block: 'POST /api/users/:id/block',
        unblock: 'POST /api/users/:id/unblock',
        stats: 'GET /api/users/stats/summary'
      },
      admin: {
        users: 'GET /api/admin/users',
        blockedUsers: 'GET /api/admin/users/blocked',
        unblockUser: 'POST /api/admin/users/:id/unblock',
        blockUser: 'POST /api/admin/users/:id/block',
        userAttempts: 'GET /api/admin/users/:id/attempts',
        resetAttempts: 'POST /api/admin/users/:id/reset-attempts',
        parameters: 'GET /api/admin/parameters',
        updateParameters: 'PUT /api/admin/parameters/:typeUserId',
        sessionStats: 'GET /api/admin/sessions/stats',
        sessionCleanup: 'POST /api/admin/sessions/cleanup'
      },
      firebase: {
        verifyToken: 'POST /api/firebase/verify-token',
        createUser: 'POST /api/firebase/create-user',
        syncSignalement: 'POST /api/firebase/sync-signalement',
        getSignalements: 'GET /api/firebase/signalements',
        getSignalementById: 'GET /api/firebase/signalements/:id'
      },
      signalement: {
        list: 'GET /api/signalements',
        create: 'POST /api/signalements',
        getById: 'GET /api/signalements/:id',
        update: 'PUT /api/signalements/:id',
        delete: 'DELETE /api/signalements/:id'
      },
      reparation: {
        list: 'GET /api/reparations',
        create: 'POST /api/reparations',
        getById: 'GET /api/reparations/:id',
        update: 'PUT /api/reparations/:id',
        updateStatus: 'PATCH /api/reparations/:id/status'
      }
    }
  });
});

// ============================================
// Routes
// ============================================

// Documentation Swagger
setupSwagger(app, port);

// Middleware de connexion globale (après les routes de santé mais avant les routes API)
app.use('/api', connectionMiddleware);

// Auth routes
app.use('/api/auth', authRoutes);

// Users routes (Manager uniquement - CRUD complet)
app.use('/api/users', usersRoutes);

// Admin routes  
app.use('/api/admin', adminRoutes);

// Firebase routes
app.use('/api/firebase', firebaseRoutes);

// Signalements routes
app.use('/api/signalements', signalementRoutes);

// Configuration routes (prix, statistiques)
app.use('/api/config', configRoutes);

// Photos routes
app.use('/api/photos', photosRoutes);

// Réparations routes
app.use('/api/reparations', reparationsRoutes);

// ============================================
// Error handling middleware
// ============================================

interface CustomError extends Error {
  status?: number;
  code?: string;
}

app.use((err: CustomError, req: Request, res: Response, next: NextFunction) => {
  console.error('Error:', err);

  const status = err.status || 500;
  const message = err.message || 'Internal Server Error';

  res.status(status).json({
    error: {
      status,
      message,
      timestamp: new Date().toISOString()
    }
  });
});

// ============================================
// 404 Handler
// ============================================

app.use((req: Request, res: Response) => {
  res.status(404).json({
    error: {
      status: 404,
      message: `Route not found: ${req.method} ${req.path}`,
      timestamp: new Date().toISOString()
    }
  });
});

// ============================================
// Server startup
// ============================================

async function startServer() {
  // Vérifier la connexion PostgreSQL
  const dbConnected = await checkConnection();

  app.listen(port, () => {
    console.log(`
╔════════════════════════════════════════════════════╗
║   Travaux Routiers API - Server Started            ║
╠════════════════════════════════════════════════════╣
║ Environment: ${nodeEnv.padEnd(37)}║
║ Port:        ${port.toString().padEnd(37)}║
║ PostgreSQL:  ${(dbConnected ? '✅ Connected' : '❌ Not connected').padEnd(37)}║
║ Firebase:    ${(firebaseApp ? '✅ Connected' : '⚠️  Offline mode').padEnd(37)}║
║ Swagger:     http://localhost:${port}/api/docs${' '.repeat(13)}║
║ Time:        ${new Date().toISOString().padEnd(37)}║
╚════════════════════════════════════════════════════╝
    `);
  });
}

startServer().catch(console.error);

export default app;
