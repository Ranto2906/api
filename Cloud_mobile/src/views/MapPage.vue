<template>
  <ion-page>
    <ion-header class="ion-no-border">
      <ion-toolbar>
        <ion-title>
          <div class="header-content">
            <ion-icon :icon="mapOutline" />
            <span>Travaux Routiers - Tana</span>
          </div>
        </ion-title>
        <ion-buttons slot="end">
          <ion-button @click="refreshData" :disabled="loading">
            <ion-icon :icon="refreshOutline" />
          </ion-button>
          <!-- Bouton connexion/déconnexion -->
          <ion-button v-if="!currentUser" @click="goToLogin">
            <ion-icon :icon="personOutline" />
          </ion-button>
          <ion-button v-else @click="handleLogout" color="danger">
            <ion-icon :icon="logOutOutline" />
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content :fullscreen="true" class="map-content">
      <!-- Tableau Récapitulatif (selon le sujet) -->
      <div class="recap-section">
        <h3 class="section-title">Récapitulatif</h3>
        <div class="recap-grid">
          <div class="recap-box">
            <div class="recap-number">{{ recap.nbSignalements }}</div>
            <div class="recap-label">Nb de points</div>
          </div>
          <div class="recap-box">
            <div class="recap-number">{{ formatNumber(recap.surfaceTotale) }}</div>
            <div class="recap-label">Surface totale (m²)</div>
          </div>
          <div class="recap-box highlight">
            <div class="recap-number">{{ recap.avancementPct }}%</div>
            <div class="recap-label">Avancement</div>
            <div class="progress-bar">
              <div class="progress-fill" :style="{ width: recap.avancementPct + '%' }"></div>
            </div>
          </div>
          <div class="recap-box">
            <div class="recap-number">{{ formatBudget(recap.budgetTotal) }}</div>
            <div class="recap-label">Budget total (MGA)</div>
          </div>
        </div>
      </div>

      <!-- Filtres -->
      <div class="filter-section">
        <!-- Filtre "Mes signalements" visible uniquement si connecté -->
        <ion-segment v-if="currentUser" v-model="viewMode" mode="ios" class="view-segment">
          <ion-segment-button value="all">
            <ion-label>Tous les signalements</ion-label>
          </ion-segment-button>
          <ion-segment-button value="mine">
            <ion-label>Mes signalements</ion-label>
          </ion-segment-button>
        </ion-segment>

        <!-- Message pour visiteur -->
        <div v-if="!currentUser" class="visitor-info">
          <ion-icon :icon="informationCircleOutline" />
          <span>Connectez-vous pour signaler des problèmes</span>
          <ion-button fill="clear" size="small" @click="goToLogin">Se connecter</ion-button>
        </div>

        <div class="status-filters">
          <button 
            v-for="opt in statusOptions" 
            :key="opt.value"
            :class="['status-chip', { active: statusFilter === opt.value }]"
            :style="statusFilter === opt.value ? { background: opt.bg, color: opt.color, borderColor: opt.color } : {}"
            @click="statusFilter = opt.value"
          >
            <span class="chip-dot" :style="{ background: opt.color }"></span>
            {{ opt.label }}
          </button>
        </div>
      </div>

      <!-- Carte Leaflet -->
      <div class="map-wrapper">
        <div ref="mapContainer" class="leaflet-map"></div>

        <!-- Bouton localisation -->
        <button class="fab-btn location-btn" @click="centerOnMyLocation">
          <ion-icon :icon="locateOutline" />
        </button>

        <!-- Bouton signaler (utilisateur connecté uniquement) -->
        <button v-if="currentUser" class="fab-btn signal-btn" @click="openSignalementModal">
          <ion-icon :icon="addOutline" />
          <span>Signaler</span>
        </button>
      </div>

      <!-- Modal nouveau signalement -->
      <ion-modal :is-open="showModal" @didDismiss="closeModal">
        <ion-header>
          <ion-toolbar color="primary">
            <ion-title>Nouveau signalement</ion-title>
            <ion-buttons slot="end">
              <ion-button @click="closeModal">
                <ion-icon :icon="closeOutline" />
              </ion-button>
            </ion-buttons>
          </ion-toolbar>
        </ion-header>
        <ion-content class="ion-padding modal-content">
          <div class="modal-body">
            <div class="location-info">
              <ion-icon :icon="locationOutline" />
              <div>
                <strong>Position sélectionnée</strong>
                <p v-if="selectedPosition">
                  {{ selectedPosition.lat.toFixed(5) }}, {{ selectedPosition.lng.toFixed(5) }}
                </p>
                <p v-else class="hint">Cliquez sur la carte pour choisir</p>
              </div>
            </div>

            <p class="modal-instruction">
              Appuyez sur la carte derrière pour définir l'emplacement du problème routier.
            </p>

            <ion-button 
              expand="block" 
              @click="submitSignalementHandler"
              :disabled="!selectedPosition || submitting"
              class="submit-btn"
            >
              <ion-spinner v-if="submitting" name="dots" />
              <template v-else>
                <ion-icon :icon="sendOutline" slot="start" />
                Envoyer le signalement
              </template>
            </ion-button>
          </div>
        </ion-content>
      </ion-modal>

      <!-- Toast -->
      <ion-toast
        :is-open="toastVisible"
        :message="toastMessage"
        :color="toastColor"
        :duration="3000"
        position="top"
        @didDismiss="toastVisible = false"
      />

      <ion-loading :is-open="loading" message="Chargement..." />
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import { useRouter } from 'vue-router';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonContent,
  IonButton, IonButtons, IonIcon, IonSegment, IonSegmentButton,
  IonLabel, IonModal, IonSpinner, IonToast, IonLoading
} from '@ionic/vue';
import {
  mapOutline, refreshOutline, locateOutline, addOutline,
  closeOutline, locationOutline, sendOutline,
  personOutline, logOutOutline, informationCircleOutline
} from 'ionicons/icons';
import L from 'leaflet';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
import { auth } from '@/Firebase/FirebaseConfig';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import {
  fetchAllSignalements,
  fetchMySignalements,
  prepareSignalementPayload,
  submitSignalement,
  calculateRecapitulatif
} from '@/services/signalement';
import type { SignalementRecord, RecapitulatifData, SignalementStatus } from '@/types/signalement';

