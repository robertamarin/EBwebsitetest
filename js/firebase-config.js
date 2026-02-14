// Firebase Configuration for Ethereal Balance
// =============================================
// IMPORTANT: Replace these values with your actual Firebase project config
// Get these from: Firebase Console > Project Settings > General > Your apps > Web app

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getFirestore, collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc, query, where, orderBy, limit, onSnapshot, serverTimestamp, increment as firestoreIncrement, runTransaction } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';

const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT.firebasestorage.app",
    messagingSenderId: "YOUR_SENDER_ID",
    appId: "YOUR_APP_ID"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// Stripe Configuration
// Replace with your Stripe publishable key (safe for client-side)
const STRIPE_PUBLISHABLE_KEY = 'pk_live_YOUR_PUBLISHABLE_KEY';

// Cloud Functions base URL
// Replace with your actual Firebase Cloud Functions URL after deployment
const FUNCTIONS_BASE_URL = 'https://us-central1-YOUR_PROJECT_ID.cloudfunctions.net';

// Export everything for use in other modules
export {
    app,
    db,
    auth,
    STRIPE_PUBLISHABLE_KEY,
    FUNCTIONS_BASE_URL,
    collection,
    doc,
    getDoc,
    getDocs,
    addDoc,
    updateDoc,
    deleteDoc,
    query,
    where,
    orderBy,
    limit,
    onSnapshot,
    serverTimestamp,
    firestoreIncrement,
    runTransaction,
    signInWithEmailAndPassword,
    onAuthStateChanged,
    signOut
};
