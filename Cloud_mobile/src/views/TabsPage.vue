<template>
  <ion-page>
    <ion-tabs>
      <ion-router-outlet></ion-router-outlet>
      <ion-tab-bar slot="bottom">
        <ion-tab-button tab="map" href="/tabs/map">
          <ion-icon :icon="mapOutline" />
          <ion-label>Carte</ion-label>
        </ion-tab-button>
        <ion-tab-button @click="handleLogout">
          <ion-icon :icon="logOutOutline" />
          <ion-label>Déconnexion</ion-label>
        </ion-tab-button>
      </ion-tab-bar>
    </ion-tabs>
  </ion-page>
</template>

<script setup lang="ts">
import { IonTabBar, IonTabButton, IonTabs, IonLabel, IonIcon, IonPage, IonRouterOutlet } from '@ionic/vue';
import { mapOutline, logOutOutline } from 'ionicons/icons';
import { useRouter } from 'vue-router';
import { signOut } from 'firebase/auth';
import { auth } from '@/Firebase/FirebaseConfig';

const router = useRouter();

const handleLogout = async () => {
  try {
    await signOut(auth);
    router.replace('/login');
  } catch (error) {
    console.error('Erreur lors de la déconnexion:', error);
  }
};
</script>

<style scoped>
ion-tab-bar {
  --background: #ffffff;
  --border: 1px solid #e0e0e0;
  height: 56px;
  box-shadow: 0 -2px 10px rgba(0, 0, 0, 0.05);
}

ion-tab-button {
  --color: #999;
  --color-selected: #3880ff;
}

ion-tab-button ion-icon {
  font-size: 22px;
}

ion-tab-button ion-label {
  font-size: 11px;
  font-weight: 500;
}
</style>