const router = useRouter();

// Leaflet map refs
const mapContainer = ref<HTMLElement | null>(null);
let map: L.Map | null = null;
let markersLayer: L.LayerGroup | null = null;
let selectionMarker: L.Marker | null = null;

// State
const loading = ref(false);
const submitting = ref(false);
const showModal = ref(false);
const viewMode = ref<'all' | 'mine'>('all');
const statusFilter = ref<SignalementStatus | 'all'>('all');
const selectedPosition = ref<{ lat: number; lng: number } | null>(null);
const currentUser = ref<User | null>(null);

const allSignalements = ref<SignalementRecord[]>([]);
const mySignalements = ref<SignalementRecord[]>([]);

// Toast
const toastVisible = ref(false);
const toastMessage = ref('');
const toastColor = ref('success');

// Status filter options
const statusOptions = [
  { value: 'all' as const, label: 'Tous', color: '#666', bg: '#f0f0f0' },
  { value: 'nouveau' as const, label: 'Nouveau', color: '#e74c3c', bg: '#fdecea' },
  { value: 'en_cours' as const, label: 'En cours', color: '#f39c12', bg: '#fef5e7' },
  { value: 'termine' as const, label: 'Terminé', color: '#27ae60', bg: '#e8f8f0' }
];

// Computed
const filteredSignalements = computed(() => {
  const source = viewMode.value === 'mine' ? mySignalements.value : allSignalements.value;
  if (statusFilter.value === 'all') return source;
  return source.filter(s => s.status === statusFilter.value);
});

const recap = computed<RecapitulatifData>(() => {
  return calculateRecapitulatif(filteredSignalements.value);
});

// Helpers
const formatNumber = (n: number) => n.toLocaleString('fr-FR');
const formatBudget = (n: number) => {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(0) + 'k';
  return n.toString();
};

const formatDate = (d: Date | null) => {
  if (!d) return 'N/A';
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' }).format(d);
};

const showToast = (msg: string, color = 'success') => {
  toastMessage.value = msg;
  toastColor.value = color;
  toastVisible.value = true;
};

// Navigation
const goToLogin = () => {
  router.push('/login');
};

const handleLogout = async () => {
  try {
    await signOut(auth);
    viewMode.value = 'all'; // Reset to all signalements view
    showToast('Déconnexion réussie');
  } catch (error) {
    console.error('Erreur de déconnexion:', error);
  }
};

