import { initializeApp } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-analytics.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-database.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyBePhUfYinZ02-1BWbZvzV3IBwoAYh-kxE",
  authDomain: "suisougaku-bdcc0.firebaseapp.com",
  databaseURL: "https://suisougaku-bdcc0-default-rtdb.firebaseio.com",
  projectId: "suisougaku-bdcc0",
  storageBucket: "suisougaku-bdcc0.firebasestorage.app",
  messagingSenderId: "636001978886",
  appId: "1:636001978886:web:24e68f1ef5b66dc7fa5187",
  measurementId: "G-Y04PFJ9BQ6",
};

export const app = initializeApp(firebaseConfig);
export const analytics = getAnalytics(app);
export const db = getDatabase(app);
export const auth = getAuth(app);
