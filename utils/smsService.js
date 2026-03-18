import axios from "axios";

const SMS_CONFIG = {
  authKey: process.env.BULKSMS_AUTH_KEY || "3237656e63656738303394",
  sender: process.env.BULKSMS_SENDER || "CLGFOM",
  route: process.env.BULKSMS_ROUTE || "2",
  country: process.env.BULKSMS_COUNTRY || "0",
  DLT_TE_ID: process.env.BULKSMS_DLT_ID || "1707176137809504396"
};

export const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

export const sendSmsOtp = async (mobile, otp) => {
  try {
    const { authKey, sender, route, country, DLT_TE_ID } = SMS_CONFIG;
    
    const message = `Thanks for verifying your number! Use OTP ${otp} to unlock exclusive discounts on your college Applications. Valid for 15 minutes only. www.collegeforms.in`;

    const url = `http://control.yourbulksms.com/api/sendhttp.php?authkey=${authKey}&mobiles=${mobile}&sender=${sender}&route=${route}&country=${country}&DLT_TE_ID=${DLT_TE_ID}&message=${encodeURIComponent(message)}`;

    const { data } = await axios.get(url);
    console.log("✅ SMS API Response:", data);
    console.log("📲 OTP sent to", mobile, ":", otp);
    
    return { success: true, data };
  } catch (err) {
    console.error("❌ Error sending SMS OTP:", err.message);
    return { success: false, error: err.message };
  }
};

export default { sendSmsOtp, generateOTP };
