<template>
  <ion-page>
    <ion-content :fullscreen="true" class="auth-content">
      <div class="auth-container">
        <!-- Logo et titre -->
        <div class="auth-header">
          <div class="logo">
            <ion-icon :icon="constructOutline" />
          </div>
          <h1>Travaux Routiers</h1>
          <p class="subtitle">Antananarivo - Signalement Mobile</p>
        </div>

        <!-- Card de connexion -->
        <div class="auth-card">
          <h2>{{ isLogin ? 'Connexion' : 'Inscription' }}</h2>
          
          <div class="form-group">
            <label>Email</label>
            <div class="input-wrapper">
              <ion-icon :icon="mailOutline" />
              <ion-input
                v-model="email"
                type="email"
                placeholder="votre@email.com"
                :clear-input="true"
              />
            </div>
          </div>

          <div class="form-group">
            <label>Mot de passe</label>
            <div class="input-wrapper">
              <ion-icon :icon="lockClosedOutline" />
              <ion-input
                v-model="password"
                :type="showPassword ? 'text' : 'password'"
                placeholder="••••••••"
              />
              <ion-button fill="clear" size="small" @click="showPassword = !showPassword">
                <ion-icon :icon="showPassword ? eyeOffOutline : eyeOutline" />
              </ion-button>
            </div>
          </div>

          <!-- Message d'erreur -->
          <div v-if="errorMessage" class="error-message">
            <ion-icon :icon="alertCircleOutline" />
            <span>{{ errorMessage }}</span>
          </div>

          <!-- Boutons -->
          <ion-button 
            expand="block" 
            class="primary-btn"
            @click="handleSubmit"
            :disabled="loading"
          >
            <ion-spinner v-if="loading" name="dots" />
            <span v-else>{{ isLogin ? 'Se connecter' : 'Créer mon compte' }}</span>
          </ion-button>

          <div class="switch-mode">
            <span>{{ isLogin ? 'Pas encore de compte ?' : 'Déjà un compte ?' }}</span>
            <ion-button fill="clear" size="small" @click="isLogin = !isLogin">
              {{ isLogin ? 'Inscription' : 'Connexion' }}
            </ion-button>
          </div>
        </div>

        <!-- Footer -->
        <p class="footer-text">Projet Cloud S5 - ITU Promotion 17</p>
      </div>

      <ion-toast
        :is-open="toastVisible"
        :message="toastMessage"
        :color="toastColor"
        :duration="3000"
        position="top"
        @didDismiss="toastVisible = false"
      />
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import {
  IonPage, IonContent, IonInput, IonButton, IonIcon, IonSpinner, IonToast
} from '@ionic/vue';
import {
  constructOutline, mailOutline, lockClosedOutline,
  eyeOutline, eyeOffOutline, alertCircleOutline
} from 'ionicons/icons';
import { auth } from '@/Firebase/FirebaseConfig';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged
} from 'firebase/auth';

const router = useRouter();

// State
const email = ref('');
const password = ref('');
const showPassword = ref(false);
const isLogin = ref(true);
const loading = ref(false);
const errorMessage = ref('');

// Toast
const toastVisible = ref(false);
const toastMessage = ref('');
const toastColor = ref('success');

const showToast = (message: string, color = 'success') => {
  toastMessage.value = message;
  toastColor.value = color;
  toastVisible.value = true;
};

