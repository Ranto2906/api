import { createRouter, createWebHistory } from "@ionic/vue-router";
import TabsPage from "../views/TabsPage.vue";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/Firebase/FirebaseConfig";

const routes = [
  {
    path: "/",
    redirect: "/map"
  },
  {
    path: "/login",
    component: () => import("@/views/AuthPage.vue")
  },
  {
    path: "/map",
    component: () => import("@/views/MapPage.vue")
  },
  {
    path: "/tabs/",
    component: TabsPage,
    meta: { requiresAuth: true },
    children: [
      {
        path: "",
        redirect: "/tabs/map"
      },
      {
        path: "map",
        component: () => import("@/views/MapPage.vue")
      }
    ]
  }
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
});

const waitForAuthReady = () =>
  new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe();
      resolve(user);
    });
  });

router.beforeEach(async (to) => {
  const isAuthRoute = to.path === "/login";
  
  // Si l'utilisateur est connecté et va sur login, redirige vers la carte
  if (auth.currentUser && isAuthRoute) {
    return "/map";
  }

  // Routes protégées (tabs/) nécessitent authentification
  if (to.matched.some((record) => record.meta.requiresAuth)) {
    await waitForAuthReady();
    if (!auth.currentUser) {
      return "/login";
    }
  }

  return true;
});

export default router;
