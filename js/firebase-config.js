// Firebase Configuration
// Your actual Firebase project credentials

const firebaseConfig = {
  apiKey: "AIzaSyBmzs8snhkSJZTjJCTxgaIogFnAvrWoaug",
  authDomain: "dacs-building-design.firebaseapp.com",
  projectId: "dacs-building-design",
  storageBucket: "dacs-building-design.firebasestorage.app",
  messagingSenderId: "233985196307",
  appId: "1:233985196307:web:7c11ef15168de7fe3d1ae6",
  measurementId: "G-CC110BXQSF"
};

// Initialize Firebase (using compat version)
firebase.initializeApp(firebaseConfig);

// Initialize Firestore
const db = firebase.firestore();

// Initialize Auth
const auth = firebase.auth();

// Initialize Storage
const storage = firebase.storage();

console.log('✅ Firebase initialized successfully');
console.log('📁 Project:', firebaseConfig.projectId);