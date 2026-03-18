import admin from "firebase-admin";
// import serviceAccount from "../serviceAccountKey.json" assert { type: "json" };


const serviceAccount = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  privateKey: process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n") : undefined,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
};

if (serviceAccount.projectId && serviceAccount.privateKey && serviceAccount.clientEmail) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
  console.log("Firebase Admin initialized via environment variables.");
} else {
  console.log("Firebase environment variables missing. Firebase Admin not initialized.");
}

export default admin;