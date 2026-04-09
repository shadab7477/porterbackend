import admin from '../config/firebase.js';

/**
 * Send a push notification to a specific device
 * @param {string} fcmToken - Device FCM token
 * @param {string} title - Notification title
 * @param {string} body - Notification body
 * @param {Object} data - Additional data payload (optional)
 * @returns {Promise<Object>} Status of the notification
 */
export const sendNotification = async (fcmToken, title, body, data = {}) => {
    if (!admin.apps.length) {
        return { success: false, message: 'Firebase Admin not initialized properly (missing env vars)' };
    }

    try {
        console.log(`Sending notification to token: ${fcmToken.substring(0, 10)}... Title: ${title}`);
        const message = {
            notification: {
                title,
                body
            },
            data: {
                ...data,
            },
            token: fcmToken
        };

        const response = await admin.messaging().send(message);
        console.log('Successfully sent message:', response);
        return { success: true, messageId: response };
    } catch (error) {
        console.error('Error sending message:', error);
        return { success: false, error: error.message };
    }
};
