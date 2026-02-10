"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const helmet_1 = __importDefault(require("helmet"));
const cors_1 = __importDefault(require("cors"));
const morgan_1 = __importDefault(require("morgan"));
const dotenv_1 = __importDefault(require("dotenv"));
const firebase_1 = require("./config/firebase");
const database_1 = require("./config/database");
const swagger_1 = require("./config/swagger");
const connection_1 = require("./middleware/connection");
const hybridDataService_1 = require("./services/hybridDataService");
const firebase_2 = __importDefault(require("./routes/firebase"));
const auth_1 = __importDefault(require("./routes/auth"));
const admin_1 = __importDefault(require("./routes/admin"));
const signalements_1 = __importDefault(require("./routes/signalements"));
const users_1 = __importDefault(require("./routes/users"));
const config_1 = __importDefault(require("./routes/config"));
const photos_1 = __importDefault(require("./routes/photos"));
const reparations_1 = __importDefault(require("./routes/reparations"));
// Load environment variables
dotenv_1.default.config();
// Initialize Firebase
const firebaseApp = (0, firebase_1.initializeFirebase)();
const firestore = firebaseApp ? (0, firebase_1.getFirestore)() : null;
const firebaseAuth = firebaseApp ? (0, firebase_1.getAuth)() : null;
const app = (0, express_1.default)();
const port = parseInt(process.env.PORT || '3001', 10); // Changé de 3001 à 3001
const nodeEnv = process.env.NODE_ENV || 'development';
// ============================================
// Middleware de sécurité et logging
// ============================================
// Helmet pour les headers de sécurité
app.use((0, helmet_1.default)());
// CORS
app.use((0, cors_1.default)({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
    credentials: true
}));
// Morgan pour les logs
app.use((0, morgan_1.default)('combined'));
// Body parsing
app.use(express_1.default.json({ limit: '10mb' }));
app.use(express_1.default.urlencoded({ limit: '10mb', extended: true }));
// ============================================
// Routes de santé et info
// ============================================
/**
 * GET /health - Health check endpoint
 */
app.get('/health', async (req, res) => {
    const isFirebaseConnected = hybridDataService_1.hybridDataService.isFirebaseAvailableSync();
    const syncStatus = await hybridDataService_1.hybridDataService.getSyncStatus();
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
app.get('/api', async (req, res) => {
    const isFirebaseConnected = hybridDataService_1.hybridDataService.isFirebaseAvailableSync();
    const syncStatus = await hybridDataService_1.hybridDataService.getSyncStatus();
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
(0, swagger_1.setupSwagger)(app, port);
// Middleware de connexion globale (après les routes de santé mais avant les routes API)
app.use('/api', connection_1.connectionMiddleware);
// Auth routes
app.use('/api/auth', auth_1.default);
// Users routes (Manager uniquement - CRUD complet)
app.use('/api/users', users_1.default);
// Admin routes  
app.use('/api/admin', admin_1.default);
// Firebase routes
app.use('/api/firebase', firebase_2.default);
// Signalements routes
app.use('/api/signalements', signalements_1.default);
// Configuration routes (prix, statistiques)
app.use('/api/config', config_1.default);
// Photos routes
app.use('/api/photos', photos_1.default);
// Réparations routes
app.use('/api/reparations', reparations_1.default);
app.use((err, req, res, next) => {
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
app.use((req, res) => {
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
    const dbConnected = await (0, database_1.checkConnection)();
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
exports.default = app;
//# sourceMappingURL=server.js.map