// Map functions
const initMap = () => {
  if (!mapContainer.value) return;

  // Fix default marker icons
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: markerIcon2x,
    iconUrl: markerIcon,
    shadowUrl: markerShadow
  });

  // Create map centered on Antananarivo
  map = L.map(mapContainer.value).setView([-18.8792, 47.5079], 13);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap',
    maxZoom: 19
  }).addTo(map);

  markersLayer = L.layerGroup().addTo(map);

  // Click handler for placing signalement
  map.on('click', (e: L.LeafletMouseEvent) => {
    if (showModal.value) {
      placeSelectionMarker(e.latlng.lat, e.latlng.lng);
    }
  });

  setTimeout(() => map?.invalidateSize(), 200);
};

const placeSelectionMarker = (lat: number, lng: number) => {
  if (!map) return;

  selectedPosition.value = { lat, lng };

  const redIcon = L.icon({
    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
    shadowUrl: markerShadow,
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41]
  });

  if (selectionMarker) {
    selectionMarker.setLatLng([lat, lng]);
  } else {
    selectionMarker = L.marker([lat, lng], { icon: redIcon }).addTo(map);
  }
};

const updateMarkers = () => {
  if (!markersLayer) return;
  markersLayer.clearLayers();

  filteredSignalements.value.forEach(item => {
    if (item.latitude == null || item.longitude == null) return;

    // Couleur selon statut
    const colors: Record<string, string> = {
      nouveau: '#e74c3c',
      en_cours: '#f39c12',
      termine: '#27ae60'
    };
    const color = colors[item.status] || '#666';

    const icon = L.divIcon({
      className: 'custom-marker',
      html: `<div style="
        background: ${color};
        width: 20px;
        height: 20px;
        border-radius: 50%;
        border: 3px solid white;
        box-shadow: 0 2px 6px rgba(0,0,0,0.3);
      "></div>`,
      iconSize: [20, 20],
      iconAnchor: [10, 10]
    });

    // Popup avec infos du sujet: date, status, surface, budget, entreprise
    const popup = `
      <div style="min-width: 180px;">
        <div style="background: ${color}; color: white; padding: 8px 12px; margin: -10px -10px 8px; border-radius: 4px 4px 0 0; font-weight: 600;">
          ${item.statusLabel || item.status}
        </div>
        <p style="margin: 4px 0;"><strong>Date:</strong> ${formatDate(item.dateSignalement)}</p>
        <p style="margin: 4px 0;"><strong>Surface:</strong> ${item.surfaceM2 || 'N/A'} m²</p>
        <p style="margin: 4px 0;"><strong>Budget:</strong> ${item.budget ? item.budget.toLocaleString() + ' MGA' : 'N/A'}</p>
        <p style="margin: 4px 0;"><strong>Entreprise:</strong> ${item.entrepriseNom || 'Non assignée'}</p>
      </div>
    `;

    L.marker([item.latitude, item.longitude], { icon })
      .bindPopup(popup)
      .addTo(markersLayer as L.LayerGroup);
  });
};

const centerOnMyLocation = () => {
  if (!navigator.geolocation || !map) {
    showToast('Géolocalisation non disponible', 'warning');
    return;
  }

  navigator.geolocation.getCurrentPosition(
    pos => map?.setView([pos.coords.latitude, pos.coords.longitude], 16),
    () => showToast('Impossible d\'obtenir votre position', 'danger')
  );
};

const refreshData = async () => {
  loading.value = true;
  try {
    allSignalements.value = await fetchAllSignalements();
    if (currentUser.value) {
      mySignalements.value = await fetchMySignalements(currentUser.value.uid);
    }
    updateMarkers();
  } catch (err: any) {
    showToast('Erreur de chargement des données', 'danger');
  } finally {
    loading.value = false;
  }
};

// Modal handlers
const openSignalementModal = () => {
  if (!currentUser.value) {
    showToast('Connectez-vous pour signaler', 'warning');
    return;
  }
  if (map) {
    const center = map.getCenter();
    placeSelectionMarker(center.lat, center.lng);
  }
  showModal.value = true;
};

const closeModal = () => {
  showModal.value = false;
  if (selectionMarker) {
    selectionMarker.remove();
    selectionMarker = null;
  }
  selectedPosition.value = null;
};

const submitSignalementHandler = async () => {
  if (!selectedPosition.value || !currentUser.value) return;

  submitting.value = true;
  try {
    const payload = prepareSignalementPayload(
      selectedPosition.value.lat,
      selectedPosition.value.lng
    );
    await submitSignalement(payload);
    showToast('Signalement envoyé avec succès !');
    closeModal();
    await refreshData();
  } catch (err: any) {
    showToast(err.message || 'Erreur lors de l\'envoi', 'danger');
  } finally {
    submitting.value = false;
  }
};