const handleSubmit = async () => {
  errorMessage.value = '';
  
  // Validation
  if (!email.value.trim()) {
    errorMessage.value = 'Veuillez entrer votre email';
    return;
  }
  if (!email.value.includes('@')) {
    errorMessage.value = 'Email invalide';
    return;
  }
  if (password.value.length < 6) {
    errorMessage.value = 'Mot de passe: 6 caractères minimum';
    return;
  }

  loading.value = true;

  try {
    if (isLogin.value) {
      await signInWithEmailAndPassword(auth, email.value, password.value);
      showToast('Connexion réussie !');
    } else {
      await createUserWithEmailAndPassword(auth, email.value, password.value);
      showToast('Compte créé avec succès !');
    }
    setTimeout(() => router.replace('/tabs/map'), 500);
  } catch (error: any) {
    console.error('Auth error:', error);
    switch (error.code) {
      case 'auth/email-already-in-use':
        errorMessage.value = 'Cet email est déjà utilisé';
        break;
      case 'auth/invalid-credential':
      case 'auth/wrong-password':
      case 'auth/user-not-found':
        errorMessage.value = 'Email ou mot de passe incorrect';
        break;
      case 'auth/too-many-requests':
        errorMessage.value = 'Trop de tentatives. Réessayez plus tard';
        break;
      case 'auth/network-request-failed':
        errorMessage.value = 'Erreur réseau. Vérifiez votre connexion';
        break;
      case 'auth/configuration-not-found':
        errorMessage.value = 'Authentification non configurée sur Firebase';
        break;
      default:
        errorMessage.value = error.message || 'Erreur de connexion';
    }
  } finally {
    loading.value = false;
  }
};

onMounted(() => {
  onAuthStateChanged(auth, (user) => {
    if (user) {
      router.replace('/tabs/map');
    }
  });
});
</script>

<style scoped>
.auth-content {
  --background: #f5f7fa;
}

.auth-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-height: 100%;
  padding: 40px 20px;
}

.auth-header {
  text-align: center;
  margin-bottom: 32px;
}

.logo {
  width: 72px;
  height: 72px;
  background: linear-gradient(135deg, #3880ff 0%, #5260ff 100%);
  border-radius: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 16px;
  box-shadow: 0 8px 24px rgba(56, 128, 255, 0.3);
}

.logo ion-icon {
  font-size: 36px;
  color: white;
}

.auth-header h1 {
  font-size: 26px;
  font-weight: 700;
  color: #1a1a2e;
  margin: 0;
}

.subtitle {
  color: #666;
  font-size: 14px;
  margin: 4px 0 0;
}

.auth-card {
  width: 100%;
  max-width: 380px;
  background: white;
  border-radius: 16px;
  padding: 28px 24px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
}

.auth-card h2 {
  font-size: 20px;
  font-weight: 600;
  color: #1a1a2e;
  margin: 0 0 24px;
  text-align: center;
}

.form-group {
  margin-bottom: 18px;
}

.form-group label {
  display: block;
  font-size: 13px;
  font-weight: 500;
  color: #555;
  margin-bottom: 8px;
}

.input-wrapper {
  display: flex;
  align-items: center;
  background: #f5f7fa;
  border: 2px solid #e8ecf0;
  border-radius: 10px;
  padding: 0 12px;
  transition: border-color 0.2s;
}

.input-wrapper:focus-within {
  border-color: #3880ff;
}

.input-wrapper ion-icon {
  font-size: 20px;
  color: #999;
  margin-right: 10px;
}

.input-wrapper ion-input {
  --padding-start: 0;
  --padding-end: 0;
  flex: 1;
}

.input-wrapper ion-button {
  --padding-start: 8px;
  --padding-end: 8px;
  margin: 0;
}

.error-message {
  display: flex;
  align-items: center;
  gap: 8px;
  background: #fff2f2;
  color: #e74c3c;
  padding: 10px 14px;
  border-radius: 8px;
  font-size: 13px;
  margin-bottom: 16px;
}

.error-message ion-icon {
  font-size: 18px;
  flex-shrink: 0;
}

.primary-btn {
  --background: linear-gradient(135deg, #3880ff 0%, #5260ff 100%);
  --border-radius: 10px;
  height: 48px;
  font-weight: 600;
  margin-top: 8px;
}

.switch-mode {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 20px;
  font-size: 13px;
  color: #666;
}

.switch-mode ion-button {
  --color: #3880ff;
  font-weight: 600;
}

.footer-text {
  margin-top: auto;
  padding-top: 32px;
  font-size: 12px;
  color: #999;
}
</style>
