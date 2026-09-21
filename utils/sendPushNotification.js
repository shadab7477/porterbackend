import admin from "../config/firebase.js";

export const sendPushNotification = async (
  fcmToken,
  title,
  body,
  data = {}
) => {
  try {
    const message = {
      token: fcmToken,
      notification: {
        title,
        body,
      },
      data: {
        ...data,
      },
    };

    const response = await admin.messaging().send(message);

    console.log("Push sent:", response);
  } catch (error) {
    console.error("Push error:", error.message);
  }
};