// Lifecycle
onMounted(async () => {
  onAuthStateChanged(auth, user => {
    currentUser.value = user;
  });

  initMap();
  await refreshData();
});

watch([viewMode, statusFilter], () => {
  updateMarkers();
});

onBeforeUnmount(() => {
  map?.remove();
  map = null;
});
</script>

<style scoped>
.map-content {
  --background: #f5f7fa;
}

ion-toolbar {
  --background: white;
  --border-width: 0;
  box-shadow: 0 2px 8px rgba(0,0,0,0.06);
}

.header-content {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: 17px;
  color: #1a1a2e;
}

.header-content ion-icon {
  color: #3880ff;
}

/* Section Récap */
.recap-section {
  padding: 16px;
  background: white;
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  color: #666;
  margin: 0 0 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.recap-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}

.recap-box {
  background: #f8f9fb;
  border-radius: 12px;
  padding: 14px;
  text-align: center;
}

.recap-box.highlight {
  background: linear-gradient(135deg, #3880ff 0%, #5260ff 100%);
  color: white;
}

.recap-number {
  font-size: 22px;
  font-weight: 700;
  color: #1a1a2e;
}

.recap-box.highlight .recap-number {
  color: white;
}

.recap-label {
  font-size: 11px;
  color: #888;
  margin-top: 4px;
}

.recap-box.highlight .recap-label {
  color: rgba(255,255,255,0.8);
}

.progress-bar {
  height: 4px;
  background: rgba(255,255,255,0.3);
  border-radius: 2px;
  margin-top: 8px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: white;
  border-radius: 2px;
  transition: width 0.3s;
}

/* Filtres */
.filter-section {
  padding: 12px 16px;
  background: white;
  border-top: 1px solid #eee;
}

.view-segment {
  --background: #f0f0f0;
  border-radius: 10px;
  margin-bottom: 12px;
}

ion-segment-button {
  --indicator-color: #3880ff;
  --color-checked: white;
  --border-radius: 8px;
  font-size: 13px;
  min-height: 36px;
}

.status-filters {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 4px;
}

.status-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: 1.5px solid #ddd;
  border-radius: 20px;
  background: white;
  font-size: 12px;
  font-weight: 500;
  color: #666;
  white-space: nowrap;
  cursor: pointer;
  transition: all 0.2s;
}

.status-chip.active {
  font-weight: 600;
}

.chip-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

/* Map */
.map-wrapper {
  position: relative;
  height: calc(100% - 280px);
  min-height: 300px;
}

.leaflet-map {
  width: 100%;
  height: 100%;
}

.fab-btn {
  position: absolute;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 50px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  cursor: pointer;
  z-index: 1000;
}

.location-btn {
  bottom: 100px;
  right: 16px;
  width: 44px;
  height: 44px;
  background: white;
  color: #333;
}

.location-btn ion-icon {
  font-size: 22px;
}

.signal-btn {
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  gap: 8px;
  padding: 12px 24px;
  background: linear-gradient(135deg, #e74c3c 0%, #c0392b 100%);
  color: white;
  font-weight: 600;
  font-size: 14px;
}

.signal-btn ion-icon {
  font-size: 20px;
}

/* Modal */
.modal-content {
  --background: #f5f7fa;
}

.modal-body {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding-top: 16px;
}

.location-info {
  display: flex;
  align-items: center;
  gap: 14px;
  background: white;
  padding: 16px;
  border-radius: 12px;
}

.location-info ion-icon {
  font-size: 32px;
  color: #e74c3c;
}

.location-info strong {
  font-size: 14px;
  color: #333;
}

.location-info p {
  margin: 4px 0 0;
  font-size: 13px;
  color: #666;
  font-family: monospace;
}

.location-info .hint {
  color: #999;
  font-style: italic;
}

.modal-instruction {
  text-align: center;
  color: #888;
  font-size: 13px;
}

.submit-btn {
  --background: linear-gradient(135deg, #3880ff 0%, #5260ff 100%);
  --border-radius: 10px;
  height: 50px;
  font-weight: 600;
}

/* Info visiteur */
.visitor-info {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: #e8f4fd;
  border-radius: 8px;
  margin-bottom: 12px;
  font-size: 13px;
  color: #3880ff;
}

.visitor-info ion-icon {
  font-size: 18px;
  flex-shrink: 0;
}

.visitor-info span {
  flex: 1;
}

.visitor-info ion-button {
  --color: #3880ff;
  font-weight: 600;
}
</style>
