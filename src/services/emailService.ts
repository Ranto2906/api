/**
 * Service d'envoi d'emails
 * Utilise Nodemailer avec Gmail ou autre SMTP
 */

import * as nodemailer from 'nodemailer';

// ============================================
// INTERFACES
// ============================================

export interface EmailOptions {
    to: string;
    subject: string;
    text?: string;
    html?: string;
}

export interface WelcomeEmailData {
    email: string;
    displayName: string;
    temporaryPassword: string;
    loginUrl?: string;
}

// ============================================
// SERVICE EMAIL
// ============================================

export class EmailService {
    private static instance: EmailService;
    private transporter: nodemailer.Transporter | null = null;

    private constructor() { }

    public static getInstance(): EmailService {
        if (!EmailService.instance) {
            EmailService.instance = new EmailService();
        }
        return EmailService.instance;
    }

    /**
     * Initialise le transporter de manière lazy
     */
    private getTransporter(): nodemailer.Transporter | null {
        if (!this.transporter && process.env.EMAIL_USER && process.env.EMAIL_PASSWORD) {
            this.transporter = nodemailer.createTransport({
                service: process.env.EMAIL_SERVICE || 'gmail',
                auth: {
                    user: process.env.EMAIL_USER,
                    pass: process.env.EMAIL_PASSWORD
                }
            });
            console.log('✅ EmailService: Transporter initialisé');
        }
        return this.transporter;
    }

    /**
     * Vérifie si le service email est configuré
     */
    public isReady(): boolean {
        return !!(process.env.EMAIL_USER && process.env.EMAIL_PASSWORD);
    }

    /**
     * Envoie un email générique
     */
    public async sendEmail(options: EmailOptions): Promise<{ success: boolean; messageId?: string; error?: string }> {
        const transporter = this.getTransporter();

        if (!transporter) {
            console.warn('⚠️ Email non envoyé: service non configuré');
            return { success: false, error: 'Service email non configuré' };
        }

        try {
            const info = await transporter.sendMail({
                from: `"SignalRoute" <${process.env.EMAIL_USER}>`,
                to: options.to,
                subject: options.subject,
                text: options.text,
                html: options.html
            });

            console.log(`✅ Email envoyé à ${options.to}: ${info.messageId}`);
            return { success: true, messageId: info.messageId };
        } catch (error: any) {
            console.error(`❌ Erreur envoi email à ${options.to}:`, error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Envoie un email de bienvenue avec les identifiants
     */
    public async sendWelcomeEmail(data: WelcomeEmailData): Promise<{ success: boolean; error?: string }> {
        const loginUrl = data.loginUrl || process.env.FRONTEND_URL || 'http://localhost:5173';

        const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #f9f9f9; padding: 30px; border: 1px solid #ddd; }
        .credentials { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #667eea; }
        .credentials p { margin: 10px 0; }
        .credentials strong { color: #667eea; }
        .button { display: inline-block; background: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin-top: 20px; }
        .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
        .warning { background: #fff3cd; border: 1px solid #ffc107; padding: 15px; border-radius: 5px; margin-top: 20px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🚧 SignalRoute</h1>
            <p>Bienvenue sur la plateforme</p>
        </div>
        <div class="content">
            <h2>Bonjour ${data.displayName || 'Utilisateur'},</h2>
            <p>Votre compte a été créé avec succès sur la plateforme <strong>SignalRoute</strong>.</p>
            <p>Voici vos identifiants de connexion :</p>
            
            <div class="credentials">
                <p><strong>📧 Email :</strong> ${data.email}</p>
                <p><strong>🔑 Mot de passe temporaire :</strong> ${data.temporaryPassword}</p>
            </div>
            
            <div class="warning">
                <strong>⚠️ Important :</strong> Pour des raisons de sécurité, nous vous recommandons de changer votre mot de passe dès votre première connexion.
            </div>
            
            <center>
                <a href="${loginUrl}" class="button">Se connecter</a>
            </center>
        </div>
        <div class="footer">
            <p>Cet email a été envoyé automatiquement. Merci de ne pas y répondre.</p>
            <p>© ${new Date().getFullYear()} SignalRoute - Tous droits réservés</p>
        </div>
    </div>
</body>
</html>
        `;

        const text = `
Bienvenue sur SignalRoute !

Bonjour ${data.displayName || 'Utilisateur'},

Votre compte a été créé avec succès.

Vos identifiants de connexion :
- Email : ${data.email}
- Mot de passe temporaire : ${data.temporaryPassword}

Connectez-vous ici : ${loginUrl}

⚠️ Important : Changez votre mot de passe dès votre première connexion.

---
Cet email a été envoyé automatiquement.
© ${new Date().getFullYear()} SignalRoute
        `;

        return await this.sendEmail({
            to: data.email,
            subject: '🚧 Bienvenue sur SignalRoute - Vos identifiants',
            html,
            text
        });
    }

    /**
     * Envoie un email de réinitialisation de mot de passe
     */
    public async sendPasswordResetEmail(email: string, resetLink: string): Promise<{ success: boolean; error?: string }> {
        const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #f9f9f9; padding: 30px; border: 1px solid #ddd; }
        .button { display: inline-block; background: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
        .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🔑 Réinitialisation du mot de passe</h1>
        </div>
        <div class="content">
            <p>Vous avez demandé la réinitialisation de votre mot de passe.</p>
            <p>Cliquez sur le bouton ci-dessous pour définir un nouveau mot de passe :</p>
            
            <center>
                <a href="${resetLink}" class="button">Réinitialiser mon mot de passe</a>
            </center>
            
            <p style="color: #666; font-size: 12px; margin-top: 20px;">
                Si vous n'avez pas demandé cette réinitialisation, ignorez cet email.
                Ce lien expire dans 1 heure.
            </p>
        </div>
        <div class="footer">
            <p>© ${new Date().getFullYear()} SignalRoute</p>
        </div>
    </div>
</body>
</html>
        `;

        return await this.sendEmail({
            to: email,
            subject: '🔑 Réinitialisation de votre mot de passe - SignalRoute',
            html
        });
    }
}

export const emailService = EmailService.getInstance();
