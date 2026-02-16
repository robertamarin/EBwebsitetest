// Firebase Configuration for Ethereal Balance
// =============================================
// IMPORTANT: Replace these values with your actual Firebase project config
// Get these from: Firebase Console > Project Settings > General > Your apps > Web app

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getFirestore, collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc, query, where, orderBy, limit, onSnapshot, serverTimestamp, increment as firestoreIncrement, runTransaction } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL, deleteObject, listAll } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js';

const firebaseConfig = {
    apiKey: "AIzaSyAMk6ytOsRIp4ICQRMZrdhQe90-gMEuDDM",
    authDomain: "ethereal-balance.firebaseapp.com",
    projectId: "ethereal-balance",
    storageBucket: "ethereal-balance.firebasestorage.app",
    messagingSenderId: "1062807553833",
    appId: "1:1062807553833:web:0e368360755c03d5fe9938"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const storage = getStorage(app);

// Stripe Configuration
// Replace with your Stripe publishable key (safe for client-side)
const STRIPE_PUBLISHABLE_KEY = 'pk_live_51T1V2uKBwU3yvbF87vG91VqRYw17jqpJq0f5pp54pYw8NBbfwEv5e8h2untVwYNeFeZGsuSanByjC7MjCdZsf37A00A4oHBjRE';

// Cloud Functions base URL
// Replace with your actual Firebase Cloud Functions URL after deployment
const FUNCTIONS_BASE_URL = 'https://us-central1-ethereal-balance.cloudfunctions.net';

// Export everything for use in other modules
export {
    app,
    db,
    auth,
    storage,
    storageRef,
    uploadBytes,
    getDownloadURL,
    deleteObject,
    listAll,
    STRIPE_PUBLISHABLE_KEY,
    FUNCTIONS_BASE_URL,
    collection,
    doc,
    getDoc,
    getDocs,
    addDoc,
    setDoc,
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
